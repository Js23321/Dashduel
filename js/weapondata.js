/* DASHDUEL - weapon data (pure data + tiny helpers, no rendering).
 *
 * This file is shared: the browser loads it, and so does the game server (server/), so both sides
 * use exactly the same damage, fire rates, magazines, ranges and grenade numbers.
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const RV = (root.RV = root.RV || {});

  /*
   * Numbers follow Roblox RIVALS (community wiki / weapon database, checked 2026-10; the game is patched often).
   * Distances: RIVALS measures in studs; one stud is scaled to 0.36 m here (RIVALS' avatar is ~5.2 studs tall, this one
   * is 1.85 m), so the rifle's 50 -> 200 stud falloff becomes 18 -> 71 m and the grenade's 16 stud blast ~ 6 m.
   *   Assault Rifle: 12 damage falling to 3, crit 15 -> 4 (x1.25), 0.10 s between shots, 20 / 100 rounds, reload 1.56 s
   *   Handgun:       12 damage falling to 3, crit 15 -> 4 (x1.25), 0.13 s between shots, 13 / 91 rounds, reload 1.06 s
   *   Fists:         30 damage, 0.35 s
   *   Grenade:       75 blast damage, 16 stud radius, 2 s fuse, 30 s cooldown
   * (RIVALS' per-weapon move speed changes are NOT copied: weapons never slow movement here, by design.)
   */
  /** Slot order = number keys 1..4. */
  const WEAPONS = [
    {
      id: 'rifle', name: 'Assault Rifle', short: 'RIFLE', kind: 'gun', dmg: 12, headMul: 1.25, falloff: [18, 71, 0.25], interval: 0.1, auto: true, mag: 20, reserve: 100, reload: 1.56, range: 260, switchTime: 0.25,
      tracer: 0xffd34d, tw: 0.03, flash: [0xffe29a, 0.07], adsFovMul: 0.82, adsIn: 0.15, adsOut: 0.07, sight: 'iron',
      desc: 'Automatic, steady and accurate. 12 damage up close, less at range.', stats: { damage: '12 → 3', rate: '600 rpm', mag: '20 / 100', range: 'Long' },
    },
    {
      id: 'pistol', name: 'Handgun', short: 'HANDGUN', kind: 'gun', dmg: 12, headMul: 1.25, falloff: [18, 71, 0.25], interval: 0.13, auto: false, mag: 13, reserve: 91, reload: 1.06, range: 200, switchTime: 0.18,
      tracer: 0xffb21f, tw: 0.03, flash: [0xffe08a, 0.06], adsFovMul: 0.9, adsIn: 0.11, adsOut: 0.06, sight: 'iron',
      desc: 'Semi-automatic. One click, one round, quick to reload.', stats: { damage: '12 → 3', rate: 'Semi-auto', mag: '13 / 91', range: 'Medium' },
    },
    {
      id: 'fists', name: 'Fists', short: 'FISTS', kind: 'melee', melee: true, dmg: 30, interval: 0.35, auto: true, mag: 0, range: 2.4, reach: 0.3, switchTime: 0.2,
      adsFovMul: 0, adsIn: 0.1, adsOut: 0.06, sight: 'none', doubleJump: true,
      desc: 'Close combat. Equipping fists unlocks the double jump.', stats: { damage: 30, rate: '2.9 / s', mag: '∞', range: 'Melee' },
    },
    {
      id: 'grenade', name: 'Grenade', short: 'GRENADE', kind: 'grenade', dmg: 75, interval: 0.6, auto: false, mag: 0, range: 0, switchTime: 0.25,
      adsFovMul: 0, adsIn: 0.1, adsOut: 0.06, sight: 'none',
      // Hold the button to aim (a path line + landing circle), release to throw. If you keep holding,
      // after `hold.still` s the circle starts sliding towards you (slowly, then faster) and reaches you
      // `hold.total` s after the pin came out: it touches you and explodes (a self boost, no damage to you).
      hold: { still: 1.0, total: 3.0 },
      // fuse = seconds after release; speed in m/s along the view direction; arc = extra upward angle (rad)
      fuse: 2.0, speed: 17, arc: 0.17, radius: 6, minDmgFrac: 1, selfMul: 0, maxCount: 1, regen: 30, regenPractice: 8,
      // self boost: a blast within boostRadius shoves you away from it (no damage to you)
      boostRadius: 6.5, boostPower: 15, boostUp: 0.45,
      desc: 'Hold to aim, release to throw. Keep holding and the circle slides to you and blows: 75 to enemies, never hurts you, launches you. 30 s cooldown.', stats: { damage: 75, rate: '30 s cooldown', mag: '1', range: '6 m blast' },
    },
  ];
  const BY_ID = {};
  WEAPONS.forEach((w, i) => {
    w.slot = i;
    BY_ID[w.id] = w;
  });

  /** Damage of one hit at a distance (linear falloff for weapons that have one). */
  function damageAt(w, dist) {
    if (!w.falloff) return w.dmg;
    const f = w.falloff;
    if (dist <= f[0]) return w.dmg;
    if (dist >= f[1]) return Math.max(1, Math.round(w.dmg * f[2]));
    const t = (dist - f[0]) / (f[1] - f[0]);
    return Math.max(1, Math.round(w.dmg * (1 - t * (1 - f[2]))));
  }

  RV.WEAPONS = WEAPONS;
  RV.WEAPON_BY_ID = BY_ID;
  RV.damageAt = damageAt;

  // ---------------------------------------------------------------------------
  // Damage helper for anything with .hp (the player's session and the bots). The shield
  // code path is unused now that nobody has armour.
  // ---------------------------------------------------------------------------
  RV.MAX_HP = 150; // everyone: you and every bot (RIVALS itself uses 100: set 100 here for its exact time-to-kill)
  /**
   * Spawn protection: a player who has just spawned (a round that has just gone live, a deathmatch respawn) takes no
   * damage for this many seconds, or until they attack (fire, punch, throw), whichever comes first. Falling out of the
   * map still kills. The online server enforces it (server/config.js SPAWN_PROTECT_S); this value is for local modes.
   */
  RV.SPAWN_PROTECT_S = 2.0;
  const ARMOR = (RV.ARMOR = { START: 0, ABSORB: 0.5 }); // no shield in play (kept as a no-op)
  RV.takeDamage = function (unit, dmg) {
    const soaked = Math.min(unit.armor || 0, dmg * ARMOR.ABSORB);
    unit.armor = (unit.armor || 0) - soaked;
    unit.hp -= dmg - soaked;
    return dmg - soaked;
  };
})();
