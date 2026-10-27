'use strict';
/*
 * Connections, handshake, sessions, rate limiting, latency measurement and the matchmaking queue.
 * Every connected player is a Client bound to a Session (sessions.js); two queued Clients become a Room (room.js).
 */
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const CFG = require('./config');
const log = require('./log');
const schema = require('./schema');
const ac = require('./anticheat');
const { Sessions } = require('./sessions');
const { Room } = require('./room');
const { FfaRoom } = require('./ffa');
const { RV } = require('./shared');

const now = () => performance.now();
const NAME_RE = /[^A-Za-z0-9_\- ]/g;

/** Same rules as the browser: 3-16 characters, letters / digits / space / _ / -. */
function cleanName(s) {
  const n = String(s == null ? '' : s)
    .replace(NAME_RE, '')
    .replace(/ +/g, ' ')
    .trim()
    .slice(0, 16);
  return n.length >= 3 ? n : 'Player' + (100 + Math.floor(Math.random() * 900));
}

class Client {
  constructor(conn, ip, lobby) {
    this.conn = conn;
    this.ip = ip;
    this.lobby = lobby;
    this.id = crypto.randomBytes(4).toString('hex'); // connection id until the handshake gives the session id
    this.session = null;
    this.name = '';
    this.state = 'new'; // new | idle | queued | voting | room
    this.vote = null; // the map vote this client is in
    this.room = null;
    this.seat = -1;
    this.rtt = 80;
    this.rttHist = []; // the last few ping samples (a browser that is busy answers late: the lowest samples are the network)
    this.rttLC = 80; // the estimate lag compensation uses: half the average, half the best of the recent samples
    this.lastSeen = now();
    this.connectedAt = now();
    this.tokens = 120;
    this.tokenAt = now();
    this.pingSent = 0;
    this.dead = false;
    this.replaced = false;
    this.over = 0;

    conn.on('message', (text) => this.onText(text));
    conn.on('close', () => {
      try {
        lobby.onClose(this);
      } catch (e) {
        lobby.handlerError('close', e);
      }
    });
  }

  get sid() {
    return this.session ? this.session.id : this.id;
  }

  alive() {
    return !this.dead && this.conn.open;
  }

  send(obj) {
    if (this.dead) return false;
    return this.conn.send(JSON.stringify(obj));
  }

  kick(msg) {
    if (this.dead) return;
    this.send({ t: 'err', code: 'kicked', msg });
    this.conn.close(1008, msg);
  }

  onText(text) {
    const t = now();
    this.lastSeen = t;
    // token bucket: 120 messages of burst, 90 per second sustained (input batches are ~30 per second)
    this.tokens = Math.min(120, this.tokens + ((t - this.tokenAt) / 1000) * 90);
    this.tokenAt = t;
    if (this.tokens > 60) this.over = 0;
    if (--this.tokens < 0) {
      // over the limit: the message is dropped; the first 60 are recorded one by one, after that every 10th (a flood is
      // kicked quickly, but a flooding client cannot make the server spend effort on every single packet)
      this.over++;
      if (this.over <= 60 || this.over % 10 === 0) this.lobby.violate(this, 'rate_limit');
      return;
    }
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      this.lobby.violate(this, 'bad_message', { why: 'not json' });
      return;
    }
    const m = schema.parse(raw);
    if (!m) {
      this.lobby.violate(this, 'bad_message', { why: 'schema', type: raw && typeof raw.t === 'string' ? raw.t.slice(0, 16) : typeof raw });
      return;
    }
    // This runs inside the socket's data event: an exception here (a bug in the game code that one player's message happened to reach)
    // must cost that one message, never the whole server with every other match on it.
    try {
      this.lobby.onMessage(this, m);
    } catch (e) {
      this.lobby.handlerError(m.t, e);
    }
  }
}

