# DASHDUEL online backend: design, anti-cheat, deployment

Short version: **a small persistent Node.js server (`server/`, zero dependencies) holds the WebSocket connections, does
the matchmaking and runs every 1v1 match as the only authority.** The browser sends *input* and *requests*; the server
simulates movement with the game's own physics, decides every hit, owns health / ammo / score / rounds / grenades, and
only tells each player what that player is allowed to know. The static game files are deployed separately and are told
where the server is with one setting. Practice, Duel, Deathmatch and Time Trial still work with no server at all.

> **Security model in one sentence:** nothing the browser says is believed unless the server's own simulation agrees.
> Position is derived from input (not claimed), hits are computed on the server from the server's own positions
> (no client direction, timestamp or damage is read), and an opponent behind a wall is never sent to you.

---

## 1. Why a custom Node.js server (and not Colyseus / serverless)

| | **Serverless WebSocket** (API Gateway + Lambda, managed pub/sub) | **Colyseus (TypeScript)** | **This server (plain Node.js)** |
|---|---|---|---|
| State | Stateless: every room/queue/health value goes through an external store on every message | In-process rooms (good) | In-process rooms (a 1v1 room is a few KB) |
| 120 Hz physics + 30 Hz snapshots + grenade/round timers | No process to run a tick | Yes | Yes (`setInterval` tick, movement stepped at 120 Hz) |
| Runs the **same** physics as the browser | Would have to ship the game files into the function runtime | Needs a TypeScript/bundler pipeline to share `js/player.js` (classic scripts, not modules) | **Loads `js/{util,collision,maps,player,weapondata,grensim,netproto}.js` unchanged**, so prediction and the authority cannot drift apart |
| Build step / dependencies | Cloud-specific tooling | npm, TypeScript, schema classes | None. `node server/server.js` |
| Already tested | n/a | Rewrite + re-test | 81 automated tests + real-browser end-to-end runs |

I chose the plain server because the central requirement (client prediction that is **bit-exact** with the server
simulation) is easiest to guarantee when both sides run literally the same file. Colyseus would be a reasonable choice
for a team that already uses TypeScript and wants its matchmaking/room tooling; it would mean porting the physics into
modules and giving up the zero-dependency, no-build property. Serverless suits bursty, tick-less games; this one is
the opposite. (Cloudflare Durable Objects are a good stateful-serverless alternative for global scale later.)

Consequences you should know about:
* Run **exactly one instance**. Rooms live in memory, so both players must be on the same process. (Scaling out later =
  a matchmaker that hands both players the same server address.)
* A server restart ends the matches in progress (players are told). Session tokens survive a restart only if
  `SESSION_SECRET` is set, but the *rooms* do not.
* Some free hosting tiers put idle services to sleep; the first connection after a quiet period can be slow.

---

## 2. Architecture

```
  Browser (static files on any host)                          Game server (one Node.js process)
  ┌─────────────────────────────────┐   one persistent       ┌───────────────────────────────────────────┐
  │ js/netclient.js  socket, hello, │   WebSocket (wss://)   │ websocket.js  RFC 6455 on http upgrade    │
  │   session token, heartbeat, RTT │ ◄────────────────────► │ lobby.js      connections, sessions,      │
  │ js/online.js     input stream,  │   JSON text frames     │               rate limits, queue, matching│
  │   prediction + reconciliation,  │                        │ sessions.js   signed session tokens       │
  │   interpolation, reconnect      │                        │ schema.js     validates EVERY message     │
  │ js/netproto.js   wire format  ──┼──── shared file ───────┤ room.js       one isolated match: movement│
  │ js/player.js     movement phys. ┼──── shared file ───────┤               sim, combat, grenades, score│
  │ js/config.js     SERVER_URL     │                        │ anticheat.js  violation scoring, lockout  │
  └─────────────────────────────────┘                        │ log.js        structured security logs    │
        local modes need no server                           └───────────────────────────────────────────┘
```

### Who decides what

