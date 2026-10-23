# DASHDUEL game server

A persistent Node.js process (no dependencies, Node 20+) that holds the WebSocket connections, matches players and
referees isolated 1v1 rooms. It is the only authority for hits, damage, health, ammo, rounds, score, respawns and
grenades; clients send their own movement (validated) and *requests*. Full design, trade-offs and deployment steps:
**[../docs/ONLINE_BACKEND.md](../docs/ONLINE_BACKEND.md)**.

```bash
SERVE_STATIC=1 node server.js     # game + socket on http://localhost:8787
node --test                       # automated tests (start the real server in-process)
```

| File | Role |
|---|---|
| `server.js` | HTTP server, `/health`, optional static files, origin policy, WebSocket upgrade |
| `websocket.js` | RFC 6455 implementation (handshake, framing, masking, fragmentation, limits) |
| `lobby.js` | connections, handshake, queue, matchmaking, heartbeat / idle timeouts, per-IP limits |
| `room.js` | one match: countdown, rounds, movement validation, lag-compensated hits, grenades, forfeits |
| `shared.js` | loads the game's own `js/` simulation files so the server uses the client's rules |
| `config.js` | all settings, from environment variables (no secrets exist) |
| `test/` | lobby, combat and cheat/abuse test suites |

Environment variables: `PORT`, `HOST`, `ALLOWED_ORIGINS`, `TRUST_PROXY`, `SERVE_STATIC`, `MAX_CONNECTIONS`,
`MAX_PER_IP`, `LOG_LEVEL` (and `TEST_MODE`, tests only). Run **one** instance: rooms live in this process's memory.
