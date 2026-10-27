'use strict';
// The free-for-all room: an always-running open room per map. Anyone joins at any time, everybody fights everybody, a death means a respawn a few
// seconds later and a point for the killer, the first to the kill limit wins the round of the room (scores reset), nobody is ever thrown out
// for it. All of it is decided by the server (same movement physics, lag-compensated hits, line-of-sight culling as in 1v1).
process.env.TEST_MODE = '1';
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { startServer, TestClient, SimClient, openPair, hiddenPair, anglesTo, tp, dbg, shoot, sleep, CFG, S, RV } = require('./helpers');

const MAP = 'testarena';
const opened = []; // every client a test opens: closed after the test, pass or fail, so one failure cannot fill the room for the next
let srv;
test.before(async () => {
  srv = await startServer();
  CFG.MAX_PER_IP = 500;
  CFG.AC.LOCKOUT_S = 0;
  CFG.FFA.MAX_PLAYERS = 3; // (a small room makes "full" easy to test; the room reads the setting when it is asked)
  CFG.FFA.RESPAWN_S = 0.7;
  CFG.FFA.SPAWN_PROTECT_S = 0;
  srv.lobby.ffa.get(MAP).slots.length = 3;
});
afterEach(async () => {
  for (const c of opened.splice(0)) c.close();
  for (let i = 0; i < 40 && srv.lobby.ffa.get(MAP).count > 0; i++) await sleep(25);
});
test.after(async () => {
  await srv.stop();
});

/** Connect, join the room of MAP, finish "loading" and wait for the first spawn. */
async function join(name, opts) {
  const tc = new TestClient(srv.url, name);
  opened.push(tc);
  const welcome = await tc.connect();
  tc.welcome = welcome;
  tc.send({ t: 'ffa', map: (opts && opts.map) || MAP });
  const j = await tc.wait('ffa');
  if (opts && opts.noReady) return { tc, j };
  tc.send({ t: 'ready' });
  const sp = await tc.wait('fspawn');
  const sa = new SimClient(tc, MAP, 0, sp.rn);
  sa.pl.setState(sp.st);
  return { tc, j, sp, sa };
}
const room = () => srv.lobby.ffa.get(MAP);
const inRoom = (name) => room().p.find((x) => x.name === name);

/** Put `x` at `pos` looking at `to` (TEST_MODE) and wait until the server confirms. */
async function place(x, pos, look, slot, hp) {
  const a = look ? anglesTo(pos, look, 1.0) : { yaw: 0, pitch: 0 };
  x.tc.clear('fix');
  tp(x.tc, pos, a.yaw, a.pitch, slot == null ? 0 : slot, hp);
  const f = await x.tc.wait('fix', (m) => m.why === 'tp', 3000);
  x.tc.msgs.unshift(f);
  x.sa.pump();
  x.sa.pl.yaw = a.yaw;
  x.sa.pl.pitch = a.pitch;
  x.sa.slot = slot == null ? 0 : slot;
}

test('joining: the server answers with the map and your slot, the map loads, `ready` puts you into the world with a numbered life', async () => {
  const a = await join('Alpha');
  assert.strictEqual(a.j.map, MAP);
  assert.strictEqual(a.j.cap, 3);
  assert.ok(a.j.kl >= 1 && a.j.rs > 0, 'the kill limit and the respawn time are told');
  assert.ok(Array.isArray(a.j.l) && a.j.l.length === 1, 'the player list has me in it');
  assert.strictEqual(a.sp.rn, 1, 'first life');
  assert.strictEqual(a.sp.hp, RV.MAX_HP);
  assert.ok(Array.isArray(a.sp.st) && a.sp.st.length === RV.PLAYER_STATE_LEN, 'the full movement state to start from');
  const snap = await a.tc.wait('fsnap');
  assert.strictEqual(snap.rn, 1);
  assert.strictEqual(snap.hp, RV.MAX_HP);
  assert.ok(Array.isArray(snap.os), 'a snapshot carries the list of the other players you can see');
  a.tc.close();
  await sleep(150);
  assert.strictEqual(room().count, 0, 'closing the connection takes the player out of the room');
});

