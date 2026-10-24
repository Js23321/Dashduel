/* DASHDUEL - AI opponents.
 *
 * Nav:  a graph of walkable points built automatically from any map. Every edge
 *       is validated by physically walking a test body along it with the same
 *       collision code the bots use, so ramps / steps / drops "just work".
 * Bot:  carries a real weapon (same stats as yours, scaled by difficulty), picks
 *       manoeuvres (strafe, hop, advance, retreat, hold) that suit that weapon,
 *       and fires hitscan bursts. Aim follows the player's position from `react`
 *       seconds ago, partly led by velocity, plus a smooth low-frequency wobble.
 *       Running in straight lines gets you hit; changing direction, jumping and
 *       sliding makes bots miss. There is no random spread.
 */
(function () {
  'use strict';
  const RV = window.RV;

  const BOT = { HW: 0.38, H: 1.85, HP: 150, SPEED: 6.6, ACCEL: 42, G: 26 };

  const DIFF = {
    easy: { react: 0.5, lead: 0.3, turn: 4.0, dmgMul: 0.55, wobble: 0.045, think: 1.4, range: 45, hop: 0.25 },
    normal: { react: 0.32, lead: 0.6, turn: 7.0, dmgMul: 0.75, wobble: 0.026, think: 1.0, range: 60, hop: 0.5 },
    hard: { react: 0.18, lead: 0.85, turn: 11.0, dmgMul: 1.0, wobble: 0.013, think: 0.75, range: 80, hop: 0.9 },
  };

  /** How each weapon is used: preferred range band, burst size, pause between bursts. */
  const STYLE = {
    rifle: { pref: 16, near: 9, far: 28, burst: [3, 6], gap: [0.5, 1.0], fireMul: 1.15, tol: 0.14 },
    pistol: { pref: 14, near: 7, far: 26, burst: [1, 2], gap: [0.2, 0.45], fireMul: 1.5, tol: 0.1 },
    fists: { pref: 1.8, near: 0, far: 4, burst: [1, 2], gap: [0.05, 0.25], fireMul: 1.0, tol: 0.5, charge: true },
  };

  const NAMES = ['Vector', 'Ember', 'Quill', 'Onyx', 'Rook', 'Sable', 'Tern', 'Vesper'];
  const COLORS = [0xff5d5d, 0xffa63d, 0xb878ff, 0x3ec5ff, 0x5ae07a, 0xff6fa5, 0xffd23f, 0x2dd4bf];

  // ===========================================================================
  // Navigation graph
  // ===========================================================================
  class Nav {
    constructor(world, spawns) {
      this.world = world;
      this.nodes = [];
      this.live = [];
      this._wb = {
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hw: 0.38, h: 1.85,
        grounded: true, stepGround: 0.45, stepAir: 0.25,
        hitX: 0, hitZ: 0, hitUp: false, landed: false, stepped: false,
      };
      this._g = { y: 0, nx: 0, ny: 1, nz: 0, solid: null };
      this.build(spawns || []);
    }

    build(spawns) {
      const w = this.world,
        bd = w.bounds;
      const spanX = bd.maxX - bd.minX,
        spanZ = bd.maxZ - bd.minZ;
      let step = 4;
      while ((spanX / step) * (spanZ / step) > 1300) step += 0.5;
      this.step = step;
      const nodes = this.nodes;
      const tmp = [];

      for (let gx = bd.minX + step / 2; gx < bd.maxX; gx += step) {
        for (let gz = bd.minZ + step / 2; gz < bd.maxZ; gz += step) {
          const list = w.query(gx - 0.1, gx + 0.1, gz - 0.1, gz + 0.1, tmp);
          const tops = [];
          for (let i = 0; i < list.length; i++) {
            const s = list[i];
            if (gx < s.minX || gx > s.maxX || gz < s.minZ || gz > s.maxZ) continue;
            // ramps: the body's footprint stands on the highest surface under it, so test at that height
            tops.push(s.isRamp ? RV.rampSupport(s, gx, gz, 0.42) : s.maxY);
          }
          tops.sort((a, c) => c - a);
          let last = Infinity;
          for (const top of tops) {
            if (last - top < 0.5) continue;
            last = top;
            if (top < w.killY + 5) continue;
            if (w.overlapsAny(gx, top + 0.02, gz, 0.42, BOT.H)) continue;
            nodes.push({ x: gx, y: top, z: gz, edges: [], id: nodes.length, ok: true });
          }
        }
      }

      // bucket for neighbour lookups
      const cells = new Map();
      const key = (ix, iz) => ix * 4096 + iz;
      for (const n of nodes) {
        n.ix = Math.floor((n.x - bd.minX) / step);
        n.iz = Math.floor((n.z - bd.minZ) / step);
        const k = key(n.ix, n.iz);
        let l = cells.get(k);
        if (!l) cells.set(k, (l = []));
        l.push(n);
      }
      for (const a of nodes) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const l = cells.get(key(a.ix + dx, a.iz + dz));
            if (!l) continue;
            for (const c of l) {
              if (c === a) continue;
              const dy = c.y - a.y;
              if (Math.abs(dy) > 8) continue;
              const d = Math.hypot(c.x - a.x, c.z - a.z);
              if (d > step * 1.5) continue;
              if (this._walk(a, c)) a.edges.push({ to: c.id, cost: d + Math.abs(dy) * 0.5 });
            }
          }
        }
      }

      // keep only the part of the graph that is mutually reachable from the spawns
      const roots = [];
      for (const s of spawns) {
        const n = this._nearestRaw(s.x, s.y, s.z);
        if (n) roots.push(n.id);
      }
      if (roots.length) {
        const fwd = this._bfs(roots, (n) => n.edges.map((e) => e.to));
        const rev = new Array(nodes.length);
        for (let i = 0; i < nodes.length; i++) rev[i] = [];
        for (const n of nodes) for (const e of n.edges) rev[e.to].push(n.id);
        const back = this._bfs(roots, (n) => rev[n.id]);
        for (const n of nodes) n.ok = fwd[n.id] && back[n.id];
        for (const n of nodes) n.edges = n.edges.filter((e) => nodes[e.to].ok);
      }
      this.live = nodes.filter((n) => n.ok);
    }

    _bfs(roots, nbrs) {
      const seen = new Array(this.nodes.length).fill(false);
      const q = roots.slice();
      for (const r of roots) seen[r] = true;
      while (q.length) {
        const n = this.nodes[q.pop()];
        for (const to of nbrs(n)) {
          if (!seen[to]) {
            seen[to] = true;
            q.push(to);
          }
        }
      }
      return seen;
    }

    /** Walk a test body from a to c; true if it arrives standing near c. */
    _walk(a, c) {
      const w = this.world,
        b = this._wb,
        g = this._g;
      b.x = a.x;
      b.y = a.y + 0.01;
      b.z = a.z;
      b.grounded = true;
      let vy = 0;
      const dx = c.x - a.x,
        dz = c.z - a.z;
      const dist = Math.hypot(dx, dz) || 1;
      const sp = 5,
        dt = 0.05;
      let vx = (dx / dist) * sp,
        vz = (dz / dist) * sp;
      const maxSteps = Math.ceil(dist / (sp * dt)) * 2 + 60;
      let stuck = 0;
      for (let i = 0; i < maxSteps; i++) {
        const wasG = b.grounded;
        vy = wasG ? 0 : vy - BOT.G * dt;
        const px = b.x,
          pz = b.z;
        w.move(b, vx * dt, vy * dt, vz * dt);
        if (b.landed && vy < 0) vy = 0;
        let found = vy <= 0.01 && w.probeGround(b, 0.05, g);
        if (!found && wasG && vy <= 0.01 && w.probeGround(b, 0.4, g)) {
          b.y = g.y;
          found = true;
        }
        b.grounded = found;
        if (b.y < c.y - 9) return false;
        const rx = c.x - b.x,
          rz = c.z - b.z;
        const d2 = rx * rx + rz * rz;
        if (d2 < 0.09) {
          vx = vz = 0;
        }
        if (d2 < 0.36 && b.grounded) return Math.abs(b.y - c.y) < 0.8;
        const moved = Math.hypot(b.x - px, b.z - pz);
        if (moved < sp * dt * 0.25 && vx !== 0) {
          if (++stuck > 4) return false;
        } else stuck = 0;
      }
      return false;
    }

    _nearestRaw(x, y, z) {
      let best = null,
        bd = Infinity;
      for (const n of this.nodes) {
        const dy = Math.abs(n.y - y);
        if (dy > 2.5) continue;
        const d = Math.hypot(n.x - x, n.z - z) + dy * 2;
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      return best;
    }

    nearest(x, y, z) {
      let best = null,
        bd = Infinity;
      const L = this.live;
      for (let i = 0; i < L.length; i++) {
        const n = L[i];
        const dy = Math.abs(n.y - y);
        const d = Math.hypot(n.x - x, n.z - z) + dy * 2.5;
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      return best;
    }

    random(rng) {
      return this.live[Math.floor(rng() * this.live.length)];
    }

    /** A* over the live graph. Returns array of node objects (excluding the start). */
    path(from, to) {
      if (!from || !to || from === to) return [];
      const N = this.nodes.length;
      const g = new Float32Array(N).fill(Infinity);
      const came = new Int32Array(N).fill(-1);
      const closed = new Uint8Array(N);
      const heap = [];
      const push = (id, f) => {
        heap.push([f, id]);
        let i = heap.length - 1;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (heap[p][0] <= heap[i][0]) break;
          [heap[p], heap[i]] = [heap[i], heap[p]];
          i = p;
        }
      };
      const pop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length) {
          heap[0] = last;
          let i = 0;
          for (;;) {
            const l = i * 2 + 1,
              r = l + 1;
            let m = i;
            if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
            if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
            if (m === i) break;
            [heap[m], heap[i]] = [heap[i], heap[m]];
            i = m;
          }
        }
        return top;
      };
      const h = (n) => Math.hypot(n.x - to.x, n.z - to.z) + Math.abs(n.y - to.y) * 0.5;
      g[from.id] = 0;
      push(from.id, h(from));
      while (heap.length) {
        const [, id] = pop();
        if (closed[id]) continue;
        closed[id] = 1;
        if (id === to.id) break;
        const n = this.nodes[id];
        for (const e of n.edges) {
          if (closed[e.to]) continue;
          const ng = g[id] + e.cost;
          if (ng < g[e.to]) {
            g[e.to] = ng;
            came[e.to] = id;
            push(e.to, ng + h(this.nodes[e.to]));
          }
        }
      }
      if (came[to.id] < 0) return [];
      const out = [];
      for (let id = to.id; id !== from.id; id = came[id]) out.push(this.nodes[id]);
      return out.reverse();
    }
  }

  // ===========================================================================
  // Bot
  // ===========================================================================
  class Bot {
    constructor(game, index, diffKey, dummy) {
      this.g = game;
      this.index = index;
      this.name = dummy ? 'Dummy' : NAMES[index % NAMES.length];
      this.diffKey = diffKey;
      this.d = DIFF[diffKey] || DIFF.normal;
      this.dummy = !!dummy;
      this.body = {
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hw: BOT.HW, h: BOT.H,
        grounded: false, stepGround: 0.45, stepAir: 0.25,
        hitX: 0, hitZ: 0, hitUp: false, landed: false, stepped: false,
      };
      this._g = { y: 0, nx: 0, ny: 1, nz: 0, solid: null };
      this._rh = { t: 0, nx: 0, ny: 0, nz: 0, solid: null };
      this.mesh = RV.render.createBotMesh(dummy ? 0x9ca3af : COLORS[index % COLORS.length], 'rifle', index);
      this.mesh.setName(this.name, dummy ? '#e5e7eb' : '#ffffff');
      this.kills = 0;
      this.deaths = 0;
      this.hp = BOT.HP;
      this.armor = RV.ARMOR.START;
      this.alive = false;
      this.mesh.group.visible = false;
      this.rng = RV.makeRng(1000 + index * 77);
      this.phase = this.rng() * 6.28;
      this.phase2 = this.rng() * 6.28;
      this.home = null;
      this.pace = null;
      this.setWeapon('rifle');
    }

    setWeapon(id) {
      const w = RV.WEAPON_BY_ID[id] || RV.WEAPON_BY_ID.rifle;
      this.weaponId = w.id;
      this.weapon = w;
      this.style = STYLE[w.id];
      this.mesh.setWeapon(w.id);
    }

    spawn(x, y, z, yaw) {
      const b = this.body;
      b.x = x;
      b.y = y + 0.01;
      b.z = z;
      b.vx = b.vy = b.vz = 0;
      b.grounded = false;
      this.hp = BOT.HP;
      this.armor = RV.ARMOR.START;
      this.alive = true;
      this.deadT = 0;
      this.respawnAt = 0;
      this.yaw = yaw || 0;
      this.aimYaw = this.yaw;
      this.aimPitch = 0;
      this.canSee = false;
      this.lastSeen = -99;
      this.acquiredAt = 0;
      this.seeT = this.rng() * 0.2;
      this.fireCd = 0;
      this.burstLeft = 0;
      this.pauseT = (0.4 + this.rng() * 0.6) * this.d.think;
      this.strafeDir = this.rng() < 0.5 ? -1 : 1;
      this.man = 'strafe';
      this.manT = 0.3 + this.rng() * 0.5;
      this.manJump = false;
      this.path = null;
      this.pi = 0;
      this.repathAt = 0;
      this.stuckT = 0;
      this.stuckX = x;
      this.stuckZ = z;
      this.walkPhase = 0;
      this.flash = 0;
      this.paceT = 0;
      this.home = { x, y, z };
      const m = this.mesh;
      m.group.visible = true;
      m.group.rotation.set(0, this.yaw, 0);
      m.group.position.set(x, y, z);
    }

    /** Returns true when this hit killed the bot. */
    isProtected(g) {
      return (this.protUntil || 0) > g.time;
    }

    damage(amount, g, w) {
      if (!this.alive || this.isProtected(g)) return false;
      RV.takeDamage(this, amount);
      this.flash = 0.07;
      if (this.hp <= 0) {
        this.hp = 0;
        this.alive = false;
        this.deaths++;
        this.deadT = 0;
        this.respawnAt = this.noAutoRespawn ? 0 : g.time + (this.dummy ? 1.6 : 3.0);
        g.onBotKilled(this, w);
        return true;
      }
      return false;
    }

    _pickManeuver(tl) {
      const st = this.style,
        d = this.d;
      if (st.charge) {
        this.man = 'advance';
        this.manT = 0.5 + this.rng() * 0.6;
        this.manJump = this.rng() < d.hop * 0.6;
        return;
      }
      const r = this.rng;
      const w = {
        advance: tl > st.far ? 6 : tl > st.pref ? 2 : 0.3,
        retreat: tl < st.near ? 6 : tl < st.pref * 0.7 ? 1.5 : 0.1,
        strafe: 3,
        hop: 1 + d.hop * 2.5,
        hold: tl > st.near && tl < st.far ? 0.7 : 0,
      };
      let tot = 0;
      for (const k in w) tot += w[k];
      let pick = r() * tot;
      let chosen = 'strafe';
      for (const k in w) {
        pick -= w[k];
        if (pick <= 0) {
          chosen = k;
          break;
        }
      }
      this.man = chosen === 'hop' ? 'strafe' : chosen;
      this.manJump = chosen === 'hop';
      this.manT = 0.35 + r() * 1.0;
      if (r() < 0.6) this.strafeDir = -this.strafeDir;
    }

    update(dt, g) {
      const m = this.mesh;
      if (!this.alive) {
        this.deadT += dt;
        const k = Math.min(1, this.deadT * 4);
        m.group.rotation.x = -k * 1.5;
        if (this.deadT > 2.0) m.group.visible = false;
        if (this.respawnAt > 0 && g.time >= this.respawnAt) g.respawnBot(this);
        return;
      }
      const b = this.body;
      const player = g.player;
      const pb = player.b;
      const st = this.style;

      // -------- perception ----------------------------------------------------
      this.seeT -= dt;
      const ex = b.x,
        ey = b.y + 1.6,
        ez = b.z;
      const pcy = pb.y + Math.min(1.1, pb.h * 0.6);
      if (this.seeT <= 0 && !this.dummy) {
        this.seeT = 0.1 + this.rng() * 0.06;
        const dx = pb.x - ex,
          dz = pb.z - ez;
        this.dist = Math.hypot(dx, pcy - ey, dz);
        const reach = Math.max(this.d.range, st.far * 1.6);
        const see = !g.playerDead && this.dist < reach && g.world.lineClear(ex, ey, ez, pb.x, pcy, pb.z);
        if (see && !this.canSee) this.acquiredAt = g.time;
        this.canSee = see;
        if (see) {
          this.lastSeen = g.time;
          this.lastSeenPos = { x: pb.x, y: pb.y, z: pb.z };
        }
      }

      let wantX = 0,
        wantZ = 0,
        speed = BOT.SPEED;
      if (this.dummy) {
        if (this.pace) {
          this.paceT += dt;
          const ph = Math.sin(this.paceT * (this.pace.speed || 0.5));
          const tx = this.home.x + this.pace.dx * ph,
            tz = this.home.z + this.pace.dz * ph;
          const dx = tx - b.x,
            dz = tz - b.z;
          const l = Math.hypot(dx, dz);
          if (l > 0.05) {
            wantX = dx / l;
            wantZ = dz / l;
            speed = Math.min(5, l * 8);
          }
        }
      } else if (this.canSee) {
        // ------------ combat movement ------------------------------------------
        const tx = pb.x - b.x,
          tz = pb.z - b.z;
        const tl = Math.hypot(tx, tz) || 1;
        const nx = tx / tl,
          nz = tz / tl;
        this.manT -= dt;
        if (this.manT <= 0) this._pickManeuver(tl);
        const sd = this.strafeDir;
        switch (this.man) {
          case 'advance':
            wantX = nx - nz * sd * 0.4;
            wantZ = nz + nx * sd * 0.4;
            if (st.charge) speed = 8.4;
            break;
          case 'retreat':
            wantX = -nx - nz * sd * 0.5;
            wantZ = -nz + nx * sd * 0.5;
            break;
          case 'hold':
            wantX = wantZ = 0;
            break;
          default: // strafe, drifting slightly towards the preferred range
            {
              const drift = tl > st.pref ? 0.25 : tl < st.pref * 0.7 ? -0.25 : 0;
              wantX = -nz * sd + nx * drift;
              wantZ = nx * sd + nz * drift;
            }
        }
        const l = Math.hypot(wantX, wantZ);
        if (l > 0.001) {
          wantX /= l;
          wantZ /= l;
        }
        // bunny-hop style jumps keep momentum through the air
        if (b.grounded && this.manJump && (wantX || wantZ) && this.rng() < dt * 3) {
          b.vy = 7.6;
          b.grounded = false;
        }
        // never stroll off ledges while dodging
        const fl = g.world.floorBelow(b.x + wantX * 1.3, b.y + 0.7, b.z + wantZ * 1.3, 0.3);
        if (fl < b.y - 1.2) {
          this.strafeDir = -this.strafeDir;
          wantX = wantZ = 0;
          this.manT = 0.1;
        }
        if (b.hitX || b.hitZ) {
          this.strafeDir = -this.strafeDir;
          this.manT = Math.min(this.manT, 0.15);
        }
      } else {
        // ------------ navigation -----------------------------------------------
        const nav = g.nav;
        if (nav && nav.live.length) {
          const alert = g.time - this.lastSeen < 4 && this.lastSeenPos;
          if (!this.path || this.pi >= this.path.length || g.time > this.repathAt) {
            const from = nav.nearest(b.x, b.y, b.z);
            let goal;
            if (alert) goal = nav.nearest(this.lastSeenPos.x, this.lastSeenPos.y, this.lastSeenPos.z);
            else if (g.mode === 'duel' || this.rng() < 0.45) goal = nav.nearest(pb.x + (this.rng() - 0.5) * 16, pb.y, pb.z + (this.rng() - 0.5) * 16);
            else goal = nav.random(this.rng);
            this.path = nav.path(from, goal);
            this.pi = 0;
            this.repathAt = g.time + 4 + this.rng() * 4;
          }
          if (this.path && this.pi < this.path.length) {
            const n = this.path[this.pi];
            const dx = n.x - b.x,
              dz = n.z - b.z;
            const d = Math.hypot(dx, dz);
            if (d < 0.9 && Math.abs(n.y - b.y) < 1.6) this.pi++;
            else {
              wantX = dx / (d || 1);
              wantZ = dz / (d || 1);
              if (st.charge) speed = 8.0;
            }
          }
          // stuck? pick a new route
          this.stuckT += dt;
          if (this.stuckT > 1.4) {
            if (Math.hypot(b.x - this.stuckX, b.z - this.stuckZ) < 0.5 && (wantX || wantZ)) {
              this.path = null;
              if (b.grounded) b.vy = 7.6;
            }
            this.stuckT = 0;
            this.stuckX = b.x;
            this.stuckZ = b.z;
          }
        }
      }

      // -------- velocity + physics ----------------------------------------------
      const air = b.grounded ? 1 : 0.25;
      const ax = BOT.ACCEL * dt * air;
      b.vx += RV.clamp(wantX * speed - b.vx, -ax, ax);
      b.vz += RV.clamp(wantZ * speed - b.vz, -ax, ax);
      const wasG = b.grounded;
      if (wasG && b.vy <= 0) b.vy = 0;
      else b.vy -= BOT.G * dt;
      g.world.move(b, b.vx * dt, b.vy * dt, b.vz * dt);
      if (b.hitX) b.vx = 0;
      if (b.hitZ) b.vz = 0;
      if (b.hitUp && b.vy > 0) b.vy = 0;
      if (b.landed && b.vy < 0) b.vy = 0;
      const gr = this._g;
      let found = b.vy <= 0.01 && g.world.probeGround(b, 0.05, gr);
      if (!found && wasG && b.vy <= 0.01 && g.world.probeGround(b, 0.4, gr)) {
        b.y = gr.y;
        found = true;
      }
      b.grounded = found;
      if (b.y < g.world.killY) {
        this.alive = true;
        this.hp = 0;
        this.damage(1, g);
        return;
      }

      // -------- aiming + shooting -------------------------------------------------
      if (!this.dummy) {
        let wantYaw = this.aimYaw,
          wantPitch = 0;
        if (this.canSee) {
          const h = g.sampleHistory(g.time - this.d.react);
          const lead = this.d.react * this.d.lead;
          const tx = h.x + h.vx * lead,
            tz = h.z + h.vz * lead;
          const ty = h.y + 0.9;
          const dx = tx - ex,
            dy = ty - ey,
            dz = tz - ez;
          wantYaw = Math.atan2(-dx, -dz);
          wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
          // slow, smooth wobble (deterministic, not per-shot spread): worse when the target moves fast
          const t = g.time;
          const wob = this.d.wobble * (1 + 0.8 * Math.min(1, Math.hypot(h.vx, h.vz) / 12));
          wantYaw += (Math.sin(t * 1.9 + this.phase) + 0.6 * Math.sin(t * 3.3 + this.phase2)) * wob;
          wantPitch += (Math.sin(t * 1.5 + this.phase2) + 0.6 * Math.sin(t * 2.7 + this.phase)) * wob * 0.7;
          const step = this.d.turn * dt;
          this.aimYaw += RV.clamp(RV.angleDiff(this.aimYaw, wantYaw), -step, step);
          this.aimPitch += RV.clamp(wantPitch - this.aimPitch, -step, step);
          this.yaw = this.aimYaw;

          this.fireCd -= dt;
          const err = Math.abs(RV.angleDiff(this.aimYaw, wantYaw)) + Math.abs(this.aimPitch - wantPitch);
          const w = this.weapon;
          if (this.burstLeft > 0) {
            if (this.fireCd <= 0) {
              if (w.melee) this._swing(g);
              else this._shoot(g, ex, ey, ez);
              this.burstLeft--;
              this.fireCd = w.interval * st.fireMul;
              if (this.burstLeft === 0) this.pauseT = (st.gap[0] + this.rng() * (st.gap[1] - st.gap[0])) * this.d.think;
            }
          } else {
            this.pauseT -= dt;
            const inRange = w.melee ? this.dist < w.range + 0.8 : true;
            if (this.pauseT <= 0 && err < st.tol && inRange && g.time - this.acquiredAt > this.d.react) {
              this.burstLeft = st.burst[0] + Math.floor(this.rng() * (st.burst[1] - st.burst[0] + 1));
            }
          }
        } else {
          this.burstLeft = 0;
          const sp = Math.hypot(b.vx, b.vz);
          if (sp > 0.5) {
            const wy = Math.atan2(-b.vx, -b.vz);
            this.yaw += RV.clamp(RV.angleDiff(this.yaw, wy), -8 * dt, 8 * dt);
          }
          this.aimYaw = this.yaw;
          this.aimPitch *= 0.9;
        }
      }

      // -------- visuals -------------------------------------------------------------
      const sp = Math.hypot(b.vx, b.vz);
      this.walkPhase += sp * dt * 2.2;
      const sw = b.grounded ? Math.sin(this.walkPhase) * Math.min(1, sp / 5) * 0.8 : 0.3;
      m.legL.rotation.x = sw;
      m.legR.rotation.x = -sw;
      m.group.position.set(b.x, b.y, b.z);
      m.group.rotation.set(0, this.yaw, 0);
      m.group.rotation.x = 0;
      if (this.flash > 0) {
        this.flash -= dt;
        m.bodyMat.emissive.setHex(0xffffff);
        m.headMat.emissive.setHex(0xffffff);
      } else {
        const pc = this.isProtected(g) ? 0x0c4f6e : 0x000000; // a protected bot glows faintly teal
        m.bodyMat.emissive.setHex(pc);
        m.headMat.emissive.setHex(pc);
      }
      const hpf = (this.hp + this.armor) / (BOT.HP + RV.ARMOR.START);
      m.fill.scale.x = Math.max(0.001, 0.9 * hpf);
      m.fill.position.x = -(0.9 - 0.9 * hpf) / 2;
      m.fill.material.color.setHex(hpf > 0.5 ? 0x4ade80 : hpf > 0.25 ? 0xfacc15 : 0xef4444);
    }

    /** Damage the player takes from this bot at distance `dist`. */
    _damage(dist) {
      return Math.max(1, Math.round(RV.damageAt(this.weapon, dist) * this.d.dmgMul));
    }

    _swing(g) {
      this.protUntil = 0; // attacking ends spawn protection
      const b = this.body,
        pb = g.player.b;
      const dist = Math.hypot(pb.x - b.x, pb.y + 0.9 - (b.y + 0.9), pb.z - b.z);
      RV.audio.play('swing');
      if (dist <= this.weapon.range + 0.6 && !g.playerDead) g.hurtPlayer(this._damage(dist), b.x, b.z, this);
    }

    _shoot(g, ex, ey, ez) {
      this.protUntil = 0; // attacking ends spawn protection
      const w = this.weapon;
      const cp = Math.cos(this.aimPitch);
      const dx = -Math.sin(this.aimYaw) * cp,
        dy = Math.sin(this.aimPitch),
        dz = -Math.cos(this.aimYaw) * cp;
      const rh = this._rh;
      const range = Math.min(w.range, 160);
      const hit = g.world.raycast(ex, ey, ez, dx, dy, dz, range, rh);
      const tw = hit ? rh.t : range;
      const pb = g.player.b;
      const tp = g.playerDead
        ? -1
        : RV.rayAABB(ex, ey, ez, dx, dy, dz, pb.x - pb.hw, pb.y, pb.z - pb.hw, pb.x + pb.hw, pb.y + pb.h, pb.z + pb.hw, tw);
      const end = tp >= 0 && tp < tw ? tp : tw;
      // bots are loud when close
      const dist = this.dist || 30;
      RV.audio.play('botShot', RV.clamp(1.2 - dist / 60, 0.15, 1));
      RV.render.addTracer(ex + dx * 0.6, ey - 0.25 + dy * 0.6, ez + dz * 0.6, ex + dx * end, ey + dy * end, ez + dz * end, w.tracer || 0xff6b5b, Math.max(0.05, (w.tw || 0.03) * 1.5));
      RV.render.addSpark(ex + dx * 0.75, ey - 0.25 + dy * 0.75, ez + dz * 0.75, 0xffe29a, 0.45, 0.06);
      if (hit && !(tp >= 0 && tp < tw) && end < 70) RV.fx.impact(ex + dx * end, ey + dy * end, ez + dz * end, rh.nx, rh.ny, rh.nz, 'wall');
      if (tp >= 0 && tp < tw) g.hurtPlayer(this._damage(tp), this.body.x, this.body.z, this);
    }
  }

  RV.Nav = Nav;
  RV.Bot = Bot;
  RV.BOT = BOT;
  RV.BOT_DIFF = DIFF;
  RV.BOT_STYLE = STYLE;
})();
