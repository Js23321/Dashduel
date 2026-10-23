/* DASHDUEL - WebAudio synth. No asset files: every sound is generated.
 *
 * Signal path:  sound -> master gain -> compressor -> speakers
 *               sound -> reverb send -> convolver (generated room tail) -> master
 * The compressor keeps a burst of full-auto fire from clipping; the reverb gives gun shots and
 * explosions a tail so they feel like they happen in a space instead of inside your head.
 */
(function () {
  'use strict';
  const RV = window.RV;

  const A = (RV.audio = {
    ctx: null,
    master: null,
    comp: null,
    revSend: null,
    noise: null,
    loops: {},
    ready: false,
  });

  const rnd = (a, b) => a + Math.random() * (b - a);

  /** A short generated room impulse response: decaying stereo noise. */
  function makeImpulse(ctx, secs, decay) {
    const len = Math.floor(ctx.sampleRate * secs);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 400 ? i / 400 : 1);
      }
    }
    return buf;
  }

  A.init = function () {
    if (A.ctx) {
      if (A.ctx.state === 'suspended') A.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      A.ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      return;
    }
    const ctx = A.ctx;
    A.master = ctx.createGain();
    A.master.gain.value = RV.settings.volume;
    // glue + protection against clipping when many sounds overlap
    A.comp = ctx.createDynamicsCompressor();
    A.comp.threshold.value = -16;
    A.comp.knee.value = 14;
    A.comp.ratio.value = 5;
    A.comp.attack.value = 0.003;
    A.comp.release.value = 0.2;
    A.master.connect(A.comp);
    A.comp.connect(ctx.destination);
    // reverb bus
    try {
      const conv = ctx.createConvolver();
      conv.buffer = makeImpulse(ctx, 1.2, 3.4);
      A.revSend = ctx.createGain();
      A.revSend.gain.value = 1;
      const wet = ctx.createGain();
      wet.gain.value = 0.55;
      A.revSend.connect(conv);
      conv.connect(wet);
      wet.connect(A.master);
    } catch (e) {
      A.revSend = null;
    }
    // one second of white noise reused by everything
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    A.noise = buf;
    A.ready = true;
    A._makeLoop('wind', 'lowpass', 500, 0.9);
    A._makeLoop('slide', 'bandpass', 900, 1.4);
    A._makeLoop('wallrun', 'bandpass', 2200, 2.5);
  };

  A.setVolume = function (v) {
    if (A.master) A.master.gain.value = v;
  };

  /** Stop all sound while the tab is hidden; resume on return. */
  A.suspend = function () {
    if (A.ctx && A.ctx.state === 'running') A.ctx.suspend();
  };
  A.resume = function () {
    if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
  };

  A._makeLoop = function (name, type, freq, q) {
    const src = A.ctx.createBufferSource();
    src.buffer = A.noise;
    src.loop = true;
    const f = A.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = A.ctx.createGain();
    g.gain.value = 0;
    src.connect(f);
    f.connect(g);
    g.connect(A.master);
    src.start();
    A.loops[name] = { g, f, base: freq };
  };

  /** Smoothly drive a looping sound: level 0..1 */
  A.loop = function (name, level, pitch) {
    const l = A.loops[name];
    if (!l || !A.ctx) return;
    const t = A.ctx.currentTime;
    l.g.gain.setTargetAtTime(level, t, 0.06);
    if (pitch) l.f.frequency.setTargetAtTime(l.base * pitch, t, 0.08);
  };

  function env(g, t0, attack, peak, decay) {
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  /** Connect a sound's output to the master bus and (optionally) to the reverb. */
  function out(node, send) {
    node.connect(A.master);
    if (send > 0 && A.revSend) {
      const s = A.ctx.createGain();
      s.gain.value = send;
      node.connect(s);
      s.connect(A.revSend);
    }
  }

  function tone(freq, dur, type, vol, slideTo, delay, send) {
    if (!A.ready) return;
    const t0 = A.ctx.currentTime + (delay || 0);
    const o = A.ctx.createOscillator();
    const g = A.ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    env(g, t0, 0.004, vol, dur);
    o.connect(g);
    out(g, send);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noiseBurst(dur, vol, type, freq, q, delay, send) {
    if (!A.ready) return;
    const t0 = A.ctx.currentTime + (delay || 0);
    const s = A.ctx.createBufferSource();
    s.buffer = A.noise;
    const f = A.ctx.createBiquadFilter();
    f.type = type || 'highpass';
    f.frequency.value = freq || 1000;
    f.Q.value = q || 0.7;
    const g = A.ctx.createGain();
    env(g, t0, 0.002, vol, dur);
    s.connect(f);
    f.connect(g);
    out(g, send);
    s.start(t0, Math.random() * 0.5);
    s.stop(t0 + dur + 0.05);
  }

  /** Filtered noise whose cut-off glides from f0 to f1 (whooshes, blasts, gun bodies). */
  function noiseSweep(dur, vol, f0, f1, q, type, delay, send) {
    if (!A.ready) return;
    const t0 = A.ctx.currentTime + (delay || 0);
    const s = A.ctx.createBufferSource();
    s.buffer = A.noise;
    const f = A.ctx.createBiquadFilter();
    f.type = type || 'bandpass';
    f.Q.value = q || 0.8;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
    const g = A.ctx.createGain();
    env(g, t0, 0.004, vol, dur);
    s.connect(f);
    f.connect(g);
    out(g, send);
    s.start(t0, Math.random() * 0.5);
    s.stop(t0 + dur + 0.05);
  }

  const S = {
    // ----------------------------------------------------------- guns
    /** Assault rifle: bright crack + body + low punch + a short tail. Slightly different every shot. */
    shot(id) {
      if (id === 'pistol') {
        noiseBurst(0.022, 0.36, 'highpass', rnd(3200, 3700), 0.7, 0, 0.15);
        noiseSweep(0.13, 0.3, 3000, 500, 0.9, 'bandpass', 0, 0.35);
        tone(rnd(205, 230), 0.11, 'sine', 0.5, 62, 0);
        tone(2200, 0.03, 'triangle', 0.05, 900, 0.004);
        noiseBurst(0.3, 0.12, 'lowpass', 600, 0.6, 0.02, 0.8);
        noiseBurst(0.012, 0.07, 'bandpass', 3800, 2, 0.085); // slide clack
        return;
      }
      noiseBurst(0.028, 0.34, 'highpass', rnd(2800, 3700), 0.7, 0, 0.12); // supersonic crack
      noiseSweep(0.11, 0.3, rnd(3800, 4600), 650, 0.9, 'bandpass', 0, 0.3); // body
      tone(rnd(132, 150), 0.09, 'sine', 0.5, 46, 0); // low punch
      tone(rnd(300, 340), 0.035, 'square', 0.07, 120, 0); // mechanical snap
      noiseBurst(0.26, 0.11, 'lowpass', 480, 0.6, 0.015, 0.7); // rumble tail into the room
      noiseBurst(0.012, 0.06, 'bandpass', 4600, 2.2, 0.052); // bolt tick
    },
    botShot(vol) {
      noiseBurst(0.035, 0.2 * vol, 'highpass', 2400, 0.8, 0, 0.1);
      noiseSweep(0.09, 0.16 * vol, 3000, 600, 0.9, 'bandpass', 0, 0.25);
      tone(rnd(120, 150), 0.07, 'sine', 0.2 * vol, 50);
    },
    reload(id) {
      if (id === 'pistol') {
        noiseBurst(0.02, 0.12, 'bandpass', 1800, 2, 0.12);
        tone(170, 0.04, 'square', 0.05, 90, 0.12);
        tone(125, 0.06, 'sine', 0.2, 70, 0.58);
        noiseBurst(0.03, 0.14, 'bandpass', 1500, 1.5, 0.58);
        return;
      }
      noiseBurst(0.02, 0.12, 'bandpass', 1800, 2, 0.2); // magazine out
      tone(180, 0.04, 'square', 0.05, 90, 0.2);
      noiseBurst(0.05, 0.05, 'highpass', 3000, 0.8, 0.5); // fresh magazine
      tone(125, 0.07, 'sine', 0.22, 66, 0.82); // seated
      noiseBurst(0.03, 0.15, 'bandpass', 1400, 1.5, 0.82);
    },
    reloadDone(id) {
      noiseBurst(0.02, 0.15, 'bandpass', 2600, 2);
      tone(210, 0.05, 'square', 0.08, 100);
      if (id !== 'pistol') {
        noiseBurst(0.018, 0.12, 'bandpass', 3200, 2, 0.07);
        tone(300, 0.04, 'square', 0.06, 140, 0.07);
      }
    },
    empty() {
      noiseBurst(0.012, 0.13, 'bandpass', 3000, 2);
      tone(200, 0.025, 'square', 0.06, 120);
    },
    swap() {
      tone(420, 0.04, 'square', 0.04, 620);
      noiseBurst(0.02, 0.07, 'bandpass', 2200, 1.6, 0.03);
    },
    // ----------------------------------------------------------- fists
    swing() {
      noiseSweep(0.12, 0.13, 500, 2300, 1.2, 'bandpass');
      noiseSweep(0.1, 0.08, 2300, 600, 1.2, 'bandpass', 0.1);
    },
    punchHit() {
      tone(rnd(85, 100), 0.13, 'sine', 0.55, 40, 0, 0.1);
      noiseBurst(0.07, 0.28, 'lowpass', 1100, 0.7);
      noiseBurst(0.025, 0.18, 'bandpass', 2500, 1);
    },
    // ----------------------------------------------------------- hits
    hit() {
      tone(1800, 0.045, 'triangle', 0.12);
      tone(2600, 0.03, 'sine', 0.06, null, 0.01);
    },
    headshot() {
      tone(2400, 0.09, 'sine', 0.16);
      tone(3600, 0.07, 'sine', 0.1, null, 0.03);
      noiseBurst(0.03, 0.12, 'bandpass', 4500, 2);
      tone(120, 0.06, 'sine', 0.2, 60);
    },
    kill() {
      tone(1000, 0.08, 'triangle', 0.14);
      tone(1500, 0.1, 'triangle', 0.14, null, 0.07);
      tone(2100, 0.18, 'sine', 0.12, null, 0.14);
    },
    hurt() {
      tone(95, 0.18, 'sawtooth', 0.22, 48);
      noiseBurst(0.12, 0.18, 'lowpass', 420, 0.7);
      tone(300, 0.05, 'square', 0.04, 150);
    },
    die() {
      tone(260, 0.7, 'sawtooth', 0.2, 40, 0, 0.4);
      noiseBurst(0.4, 0.12, 'lowpass', 500, 0.6, 0, 0.4);
    },
    // ----------------------------------------------------------- grenade
    pin() {
      tone(3100, 0.05, 'sine', 0.07);
      tone(4200, 0.04, 'sine', 0.04, null, 0.02);
      noiseBurst(0.015, 0.08, 'highpass', 5000, 0.8);
      tone(900, 0.03, 'square', 0.04, 500, 0.09); // spoon clink
    },
    throw() {
      noiseSweep(0.2, 0.14, 600, 2400, 1, 'bandpass');
      tone(380, 0.12, 'triangle', 0.05, 160);
    },
    bounce(v) {
      tone(380, 0.05, 'triangle', 0.12 * v, 220);
      noiseBurst(0.03, 0.1 * v, 'bandpass', 2600, 1.5);
      tone(90, 0.06, 'sine', 0.12 * v, 55);
    },
    tick(v) {
      tone(2400, 0.03, 'square', 0.045 * v);
    },
    /** Warning beep while the grenade circle closes in: p = 0..1, rising pitch and volume. */
    warn(p) {
      p = p || 0;
      tone(1100 + 1500 * p, 0.045, 'square', 0.05 + 0.06 * p);
      if (p > 0.7) tone(1500 + 1800 * p, 0.03, 'square', 0.05, null, 0.05);
    },
    explosion(v) {
      v = v == null ? 1 : v;
      noiseBurst(0.03, 0.5 * v, 'highpass', 2000, 0.7, 0, 0.2); // crack
      noiseSweep(1.1, 0.55 * v, 5000, 120, 0.7, 'lowpass', 0, 0.85); // roar
      tone(60, 0.9, 'sine', 0.7 * v, 20, 0, 0.4); // sub boom
      noiseBurst(0.5, 0.25 * v, 'bandpass', 900, 0.6, 0.12, 0.9); // debris
    },
    boost() {
      noiseSweep(0.35, 0.16, 300, 3000, 1, 'bandpass');
      tone(180, 0.3, 'sine', 0.12, 700);
    },
    // ----------------------------------------------------------- movement
    jump() {
      noiseBurst(0.07, 0.05, 'bandpass', 900, 0.9);
    },
    djump() {
      tone(380, 0.14, 'triangle', 0.1, 1100);
      noiseSweep(0.2, 0.08, 800, 3500, 0.9, 'bandpass');
    },
    step(v) {
      v = v == null ? 1 : v;
      noiseBurst(0.05, 0.09 * v, 'lowpass', rnd(380, 620), 0.8);
      tone(rnd(65, 85), 0.06, 'sine', 0.08 * v, 45);
    },
    land(impact) {
      const v = Math.min(1, impact / 22);
      tone(95, 0.12, 'sine', 0.25 * v + 0.05, 45);
      noiseBurst(0.07, 0.1 * v, 'lowpass', 700, 0.7);
    },
    slide() {
      noiseBurst(0.18, 0.1, 'bandpass', 700, 1.2);
    },
    walljump() {
      tone(420, 0.1, 'triangle', 0.16, 900);
      noiseBurst(0.07, 0.07, 'highpass', 2500, 0.8);
    },
    wallrun() {
      noiseBurst(0.1, 0.07, 'bandpass', 2400, 2);
    },
    pad() {
      tone(250, 0.28, 'sawtooth', 0.14, 1000);
      noiseBurst(0.2, 0.08, 'bandpass', 1800, 0.9);
    },
    // ----------------------------------------------------------- match
    checkpoint() {
      tone(880, 0.14, 'sine', 0.2);
      tone(1320, 0.2, 'sine', 0.18, null, 0.07);
    },
    finish() {
      [660, 880, 1100, 1320].forEach((f, i) => tone(f, 0.22, 'sine', 0.2, null, i * 0.08, 0.2));
    },
    beep() {
      tone(660, 0.12, 'sine', 0.2);
    },
    go() {
      tone(990, 0.28, 'sine', 0.24, null, 0, 0.2);
    },
    respawn() {
      tone(300, 0.2, 'triangle', 0.15, 700);
    },
    click() {
      tone(900, 0.03, 'square', 0.05);
    },
  };

  A.play = function (name, a) {
    if (!A.ready || !A.ctx) return;
    if (A.ctx.state === 'suspended') A.ctx.resume();
    const f = S[name];
    if (f) f(a);
  };
})();