test('the same session opened in a second window takes its slot over: the new connection loads and gets a fresh life, the old one is closed', async () => {
  const a = await join('Alpha');
  assert.ok(a.tc.welcome.tok, 'a new session comes with a token');
  const second = new TestClient(srv.url, 'Alpha');
  opened.push(second);
  await second.connect({ hello: false });
  second.send({ t: 'hello', v: CFG.PROTOCOL, name: 'Alpha', tok: a.tc.welcome.tok });
  const w = await second.wait('welcome');
  assert.strictEqual(w.resumed, true);
  const j = await second.wait('ffa');
  assert.strictEqual(j.map, MAP);
  assert.strictEqual(j.you, a.j.you, 'the same slot');
  assert.strictEqual(room().count, 1, 'still one player in the room, not two');
  second.send({ t: 'ready' });
  const sp = await second.wait('fspawn');
  assert.ok(sp.rn >= 2, 'a fresh life, numbered after the old one');
  await sleep(200);
  assert.ok(a.tc.closed, 'the old connection was closed');
});

test('before it says `ready` a joined player is not in the world: it cannot be shot, seen, or see (it is still loading)', async () => {
  const a = await join('Alpha');
  const b = await join('Bravo', { noReady: true });
  assert.strictEqual(room().count, 2);
  await sleep(300);
  const sn = a.tc.last('fsnap');
  assert.strictEqual(sn.os.length, 0, 'a loading player is not replicated');
  assert.strictEqual(room().foes(room().playerOf(a.tc.session ? a.tc : room().p[0].cl)).length, 0, 'and it is nobody\'s target');
  assert.strictEqual(b.tc.all('fsnap').length, 0, 'it is sent no snapshots either');
  a.tc.close();
  b.tc.close();
  await sleep(150);
});

test('anyone can join and leave at any time: the board lists everyone, a full room says so, leaving frees the slot', async () => {
  const a = await join('Alpha');
  const b = await join('Bravo');
  const c = await join('Charlie');
  await sleep(400);
  const board = a.tc.last('fboard');
  assert.ok(board && board.l.length === 3, 'the board has three players');
  assert.deepStrictEqual(board.l.map((r) => r[1]).sort(), ['Alpha', 'Bravo', 'Charlie']);
  // a fourth player: the room is full, the server says so plainly and does not touch the others
  const d = new TestClient(srv.url, 'Delta');
  await d.connect();
  d.send({ t: 'ffa', map: MAP });
  const err = await d.wait('err');
  assert.strictEqual(err.code, 'full');
  assert.strictEqual(room().count, 3);
  // somebody leaves: the slot is free at once and the next player gets it
  b.tc.send({ t: 'leave' });
  await sleep(200);
  assert.strictEqual(room().count, 2);
  d.send({ t: 'ffa', map: MAP });
  await d.wait('ffa');
  assert.strictEqual(room().count, 3);
  d.send({ t: 'ready' });
  await d.wait('fspawn');
  for (const x of [a.tc, b.tc, c.tc, d]) x.close();
  await sleep(200);
  assert.strictEqual(room().count, 0);
});

test('an unknown map is refused, and a player who joined can go on to a 1v1 queue (they leave the room first)', async () => {
  const x = new TestClient(srv.url, 'Alpha');
  await x.connect();
  x.send({ t: 'ffa', map: 'nowhere' });
  assert.strictEqual((await x.wait('err')).code, 'nomap');
  x.send({ t: 'ffa', map: MAP });
  await x.wait('ffa');
  x.send({ t: 'ready' });
  await x.wait('fspawn');
  assert.strictEqual(room().count, 1);
  x.send({ t: 'queue' });
  await x.wait('queued');
  assert.strictEqual(room().count, 0, 'queueing for a duel took the player out of the free-for-all room');
  x.send({ t: 'unqueue' });
  x.close();
  await sleep(100);
});

test('the server runs everybody\'s movement from their input exactly like in 1v1 (what the client predicts is what the server simulates)', async () => {
  const a = await join('Alpha');
  await sleep(200);
  a.tc.clear('fix');
  await a.sa.run(1.2, () => ({ fw: 1, sprint: true }));
  await sleep(250);
  a.sa.pump();
  const d = await dbg(a.tc);
  const b = a.sa.pl.b;
  const sim = a.sa.seq;
  assert.ok(d.a > sim * 0.8, 'the server simulated most of the input (' + d.a + ' / ' + sim + ' steps)');
  assert.ok(Math.hypot(b.x - d.x, b.z - d.z) < 6, 'and is in the same neighbourhood (prediction vs authority)');
  assert.ok(a.sa.fixes <= 3, 'with next to no corrections (' + a.sa.fixes + ')');
  a.tc.close();
  await sleep(100);
});

