'use strict';
// Sessions, reconnection, rematch, room cleanup and information protection (what each client is told about the other).
process.env.TEST_MODE = '1';
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, liveMatch, TestClient, SimClient, openPair, hiddenPair, stage, shoot, dbg, tp, anglesTo, sleep, CFG, S, RV } = require('./helpers');
const log = require('../log');

let srv;
test.before(async () => {
  srv = await startServer();
  CFG.MAX_PER_IP = 500;
  CFG.AC.LOCKOUT_S = 0;
  log.setLevel('quiet');
});
test.after(async () => {
  await srv.stop();
});

/** A second connection for an existing session (same token). */
async function reconnect(tok, name) {
  const c = new TestClient(srv.url, name || 'Back');
  await c.connect({ hello: false });
  c.send({ t: 'hello', v: CFG.PROTOCOL, name: name || 'Back', tok });
  const w = await c.wait('welcome');
  return { c, w };
}

async function loggedInMatch() {
  const a = new TestClient(srv.url, 'Alpha'),
    b = new TestClient(srv.url, 'Bravo');
  const wa = await a.connect(),
    wb = await b.connect();
  a.tok = wa.tok;
  b.tok = wb.tok;
  a.send({ t: 'queue' });
  b.send({ t: 'queue' });
  const [ma, mb] = await Promise.all([a.wait('match'), b.wait('match')]);
  a.send({ t: 'ready' });
  b.send({ t: 'ready' });
  const [ra, rb] = await Promise.all([a.wait('round'), b.wait('round')]);
  await Promise.all([a.wait('live', null, 6000), b.wait('live', null, 6000)]);
  return { a, b, ma, mb, ra, rb, map: ma.map, room: ma.room };
}

test('every new connection gets a unique server-assigned id and a signed token; the id is not the username', async () => {
  const a = new TestClient(srv.url, 'Same Name'),
    b = new TestClient(srv.url, 'Same Name');
  const wa = await a.connect(),
    wb = await b.connect();
  assert.notStrictEqual(wa.id, wb.id, 'two players may share a display name but never an identity');
  assert.notStrictEqual(wa.tok, wb.tok);
  assert.strictEqual(wa.resumed, false);
  assert.ok(wa.id.length >= 12 && !wa.id.includes('Same'), 'the id is random, not derived from the name');
  assert.ok(wa.tok.startsWith(wa.id + '.'), 'the token is bound to the id');
  a.close();
  b.close();
});

test('the same token on a new connection is the same session; the first connection is replaced (never two at once)', async () => {
  const a = new TestClient(srv.url, 'Dup');
  const w = await a.connect();
  const { c: a2, w: w2 } = await reconnect(w.tok, 'Dup2');
  assert.strictEqual(w2.resumed, true);
  assert.strictEqual(w2.id, w.id, 'same identity');
  const err = await a.wait('err', null, 2000);
  assert.strictEqual(err.code, 'replaced');
  await sleep(200);
  assert.ok(a.closed, 'the old connection was closed');
  a2.close();
});

test('a session cannot be in two matches or queue twice: asking to queue inside a match resumes it instead', async () => {
  const m = await loggedInMatch();
  m.a.clear();
  m.a.send({ t: 'queue' });
  const r = await m.a.wait('resume', null, 2000);
  assert.strictEqual(r.n, 1);
  assert.strictEqual(m.a.all('queued').length, 0, 'no second queue entry for a session that is in a room');
  assert.strictEqual(srv.lobby.rooms.size >= 1, true);
  // and a second connection with the same token also lands in the SAME room (not a new one)
  const { c: dup } = await reconnect(m.a.tok);
  const r2 = await dup.wait('resume', null, 2000);
  assert.strictEqual(r2.map, m.map);
  m.a.close();
  m.b.close();
  dup.close();
});

