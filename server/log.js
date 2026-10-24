'use strict';
/*
 * Structured logging: one JSON object per line (or plain text with LOG_FORMAT=text), ISO timestamps, a stable
 * event name (`ev`) and small fields. Secrets never go in here: any field called token / tok / secret /
 * authorization / password is dropped before writing, and callers pass session ids (random, not personal),
 * never IP addresses or names unless the event is about that.
 *
 *   log.info('match_start', { room: 3, map: 'toybox' })
 *   log.sec('violation', { sid, rule, ... })     // security / anti-cheat events: also kept in a ring for /debug/anticheat
 */
const CFG = require('./config');

const SECRET_KEY = /token|^tok$|secret|authorization|password|cookie/i;
const ring = [];
const counters = Object.create(null);
let level = CFG.LOG_LEVEL;
let format = CFG.LOG_FORMAT;
let sink = (line) => console.log(line);

function clean(fields) {
  const out = {};
  for (const k of Object.keys(fields || {})) {
    if (SECRET_KEY.test(k)) continue;
    const v = fields[k];
    out[k] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '...' : v;
  }
  return out;
}

function write(lvl, ev, fields, security) {
  const rec = Object.assign({ ts: new Date().toISOString(), lvl, ev }, clean(fields));
  counters[ev] = (counters[ev] || 0) + 1;
  if (security) {
    ring.push(rec);
    while (ring.length > CFG.AC.EVENT_RING) ring.shift();
  }
  if (level === 'quiet') return rec;
  if (lvl === 'debug' && level !== 'debug') return rec;
  if (format === 'text') {
    const { ts, lvl: l, ev: e, ...rest } = rec;
    sink(ts.slice(11, 19) + ' ' + l + ' ' + e + ' ' + Object.keys(rest).map((k) => k + '=' + JSON.stringify(rest[k])).join(' '));
  } else sink(JSON.stringify(rec));
  return rec;
}

const log = {
  debug: (ev, f) => write('debug', ev, f, false),
  info: (ev, f) => write('info', ev, f, false),
  warn: (ev, f) => write('warn', ev, f, false),
  /** Security / anti-cheat event: always recorded in the ring, logged at warn level. */
  sec: (ev, f) => write('warn', ev, f, true),
  recent: (n) => ring.slice(-(n || 100)),
  counters: () => Object.assign({}, counters),
  setLevel(l) {
    level = l;
  },
  setFormat(f) {
    format = f;
  },
  setSink(fn) {
    sink = fn;
  },
  clear() {
    ring.length = 0;
    for (const k of Object.keys(counters)) delete counters[k];
  },
};

module.exports = log;