| Thing | Decided by | How |
|---|---|---|
| Player identity | **server** | The server creates a random session id and a signed token (`id.HMAC`). The browser keeps the token in `sessionStorage` only to resume; **no client-supplied id, seat or team is ever used**. |
| Your position | **server**, predicted by you | You send *input* (keys + view angles, numbered). The server steps the same physics with it. You also simulate locally so movement is instant; the server compares and corrects (section 4). |
| Where the opponent is (and whether you may know) | **server** | Positions are sent only if the opponent is visible (section 7). Otherwise the snapshot says `hidden` and contains no coordinates. |
| Hits, damage, headshots | **server** | Ray from the *server's* eye position along the view your *input stream* describes; the target is rewound by a bounded lag compensation (section 5). Hit markers and damage numbers appear only when the server confirms. |
| Health, ammo, reload, weapon switch, cooldowns | **server** | In simulation time (`step × 1/120 s`), so a client cannot fire faster by lying about time. |
| Grenades | **server** | Flight, bounces, fuse, blast, damage and the blast push are simulated with the same `grensim.js` the client uses for its preview. |
| Rounds, score, countdown (3 s locked), 90 s round limit, spawns, winner, rematch | **server** | First to 5. |
| Disconnects | **server** | 15 s reconnect grace, then forfeit (section 8). |

### Messages (JSON text frames)

Client → server (all checked by `server/schema.js`; unknown types, unknown fields, wrong types and out-of-range values
are rejected and counted):

| Message | Fields | Meaning |
|---|---|---|
| `hello` | `v, name, tok?` | Handshake: protocol version, display name, optional session token to resume |
| `queue` / `unqueue` / `ready` / `leave` / `rematch` | none | Lobby and match flow |
| `in` | `rn, q, r:[[k,fw,sd,flags,yaw,pitch,slot],…], c?:[x,y,z,fx]` | A batch of input: round number, sequence number of the first step, runs of `k` identical 1/120 s steps, and optionally the client's *predicted position* after the last step (`c`) with the id of the last correction it applied |
| `act` | `rn, q, a, s` | A request: `fire punch reload nadepin nadecancel nade nadeself`, made at input step `q`, with weapon slot `s`. **No direction, no timestamp, no damage** |
| `ping` / `spong` | `ts` | Latency |

Server → client: `welcome` (session id, token for a new session), `queued`, `match`, `resume`, `round`, `live`, `snap`
(30 Hz), `hurt`, `hit`, `fx`, `nade`, `boom`, `roundEnd`, `matchEnd`, `fix`, `opp` (away/back), `rematch`, `warn`, `err`,
`sping`, `pong`.

### Connection status in the game
The in-game top-left line shows `Connected · <ms> · <n> online` (or `Reconnecting…`); the queue screen shows connecting /
searching / error states; the results screen offers **Rematch**; *Settings → Network* shows the server in use and has a
**Test connection** button (a separate short socket, so it never disturbs a running match).

---

## 3. Sessions, matchmaking, rooms

* **Session:** `hello` without a token creates a session (`sessions.js`): 12 random bytes for the id, signed with
  HMAC-SHA256 using `SESSION_SECRET` (random per start if unset). A token is verified in constant time. A valid token
  on a new connection **replaces** the old connection of the same session (a session is never in two places).
* **Queue:** `queue` puts the connection in a FIFO list; two live, distinct sessions become a `Room` (random map from
  the duel maps). A session already inside a running match that sends `queue` is *re-attached* to that
  match instead of being queued twice.
* **Isolation:** each room has its own players, history, grenades and timers; nothing is shared. A bug or exception in
  one room aborts that room (both players are told) and never touches the others. Closed rooms are removed from the
  lobby and the session table; idle sessions are swept after `SESSION_IDLE_S`.
* **Match flow:** `match` → both load and send `ready` (25 s timeout) → `round` (3 s countdown, both locked in their
  own spawn) → `live` → … → `roundEnd` → next round … → `matchEnd` (first to 5, or forfeit). The round ends when a
  player dies, or after 90 s (more health wins).

---

## 4. Movement: input stream, prediction, reconciliation, interpolation

1. **The client records its input** every 1/120 s physics step, merges identical steps into *runs*
   `[k, fw, sd, flags, yaw, pitch, slot]`, numbers them (`q` = index of the first step) and sends a batch ~30×/s.
2. **The server steps its own `Player` (the same `js/player.js`) with that input**, at most 120 steps per second of
   real time (token bucket with a small burst), so the official position can only be what the physics allows from that
   input: no teleport, no speed beyond the physics, no walking through walls, no extra jumps (the fists-only double jump
   is enabled only while the *server* says the Fists are equipped).
