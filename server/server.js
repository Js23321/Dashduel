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
const path = require('path');
const CFG = require('./config');
const { upgrade } = require('./websocket');
const { Lobby, log } = require('./lobby');

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

function createServer() {
  const lobby = new Lobby();
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, protocol: CFG.PROTOCOL, uptime: Math.round(process.uptime()), ...lobby.info(), totals: lobby.totals }));
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
    log('info', 'DASHDUEL server listening on ' + CFG.HOST + ':' + CFG.PORT + (CFG.SERVE_STATIC ? '  (also serving the game files)' : ''));
    log('info', 'allowed origins: ' + (CFG.ALLOWED_ORIGINS.length ? CFG.ALLOWED_ORIGINS.join(', ') : 'localhost / file:// only (set ALLOWED_ORIGINS for production)'));
  });
  const shutdown = () => {
    log('info', 'shutting down');
    lobby.stop();
    server.close();
    if (server.closeAllConnections) server.closeAllConnections();
    setTimeout(() => process.exit(0), 700).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
