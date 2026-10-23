# DASHDUEL online backend: choice, design and deployment

Short version: **a small persistent Node.js server (`server/`) holds the WebSocket connections, does the matchmaking and
referees every 1v1 match.** It has no dependencies and needs no secrets. The browser game (static files) is deployed
separately and is told where the server is with one setting. Local practice modes still work with no server at all.

---

## 1. Serverless WebSocket backend vs. a persistent Node.js game server

I weighed both before writing any server code.

| | **Serverless WebSocket** (e.g. API Gateway + Lambda, or a managed pub/sub) | **Persistent Node.js server** |
|---|---|---|
| **Where state lives** | Functions are stateless and short-lived, so every room, queue entry, health value and position history has to be read from / written to an external store (DynamoDB, Redis, ...) on *every message*. | In the process's memory. A 1v1 room is a few kilobytes of plain objects. |
| **Message cost / latency** | Each client message is typically a function invocation (billed per request, plus cold starts). A shooter sends ~30 position updates per second per player, so cost and tail latency are paid thousands of times a minute. | A message is a function call inside a running process: microseconds, no per-message billing. |
| **Game loop** | There is no process to run a fixed tick (30 Hz snapshots, grenade physics, round timers, respawn countdowns). You would need a scheduler or step timer outside the platform. | A plain `setInterval` tick. Timers, projectiles and round clocks are trivial. |
| **Lag compensation / anti-cheat** | Needs a short per-player position history (last ~0.5 s) to rewind hits; in a stateless function that is another store round-trip per shot. | Kept in memory next to the room. |
| **Sharing the game's own rules** | The collision world, weapon table and grenade physics would have to run inside the function runtime on every cold start. | Loads the same `js/` files the browser uses, once, at start-up. The server and the client cannot drift apart. |
| **Connection limits** | Managed WebSocket gateways document a maximum connection duration and an idle timeout; a match must survive those. | A socket lives as long as the match does. |
| **Scaling** | Scales out automatically and costs nothing when idle. This is its real strength. | One process = one CPU core and one machine. Fine for a small game (a room is tiny), but you scale by adding servers, not by magic. |
| **Operations** | Nothing to keep running, but the architecture is spread over several managed services. | One process to deploy, restart and watch. A restart ends the matches in progress. |
| **Dev / testing** | Needs emulators or a cloud account to test. | `node server/server.js`; the automated tests start the real server in-process. |

A notable exception is a *stateful* serverless primitive such as Cloudflare Durable Objects (one object per room, with
its own memory and timers). It suits rooms well, but it means a different runtime API, a rewrite of the server and
lock-in to one platform. It is a reasonable second step if you ever need global scale; it is not needed for a small game.

### Decision: persistent Node.js server

For a browser 1v1 shooter with a 30 Hz authoritative tick, server-side hit validation with lag compensation, server-run
grenades and tiny rooms, the persistent process is the simpler, cheaper and more accurate fit. Serverless wins when
traffic is bursty and tiny and nothing needs a tick loop; this game is the opposite.

Consequences you should know about:
* Run **exactly one instance** of the server. Rooms live in memory, so both players of a match must be connected to the
  same process. (Scaling out later means a matchmaker that hands both players the same server address.)
* A server restart or crash ends the matches in progress (the connected player is told; there is no reconnection yet).
* Some free hosting tiers put idle services to sleep; the first connection after a quiet period can then take a while.
  Check your host's current free-tier terms before relying on it.

---

## 2. Architecture

```
  Browser (static files on any host)                        Game server (one Node.js process)
  ┌──────────────────────────────┐   one persistent        ┌──────────────────────────────────────┐
  │ js/netclient.js  socket,     │   WebSocket (wss://)    │ websocket.js  RFC 6455 on http upgrade│
  │   handshake, heartbeat, RTT  │ ◄─────────────────────► │ lobby.js      connections, queue,     │
  │ js/online.js     sends own   │   JSON messages         │               matchmaking, heartbeat  │
  │   movement + requests,       │                         │ room.js       ONE isolated match:     │
  │   draws what the server says │                         │               rules, validation, hits,│
  │ js/config.js     SERVER_URL  │                         │               grenades, score, rounds │
  └──────────────────────────────┘                         │ shared.js     loads js/{util,collision│
        local modes need no server                         │               ,maps,player,weapondata,│
                                                           │               grensim}.js unchanged   │
                                                           └──────────────────────────────────────┘
```

### Who decides what