3. **Prediction:** the browser simulates the same input locally, so its own movement feels instant.
4. **Reconciliation:** each batch carries the client's predicted position (`c`). When the server's simulation reaches that
   step it compares; if they differ by more than `AC_CLAIM_EPS` (5 cm) it sends `fix {id, a, st, why}` with the full
   movement state at step `a`. The client restores that state and **replays** every input the server has not simulated yet,
   then smooths the visible jump (<3 m; larger snaps). `fx` ids stop stale claims from triggering a second correction.
   Corrections are also used for teleport-like events only the server knows about (grenade blast push: `why:'boost'`).
   With honest play the corrections are **zero** (the same code on both sides is bit-exact; verified).
5. **Interpolation:** the opponent is drawn 100 ms in the past from 30 Hz snapshots.
6. **Stalls and speed-hack limit:** input is simulated at real-time rate; after a network or server stall the backlog is
   worked off at up to 1.5× (so a lag spike does not leave you late for the rest of the round), but a client may never
   be **ahead** of the round clock by more than 3 s of input in total (`received ≤ clock × 120 + 360`). A client that
   sends input faster than real time (speed hack / time hack) hits that limit and is flagged `input_overflow`.

### What the movement checks understand
Because the server runs the real physics, **everything legitimate is automatically legitimate**: slides, slide-jumps,
bunny hops (auto-hop only if that client setting is sent *and* it is the same physics), air strafing, wall runs and wall
jumps, ramps and launch pads, grenade boosts, and the Fists-only double jump. There are no hand-written speed
thresholds that could false-positive on those. What is rejected falls out of the simulation: speed above what input can
produce, teleports, noclip, flying, a double jump without Fists, a jump rate faster than the physics allows.

---

## 5. Combat and lag compensation

* A `fire`/`punch` request is queued with the input step `q` it was made at and executed **when the server's simulation
  of that player reaches step `q`**; weapon timing is therefore in simulation seconds and cannot be sped up by the client.
* **Origin** = the server's simulated eye position. **Direction** = the view (yaw/pitch) of the player's own input
  stream at that step (the input turn rate is clamped, see below). **Nothing the client could send about direction,
  position, time or damage exists on the wire.** Zero recoil and zero spread are kept (the game design).
* The ray is cast against the map, then against the target **rewound** to where the shooter saw them:
  `rewind = clamp(shooter RTT + 100 ms interpolation, 0, 350 ms)` using the server's own per-tick position history
  (1.5 s kept). A high-ping player cannot rewind further than 350 ms.
* Validation before the shot happens: weapon is a gun, equipped (switch time respected), not reloading, ammo > 0,
  interval ≥ 90 % of the weapon's (frame granularity), alive, round live. Violations are scored (below), not trusted.
* Headshot = ray height in the top 0.3 m of the target's body box; damage = the shared `RV.damageAt` table (distance
  falloff) × the crit multiplier. The weapon numbers are the RIVALS ones (rifle 12 → 3, handgun 12 → 3, 0.10 / 0.13 s,
  20 / 100 and 13 / 91 rounds, fists 30 / 0.35 s, grenade 75): see `js/weapondata.js`, which the server loads unchanged.
* **Ammo** is tracked per weapon slot on the server (magazine + spare rounds). A reload moves only the missing rounds out of
  the spare ones (sim-time duration); with no spare rounds it does nothing. Refilled every round.
* **Spawn protection:** when a round goes `live` each player gets `SPAWN_PROTECT_S` (default 2 s) with no damage taken; it
  ends at once when that player fires, punches or throws, and never stops void deaths. A shot absorbed by it sends the
  shooter a `blk` message (no hit marker); snapshots carry `pr` (seconds left, own) and `o.pr` (opponent flag, for the glow).
* Grenades: pin → throw requires a pin, the hold time and the cooldown; the server launches the projectile with the
  thrower's velocity and simulates it; "self-detonation" requires the full hold time.

---

## 6. Anti-cheat rules

Every violation adds weight to a **per-session score that decays 1 point/second**. One odd event (a lag spike, a
duplicate packet) is forgotten; sustained cheating adds up.

| Score / count | Result |
|---|---|
| ≥ **40** (`AC_WARN_SCORE`) | the client gets a `warn` message (at most every 10 s), logged |
| ≥ **100** (`AC_KICK_SCORE`) | disconnect (`1008`), and the **session and IP are locked out of matchmaking for 60 s** (`AC_LOCKOUT_S`). **Never a permanent ban.** |
| **3 severe** events inside 60 s | the same kick |

