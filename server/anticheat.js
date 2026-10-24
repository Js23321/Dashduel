'use strict';
/*
 * Anti-cheat scoring. Every rule violation adds weight to a per-session score that decays over time (1 point a
 * second by default), so one odd event (a lag spike, a duplicate packet) is forgotten while sustained cheating
 * adds up:
 *
 *   score >= WARN_SCORE  -> the client gets a warning message and the event is logged
 *   score >= KICK_SCORE  -> disconnect, and the session + address cannot queue for LOCKOUT_S seconds (never a permanent ban)
 *   SEVERE_KICK_COUNT "severe" events inside SEVERE_WINDOW_S -> the same kick (impossible actions: a gap in the
 *                           input sequence, an action from the future, flooding the input queue)
 *
 * Nothing here decides who wins a fight or what a position is: the simulation does that. This module only
 * decides when to stop talking to a client that keeps breaking the rules. All numbers come from config.js.
 */
const CFG = require('./config');
const log = require('./log');

const now = () => Date.now();

/** rule id -> weight; severe = impossible for an honest client */
const RULES = {
  bad_message: { w: 4, why: 'malformed or unexpected message' },
  rate_limit: { w: 4, why: 'too many messages per second' },
  seq_gap: { w: 30, severe: true, why: 'input sequence has a gap' },
  seq_dup: { w: 6, why: 'duplicate or overlapping input' },
  input_overflow: { w: 25, severe: true, why: 'more input queued than real time allows (speed hack / flooding)' },
  act_future: { w: 20, severe: true, why: 'action refers to input that was never sent' },
  act_order: { w: 8, why: 'actions out of order' },
  aim_rate: { w: 6, why: 'view turned faster than a human can' },
  prediction_mismatch: { w: 2, why: 'client movement differs from the server simulation' },
  fire_rate: { w: 3, why: 'shot faster than the weapon fires' },
  fire_no_ammo: { w: 4, why: 'shot with an empty magazine' },
  fire_dead: { w: 2, why: 'shot while unable to fire' },
  fire_wrong_weapon: { w: 3, why: 'shot with a weapon that is not equipped' },
  melee_rate: { w: 3, why: 'punched faster than allowed' },
  nade_rate: { w: 8, why: 'grenade thrown without a pin / too quickly' },
  nade_early: { w: 12, why: 'grenade self-detonation before the hold time' },
  weapon_switch_rate: { w: 2, why: 'weapon switching faster than allowed' },
  reload_invalid: { w: 3, why: 'reload that is not possible' },
};

const trackers = new Map(); // sid -> { score, at, counts, severe:[], warnedAt }
const lock = new Map(); // 'sid:..' / 'ip:..' -> until (ms)
const byRule = Object.create(null);
let kicks = 0;

function decayed(tr, t) {
  tr.score = Math.max(0, tr.score - ((t - tr.at) / 1000) * CFG.AC.DECAY_PER_S);
  tr.at = t;
  return tr.score;
}

/**
 * Record a violation. `who` = { sid, ip }. Returns 'none' | 'warn' | 'kick'.
 * `detail` is a small object for the log (never put secrets in it).
 */
function record(who, rule, detail) {
  const R = RULES[rule] || { w: 3, why: rule };
  const t = now();
  let tr = trackers.get(who.sid);
  if (!tr) trackers.set(who.sid, (tr = { score: 0, at: t, counts: Object.create(null), severe: [], warnedAt: 0 }));
  decayed(tr, t);
  tr.score += R.w;
  tr.counts[rule] = (tr.counts[rule] || 0) + 1;
  byRule[rule] = (byRule[rule] || 0) + 1;
  let severeRecent = 0;
  if (R.severe) {
    tr.severe.push(t);
    while (tr.severe.length && t - tr.severe[0] > CFG.AC.SEVERE_WINDOW_S * 1000) tr.severe.shift();
    severeRecent = tr.severe.length;
  }
  log.sec('violation', Object.assign({ sid: who.sid, rule, w: R.w, score: Math.round(tr.score * 10) / 10, severe: !!R.severe }, detail || {}));
  if (tr.score >= CFG.AC.KICK_SCORE || severeRecent >= CFG.AC.SEVERE_KICK_COUNT) {
    kicks++;
    const until = t + CFG.AC.LOCKOUT_S * 1000;
    lock.set('sid:' + who.sid, until);
    if (who.ip) lock.set('ip:' + who.ip, until);
    tr.score = 0;
    tr.severe.length = 0;
    log.sec('kick', { sid: who.sid, rule, lockoutS: CFG.AC.LOCKOUT_S });
    return 'kick';
  }
  if (tr.score >= CFG.AC.WARN_SCORE && t - tr.warnedAt > 10000) {
    tr.warnedAt = t;
    log.sec('warn', { sid: who.sid, rule, score: Math.round(tr.score) });
    return 'warn';
  }
  return 'none';
}

/** Seconds left of a lockout for this session / address (0 = free). */
function lockedFor(sid, ip) {
  const t = now();
  let until = 0;
  for (const k of ['sid:' + sid, 'ip:' + ip]) {
    const u = lock.get(k);
    if (u === undefined) continue;
    if (u <= t) lock.delete(k);
    else until = Math.max(until, u);
  }
  return until ? Math.ceil((until - t) / 1000) : 0;
}

function forget(sid) {
  trackers.delete(sid);
}

function sweep() {
  const t = now();
  for (const [k, u] of lock) if (u <= t) lock.delete(k);
  for (const [sid, tr] of trackers) if (decayed(tr, t) <= 0 && t - tr.at > 120000) trackers.delete(sid);
}

/** For the development-only inspection endpoint: no tokens, no addresses, short session ids. */
function snapshot() {
  const t = now();
  const active = [];
  for (const [sid, tr] of trackers) {
    decayed(tr, t);
    if (tr.score > 0.5 || Object.keys(tr.counts).length) active.push({ sid: sid.slice(0, 6), score: Math.round(tr.score * 10) / 10, counts: tr.counts });
  }
  return { rules: Object.keys(RULES).map((k) => ({ rule: k, weight: RULES[k].w, severe: !!RULES[k].severe, why: RULES[k].why, seen: byRule[k] || 0 })), active, kicks, lockouts: lock.size, thresholds: CFG.AC };
}

module.exports = { RULES, record, lockedFor, forget, sweep, snapshot };