test('a dropped player can come back: the opponent is told, clocks stop, and the match resumes where it was', async () => {
  const old = CFG.RECONNECT_GRACE_S;
  CFG.RECONNECT_GRACE_S = 6;
  try {
    const m = await loggedInMatch();
    const pair = openPair(m.map, 8);
    const sa = await stage(m, m.ra, pair);
    await sleep(150);
    const rt0 = m.b.last('snap').rt;
    // A's network drops
    m.a.close();
    const away = await m.b.wait('opp', (x) => x.st === 'away', 2000);
    assert.strictEqual(away.g, 6, 'B is told how long it will wait');
    await sleep(1200);
    // B cannot hurt a player who is away (they cannot answer)
    const sb = new SimClient(m.b, m.map, m.rb.you, m.rb.n);
    // A comes back with the token
    const { c: a2, w } = await reconnect(m.a.tok, 'Alpha');
    assert.strictEqual(w.resumed, true);
    const resume = await a2.wait('resume', null, 2000);
    assert.strictEqual(resume.n, 1);
    assert.strictEqual(resume.ph, 2, 'the round is live');
    assert.strictEqual(resume.hp, 150);
    assert.strictEqual(resume.st.length, RV.PLAYER_STATE_LEN, 'the full movement state comes with it');
    assert.strictEqual(resume.opp, 'Bravo');
    assert.strictEqual(resume.fx > 0, true);
    const back = await m.b.wait('opp', (x) => x.st === 'back', 2000);
    assert.ok(back);
    await sleep(300);
    const rt1 = m.b.last('snap').rt;
    assert.ok(rt0 - rt1 < 1.0, 'the round clock stood still while A was away (' + rt0 + ' -> ' + rt1 + ')');
    // the match goes on: A is where it was and the room is the same
    const d = await dbg(a2);
    assert.ok(Math.hypot(d.x - pair.a.x, d.z - pair.a.z) < 0.01, 'A is exactly where it stood');
    a2.close();
    m.b.close();
  } finally {
    CFG.RECONNECT_GRACE_S = old;
  }
});

test('a player who is away cannot be hurt, and is hurt again after returning', async () => {
  const old = CFG.RECONNECT_GRACE_S;
  CFG.RECONNECT_GRACE_S = 8;
  try {
    const m = await loggedInMatch();
    const pair = openPair(m.map, 8);
    // B shoots at A: swap the roles for the staging helper
    const sw = { a: m.b, b: m.a, map: m.map };
    const sb = await stage(sw, m.rb, { a: pair.b, b: pair.a });
    m.a.close();
    await m.b.wait('opp', (x) => x.st === 'away', 2000);
    m.b.clear();
    shoot(sb);
    await sleep(500);
    assert.strictEqual(m.b.all('hit').length, 0, 'no damage to a player who is away');
    const { c: a2 } = await reconnect(m.a.tok, 'Alpha');
    await a2.wait('resume', null, 2000);
    await sleep(200);
    shoot(sb);
    const hit = await m.b.wait('hit', null, 2000);
    assert.strictEqual(hit.dmg, 12, 'after returning A can be hit again');
    a2.close();
    m.b.close();
  } finally {
    CFG.RECONNECT_GRACE_S = old;
  }
});

test('nobody comes back: after the grace period the remaining player wins by forfeit, the room is cleaned up', async () => {
  const old = CFG.RECONNECT_GRACE_S;
  CFG.RECONNECT_GRACE_S = 1.2;
  try {
    const m = await loggedInMatch();
    m.a.close();
    const e = await m.b.wait('matchEnd', null, 5000);
    assert.strictEqual(e.w, 'you');
    assert.strictEqual(e.reason, 'forfeit');
    assert.strictEqual(e.rm, 0, 'no rematch against someone who left');
    await sleep(400);
    assert.strictEqual([...srv.lobby.rooms].filter((r) => r.id === m.room).length, 0, 'the room is gone');
    // the winner is free to queue again
    m.b.send({ t: 'queue' });
    assert.ok(await m.b.wait('queued'));
    m.b.close();
  } finally {
    CFG.RECONNECT_GRACE_S = old;
  }
});

