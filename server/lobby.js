'use strict';
/*
 * Connections, handshake, rate limiting, latency measurement and the matchmaking queue.
 * Every connected player is a Client; two queued Clients become a Room (room.js).
 */
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const CFG = require('./config');
const S = require('./shared');
const { Room } = require('./room');

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

let log = () => {};
function setLogger(level) {
  const stamp = () => new Date().toISOString().slice(11, 19);
  log = (lvl, ...a) => {
    if (level === 'quiet') return;
    if (lvl === 'debug' && level !== 'debug') return;
    console.log(stamp(), ...a);
  };
}
setLogger(CFG.LOG_LEVEL);

class Client {
  constructor(conn, ip, lobby) {
    this.conn = conn;
    this.ip = ip;
    this.lobby = lobby;
    this.id = crypto.randomBytes(4).toString('hex');
    this.name = '';
    this.state = 'new'; // new | idle | queued | room
    this.room = null;
    this.seat = -1;
    this.rtt = 80;
    this.lastSeen = now();
    this.connectedAt = now();
    this.tokens = 120;
    this.tokenAt = now();
    this.bad = 0;
    this.pingSent = 0;
    this.dead = false;

    conn.on('message', (text) => this.onText(text));
    conn.on('close', () => lobby.onClose(this));
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
    // token bucket: 120 messages of burst, 90 per second sustained (snapshots are 30 per second)
    this.tokens = Math.min(120, this.tokens + ((t - this.tokenAt) / 1000) * 90);
    this.tokenAt = t;
    if (--this.tokens < 0) {
      if (++this.bad > 60) this.kick('Too many messages');
      return;
    }
    let m;
    try {
      m = JSON.parse(text);
    } catch (e) {
      if (++this.bad > 20) this.kick('Invalid data');
      return;
    }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    this.lobby.onMessage(this, m);
  }
}

class Lobby {
  constructor() {
    this.clients = new Set();
    this.queue = [];
    this.rooms = new Set();
    this.nextRoom = 1;
    this.perIp = new Map();
    this.started = Date.now();
    this.totals = { connections: 0, matches: 0, finished: 0 };
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
    log('debug', 'connect', c.id);
    return c;
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
    if (c.room) c.room.onLeave(c, 'disconnected');
    log('debug', 'disconnect', c.id, c.name);
  }

  info() {
    return { online: this.clients.size, queued: this.queue.length, rooms: this.rooms.size };
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
        c.name = cleanName(m.name);
        c.state = 'idle';
        c.send({ t: 'welcome', id: c.id, name: c.name, v: CFG.PROTOCOL, tick: CFG.TICK_HZ, ...this.info() });
        return;
      }
      case 'spong':
        if (typeof m.ts === 'number' && c.pingSent && Math.abs(m.ts - c.pingSent) < 1) {
          const sample = now() - c.pingSent;
          c.rtt = c.rtt * 0.7 + Math.min(sample, 2000) * 0.3;
          c.pingSent = 0;
        }
        return;
      case 'ping':
        c.send({ t: 'pong', ts: m.ts });
        return;
    }
    if (c.state === 'new') return;
    switch (m.t) {
      case 'queue':
        if (c.state === 'idle') {
          c.state = 'queued';
          this.queue.push(c);
          c.send({ t: 'queued', ...this.info() });
          this.tryMatch();
        }
        return;
      case 'unqueue': {
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
      const map = CFG.MAPS[Math.floor(Math.random() * CFG.MAPS.length)];
      const room = new Room(this.nextRoom++, map, a, b, (r) => this.roomClosed(r));
      a.state = b.state = 'room';
      this.rooms.add(room);
      this.totals.matches++;
      log('info', 'match', room.id, map, a.name, 'vs', b.name);
    }
  }

  roomClosed(room) {
    this.rooms.delete(room);
    this.totals.finished++;
    for (const p of room.p) {
      if (!p.cl.dead && p.cl.state === 'room') p.cl.state = 'idle';
    }
    log('debug', 'room closed', room.id);
  }

  tick() {
    const t = now();
    const dt = Math.min(0.1, (t - this.lastTick) / 1000);
    this.lastTick = t;
    for (const r of this.rooms) r.tick(t, dt);
  }

  /** once a second: latency pings, idle timeouts, handshake timeout, stats */
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
  }
}

module.exports = { Lobby, Client, cleanName, setLogger, log: (...a) => log(...a) };
