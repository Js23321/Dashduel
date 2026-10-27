'use strict';
// Speed exploits. The shared player simulation (js/player.js, also what the server runs) must not let slide jumps, bunny hops, air strafing or
// grenade blasts add up to a speed the movement is not meant to reach:
//   - a slide-jump chain holds ONE speed (it cannot keep growing, and a grenade blast cannot be carried through it for ever),
//   - perfect air strafing is capped,
//   - a blast is a burst: the extra speed bleeds off at the next landings / on the ground and blasts do not stack.
process.env.TEST_MODE = '1';
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../shared.js');
const RV = S.RV;
const DT = RV.PHYS.STEP;
const GW = RV.WEAPON_BY_ID.grenade;

const flat = () => new RV.World({ solids: [{ type: 'box', min: [-900, -5, -900], max: [900, 0, 900], wall: false }], pads: [], killY: -80 });
const cmd = (o) => Object.assign({ fwd: 0, side: 0, jumpPressed: false, jumpDown: false, crouch: false, sprint: true }, o);

/**
 * Run `secs` of holding forward + jump on a flat floor and return the horizontal speed once per second.
 * opts: strafe (perfect air strafing), slide (crouch on landing = slide jumps), nadeEvery (s between blasts), nadeBehind (m behind the player)
 */
function run(secs, opts) {
  const w = flat();
  const p = new RV.Player(w);
  p.autoHop = true;
  p.reset(0, 0, 0, 0, 0);
  for (let i = 0; i < 240; i++) p.step(DT, cmd({ fwd: 1 }));
  let dir = 1;
  let t = 0;
  let nextNade = opts.nadeEvery || 1e9;
  const perSecond = [];
  const blastTimes = [];
  for (let i = 0; i < secs * 120; i++) {
    t += DT;
    const b = p.b;
    if (t >= nextNade) {
      const sp = Math.hypot(b.vx, b.vz) || 1;
      const k = opts.nadeBehind || 0;
      RV.grensim.boost(w, p, GW, b.x - (b.vx / sp) * k, b.y + 0.12, b.z - (b.vz / sp) * k);
      blastTimes.push(t);
      nextNade += opts.nadeEvery;
    }
    let c;
    if (!b.grounded) {
      if (opts.strafe) {
        const psi = Math.atan2(b.vz, b.vx);
        const delta = 0.06;
        if (dir > 0) p.yaw = -(psi + dir * (Math.PI / 2 - delta));
        else p.yaw = -(psi - (Math.PI / 2 - delta) + Math.PI);
        c = cmd({ side: dir, jumpDown: true, crouch: false });
      } else c = cmd({ fwd: 1, jumpDown: true });
    } else {
      if (opts.strafe) {
        p.yaw = -(Math.atan2(b.vz, b.vx) + Math.PI / 2);
        dir = -dir;
      }
      c = cmd({ fwd: 1, jumpDown: true, crouch: !!opts.slide, side: 0 });
    }
    p.step(DT, c);
    if (i % 120 === 119) perSecond.push(p.speedH);
  }
  return { perSecond, blastTimes };
}

const max = (a) => Math.max(...a);

test('bunny hopping straight ahead does not build speed', () => {
  const r = run(20, {});
  assert.ok(max(r.perSecond) < 9, 'peak ' + max(r.perSecond).toFixed(1));
});

test('a slide-jump chain holds one speed and never grows', () => {
  const r = run(30, { slide: true });
  assert.ok(max(r.perSecond) <= 14.3, 'peak ' + max(r.perSecond).toFixed(1));
  assert.ok(Math.abs(r.perSecond[29] - r.perSecond[9]) < 0.5, 'still ' + r.perSecond[29].toFixed(1) + ' after 30 s (was ' + r.perSecond[9].toFixed(1) + ' at 10 s)');
});

test('perfect air strafing (hop and slide jump) is capped', () => {
  for (const slide of [false, true]) {
    const r = run(30, { strafe: true, slide });
    assert.ok(max(r.perSecond) <= 19.7, (slide ? 'slide jump' : 'hop') + ' strafe peak ' + max(r.perSecond).toFixed(1));
  }
});

test('slide jumping with a grenade blast at your feet every 3 s does not go faster than slide jumping without one', () => {
  const r = run(30, { slide: true, nadeEvery: 3 });
  assert.ok(max(r.perSecond) <= 14.3, 'peak ' + max(r.perSecond).toFixed(1));
});

test('a blast behind you is a burst: it bleeds off, and blasts every 4 s do not stack up', () => {
  const r = run(40, { slide: true, strafe: true, nadeEvery: 4, nadeBehind: 1 });
  assert.ok(max(r.perSecond) < 33, 'peak ' + max(r.perSecond).toFixed(1));
  // the second before the next blast (3 s after the last one) the speed is back to what strafing alone gives
  for (let k = 3; k < r.blastTimes.length; k++) {
    const at = Math.round(r.blastTimes[k] + 3) - 1; // index of the per-second sample ~3 s after blast k
    if (at >= r.perSecond.length) break;
    assert.ok(r.perSecond[at] <= 20, 'blast ' + k + ': ' + r.perSecond[at].toFixed(1) + ' m/s three seconds later');
  }
});

test('a blast while running on the ground is gone within a few seconds', () => {
  const w = flat();
  const p = new RV.Player(w);
  p.reset(0, 0, 0, 0, 0);
  for (let i = 0; i < 240; i++) p.step(DT, cmd({ fwd: 1 }));
  p.b.vz -= 20; // a 20 m/s shove along the run direction
  let peak = 0;
  for (let i = 0; i < 120 * 3; i++) {
    p.step(DT, cmd({ fwd: 1 }));
    peak = Math.max(peak, p.speedH);
  }
  assert.ok(peak > 15, 'the shove did something (' + peak.toFixed(1) + ')');
  assert.ok(p.speedH < RV.PHYS.RUN + 3, 'after 3 s on the ground the speed is ' + p.speedH.toFixed(1));
});