| Thing | Decided by | How |
|---|---|---|
| Your movement | **client**, then **checked by the server** | The client simulates its own physics (so it feels instant) and sends 30 snapshots/s. The server rejects teleports, speeds above the cap (movement budget), positions inside walls and out-of-bounds values, and snaps the player back (`fix`). |
| Where the opponent is | **server** | Snapshots at 30 Hz; the client draws the opponent 100 ms in the past, interpolated. |
| Hits, damage, headshots | **server** | The client only sends "fire in this direction". The server casts the ray from *its own* validated position of the shooter and tests it against the target's position *rewound* to when the shooter saw it (`rtt + 100 ms`, max 350 ms). Hit markers and damage numbers appear only when the server confirms. |
| Health, ammo, reloads, weapon switch time | **server** | 150 HP, 30/12 round magazines, fire-rate and reload timing enforced. |
| Rounds, score, respawns, spawn points, countdown | **server** | First to 5; 3 s locked countdown per round; 90 s round limit. |
| Grenades | **server** | Flight, bounces, fuse and blast are simulated on the server with the same `grensim.js` the client uses for previews. Self-blasts boost but never hurt. |
| Disconnects | **server** | Leaving, closing the tab or timing out ends the match; the other player wins by forfeit. |

### Messages (JSON text frames, one socket)

Client → server: `hello {v,name}`, `queue`, `unqueue`, `ready`, `st` (position snapshot), `fire`, `punch`, `reload`,
`nadepin`, `nadecancel`, `nade`, `nadeself`, `leave`, `ping`, `spong`.
Server → client: `welcome`, `queued`, `match`, `round`, `live`, `snap` (30 Hz), `hurt`, `hit`, `fx`, `nade`, `boom`,
`roundEnd`, `matchEnd`, `fix`, `err`, `sping`, `pong`. The protocol version is checked in the handshake.

### Connection status in the game
The in-game top-left line shows `Connected · <ms> · <n> online`; the queue screen shows connecting / searching / error
states; a lost connection shows a "Disconnected" result; *Settings → Network* shows the server in use and has a
**Test connection** button (a short separate socket, so it never disturbs a running match).

### Honest limits
* **No simulated opponent.** If the server can't be reached the game says so; it never invents a player.
* The server sends both players' positions all the time, so a modified client could still read them (wall-hack style
  information) and could aim automatically; server-side checks cannot detect that. Movement inside the speed cap is
  accepted. This is *far* harder to abuse than peer-to-peer, but it is not a commercial anti-cheat.
* No accounts, ranking or persistence: usernames are chosen by the player and filtered, nothing is stored.
* No reconnection: a dropped player forfeits.

---

## 3. Run it locally

You need Node.js 20 or newer (no `npm install`: the server has zero dependencies).

```bash
cd server
SERVE_STATIC=1 node server.js          # serves the game AND the socket on http://localhost:8787
```

Open **http://localhost:8787/** in two browser windows, enter a username in each and press *Online 1v1* in both.
For a second device on your network open `http://<this-computer's-address>:8787/?server=ws://<this-computer's-address>:8787/ws`
(a page that this very server served is always allowed to connect; other websites need `ALLOWED_ORIGINS`).
On Windows PowerShell use `$env:SERVE_STATIC='1'; node server.js`.