| Rule | Weight | Severe | Triggered by |
|---|---|---|---|
| `bad_message` | 4 | | not JSON, unknown type, unknown field, wrong type or range |
| `rate_limit` | 4 | | more than 90 messages/s sustained (burst 120) |
| `seq_gap` | 30 | ✔ | an input batch that skips steps (hiding input) |
| `seq_dup` | 6 | | the same input steps sent twice (replay) |
| `input_overflow` | 25 | ✔ | more input than the round clock allows (speed hack), or a flood of queued input |
| `act_future` | 20 | ✔ | an action that refers to input that was never sent |
| `act_order` | 8 | | actions out of order |
| `aim_rate` | 6 | | view turned faster than 80 rad/s (a very fast human flick is ~30); the turn is **clamped** as well |
| `prediction_mismatch` | 2 | | the client's position differs from the simulation (corrected; low weight because a cheater who is corrected is harmless) |
| `fire_rate` / `melee_rate` | 3 | | fired/punched faster than the weapon allows |
| `fire_no_ammo` | 4 | | shot with an empty magazine |
| `fire_dead` | 2 | | acted while dead |
| `fire_wrong_weapon` | 3 | | fired a non-gun |
| `nade_rate` / `nade_early` | 8 / 12 | | grenade without a pin / too fast / self-detonation before the hold time |
| `weapon_switch_rate` | 2 | | switching faster than 50 ms |
| `reload_invalid` | 3 | | reloading a full magazine or a non-gun |

All thresholds are configurable (`server/.env.example`). Impossible things are not "detected after the fact": they
simply do not happen, because the server computes them.

**Telemetry (logged, never auto-punished):** at match end the server logs per player shots, hits, headshot ratio,
minimum/average fire interval, maximum view turn rate, hits right after very fast flicks, number of corrections and
mismatches. These help a human spot an aimbot; a clean-looking aimbot that obeys all limits cannot be proven from the
server (see section 11).

### Logging and inspection
* **Structured JSON logs** (one object per line; `LOG_FORMAT=text` for humans): `match_start`, `match_end` (+telemetry),
  `violation` (rule, weight, score, session id, room, small details), `warn`, `kick`, `player_away/back/gone`,
  `rematch_*`, `session_new/resume`, `room_error`. Fields named token/secret/password/authorization are dropped before
  writing; no IP addresses or tokens are logged.
* **Dev-only endpoints**, off unless `DEBUG_ENDPOINTS=1`: `GET /debug/anticheat` (rule table with counters, active
  scores, recent security events, thresholds) and `GET /debug/rooms` (room phase, scores, stats per room). They need
  `Authorization: Bearer <ADMIN_TOKEN>` (constant-time compare) or, with no token configured, a loopback client.
  Neither exposes tokens, IPs or secrets. `GET /health` is always available and contains no secrets.

---

## 7. Information protection (wallhack mitigation)

A client cannot draw what it never receives. Each snapshot to a player contains the opponent's position **only if**:
* they are within 3 m, or
* a line of sight exists from the viewer's eye to any of 5 points on the opponent's body (centre, head, feet, two
  sides) through the map's collision geometry, or would exist within the next 0.25 s (look-ahead, so nobody pops into
  view late), and
* it stays visible for 0.5 s after the line breaks (no flicker).

Otherwise the snapshot carries `o:{hid:1, al}` (just "alive or not"). Also: the opponent's **spawn is never announced**
(the `round` message has only *your* spawn), shot effects from a hidden shooter carry **no origin or direction**
(the target just hears the shot), and a **grenade thrown from out of sight is not replicated** (its start point would give
away the thrower): the opponent only gets the explosion, which is a loud, bright world event shared by both players.
Tests check that a hidden player's snapshots contain no coordinates and that a hidden throw sends no `nade` message.

---

## 8. Reconnection, disconnect, rematch

* A dropped connection (not a deliberate leave) puts the player **away**: their avatar is held, the round clock stops,
  they cannot be damaged, the opponent is told (`opp away`). The browser reconnects automatically for up to ~16 s with
  its session token; the server answers with `resume` (map, round, phase, scores, health, ammo, grenades, exact
  movement state, last acknowledged input step, countdown / clock) and the client adopts it. After 15 s
  (`RECONNECT_GRACE_S`) the player forfeits.
* **Leave match**, closing the tab (`pagehide`), or a kick ends the match for that player at once (forfeit).
* **Rematch:** after a normal match both players get a *Rematch* button for 20 s. When both press it the same room
  restarts at 0-0 (maps reloaded, countdown again). If one leaves, the other is told; an unanswered request expires.
  No rematch after a forfeit.