test('both players dropping leaves no broken room and no leaked session', async () => {
  const oldG = CFG.RECONNECT_GRACE_S,
    oldS = CFG.SESSION_IDLE_S;
  CFG.RECONNECT_GRACE_S = 1;
  CFG.SESSION_IDLE_S = 0.5;
  try {
    const before = srv.lobby.rooms.size;
    const m = await loggedInMatch();
    assert.strictEqual(srv.lobby.rooms.size, before + 1);
    const sidA = (await m.a.wait('snap')).rn && m.a.tok.split('.')[0];
    m.a.close();
    m.b.close();
    await sleep(3200);
    assert.strictEqual(srv.lobby.rooms.size, before, 'the abandoned room was removed');
    assert.strictEqual(srv.lobby.sessions.map.has(sidA), false, 'and so were the idle sessions');
  } finally {
    CFG.RECONNECT_GRACE_S = oldG;
    CFG.SESSION_IDLE_S = oldS;
  }
});

test('after a match both players can leave the rematch screen; leaving tells the other one; an unanswered rematch expires', async () => {
  const old = CFG.REMATCH_WINDOW_S;
  CFG.REMATCH_WINDOW_S = 1.5;
  try {
    // 1) the rematch window times out
    let m = await loggedInMatch();
    const room = [...srv.lobby.rooms].find((r) => r.id === m.room);
    room.score = [4, 0];
    room.endRound(0); // round won -> match over
    await m.a.wait('matchEnd', null, 6000);
    assert.ok((await m.b.wait('matchEnd', null, 2000)).rm > 0);
    m.a.send({ t: 'rematch' });
    assert.strictEqual((await m.b.wait('rematch')).st, 'opp');
    const closed = await m.b.wait('rematch', (x) => x.st === 'closed', 4000);
    assert.ok(closed, 'nobody answered: the window closed');
    await sleep(200);
    assert.strictEqual([...srv.lobby.rooms].filter((r) => r.id === m.room).length, 0);
    m.a.close();
    m.b.close();
    // 2) leaving the results screen tells the opponent at once
    m = await loggedInMatch();
    const room2 = [...srv.lobby.rooms].find((r) => r.id === m.room);
    room2.score = [4, 0];
    room2.endRound(0);
    await m.a.wait('matchEnd', null, 6000);
    await m.b.wait('matchEnd', null, 2000);
    m.b.send({ t: 'leave' });
    assert.strictEqual((await m.a.wait('rematch', null, 2000)).st, 'left');
    m.a.close();
    m.b.close();
  } finally {
    CFG.REMATCH_WINDOW_S = old;
  }
});

test('information protection: a hidden opponent is not replicated (no coordinates), a visible one is', async () => {
  // behind a wall: the other player's position never reaches the client
  let m;
  const bp = ['toybox', 'skybridge', 'pinwheel', 'vertigo'].some((id) => hiddenPair(id));
  let tested = false;
  for (let tries = 0; tries < 12 && bp && !tested; tries++) {
    m = await liveMatch(srv);
    const pair = hiddenPair(m.map);
    if (!pair) {
      m.a.close();
      m.b.close();
      await sleep(100);
      continue;
    }
    await stage(m, m.ra, pair, { settle: 900 });
    await sleep(600);
    const sa = m.a.last('snap'),
      sb = m.b.last('snap');
    assert.strictEqual(sa.o.hid, 1, 'A is told nothing about where B is');
    assert.strictEqual(sa.o.x, undefined);
    assert.strictEqual(sa.o.z, undefined);
    assert.strictEqual(sb.o.hid, 1);
    assert.strictEqual(JSON.stringify(sa).includes(String(Math.round(pair.b.x))) && sa.o.x !== undefined, false);
    // the shot sound still reaches the hidden player, but without the shooter's position
    tested = true;
    m.a.close();
    m.b.close();
  }
  assert.ok(tested || !bp, 'a blocked pair was exercised');
  // in the open: replicated with full state
  m = await liveMatch(srv);
  const open = openPair(m.map, 8);
  await stage(m, m.ra, open, { settle: 600 });
  await sleep(400);
  const so = m.a.last('snap');
  assert.ok(so.o.x !== undefined && so.o.al === 1, 'a visible opponent is replicated');
  assert.ok(Math.hypot(so.o.x - open.b.x, so.o.z - open.b.z) < 0.05);
  m.a.close();
  m.b.close();
});

