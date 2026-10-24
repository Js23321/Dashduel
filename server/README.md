# DASHDUEL game server

A persistent Node.js process (no dependencies, Node 20+) that holds the WebSocket connections, matches players and runs
isolated 1v1 rooms as the **only authority**: it simulates every player's movement from their *input* with the game's own
physics (`js/player.js`), decides hits with bounded lag compensation, owns health / ammo / rounds / score / grenades,
validates every message, scores rule violations, and only sends each player what they may know (no wallhack data).
Full design, anti-cheat rules, deployment steps and limitations: **[../docs/ONLINE_BACKEND.md](../docs/ONLINE_BACKEND.md)**.

```bash
SERVE_STATIC=1 node server.js     # game + socket on http://localhost:8787 (open it in two windows to test)
npm test                          # 79 automated tests (start the real server in-process; serial, ~5 min)
```
Production settings are environment variables; see **[.env.example](.env.example)** (nothing in it is a real secret).
Run **one** instance: rooms live in this process's memory.

| File | Role |
|---|---|
| `server.js` | HTTP server, `/health`, optional static files, dev-only `/debug/*`, origin + TLS policy, WebSocket upgrade |
| `websocket.js` | RFC 6455 implementation (handshake, framing, masking, fragmentation, limits) |
| `lobby.js` | connections, handshake, sessions, rate limits, queue, matchmaking, heartbeat / idle timeouts |
| `sessions.js` | session ids and HMAC-signed tokens (reconnect), expiry sweep |
| `schema.js` | strict validation of every client message (types, ranges, lengths, unknown fields dropped) |
| `room.js` | one match: input simulation, reconciliation, weapons, lag-compensated hits, grenades, visibility, reconnect, rematch |
| `anticheat.js` | violation scoring (weights, decay), warn / kick / lockout, rule table |
| `log.js` | structured JSON logging with secret redaction, security-event ring |
| `shared.js` | loads the game's own `js/` simulation files (physics, collision, maps, weapons, wire format) |
| `config.js` | all settings, from environment variables |
| `test/` | movement, combat, lobby, anti-cheat, session / information-protection and load suites |

`TEST_MODE=1` exists only for the automated tests (a teleport / state-dump message). **Never set it on a public server.**