If you open `index.html` straight from disk instead (file://) and the server runs on the same computer on port 8787, it
connects there automatically (`LOCAL_SERVER_URL` in `js/config.js`). Anything else: *Settings → Network → Server URL*,
or add `?server=ws://localhost:8787/ws` to the page address.

### Automated tests
```bash
cd server
node --test                             # 44 tests: matchmaking, rooms, combat, validation, protocol abuse
```
They start the real server in-process and drive it with real WebSocket clients: queueing and isolation of rooms,
countdown lock, server-side damage/headshots/lag-compensation, grenades, round and match flow, disconnects, forfeits,
teleport / speed / wall cheats, bunched packets, malformed JSON, flooding, oversized frames, per-IP limits, origin
checks, and the hand-written WebSocket layer (fragmentation, unmasked frames, bad handshakes).
Browser-level checks were also run with two real Chrome instances against the live server (queue, countdown lock,
movement sync, server-confirmed hits, round win, round 2, disconnect forfeit, menu layout switch mid-match).

---

## 4. Configuration

The browser needs **one** setting; the server needs **none** to run, only these optional environment variables.
**No secret exists anywhere in this project, and none may ever be put in the browser files** (everything in `js/` is
public). The server URL is not a secret.

**Browser** (`js/config.js`, in order of priority): `?server=` in the address bar → *Settings → Network* (saved in the
browser) → `SERVER_URL` → `SAME_ORIGIN_SERVER` (use the host that served the page) → `LOCAL_SERVER_URL` (localhost only).

**Server environment variables** (`server/config.js`):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port to listen on. Hosting platforms set this for you. |
| `HOST` | `0.0.0.0` | Interface to bind. |
| `ALLOWED_ORIGINS` | *(empty)* | Comma-separated website origins allowed to open a socket, e.g. `https://mygame.netlify.app`. **Set this in production.** Empty = local development only (localhost, file://, command-line tools). `*` = anyone. |
| `TRUST_PROXY` | off | `1` behind a proxy / platform router so the real client IP (`X-Forwarded-For`) is used for per-IP limits. |
| `SERVE_STATIC` | off | `1` also serves `index.html`, `css/`, `js/`, `vendor/` (never `server/`, `docs/` or dotfiles). |
| `MAX_CONNECTIONS` / `MAX_PER_IP` | `400` / `6` | Connection limits. |
| `LOG_LEVEL` | `info` | `info`, `debug` or `quiet`. |
| `TEST_MODE` | off | **Tests only**: disables movement validation. Never set on a public server. |

Built-in protection: handshake timeout, 4 KB message limit, per-connection rate limits, strict type checks on every
field, kicks for repeated invalid moves, silent-connection timeout (12 s), origin allow-list, per-IP and total limits.
`GET /health` returns `{ok, uptime, online, queued, rooms, totals}` and contains no secrets (use it for uptime checks).

---

## 5. Deployment

Two parts: **(A)** the game server (needs a host that runs a long-lived Node process and supports WebSockets) and
**(B)** the static game files (any static host). Always use **`wss://`** (TLS) when the page is served over `https://`;
browsers refuse plain `ws://` from a secure page (the game also checks this and tells you).
I could not deploy to any hosting provider from this environment, so the steps below are written from the providers'
standard workflows and have **not** been run by me; check each provider's current docs and pricing.

The server needs the repository's `js/` folder next to `server/` (it runs the game's own collision, maps and weapon
code), so deploy the **whole repository** (or use the supplied `Dockerfile`).

### A1. Render (web service)
1. Push the project to a GitHub repository.
2. Render → *New* → *Web Service* → select the repository. Runtime **Node**. Build command: leave empty (nothing to
   install). Start command: `node server/server.js`. Instance count: **1**.
3. Environment: `TRUST_PROXY=1` and `ALLOWED_ORIGINS=https://<your-frontend-host>` (the exact origin, no path).
4. Health check path: `/health`. Render provides `PORT` and TLS; your socket URL is `wss://<service-name>.onrender.com/ws`.

### A2. Fly.io (uses the Dockerfile)
1. Install `flyctl`, then in the project folder: `fly launch --no-deploy` (accept the Dockerfile; internal port `8787`).
2. `fly secrets set` is not needed; set plain variables in `fly.toml` under `[env]`: `TRUST_PROXY = "1"`,
   `ALLOWED_ORIGINS = "https://<your-frontend-host>"`.
3. Keep **one** machine (`fly scale count 1`), `fly deploy`. Socket URL: `wss://<app-name>.fly.dev/ws`.
   Pick the region closest to your players (latency matters more than anything else for a shooter).

### A3. Railway
1. New project → *Deploy from GitHub repo*. Start command `node server/server.js`.
2. Variables: `TRUST_PROXY=1`, `ALLOWED_ORIGINS=https://<your-frontend-host>`. Generate a public domain.
   Socket URL: `wss://<generated-domain>/ws`.

### A4. Your own VPS (any Linux box)
```bash
git clone <your repo> dashduel && cd dashduel/server
sudo tee /etc/systemd/system/dashduel.service >/dev/null <<'EOF'
[Unit]
Description=DASHDUEL game server
After=network.target
[Service]
WorkingDirectory=/home/<user>/dashduel/server
Environment=PORT=8787 TRUST_PROXY=1 ALLOWED_ORIGINS=https://<your-frontend-host>
ExecStart=/usr/bin/node server.js
Restart=always
User=<user>
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now dashduel
```
Put a TLS-terminating reverse proxy in front. With Caddy that is two lines (it proxies WebSockets automatically):
```
game.example.com {
  reverse_proxy localhost:8787
}
```
(nginx needs `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`
and a long `proxy_read_timeout`.) Socket URL: `wss://game.example.com/ws`.

### B. The game files (frontend)
Any static host works (Netlify, Cloudflare Pages, GitHub Pages, ...): publish `index.html`, `css/`, `js/`, `vendor/`.
Then **tell the game where the server is** by editing `js/config.js`:
```js
SERVER_URL: 'wss://your-server.example.com/ws',
```
and redeploy the frontend. Make sure the server's `ALLOWED_ORIGINS` contains exactly the frontend's origin
(`https://yourgame.netlify.app`). Players can also override the address per browser in *Settings → Network*.

**One-service option:** run the server with `SERVE_STATIC=1` and set `SAME_ORIGIN_SERVER: true` in `js/config.js`; the
same host then serves the game and the socket, and `ALLOWED_ORIGINS` is not needed (pages the server itself served
are always allowed).

### After deploying: check
1. `https://<server>/health` answers `{"ok":true,...}`.
2. Open the game from the frontend, *Settings → Network → Test connection*: it should report latency.
3. Open the game on two devices, queue on both: both should be matched and enter the same match.

---

## 6. Where to grow later
* A second region plus a tiny matchmaker that returns the closest server address.
* Reconnect support (hold a disconnected player's slot for a few seconds).
* Interest management / hiding the opponent when occluded (reduces wall-hack value).
* Accounts and ranking behind a small database, if you want persistence.