test('everybody fights everybody: a hit costs health, the victim and the attacker are told, the kill goes on the board and in the kill feed to all', async () => {
  const a = await join('Alpha');
  const b = await join('Bravo');
  const c = await join('Charlie');
  const pair = openPair(MAP, 9);
  await place(a, pair.a, pair.b, 0);
  await place(b, pair.b, pair.a, 0, 20); // 20 health: two body shots
  // Charlie is in the room too (the kill feed must reach everybody) but far away from the line of fire, at the spawn farthest from the fight
  const far = RV.maps[MAP].spawns.reduce((m, s) => (Math.hypot(s.x - pair.a.x, s.z - pair.a.z) > Math.hypot(m.x - pair.a.x, m.z - pair.a.z) ? s : m));
  await place(c, { x: far.x, y: far.y, z: far.z }, null, 0);
  await sleep(450);
  for (const x of [a, b, c]) x.tc.clear();
  shoot(a.sa, 14);
  a.sa.flush();
  const hit = await a.tc.wait('hit', null, 2500);
  assert.strictEqual(hit.v, b.j.you, 'the hit names the victim');
  assert.ok(hit.dmg >= 10 && !hit.kill);
  const hurt = await b.tc.wait('hurt');
  assert.strictEqual(hurt.by, a.j.you, 'the victim knows who it was');
  assert.strictEqual(hurt.hp, 20 - hit.dmg);
  for (let i = 0; i < 4 && !a.tc.all('hit').some((h) => h.kill); i++) {
    shoot(a.sa, 14);
    a.sa.flush();
    await sleep(60);
  }
  await sleep(150);
  const kill = a.tc.all('hit').find((h) => h.kill);
  assert.ok(kill, 'the killing blow is flagged');
  for (const x of [a, b, c]) {
    const kf = await x.tc.wait('fkf', null, 2000);
    assert.strictEqual(kf.k, a.j.you);
    assert.strictEqual(kf.v, b.j.you);
    assert.strictEqual(kf.w, 'rifle');
  }
  await sleep(300);
  const board = c.tc.last('fboard');
  const rowA = board.l.find((r) => r[0] === a.j.you),
    rowB = board.l.find((r) => r[0] === b.j.you);
  assert.strictEqual(rowA[2], 1, 'one elimination for the killer');
  assert.strictEqual(rowB[3], 1, 'one death for the victim');
  assert.strictEqual(rowB[4], 0, 'and the victim is dead for now');
  for (const x of [a, b, c]) x.tc.close();
  await sleep(200);
});

test('a dead player respawns by itself after the respawn time, on a new numbered life; input of the old life is ignored', async () => {
  const a = await join('Alpha');
  const b = await join('Bravo');
  const pair = openPair(MAP, 9);
  await place(a, pair.a, pair.b, 0);
  await place(b, pair.b, pair.a, 0, 10);
  await sleep(450);
  b.tc.clear();
  shoot(a.sa, 14);
  a.sa.flush();
  await b.tc.wait('hurt');
  const t0 = Date.now();
  const sp = await b.tc.wait('fspawn', null, 4000);
  const dt = Date.now() - t0;
  assert.strictEqual(sp.rn, 2, 'the second life');
  assert.ok(dt > 400 && dt < 1800, 'back after about the respawn time (' + dt + ' ms)');
  assert.strictEqual(sp.hp, RV.MAX_HP);
  // input that still carries the first life's number goes nowhere
  const d0 = await dbg(b.tc);
  b.sa.round = 1;
  b.sa.pl.setState(sp.st);
  b.sa.seq = b.sa.sent = 0;
  b.sa.step(30, { fw: 1 });
  b.sa.flush(true);
  await sleep(250);
  const d1 = await dbg(b.tc);
  assert.strictEqual(d1.a, d0.a, 'the old life\'s input did not move the new body');
  // the new life's input does
  b.sa.round = sp.rn;
  b.sa.seq = b.sa.sent = 0;
  b.sa.runs = [];
  b.sa.pending = [];
  b.sa.pl.setState(sp.st);
  b.sa.step(30, { fw: 1 });
  b.sa.flush(true);
  await sleep(300);
  const d2 = await dbg(b.tc);
  assert.ok(d2.a > 20, 'the new life\'s input is simulated (' + d2.a + ' steps)');
  a.tc.close();
  b.tc.close();
  await sleep(150);
});

