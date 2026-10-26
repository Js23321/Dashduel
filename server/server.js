'use strict';
/*
 * DASHDUEL game server: a persistent Node.js process that holds WebSocket connections, runs
 * matchmaking and referees isolated 1v1 rooms. No dependencies: `node server/server.js`.
 *
 *   ws(s)://HOST:PORT/ws     the game socket
 *   GET /health              JSON status (no secrets, safe to expose)
 *   GET /...                 the game files, only when SERVE_STATIC=1
 *
 * See server/README.md and docs/ONLINE_BACKEND.md.
 */
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const CFG = require('./config');
const { upgrade } = require('./websocket');
const { Lobby } = require('./lobby');
const log = require('./log');
const ac = require('./anticheat');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
// only the game's own static files may ever be served (never server/, docs/, tests, dotfiles)
const STATIC_OK = /^\/(?:index\.html|css\/[\w.\-]+\.css|js\/[\w.\-]+\.js|vendor\/[\w.\-]+\.js)?$/;

/** Is a page from this Origin allowed to open the game socket? (`host` = the Host header of the request) */
function originAllowed(origin, host) {
  if (CFG.ALLOWED_ORIGINS.indexOf('*') >= 0) return true;
  // a page that was served by this very server (SERVE_STATIC=1) is always allowed to talk to it
  if (origin && host) {
    try {
      if (new URL(origin).host === host) return true;
    } catch (e) {
      /* malformed Origin: fall through to the list */
    }
  }
  if (CFG.ALLOWED_ORIGINS.length) return !!origin && CFG.ALLOWED_ORIGINS.indexOf(String(origin).replace(/\/+$/, '')) >= 0;
  // development default: command-line clients, file:// pages and localhost
  if (!origin || origin === 'null') return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

function clientIp(req) {
  if (CFG.TRUST_PROXY) {
    const x = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (x) return x;
  }
  return req.socket.remoteAddress || 'unknown';
}

/** TLS terminated here, or by a trusted proxy that says so. */
function isSecure(req) {
  if (req.socket.encrypted) return true;
  return CFG.TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

/**
 * The development-only inspection endpoints answer only when DEBUG_ENDPOINTS=1, and then only to a request that
 * carries ADMIN_TOKEN as a bearer token (constant-time compare) or, when no token is configured, comes from this machine.
 * They contain rule counts, short session ids and recent security events: no tokens, no addresses.
 */
function debugAllowed(req) {
  if (!CFG.DEBUG_ENDPOINTS) return false;
  if (CFG.ADMIN_TOKEN) {
    const h = String(req.headers.authorization || '');
    const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
    const want = Buffer.from(CFG.ADMIN_TOKEN);
    return given.length === want.length && crypto.timingSafeEqual(given, want);
  }
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function roomSummaries(lobby) {
  const ffa = [...lobby.ffa.values()].map((r) => Object.assign(r.summary(), { ffa: true, list: r.p.map((p) => ({ sid: p.sid.slice(0, 6), seat: p.seat, alive: p.alive, waiting: p.waiting, kills: p.kills, deaths: p.deaths, queued: p.qSteps, simSteps: p.seqDone, violations: p.tele.violations, corrections: p.tele.fixes, shots: p.tele.shots, fireActs: p.tele.fireActs, drops: p.tele.drops })) }));
  return ffa.concat([...lobby.rooms].map((r) => ({ id: r.id, map: r.mapId, phase: r.phase, round: r.round, score: r.score, players: r.p.map((p) => ({ sid: p.sid.slice(0, 6), alive: p.alive, away: p.away, hp: p.hp, queued: p.qSteps, simSteps: p.seqDone, violations: p.tele.violations, corrections: p.tele.fixes, shots: p.tele.shots, fireActs: p.tele.fireActs, drops: p.tele.drops })) })));
}

function createServer() {
  const lobby = new Lobby();
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, protocol: CFG.PROTOCOL, uptime: Math.round(process.uptime()), ...lobby.info(), totals: lobby.totals }));
      return;
    }
    if (url === '/debug/anticheat' || url === '/debug/rooms') {
      if (!debugAllowed(req)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const body = url === '/debug/anticheat' ? { anticheat: ac.snapshot(), events: log.recent(100), logCounters: log.counters() } : { rooms: roomSummaries(lobby), sessions: lobby.sessions.size, totals: lobby.totals };
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body, null, 1));
      return;
    }
    if (CFG.SERVE_STATIC && (req.method === 'GET' || req.method === 'HEAD') && STATIC_OK.test(url)) {
      const file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (file.startsWith(ROOT)) {
        fs.readFile(file, (err, data) => {
          if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
          res.end(req.method === 'HEAD' ? undefined : data);
        });
        return;
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('DASHDUEL game server. WebSocket endpoint: /ws  Health: /health\n');
  });

  server.on('upgrade', (req, socket, head) => {
    const url = (req.url || '/').split('?')[0];
    if (url !== '/ws' && url !== '/') {
      socket.destroy();
      return;
    }
    const ip = clientIp(req);
    if (CFG.REQUIRE_TLS && !isSecure(req)) {
      socket.write('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!lobby.admit(ip)) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    upgrade(req, socket, head, {
      originAllowed,
      maxPayload: CFG.MAX_MESSAGE,
      onConnection: (conn) => lobby.onConnection(conn, ip),
    });
  });
  server.on('clientError', (err, socket) => socket.destroy());
  return { server, lobby };
}

module.exports = { createServer, originAllowed };

if (require.main === module) {
  const { server, lobby } = createServer();
  lobby.start();
  server.listen(CFG.PORT, CFG.HOST, () => {
    log.info('listening', { host: CFG.HOST, port: CFG.PORT, static: CFG.SERVE_STATIC, protocol: CFG.PROTOCOL, tls_required: CFG.REQUIRE_TLS, origins: CFG.ALLOWED_ORIGINS.length ? CFG.ALLOWED_ORIGINS : 'localhost / file:// only (set ALLOWED_ORIGINS for production)' });
    if (CFG.TEST_MODE) log.warn('config', { note: 'TEST_MODE is ON (test-only teleport message enabled). Never use it on a public server.' });
  });
  const shutdown = () => {
    log.info('shutdown', {});
    lobby.stop();
    server.close();
    if (server.closeAllConnections) server.closeAllConnections();
    setTimeout(() => process.exit(0), 700).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