class Lobby {
  constructor() {
    this.clients = new Set();
    this.queue = [];
    this.votes = new Set(); // map votes in progress (two paired players each)
    this.rooms = new Set();
    this.ffa = new Map(); // map id -> its always-running free-for-all room
    if (CFG.FFA.ENABLED) {
      const maps = CFG.FFA.MAPS.length ? CFG.FFA.MAPS : CFG.MAPS;
      for (const id of maps) if (RV.maps[id] && CFG.MAPS.includes(id)) this.ffa.set(id, new FfaRoom(0, id, this));
    }
    this.sessions = new Sessions();
    this.nextRoom = 1;
    this.perIp = new Map();
    this.started = Date.now();
    this.totals = { connections: 0, matches: 0, finished: 0, kicks: 0, reconnects: 0, errors: 0 };
    this.lastTick = now();
    this.timer = null;
  }

  start() {
    const dt = 1000 / CFG.TICK_HZ;
    this.timer = setInterval(() => this.tick(), dt);
    this.slow = setInterval(() => this.housekeeping(), 1000);
    this.timer.unref && this.timer.unref();
    this.slow.unref && this.slow.unref();
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.slow);
    for (const c of this.clients) c.conn.close(1001, 'server shutting down');
  }

  /** false = refuse the connection (limits). */
  admit(ip) {
    if (this.clients.size >= CFG.MAX_CONNECTIONS) return false;
    return (this.perIp.get(ip) || 0) < CFG.MAX_PER_IP;
  }

  onConnection(conn, ip) {
    const c = new Client(conn, ip, this);
    this.clients.add(c);
    this.perIp.set(ip, (this.perIp.get(ip) || 0) + 1);
    this.totals.connections++;
    log.debug('connect', { cid: c.id });
    return c;
  }

  /** An exception in a network handler (message / close): logged, counted, and then ignored. Clients never see the internals. */
  handlerError(what, e) {
    this.totals.errors++;
    log.warn('handler_error', { what: String(what).slice(0, 16), msg: String(e && e.message).slice(0, 120), at: String((e && e.stack) || '').split('\n')[1] });
  }

  /** Record a rule violation for this client and act on the verdict (warn / kick). */
  violate(c, rule, detail) {
    const verdict = ac.record({ sid: c.sid, ip: c.ip }, rule, Object.assign({ room: c.room ? c.room.id : undefined }, detail));
    if (verdict === 'kick') {
      this.totals.kicks++;
      c.kick('Disconnected: the server detected suspicious activity. You can reconnect in ' + CFG.AC.LOCKOUT_S + ' seconds.');
    } else if (verdict === 'warn') c.send({ t: 'warn', msg: 'Unusual activity detected. Please play normally; repeated violations disconnect you.' });
    return verdict;
  }

  onClose(c) {
    if (c.dead) return;
    c.dead = true;
    this.clients.delete(c);
    const n = (this.perIp.get(c.ip) || 1) - 1;
    if (n <= 0) this.perIp.delete(c.ip);
    else this.perIp.set(c.ip, n);
    const qi = this.queue.indexOf(c);
    if (qi >= 0) this.queue.splice(qi, 1);
    if (c.vote) this.cancelVote(c.vote, c); // (the other player goes back to the front of the queue)
    const s = c.session;
    if (s && s.client === c && !c.replaced) {
      s.client = null;
      s.expireAt = Date.now() + CFG.SESSION_IDLE_S * 1000;
      if (s.room) s.room.onDisconnect(s);
    }
    log.debug('disconnect', { sid: c.sid });
  }

  info() {
    const ffa = {};
    for (const [id, r] of this.ffa) ffa[id] = r.count;
    return { online: this.clients.size, queued: this.queue.length, rooms: this.rooms.size, ffa, ffaCap: CFG.FFA.MAX_PLAYERS };
  }

  onMessage(c, m) {
    switch (m.t) {
      case 'hello': {
        if (c.state !== 'new') return;
        if (m.v !== CFG.PROTOCOL) {
          c.send({ t: 'err', code: 'version', msg: 'This game server speaks protocol ' + CFG.PROTOCOL + ' (your game: ' + m.v + '). Reload the page.' });
          c.conn.close(1008, 'protocol mismatch');
          return;
        }
        let s = m.tok ? this.sessions.verify(m.tok) : null;
        const resumed = !!s;
        const wait = ac.lockedFor(s ? s.id : '-', c.ip);
        if (wait) {
          c.send({ t: 'err', code: 'locked', msg: 'You were disconnected for suspicious activity. Try again in ' + wait + ' seconds.' });
          c.conn.close(1008, 'locked');
          return;
        }
        if (s) {
          // the same session on a new connection replaces the old one (a session is never in two places)
          const old = s.client;
          if (old && old !== c) {
            old.replaced = true;
            old.send({ t: 'err', code: 'replaced', msg: 'This session was opened in another window.' });
            old.conn.close(1000, 'replaced');
          }
          this.totals.reconnects++;
        } else {
          s = this.sessions.create(cleanName(m.name), c.ip);
          if (!s) {
            c.send({ t: 'err', code: 'full', msg: 'The server is full. Try again in a minute.' });
            c.conn.close(1013, 'full');
            return;
          }
        }
        s.client = c;
        s.ip = c.ip;
        c.session = s;
        c.name = s.name;
        c.state = s.room ? 'room' : 'idle';
        log.info(resumed ? 'session_resume' : 'session_new', { sid: s.id, room: s.room ? s.room.id : undefined });
        c.send({ t: 'welcome', id: s.id, name: s.name, v: CFG.PROTOCOL, tick: CFG.TICK_HZ, resumed, tok: resumed ? undefined : s.token, ...this.info() });
        if (s.room) s.room.attach(s, c);
        return;
      }
      case 'spong':
        if (c.pingSent && Math.abs(m.ts - c.pingSent) < 1) {
          const sample = now() - c.pingSent;
          c.rtt = c.rtt * 0.7 + Math.min(sample, 2000) * 0.3;
          c.rttHist.push(Math.min(sample, 2000));
          if (c.rttHist.length > 6) c.rttHist.shift();
          c.rttLC = c.rtt * 0.5 + Math.min(...c.rttHist) * 0.5;
          c.pingSent = 0;
        }
        return;
      case 'ping':
        c.send({ t: 'pong', ts: m.ts });
        return;
    }
    if (c.state === 'new') return;
    switch (m.t) {
      case 'vote':
        this.onVote(c, m);
        return;
      case 'ffa': {
        if (c.vote) this.cancelVote(c.vote, c); // (leaving a map vote for a free-for-all room)
        const s = c.session;
        const wait = ac.lockedFor(s.id, c.ip);
        if (wait) {
          c.send({ t: 'err', code: 'locked', msg: 'You are locked out for ' + wait + ' more seconds.' });
          return;
        }
        const room = this.ffa.get(m.map);
        if (!room) {
          c.send({ t: 'err', code: 'nomap', msg: 'There is no free-for-all room on that map.' });
          return;
        }
        if (s.room) {
          if (s.room === room) {
            room.attach(s, c); // (the same room: just take it up again)
            return;
          }
          if (s.room.phase !== 'over' && !(s.room instanceof FfaRoom)) {
            s.room.attach(s, c); // a running 1v1 match is resumed, never abandoned by joining something else
            return;
          }
          s.room.onLeave(c, 'left'); // a finished match, or another free-for-all room: leave it first
        }
        const qi = this.queue.indexOf(c);
        if (qi >= 0) this.queue.splice(qi, 1);
        c.state = 'idle';
        if (!room.join(c)) c.send({ t: 'err', code: 'full', msg: 'This room is full (' + room.count + ' / ' + CFG.FFA.MAX_PLAYERS + '). Pick another map.' });
        return;
      }
      case 'queue': {
        const s = c.session;
        const wait = ac.lockedFor(s.id, c.ip);
        if (wait) {
          c.send({ t: 'err', code: 'locked', msg: 'Matchmaking is locked for ' + wait + ' more seconds.' });
          return;
        }
        if (s.room instanceof FfaRoom) s.room.onLeave(c, 'left'); // (from a free-for-all room to a 1v1 queue)
        if (s.room) {
          // a running match is resumed, never duplicated; a finished one is left to make room for a new queue entry
          if (s.room.phase === 'over') s.room.onLeave(c, 'left');
          else {
            s.room.attach(s, c);
            return;
          }
        }
        if (c.state === 'idle') {
          c.state = 'queued';
          this.queue.push(c);
          c.send({ t: 'queued', ...this.info() });
          this.tryMatch();
        }
        return;
      }
      case 'unqueue': {
        if (c.vote) this.cancelVote(c.vote, c);
        const i = this.queue.indexOf(c);
        if (i >= 0) this.queue.splice(i, 1);
        if (c.state === 'queued') c.state = 'idle';
        c.send({ t: 'unqueued' });
        return;
      }
    }
    if (c.room) c.room.onMessage(c, m);
  }

  tryMatch() {
    while (this.queue.length >= 2) {
      const a = this.queue.shift(),
        b = this.queue.shift();
      if (!a.alive()) {
        if (b.alive()) this.queue.unshift(b);
        continue;
      }
      if (!b.alive()) {
        this.queue.unshift(a);
        continue;
      }
      if (a.session === b.session) {
        this.queue.unshift(a); // (cannot happen: one connection per session) never match a session with itself
        continue;
      }
      this.startVote(a, b);
    }
  }

  /** The maps a match can be played on (a map whose data file is missing is skipped, never played). */
  mapPool() {
    return CFG.MAPS.filter((id) => RV.maps[id]);
  }

  /** Two players were paired: they vote on the map first (or, with the vote switched off, the server picks one). */
  startVote(a, b) {
    const pool = this.mapPool();
    const n = Math.min(pool.length, Math.max(2, CFG.VOTE.OPTIONS));
    if (!CFG.VOTE.ENABLED || pool.length < 2) return this.startRoom(a, b, pool[Math.floor(Math.random() * pool.length)]);
    const opts = pool
      .map((id) => ({ id, r: Math.random() }))
      .sort((x, y) => x.r - y.r)
      .slice(0, n)
      .map((o) => o.id);
    const v = { a, b, opts, votes: new Map(), until: now() + CFG.VOTE.SECONDS * 1000 };
    a.state = b.state = 'voting';
    a.vote = b.vote = v;
    this.votes.add(v);
    for (const [c, o] of [
      [a, b],
      [b, a],
    ])
      c.send({ t: 'vote', opts, secs: CFG.VOTE.SECONDS, opp: o.name });
    log.info('vote_start', { a: a.session.id, b: b.session.id, opts });
  }

  /** A player's vote (they may change it until the vote closes). A late or stray vote is simply ignored. */
  onVote(c, m) {
    const v = c.vote;
    if (!v || c.state !== 'voting') return;
    if (v.opts.indexOf(m.map) < 0) {
      this.violate(c, 'bad_message', { why: 'vote' });
      return;
    }
    v.votes.set(c, m.map);
    const n = {};
    for (const id of v.opts) n[id] = 0;
    for (const id of v.votes.values()) n[id]++;
    for (const p of [v.a, v.b]) p.send({ t: 'votes', n });
    if (v.votes.size >= 2) this.finishVote(v);
  }

  /** The vote is over (both voted, or time ran out): the most votes win, a tie or no votes at all is decided by chance. */
  finishVote(v) {
    if (!this.votes.delete(v)) return;
    const n = new Map();
    for (const id of v.opts) n.set(id, 0);
    for (const id of v.votes.values()) n.set(id, n.get(id) + 1);
    const top = Math.max(...n.values());
    const cands = v.opts.filter((id) => n.get(id) === top);
    const map = cands[Math.floor(Math.random() * cands.length)];
    v.a.vote = v.b.vote = null;
    for (const c of [v.a, v.b]) c.send({ t: 'voteend', map });
    if (!v.a.alive() || !v.b.alive()) {
      // (cannot normally happen: a closing connection cancels its vote first) whoever is still here searches again
      for (const c of [v.a, v.b]) if (c.alive()) this.requeue(c);
      return;
    }
    this.startRoom(v.a, v.b, map);
  }

  /** One of the two left (closed the connection, stopped searching, went to a free-for-all room): the other one searches again, first in line. */
  cancelVote(v, gone) {
    if (!this.votes.delete(v)) return;
    v.a.vote = v.b.vote = null;
    if (gone && gone.state === 'voting') gone.state = 'idle';
    const other = v.a === gone ? v.b : v.a;
    if (other && other !== gone && other.alive()) {
      other.send({ t: 'votecancel', why: 'left' });
      this.requeue(other, true);
    }
  }

  requeue(c, front) {
    c.state = 'queued';
    if (front) this.queue.unshift(c);
    else this.queue.push(c);
    c.send({ t: 'queued', ...this.info() });
    this.tryMatch();
  }

  startRoom(a, b, map) {
    let room;
    try {
      room = new Room(this.nextRoom++, map, a, b, (r) => this.roomClosed(r));
    } catch (e) {
      // (a map that cannot be loaded, say) the two players are told plainly and can search again; the server is not affected
      this.handlerError('startRoom', e);
      for (const c of [a, b]) {
        c.room = null;
        c.state = c.alive() ? 'idle' : c.state;
        c.send({ t: 'err', code: 'server', msg: 'The match could not be started. Please try again.' });
      }
      return;
    }
    a.state = b.state = 'room';
    a.session.room = b.session.room = room;
    this.rooms.add(room);
    this.totals.matches++;
    log.info('match_start', { room: room.id, map, a: a.session.id, b: b.session.id, an: a.name, bn: b.name });
  }

  roomClosed(room) {
    this.rooms.delete(room);
    this.totals.finished++;
    for (const p of room.p) {
      const s = this.sessions.map.get(p.sid);
      if (s && s.room === room) {
        s.room = null;
        s.expireAt = Date.now() + CFG.SESSION_IDLE_S * 1000;
        if (s.client && !s.client.dead && s.client.state === 'room') s.client.state = 'idle';
      }
    }
    log.debug('room_closed', { room: room.id });
  }

  tick() {
    const t = now();
    const dt = Math.min(0.1, (t - this.lastTick) / 1000);
    this.lastTick = t;
    for (const v of [...this.votes]) {
      if (t < v.until) continue;
      try {
        this.finishVote(v);
      } catch (e) {
        // (the match could not be made: both players go back to idle with a plain message, the server carries on)
        this.handlerError('vote', e);
        v.a.vote = v.b.vote = null;
        for (const c of [v.a, v.b]) {
          if (c.state === 'voting' || c.state === 'queued') c.state = 'idle';
          c.send({ t: 'err', code: 'server', msg: 'The match could not be started. Please try again.' });
        }
      }
    }
    for (const r of [...this.rooms, ...this.ffa.values()]) {
      try {
        r.tick(t, dt);
      } catch (e) {
        if (r instanceof FfaRoom) {
          // an always-running room cannot be closed: log it, tell nobody the internals, and keep ticking (the players stay)
          log.warn('ffa_error', { room: r.id, msg: String(e && e.message).slice(0, 120), at: String((e && e.stack) || '').split(String.fromCharCode(10))[1] });
          continue;
        }
        // one broken room must never take the server (or the other rooms) down; clients get no internals
        log.warn('room_error', { room: r.id, msg: String(e && e.message).slice(0, 120) });
        r.abort('server error');
      }
    }
  }

  /** once a second: latency pings, idle timeouts, handshake timeout, session cleanup */
  housekeeping() {
    const t = now();
    for (const c of this.clients) {
      if (c.state === 'new' && t - c.connectedAt > 8000) {
        c.conn.close(1008, 'no hello');
        continue;
      }
      if (t - c.lastSeen > 12000) {
        c.conn.terminate(1001, 'timed out');
        continue;
      }
      if (!c.pingSent) {
        c.pingSent = t;
        c.send({ t: 'sping', ts: t });
      }
    }
    for (const s of this.sessions.sweep()) ac.forget(s.id);
    ac.sweep();
  }
}

module.exports = { Lobby, Client, cleanName };