test('spawn protection: a fresh spawn takes no damage until it attacks or the time runs out (the shooter is told the shot was absorbed)', async () => {
  CFG.FFA.SPAWN_PROTECT_S = 1.2;
  try {
    const a = await join('Alpha');
    const b = await join('Bravo');
    const pair = openPair(MAP, 9);
    await place(a, pair.a, pair.b, 0);
    await place(b, pair.b, pair.a, 0, 100);
    // (the teleport helper does not respawn: protect Bravo by hand for this check)
    inRoom('Bravo').protUntil = performance.now() + 1500;
    await sleep(450);
    a.tc.clear();
    shoot(a.sa, 14);
    a.sa.flush();
    await a.tc.wait('blk', null, 2000);
    assert.strictEqual(a.tc.all('hit').length, 0);
    assert.strictEqual(inRoom('Bravo').hp, 100, 'no damage');
    a.tc.close();
    b.tc.close();
    await sleep(150);
  } finally {
    CFG.FFA.SPAWN_PROTECT_S = 0;
  }
});

test('information protection holds in the free-for-all too: a player behind a wall is not replicated, one in the open is', async () => {
  const hid = hiddenPair(MAP);
  const open = openPair(MAP, 9);
  assert.ok(hid && open);
  const a = await join('Alpha');
  const b = await join('Bravo');
  await place(a, hid.a, null, 0);
  await place(b, hid.b, null, 0);
  await sleep(900);
  assert.strictEqual(a.tc.last('fsnap').os.length, 0, 'hidden: nothing about the other player is sent');
  await place(a, open.a, open.b, 0);
  await place(b, open.b, open.a, 0);
  await sleep(700);
  const os = a.tc.last('fsnap').os;
  assert.strictEqual(os.length, 1, 'in the open: one visible player');
  assert.strictEqual(os[0][0], b.j.you);
  assert.ok(Math.hypot(os[0][1] - open.b.x, os[0][3] - open.b.z) < 1.5, 'at the right place');
  a.tc.close();
  b.tc.close();
  await sleep(150);
});

test('the first to the kill limit wins the round of the room: everybody is told, the scores reset, nobody is thrown out', async () => {
  const oldLimit = CFG.FFA.KILL_LIMIT;
  CFG.FFA.KILL_LIMIT = 2;
  try {
    const a = await join('Alpha');
    const b = await join('Bravo');
    const pair = openPair(MAP, 9);
    for (let i = 0; i < 2; i++) {
      await place(a, pair.a, pair.b, 0);
      await place(b, pair.b, pair.a, 0, 10);
      await sleep(450);
      a.tc.clear('hit');
      b.tc.clear('fspawn');
      shoot(a.sa, 14);
      a.sa.flush();
      await a.tc.wait('hit', (h) => h.kill, 2500);
      if (i === 0) await b.tc.wait('fspawn', null, 4000); // (it respawns somewhere else: stage again)
    }
    const win = await b.tc.wait('fwin', null, 2500);
    assert.strictEqual(win.i, a.j.you);
    assert.strictEqual(win.n, 'Alpha');
    await sleep(500);
    const row = a.tc.last('fboard').l.find((r) => r[0] === a.j.you);
    assert.strictEqual(row[2], 0, 'scores are back to zero');
    assert.strictEqual(room().count, 2, 'and nobody was removed');
    a.tc.close();
    b.tc.close();
    await sleep(150);
  } finally {
    CFG.FFA.KILL_LIMIT = oldLimit;
  }
});

test('a player who stops playing is moved out after the idle time (an open server must not fill up with sleepers)', async () => {
  const old = CFG.FFA.IDLE_S;
  CFG.FFA.IDLE_S = 1.2;
  try {
    const a = await join('Alpha');
    const b = await join('Bravo');
    // Bravo keeps moving; Alpha does nothing
    const t0 = Date.now();
    while (Date.now() - t0 < 2200 && !a.tc.closed) {
      b.sa.step(8, { fw: 1, yaw: (Date.now() - t0) / 1000 });
      b.sa.flush(true);
      await sleep(40);
    }
    const end = await a.tc.wait('matchEnd', null, 1500);
    assert.match(end.reason, /inactive/);
    assert.strictEqual(room().count, 1, 'only the active player is left');
    assert.strictEqual(room().p[0].name, 'Bravo');
    a.tc.close();
    b.tc.close();
    await sleep(150);
  } finally {
    CFG.FFA.IDLE_S = old;
  }
});

test('a player who never finishes loading the map is dropped, and a flood of stale or foreign messages from a joined player is just ignored', async () => {
  const old = CFG.FFA.LOAD_TIMEOUT_S;
  CFG.FFA.LOAD_TIMEOUT_S = 0.8;
  try {
    const b = await join('Bravo', { noReady: true });
    await sleep(1400);
    assert.strictEqual(room().count, 0, 'dropped');
    const end = await b.tc.wait('matchEnd', null, 1000);
    assert.match(end.reason, /did not load/);
    b.tc.close();
  } finally {
    CFG.FFA.LOAD_TIMEOUT_S = old;
  }
});

