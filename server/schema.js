'use strict';
/*
 * Message schemas. EVERY message from a client is checked here before anything else looks at it: its type must
 * be a known one, every field must have the right type and range, arrays have a maximum length, and only the
 * fields listed here survive (anything else a client adds, such as "damage", "kills", "id" or "seat", is dropped
 * before the game code ever sees the message). Returns the cleaned message, or null if it is not acceptable.
 */
const CFG = require('./config');
const S = require('./shared');

const RV = S.RV;
const isNum = (v) => typeof v === 'number' && isFinite(v);
const isInt = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}\.[A-Za-z0-9_-]{16,64}$/;
const ACTIONS = ['fire', 'punch', 'reload', 'nadepin', 'nadecancel', 'nade', 'nadeself', 'nadeq'];
const PI = Math.PI + 0.01;

const simple = (t) => () => ({ t });

const TYPES = {
  hello(m) {
    if (!isInt(m.v, 0, 1000)) return null;
    return { t: 'hello', v: m.v, name: typeof m.name === 'string' ? m.name.slice(0, 64) : '', tok: typeof m.tok === 'string' && TOKEN_RE.test(m.tok) ? m.tok : '' };
  },
  ping(m) {
    return isNum(m.ts) ? { t: 'ping', ts: m.ts } : null;
  },
  spong(m) {
    return isNum(m.ts) ? { t: 'spong', ts: m.ts } : null;
  },
  queue: simple('queue'),
  /** Join the free-for-all room of a map (an always-running open room). */
  ffa(m) {
    return typeof m.map === 'string' && /^[a-z0-9_]{2,24}$/.test(m.map) ? { t: 'ffa', map: m.map } : null;
  },
  unqueue: simple('unqueue'),
  /** The map vote of a freshly paired match: one of the maps on offer. */
  vote(m) {
    return typeof m.map === 'string' && /^[a-z0-9_]{2,24}$/.test(m.map) ? { t: 'vote', map: m.map } : null;
  },
  ready: simple('ready'),
  leave: simple('leave'),
  rematch: simple('rematch'),

  /** A batch of movement input: runs of identical input (see js/netproto.js) + the client's predicted position. */
  in(m) {
    if (!isInt(m.rn, 0, 1e6) || !isInt(m.q, 0, 1e9) || !Array.isArray(m.r) || m.r.length < 1 || m.r.length > 24) return null;
    const runs = [];
    let steps = 0;
    for (const r of m.r) {
      if (!Array.isArray(r) || r.length !== 7) return null;
      const k = r[0], fw = r[1], sd = r[2], fl = r[3], y = r[4], p = r[5], w = r[6];
      if (!isInt(k, 1, RV.NETP.MAX_RUN_STEPS) || !(fw === -1 || fw === 0 || fw === 1) || !(sd === -1 || sd === 0 || sd === 1)) return null;
      if (!isInt(fl, 0, 31) || !isNum(y) || !isNum(p) || Math.abs(y) > PI || Math.abs(p) > 1.5535 || !isInt(w, 0, 3)) return null;
      steps += k;
      if (steps > 240) return null;
      runs.push({ k, fw, sd, fl, y, p, w });
    }
    let c = null;
    if (m.c !== undefined) {
      if (!Array.isArray(m.c) || m.c.length !== 4 || !isNum(m.c[0]) || !isNum(m.c[1]) || !isNum(m.c[2]) || !isInt(m.c[3], 0, 1e9)) return null;
      if (Math.abs(m.c[0]) > 5000 || Math.abs(m.c[1]) > 5000 || Math.abs(m.c[2]) > 5000) return null;
      c = { x: m.c[0], y: m.c[1], z: m.c[2], fx: m.c[3] };
    }
    return { t: 'in', rn: m.rn, q: m.q, runs, steps, c };
  },

  /** A discrete action (fire, punch, reload, grenade). It carries no direction: the server aims with the view the inputs describe. */
  act(m) {
    if (!isInt(m.rn, 0, 1e6) || !isInt(m.q, 0, 1e9) || typeof m.a !== 'string' || ACTIONS.indexOf(m.a) < 0 || !isInt(m.s, 0, 3)) return null;
    return { t: 'act', rn: m.rn, q: m.q, a: m.a, s: m.s };
  },
};

if (CFG.TEST_MODE) {
  // test-only: put a player somewhere (lets the combat tests stage a fight without walking there)
  TYPES.dbg = simple('dbg'); // test-only: ask the room for the exact server-side state of my player
  TYPES.tp = (m) => {
    if (!isNum(m.x) || !isNum(m.y) || !isNum(m.z) || !isNum(m.yaw) || !isNum(m.pitch)) return null;
    return { t: 'tp', x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, slot: isInt(m.slot, 0, 3) ? m.slot : -1, hp: isInt(m.hp, 1, 150) ? m.hp : -1 };
  };
}

/** @returns the cleaned message or null */
function parse(m) {
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
  const f = Object.prototype.hasOwnProperty.call(TYPES, m.t) ? TYPES[m.t] : null;
  return f ? f(m) : null;
}

module.exports = { parse, TOKEN_RE };