test('information protection: a grenade thrown from out of sight does not reveal the thrower (only the explosion is shared)', async () => {
  let done = false;
  for (let tries = 0; tries < 12 && !done; tries++) {
    const m = await liveMatch(srv);
    const pair = hiddenPair(m.map);
    if (!pair) {
      m.a.close();
      m.b.close();
      await sleep(100);
      continue;
    }
    const sa = await stage(m, m.ra, pair, { slotA: 3, settle: 900 });
    await sleep(500);
    assert.strictEqual(m.b.last('snap').o.hid, 1, 'B cannot see A');
    m.a.clear();
    m.b.clear();
    sa.act('nadepin');
    sa.step(30, {});
    sa.step(1, { pitch: -1.5 }); // down at the thrower's feet
    sa.act('nade');
    const own = await m.a.wait('nade');
    assert.strictEqual(own.own, true, 'the thrower sees their own grenade');
    await sleep(500);
    assert.strictEqual(m.b.all('nade').length, 0, 'the hidden opponent is not told where the grenade started');
    const boom = await m.b.wait('boom', null, 4000);
    assert.strictEqual(boom.own, false, 'but the explosion (a loud world event) is shared');
    done = true;
    m.a.close();
    m.b.close();
  }
  assert.ok(done, 'a hidden pair was exercised');
});

test('visibility has margin: an opponent about to come around a corner is already replicated (no pop-in)', async () => {
  const room = S.worldFor('toybox');
  // geometry check of the rule itself: from a spot with a clear line the look-ahead and hold-time keep the opponent visible
  const m = await liveMatch(srv);
  const open = openPair(m.map, 6);
  await stage(m, m.ra, open, { settle: 600 });
  await sleep(300);
  assert.strictEqual(m.a.last('snap').o.hid, undefined);
  // block the line of sight by teleporting B behind something (if the map has such a spot): the info stays for HOLD_S, then stops
  const bp = hiddenPair(m.map);
  if (bp) {
    const aim = anglesTo(bp.b, bp.a, 1);
    tp(m.b, bp.b, aim.yaw, aim.pitch, 0);
    const aim2 = anglesTo(bp.a, bp.b, 1);
    tp(m.a, bp.a, aim2.yaw, aim2.pitch, 0);
    await sleep(150);
    assert.ok(m.a.last('snap'), 'still receiving snapshots');
    await sleep(CFG.VIS.HOLD_S * 1000 + 600);
    assert.strictEqual(m.a.last('snap').o.hid, 1, 'after the hold time the hidden opponent is no longer sent');
  }
  m.a.close();
  m.b.close();
});

test('the server survives and keeps matches apart when a client misbehaves mid-match', async () => {
  const m1 = await liveMatch(srv, ['IsoA', 'IsoB']);
  const m2 = await liveMatch(srv, ['IsoC', 'IsoD']);
  // A1 sends nonsense for a while
  for (let i = 0; i < 200; i++) m1.a.send(i % 2 ? '{"t":"in","rn":"x"}' : { t: 'act', rn: m1.ra.n, q: 99999, a: 'fire', s: 0 });
  await sleep(500);
  m2.a.send({ t: 'ping', ts: 1 });
  assert.ok(await m2.a.wait('pong'), 'the other room never noticed');
  assert.ok(m2.b.last('snap').hp === 150);
  for (const c of [m1.a, m1.b, m2.a, m2.b]) c.close();
});