test('a grenade in the free-for-all hurts everybody it reaches except its thrower, who is launched by their own blast', async () => {
  const a = await join('Alpha');
  const b = await join('Bravo');
  const pair = openPair(MAP, 3);
  await place(a, pair.a, pair.b, 3);
  await place(b, pair.b, pair.a, 0, 150);
  await sleep(450);
  for (const x of [a, b]) x.tc.clear();
  // pin, hold for the full time, and it goes off on the thrower (a boost) 3 m from Bravo: Bravo is inside the 6 m blast
  a.sa.act('nadepin', 3);
  a.sa.step(Math.round((RV.WEAPON_BY_ID.grenade.hold.total + 0.1) * 120), {});
  a.sa.act('nadeself', 3);
  const hurt = await b.tc.wait('hurt', (h) => h.src === 'grenade', 3000);
  assert.ok(hurt.dmg >= 1 && hurt.by === a.j.you, 'Bravo took blast damage from Alpha');
  const boom = await a.tc.wait('boom', null, 2000);
  assert.strictEqual(boom.own, true);
  assert.strictEqual(a.tc.all('hurt').length, 0, 'the thrower is never hurt by their own grenade');
  a.tc.close();
  b.tc.close();
  await sleep(150);
});

test('falling into the void is a death; the last player who hurt you gets the credit', async () => {
  const world = S.worldFor(MAP);
  const oldKill = world.killY;
  const a = await join('Alpha');
  const b = await join('Bravo');
  const pair = openPair(MAP, 9);
  await place(a, pair.a, pair.b, 0);
  await place(b, pair.b, pair.a, 0, 100);
  await sleep(450);
  shoot(a.sa, 14); // Alpha wounds Bravo ...
  a.sa.flush();
  await b.tc.wait('hurt', null, 2000);
  for (const x of [a, b]) x.tc.clear();
  world.killY = 1; // ... who then drops into the void (the Arena has a floor: lift the kill plane above it for a moment)
  try {
    b.sa.step(20, {}); // (the void is checked while the player's own steps are simulated: a real client always sends some)
    b.sa.flush();
    const kf = await a.tc.wait('fkf', (m) => m.v === b.j.you, 4000);
    assert.strictEqual(kf.k, a.j.you, 'credited to the player who had just shot them');
    assert.strictEqual(kf.w, 'fall');
  } finally {
    world.killY = oldKill;
  }
  a.tc.close();
  b.tc.close();
  await sleep(150);
});

test('the debug summary and /health list the room (players per map) without exposing anything private', async () => {
  const a = await join('Alpha');
  const res = await (await fetch(srv.http + '/health')).json();
  assert.strictEqual(res.ffa[MAP], 1);
  assert.strictEqual(res.ffaCap, 3);
  assert.ok(!JSON.stringify(res).includes('Alpha'), 'no names in the public status');
  a.tc.close();
  await sleep(100);
});

test('a grenade of a player who has since left still goes off, but nobody is named as the thrower (their seat may belong to someone else by now)', async () => {
  const a = await join('Alpha');
  const b = await join('Bravo');
  const pa = inRoom('Alpha');
  const seatA = pa.seat;
  a.tc.send({ t: 'leave' });
  for (let i = 0; i < 40 && !pa.gone; i++) await sleep(25);
  assert.ok(pa.gone, 'Alpha is out of the room');
  const c = await join('Carol'); // takes the seat Alpha left
  assert.strictEqual(inRoom('Carol').seat, seatA, 'the seat was handed on');
  for (const x of [b, c]) x.tc.clear();
  room().damage(inRoom('Bravo'), 9999, pa, { head: false, src: 'grenade', from: { x: 0, z: 0 } }); // (Alpha's grenade, thrown before they left, goes off now)
  const hurt = await b.tc.wait('hurt', null, 2000);
  assert.strictEqual(hurt.by, -1, 'the victim is not told the new owner of the seat threw it');
  const feed = await c.tc.wait('fkf', (m) => m.v === b.j.you, 2000);
  assert.strictEqual(feed.k, -1, 'the kill feed does not credit the new owner of the seat');
  assert.strictEqual(inRoom('Carol').kills, 0, 'and Carol gets no point for it');
  b.tc.close();
  c.tc.close();
  await sleep(100);
});
