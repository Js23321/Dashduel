'use strict';
/*
 * Minimal RFC 6455 WebSocket server (text frames only), written against Node's `http` upgrade event so
 * the game server has ZERO runtime dependencies (`node server.js` and nothing to install).
 *
 * Supported: handshake (+ origin check), masked client text frames of any legal length, fragmentation,
 * ping/pong, close handshake, payload size limit, slow-consumer protection.
 * Not supported on purpose: binary frames, extensions (permessage-deflate), subprotocols.
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WSConn extends EventEmitter {
  /** opts: {maxPayload, maxBuffered} */
  constructor(socket, opts) {
    super();
    this.socket = socket;
    this.maxPayload = (opts && opts.maxPayload) || 16 * 1024;
    this.maxBuffered = (opts && opts.maxBuffered) || 1024 * 1024;
    this.buf = Buffer.alloc(0);
    this.frag = null; // {chunks, size}
    this.closed = false;
    this.closeSent = false;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._finish(1006, 'socket closed'));
    socket.on('error', () => this._finish(1006, 'socket error'));
    socket.on('end', () => this._finish(1005, 'socket ended'));
  }

  get open() {
    return !this.closed && !this.closeSent && this.socket.writable;
  }

  _write(buf) {
    if (this.closed || !this.socket.writable) return false;
    if (this.socket.writableLength > this.maxBuffered) {
      // the client is not reading: drop it instead of buffering forever
      this.terminate(1008, 'slow consumer');
      return false;
    }
    this.socket.write(buf);
    return true;
  }

  _frame(opcode, payload) {
    const len = payload.length;
    let head;
    if (len < 126) {
      head = Buffer.alloc(2);
      head[1] = len;
    } else if (len < 65536) {
      head = Buffer.alloc(4);
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    head[0] = 0x80 | opcode;
    return Buffer.concat([head, payload]);
  }

  send(text) {
    if (!this.open) return false;
    return this._write(this._frame(0x1, Buffer.from(text, 'utf8')));
  }

  ping() {
    if (this.open) this._write(this._frame(0x9, Buffer.alloc(0)));
  }

  /** Polite close: send a close frame, then end the socket shortly after. */
  close(code, reason) {
    if (this.closed || this.closeSent) return;
    this.closeSent = true;
    const r = Buffer.from(String(reason || '').slice(0, 100), 'utf8');
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code || 1000, 0);
    r.copy(p, 2);
    if (this.socket.writable) this.socket.write(this._frame(0x8, p));
    setTimeout(() => this.terminate(code, reason), 500).unref();
  }

  /** Hard close. */
  terminate(code, reason) {
    if (!this.closed) {
      try {
        this.socket.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    this._finish(code || 1006, reason || 'terminated');
  }

  _finish(code, reason) {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', code, reason);
  }

  _onData(chunk) {
    if (this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const rsv = b[0] & 0x70;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (rsv) return this.close(1002, 'reserved bits');
      if (!masked) return this.close(1002, 'client frames must be masked');
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(this.maxPayload)) return this.close(1009, 'message too big');
        len = Number(big);
        off = 10;
      }
      if (len > this.maxPayload) return this.close(1009, 'message too big');
      if (b.length < off + 4 + len) {
        if (b.length > this.maxPayload + 14) return this.close(1009, 'too much data');
        return;
      }
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.alloc(len);
      for (let i = 0; i < len; i++) payload[i] = b[off + 4 + i] ^ mask[i & 3];
      this.buf = b.subarray(off + 4 + len);

      if (this.closeSent && opcode !== 0x8) continue; // after our close frame only the client's close reply matters
      if (opcode >= 0x8) {
        // control frames: must not be fragmented, payload <= 125
        if (!fin || len > 125) return this.close(1002, 'bad control frame');
        if (opcode === 0x8) {
          const code = len >= 2 ? payload.readUInt16BE(0) : 1005;
          if (!this.closeSent) {
            // echo the close frame, then end the TCP connection (the server closes first, as RFC 6455 asks)
            this.closeSent = true;
            if (this.socket.writable) this.socket.write(this._frame(0x8, payload.subarray(0, 2)));
          }
          this.socket.end();
          this._finish(code, 'closed by client');
          return;
        }
        if (opcode === 0x9) this._write(this._frame(0xa, payload));
        else if (opcode === 0xa) this.emit('pong');
        continue;
      }
      if (opcode === 0x2) return this.close(1003, 'binary frames not supported');
      if (opcode === 0x1) {
        if (this.frag) return this.close(1002, 'unexpected new message');
        if (fin) this.emit('message', payload.toString('utf8'));
        else this.frag = { chunks: [payload], size: len };
      } else if (opcode === 0x0) {
        if (!this.frag) return this.close(1002, 'unexpected continuation');
        this.frag.chunks.push(payload);
        this.frag.size += len;
        if (this.frag.size > this.maxPayload) return this.close(1009, 'message too big');
        if (fin) {
          const text = Buffer.concat(this.frag.chunks).toString('utf8');
          this.frag = null;
          this.emit('message', text);
        }
      } else return this.close(1002, 'unknown opcode');
    }
  }
}

/**
 * Handle an http 'upgrade' event. opts: {originAllowed(origin, host) -> bool, maxPayload, onConnection(conn, req)}.
 * Rejects with a plain HTTP error if the request is not a valid WebSocket upgrade.
 */
function upgrade(req, socket, head, opts) {
  const fail = (code, msg) => {
    try {
      socket.write('HTTP/1.1 ' + code + ' ' + msg + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    } catch (e) {
      /* ignore */
    }
    socket.destroy();
  };
  const h = req.headers;
  if (String(h.upgrade || '').toLowerCase() !== 'websocket') return fail(400, 'Bad Request');
  if (!/upgrade/i.test(String(h.connection || ''))) return fail(400, 'Bad Request');
  if (h['sec-websocket-version'] !== '13') return fail(426, 'Upgrade Required');
  const key = h['sec-websocket-key'];
  if (!key || Buffer.from(key, 'base64').length !== 16) return fail(400, 'Bad Request');
  if (opts.originAllowed && !opts.originAllowed(h.origin, h.host)) return fail(403, 'Forbidden');
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const conn = new WSConn(socket, opts);
  if (head && head.length) conn._onData(head);
  opts.onConnection(conn, req);
}

module.exports = { WSConn, upgrade };
