/* DASHDUEL - personal bests and lifetime stats (localStorage). */
(function () {
  'use strict';
  const RV = window.RV;
  const KEY = 'records.v1';

  function blank() {
    return {
      tt: {}, // mapId -> {best, splits[], topSpeed, runs}
      arena: {}, // mapId -> {bestKills, fastestWin, matches, wins, kills, deaths, topSpeed}
      duel: {}, // mapId -> {matches, wins, roundsWon, roundsLost, streak, bestStreak}
      online: { matches: 0, wins: 0, roundsWon: 0, roundsLost: 0, streak: 0, bestStreak: 0 }, // real players, all maps
      practiceTopSpeed: 0,
      totals: { kills: 0, deaths: 0, shots: 0, hits: 0, jumps: 0, playTime: 0, topSpeed: 0 },
    };
  }

  const rec = (RV.records = {
    data: blank(),
  });

  rec.load = function () {
    const saved = RV.store.get(KEY, null);
    const d = blank();
    if (saved && typeof saved === 'object') {
      Object.assign(d.tt, saved.tt || {});
      Object.assign(d.arena, saved.arena || {});
      Object.assign(d.duel, saved.duel || {});
      Object.assign(d.online, saved.online || {});
      d.practiceTopSpeed = +saved.practiceTopSpeed || 0;
      Object.assign(d.totals, saved.totals || {});
    }
    rec.data = d;
  };
  rec.save = function () {
    RV.store.set(KEY, rec.data);
  };
  rec.reset = function () {
    rec.data = blank();
    rec.save();
  };

  rec.tt = function (mapId) {
    return (rec.data.tt[mapId] = rec.data.tt[mapId] || { best: null, splits: [], topSpeed: 0, runs: 0 });
  };
  rec.arena = function (mapId) {
    return (rec.data.arena[mapId] =
      rec.data.arena[mapId] || { bestKills: 0, fastestWin: null, matches: 0, wins: 0, kills: 0, deaths: 0, topSpeed: 0 });
  };

  rec.duel = function (mapId) {
    return (rec.data.duel[mapId] =
      rec.data.duel[mapId] || { matches: 0, wins: 0, roundsWon: 0, roundsLost: 0, streak: 0, bestStreak: 0 });
  };

  /** Record a finished online match against a real player. Returns {streak}. */
  rec.submitOnline = function (mapId, res) {
    const r = rec.data.online;
    r.matches++;
    r.roundsWon += res.you;
    r.roundsLost += res.opp;
    if (res.won) {
      r.wins++;
      r.streak++;
      r.bestStreak = Math.max(r.bestStreak, r.streak);
    } else r.streak = 0;
    const t = rec.data.totals;
    t.kills += res.you;
    t.deaths += res.opp;
    t.shots += res.shots || 0;
    t.hits += res.hits || 0;
    t.topSpeed = Math.max(t.topSpeed, res.topSpeed || 0);
    rec.save();
    return { streak: r.streak };
  };

  /** Record a finished duel match. Returns {streak}. */
  rec.submitDuel = function (mapId, res) {
    const r = rec.duel(mapId);
    r.matches++;
    r.roundsWon += res.you;
    r.roundsLost += res.bot;
    if (res.won) {
      r.wins++;
      r.streak++;
      r.bestStreak = Math.max(r.bestStreak, r.streak);
    } else r.streak = 0;
    const t = rec.data.totals;
    t.kills += res.you;
    t.deaths += res.bot;
    t.shots += res.shots || 0;
    t.hits += res.hits || 0;
    t.topSpeed = Math.max(t.topSpeed, res.topSpeed || 0);
    rec.save();
    return { streak: r.streak };
  };

  /** Returns {pb:boolean, delta:number|null, prevBest}. */
  rec.submitRun = function (mapId, time, splits, topSpeed) {
    const r = rec.tt(mapId);
    const prev = r.best;
    r.runs++;
    r.topSpeed = Math.max(r.topSpeed || 0, topSpeed || 0);
    const pb = prev == null || time < prev;
    if (pb) {
      r.best = time;
      r.splits = splits.slice();
    }
    rec.data.totals.topSpeed = Math.max(rec.data.totals.topSpeed, topSpeed || 0);
    rec.save();
    return { pb, delta: prev == null ? null : time - prev, prevBest: prev };
  };

  rec.submitArena = function (mapId, res) {
    const r = rec.arena(mapId);
    r.matches++;
    r.kills += res.kills;
    r.deaths += res.deaths;
    r.topSpeed = Math.max(r.topSpeed || 0, res.topSpeed || 0);
    let newBest = false;
    if (res.kills > r.bestKills) {
      r.bestKills = res.kills;
      newBest = true;
    }
    if (res.won) {
      r.wins++;
      if (r.fastestWin == null || res.time < r.fastestWin) {
        r.fastestWin = res.time;
        newBest = true;
      }
    }
    const t = rec.data.totals;
    t.kills += res.kills;
    t.deaths += res.deaths;
    t.shots += res.shots || 0;
    t.hits += res.hits || 0;
    t.topSpeed = Math.max(t.topSpeed, res.topSpeed || 0);
    rec.save();
    return { newBest };
  };

  rec.notePractice = function (topSpeed, seconds) {
    if (topSpeed > rec.data.practiceTopSpeed) rec.data.practiceTopSpeed = topSpeed;
    rec.data.totals.topSpeed = Math.max(rec.data.totals.topSpeed, topSpeed);
    rec.data.totals.playTime += seconds || 0;
    rec.save();
  };

  rec.load();
})();