* After the final result the room is closed and freed; sessions without a connection are swept after 60 s; an
  abandoned room is closed by the reconnect timeout, the loading timeout (25 s), or the rematch window.
* **After a page reload** (not just a network drop) click *Online 1v1* again: the server recognises the stored token and
  puts you back in the running match instead of queueing you.

---

## 9. Transport security

* **TLS (`wss://`):** production traffic must be encrypted. `REQUIRE_TLS=1` makes the server refuse plain `ws://`
  (it trusts `X-Forwarded-Proto: https` only when `TRUST_PROXY=1`). The browser refuses `ws://` from an `https://`
  page and the game says so. Terminate TLS in a reverse proxy / the platform (Render, Fly, Railway, Caddy, nginx).
* **Origin allow-list:** `ALLOWED_ORIGINS` (exact origins). Empty = local development only (no Origin, `file://`,
  `localhost`). Pages the server itself served are always allowed.
* **Limits:** per-IP and total connection limits, 4 KB message limit, handshake timeout (8 s), silent-connection timeout
  (12 s), token-bucket message rate limit, schema validation on every message, bounded queues and arrays everywhere.
* **No secrets in the browser files** (everything in `js/` is public): the server URL is not a secret; the only
  secrets are server-side environment variables (`SESSION_SECRET`, `ADMIN_TOKEN`).

---

## 10. Run it locally and test with two clients

You need Node.js 20 or newer (no `npm install`).

```bash
cd server
SERVE_STATIC=1 node server.js          # game + socket on http://localhost:8787
```
PowerShell: `$env:SERVE_STATIC='1'; node server.js`.

**Two-client test:**
1. Open `http://localhost:8787/` in **two browser windows** (or one normal and one private window; the session token
   lives in `sessionStorage`, so two *tabs* of one browser also work).
2. Enter a different username in each and press **Online 1v1** in both. They are matched and the match starts by itself in both (click once in the game to capture the mouse).
3. Check: 3-2-1 countdown with both locked in their spawns; you move instantly; the other window shows your avatar only
   when there is a line of sight; shooting shows hit markers only after the server confirms; scores and rounds stay in
   sync; first to 5 wins and the results screen offers **Rematch**.
4. Reconnect: in one window open DevTools → Network → toggle *Offline* for ~3 s, then back online: the match resumes
   (the other window shows "lost connection / is back"). Longer than 15 s = forfeit.
5. Another device on your network: open `http://<this-computer>:8787/?server=ws://<this-computer>:8787/ws`.
6. To watch the anti-cheat: `DEBUG_ENDPOINTS=1 node server.js`, then `curl http://localhost:8787/debug/anticheat`.

### Automated tests
```bash
cd server
npm test                                # 81 tests, serial, ~5 min (timing-based: close other heavy programs while it runs)
```
| File | Tests | Covers |
|---|---|---|
| `lobby.test.js` | 13 | handshake, queue, matchmaking, room isolation, countdown lock, forfeits, limits, origin checks, WebSocket framing |
| `movement.test.js` | 12 | prediction == simulation bit-for-bit for walking/sprint/slide/hop/air-strafe/wall-run/double-jump, corrections, teleport / speed-hack / lump-after-stall / flooding / replay / aim-rate |
| `combat.test.js` | 15 | server-side hits and headshots, lag compensation bounds, ammo/reload/cooldowns, melee, grenades, dead players, cheating clients' extra fields |
| `anticheat.test.js` | 21 | every rule: weights, decay, warn, kick, lockout, severe-event kick, schema rejection, rate limiting, telemetry, redaction |
| `map.test.js` | 2 | the Test Arena map: spawns clear and on the floor, a server-decided hit, a hidden opponent |
| `protection.test.js` | 4 | spawn protection: no damage while protected, shooter told, attacking ends it, the void still kills, per round |
| `session.test.js` | 12 | tokens, resume, replacement, reconnect grace and forfeit, rematch, room cleanup, information protection, misbehaving client mid-match |
| `load.test.js` | 1 | 16 simultaneous matches with real input |

They start the real server in-process and drive it with real WebSocket clients, including a *prediction client* that
runs the game's physics exactly like the browser. A few TEST_MODE-only messages (teleport, state dump) let the tests
stage fights; `TEST_MODE` must never be set on a public server.