// Ground feel: the body follows the keys (it used to feel like skating: ~130 ms to full speed, ~160 ms and 0.7 m of drift for a 90 degree turn).
test('the ground is grippy: quick start, crisp turns with little drift, short stops', () => {
  const settled = () => {
    const p = new RV.Player(flat());
    p.autoHop = false;
    p.reset(0, 0, 0, 0, 0);
    for (let i = 0; i < 30; i++) p.step(DT, cmd({ sprint: false }));
    return p;
  };
  const key = (o) => cmd(Object.assign({ sprint: false }, o));
  // start: 95 % of the run speed from a standstill
  let p = settled();
  let steps = 0;
  while (p.speedH < 0.95 * RV.PHYS.RUN && steps < 240) {
    p.step(DT, key({ fwd: 1 }));
    steps++;
  }
  assert.ok(steps * DT <= 0.09, 'full speed after ' + Math.round(steps * DT * 1000) + ' ms');
  // turn: running forward at full speed, then only "right": the drift along the old direction in the first 0.25 s
  p = settled();
  for (let i = 0; i < 240; i++) p.step(DT, key({ fwd: 1 }));
  const z0 = p.b.z;
  for (let i = 0; i < 30; i++) p.step(DT, key({ side: 1 }));
  assert.ok(z0 - p.b.z < 0.3, 'drifted ' + (z0 - p.b.z).toFixed(2) + ' m along the old direction while turning');
  assert.ok(p.b.vx > 0.9 * RV.PHYS.RUN, 'and is at speed in the new direction (' + p.b.vx.toFixed(1) + ')');
  // stop: let go of the keys
  p = settled();
  for (let i = 0; i < 240; i++) p.step(DT, key({ fwd: 1 }));
  const zr = p.b.z;
  let n = 0;
  while (p.speedH > 0.3 && n < 240) {
    p.step(DT, key({}));
    n++;
  }
  assert.ok(n * DT <= 0.2 && zr - p.b.z < 0.6, 'stopped after ' + Math.round(n * DT * 1000) + ' ms / ' + (zr - p.b.z).toFixed(2) + ' m');
});

// Wall-jump ladders: two close walls used to be a ladder to any height (a 3 m alley climbed 69 m in 30 s, a 1.2 m gap 80 m in 10 s).
const alley = (width) => {
  const h = width / 2;
  const box = (a, b, c, d, e, f, wall) => ({ type: 'box', min: [a, b, c], max: [d, e, f], wall: !!wall });
  return new RV.World({ solids: [box(-h - 3, -5, -2000, h + 3, 0, 10), box(-h - 3, -30, -2000, -h, 140, 10, true), box(h, -30, -2000, h + 3, 140, 10, true)], pads: [], killY: -80 });
};

function wallChain(width, steered, secs) {
  const w = alley(width);
  const p = new RV.Player(w);
  p.autoHop = false;
  const h = width / 2;
  p.reset(steered ? -h + 0.4 : 0, 0, 5, 0, 0);
  let jumps = 0;
  let dir = 1;
  let maxY = 0;
  p.onEvent = (t) => {
    if (t === 'walljump') {
      jumps++;
      dir = -dir;
    }
  };
  for (let i = 0; i < 120 * secs; i++) {
    let press = i % 14 === 0;
    if (steered) {
      press = i % 240 === 60 && p.b.grounded;
      if (p.wallRunning && p.wallRunTime > 0.3) press = true;
      if (p.b.grounded || p.wallRunning) p.yaw = 0;
      else p.yaw = -0.8 * -dir;
    }
    p.step(DT, cmd({ fwd: 1, jumpPressed: press, jumpDown: press }));
    maxY = Math.max(maxY, p.b.y);
    if (p.b.z < -1900) break;
  }
  return { jumps, maxY };
}

test('wall jumps cannot climb without limit between two close walls', () => {
  for (const [width, steered] of [[3, true], [1.2, false]]) {
    const r = wallChain(width, steered, 30);
    assert.ok(r.jumps > 20, width + ' m alley: the wall jumps still work (' + r.jumps + ' of them)');
    assert.ok(r.maxY < 5.5, width + ' m alley: reached ' + r.maxY.toFixed(1) + ' m (it used to be 69-80 m)');
  }
});

test('wall jumps along a wider corridor are unchanged (still a long chain, no climbing)', () => {
  const r = wallChain(5, true, 30);
  assert.ok(r.jumps >= 25, r.jumps + ' wall jumps');
  assert.ok(r.maxY < 4.2, 'reached ' + r.maxY.toFixed(1) + ' m');
});

test('the player state survives a round trip (getState / setState): one more field than before, nothing lost', () => {
  const w = alley(5);
  const p = new RV.Player(w);
  p.reset(0, 0, 5, 0, 0);
  for (let i = 0; i < 90; i++) p.step(DT, cmd({ fwd: 1, jumpPressed: i === 30, jumpDown: i === 30 }));
  const a = p.getState();
  assert.strictEqual(a.length, RV.PLAYER_STATE_LEN);
  const q = new RV.Player(w);
  assert.ok(q.setState(a));
  assert.deepStrictEqual(q.getState(), a);
  // and the copy keeps simulating exactly like the original
  for (let i = 0; i < 240; i++) {
    const c = cmd({ fwd: 1, side: i % 80 < 40 ? 1 : -1, jumpPressed: i % 50 === 0, jumpDown: i % 50 === 0 });
    p.step(DT, c);
    q.step(DT, c);
  }
  assert.deepStrictEqual(q.getState(), p.getState());
});