**Browser-level end-to-end** (two real headless Chrome instances against the real server, 58 checks, run with `SPAWN_PROTECT_S=14` so protection can be exercised): queue and match
by the server; countdown lock with held keys; opponent hidden at round start and no coordinates in hidden snapshots;
movement prediction with **0 corrections** over a sprint; input acknowledgements; teleport correction; server-confirmed
hits and server-owned health (a client setting its own health to 1 is overwritten); round and match win through
5 rounds; abnormal socket close → `away` / `back` / `resume` with the same round and score and still in agreement with
the server; results with rematch offered, accepted by both → a fresh 0-0 match; forfeit with no rematch; no console errors.

### Measured cost (this machine, loopback)
16 simultaneous matches (32 players, real input at 120 steps/s): server busy **1.8 % of one core** (0.037 ms per
room-tick, 0.008 ms per input batch), **~3.3 KB/s down per player**, 0 corrections. Earlier 40 rooms / 80 players
measured about 4 % of a core. Rooms are removed when finished (checked by the session/lobby tests); nothing grows
with match count.

---

## 11. Configuration

The browser needs **one** setting; the server needs **none** to run. All variables are documented, with defaults, in
**[`server/.env.example`](../server/.env.example)** (no real secrets in it).

**Browser** (`js/config.js`, in order of priority): `?server=` in the address bar → *Settings → Network* (saved in the
browser) → `SERVER_URL` → `SAME_ORIGIN_SERVER` (the host that served the page) → `LOCAL_SERVER_URL` (localhost only).

**Server essentials:**

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Where to listen (hosts set `PORT` for you) |
| `ALLOWED_ORIGINS` | *(empty = local only)* | Your frontend's exact origin(s). **Set in production.** |
| `REQUIRE_TLS` | off | `1` in production: refuse plain `ws://` |
| `TRUST_PROXY` | off | `1` behind a proxy/platform: real client IP + `X-Forwarded-Proto` |
| `SESSION_SECRET` | random per start | ≥ 32 random characters; set it in production |
| `DEBUG_ENDPOINTS` / `ADMIN_TOKEN` | off / empty | Inspection endpoints (section 6) |
| `SERVE_STATIC` | off | also serve `index.html`, `css/`, `js/`, `vendor/` |
| `SPAWN_PROTECT_S` | `2` | seconds of damage immunity when a round goes live (0 = off) |
| `MAX_CONNECTIONS` / `MAX_PER_IP` | `400` / `6` | Connection limits |
| `LOG_LEVEL` / `LOG_FORMAT` | `info` / `json` | Logging |
| `RECONNECT_GRACE_S`, `REMATCH_WINDOW_S`, `AC_*`, `LAG_MAX_REWIND_MS` | see `.env.example` | Thresholds |

---

## 12. Deployment

Two parts: **(A)** the game server (a host that runs a long-lived Node process and supports WebSockets) and **(B)** the
static game files (any static host). Use **`wss://`** whenever the page is `https://`.
I could not deploy to any hosting provider from this environment, so the steps below are the providers' standard
workflows and have **not** been run by me; check each provider's current docs and pricing.

The server needs the repository's `js/` folder next to `server/` (it runs the game's own collision, maps, physics and
weapon code), so deploy the **whole repository** (or use the supplied `Dockerfile`).

### Ports and protocol
One TCP port (`PORT`, default 8787) serves HTTP (`/health`, optional static files, optional `/debug/*`) **and** the
WebSocket upgrade on `/ws`. Behind a TLS proxy the public port is 443 (`wss://host/ws`) and the proxy forwards to
`PORT` on the private side. Open nothing else.

### A1. Render (web service)
1. Push to GitHub. Render → *New* → *Web Service* → the repository. Runtime **Node**, build command empty, start
   command `node server/server.js`, **1 instance**.
2. Environment: `TRUST_PROXY=1`, `REQUIRE_TLS=1`, `ALLOWED_ORIGINS=https://<your-frontend-host>`,
   `SESSION_SECRET=<random 32+ chars>`.
3. Health check path `/health`. Socket URL: `wss://<service>.onrender.com/ws`.

### A2. Fly.io (uses the Dockerfile)
1. `fly launch --no-deploy` (accept the Dockerfile; internal port `8787`).
2. `fly secrets set SESSION_SECRET=<random>` and in `fly.toml` `[env]`: `TRUST_PROXY="1"`, `REQUIRE_TLS="1"`,
   `ALLOWED_ORIGINS="https://<your-frontend-host>"`.
3. `fly scale count 1`, `fly deploy`. Socket URL `wss://<app>.fly.dev/ws`. Pick the region nearest your players.

### A3. Railway
New project → *Deploy from GitHub repo*, start command `node server/server.js`; variables as above; generate a public
domain. Socket URL `wss://<domain>/ws`.

### A4. Your own VPS
```bash
git clone <your repo> dashduel && cd dashduel/server
sudo tee /etc/systemd/system/dashduel.service >/dev/null <<'EOF'
[Unit]
Description=DASHDUEL game server
After=network.target
[Service]
WorkingDirectory=/home/<user>/dashduel/server
Environment=PORT=8787 TRUST_PROXY=1 REQUIRE_TLS=1 ALLOWED_ORIGINS=https://<your-frontend-host>
EnvironmentFile=/etc/dashduel.env     # contains SESSION_SECRET=...  (chmod 600)
ExecStart=/usr/bin/node server.js
Restart=always
User=<user>
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now dashduel
```
TLS reverse proxy: with Caddy, `game.example.com { reverse_proxy localhost:8787 }` (WebSockets are automatic). nginx needs
`proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`,
`proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header X-Forwarded-For $remote_addr;` and a long `proxy_read_timeout`.

### B. The game files (frontend)
Publish `index.html`, `css/`, `js/`, `vendor/` on any static host (Netlify, Cloudflare Pages, GitHub Pages, …) and
set `SERVER_URL: 'wss://your-server.example.com/ws'` in `js/config.js`. The server's `ALLOWED_ORIGINS` must contain
exactly the frontend's origin. **One-service option:** `SERVE_STATIC=1` on the server and `SAME_ORIGIN_SERVER: true` in
`js/config.js`.

### Production checklist
- [ ] `wss://` works, `REQUIRE_TLS=1` set, plain `ws://` is refused
- [ ] `ALLOWED_ORIGINS` is exactly your frontend origin (not `*`)
- [ ] `SESSION_SECRET` set to ≥ 32 random characters (and not in git)
- [ ] `TEST_MODE` is **not** set; `DEBUG_ENDPOINTS` off, or on with a strong `ADMIN_TOKEN`
- [ ] `TRUST_PROXY=1` only if a proxy really is in front (otherwise clients could fake their IP)
- [ ] Exactly one server instance; process restarts automatically (systemd / platform)
- [ ] Logs are collected (JSON lines) and `/health` is monitored
- [ ] Two real devices on the public URL: queue, play a round, test a reconnect, test a rematch
- [ ] Server region is close to your players

---

## 13. Honest limitations

* **Aimbots and triggerbots** that stay inside the rules cannot be detected by any server: the view they send is a
  legal view. What the server does: clamps turn rate, enforces weapon timing, never trusts a direction, and logs
  telemetry (headshot ratio, flick hits) so a human can look. Real anti-cheat for that needs client attestation or
  review of replays, which a browser game cannot offer.
* **Visibility culling is conservative**: an opponent shown for a moment just before/after a line of sight (look-ahead
  0.25 s, hold 0.5 s) is a deliberate trade for smoothness. A modified client can still hear/see **shot sounds** and a
  grenade thrown at it. Positions in the near-visible margin can be read by a hacked client.
* **Lag compensation favours the shooter** up to 350 ms, like most shooters; a player with very high ping gets no extra.
* **No accounts, ranking, persistence or moderation tools**; the lockout is per session + IP for 60 s and is not a ban
  system. A determined cheater can reconnect after the lockout.
* **One server process**: rooms are in memory; a restart ends running matches. No regions, no matchmaking by skill.
* **Prediction replay** is exact only for movement. A grenade blast push is applied by the server and corrected on the
  client (a short visible snap is possible on bad connections).
* Not verified: real internet play at scale, real-world TLS/proxy deployment, pointer lock and fullscreen in a real
  window (the headless tests run with a no-lock flag), real GPU behaviour, mobile networks.

## 14. Where to grow later
* Several processes + a matchmaker that returns the closest server (or Durable Objects per room).
* Skill-based matchmaking and accounts behind a small database.
* Replay recording of matches (the input streams are already numbered and deterministic) for moderation.
* Binary messages instead of JSON if bandwidth ever matters (today ~3 KB/s per player).
