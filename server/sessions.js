'use strict';
/*
 * Sessions. Identity on this server is a server-issued session, never the username: the first time a browser
 * connects it is given a random session id and a token (id + HMAC signature made with SESSION_SECRET). The
 * browser keeps the token for this tab only (sessionStorage) and shows it on the next connection to prove it is
 * the same session: that is what lets a dropped player come back to the match they are in, and what makes a
 * second connection with the same token replace the first, so one session can never be in two matches or
 * queue twice. A username is only a display name; two players may even choose the same one.
 *
 * The token is a bearer credential for this session only: it is never logged, never sent to the opponent and
 * unlocks nothing but the session it belongs to.
 */
const crypto = require('crypto');
const CFG = require('./config');
const log = require('./log');
const { TOKEN_RE } = require('./schema');

const b64u = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const now = () => Date.now();

class Sessions {
  constructor() {
    this.map = new Map();
    this.secret = CFG.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
    if (!CFG.SESSION_SECRET) log.warn('config', { note: 'SESSION_SECRET is not set: a random one is used, so session tokens stop working when the server restarts' });
  }

  sign(sid) {
    return b64u(crypto.createHmac('sha256', this.secret).update(sid).digest()).slice(0, 22);
  }

  get size() {
    return this.map.size;
  }

  /** @returns a new session, or null when the server is full of sessions */
  create(name, ip) {
    if (this.map.size >= CFG.MAX_SESSIONS) return null;
    let id;
    do id = b64u(crypto.randomBytes(12));
    while (this.map.has(id));
    const s = { id, token: id + '.' + this.sign(id), name, ip, client: null, room: null, createdAt: now(), expireAt: now() + CFG.SESSION_IDLE_S * 1000 };
    this.map.set(id, s);
    return s;
  }

  /** The live session a token belongs to (signature checked in constant time), or null. */
  verify(tok) {
    if (typeof tok !== 'string' || !TOKEN_RE.test(tok)) return null;
    const dot = tok.indexOf('.');
    const sid = tok.slice(0, dot),
      sig = tok.slice(dot + 1);
    const want = this.sign(sid);
    const a = Buffer.from(sig),
      b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return this.map.get(sid) || null;
  }

  remove(s) {
    this.map.delete(s.id);
  }

  /** Forget sessions that have no connection, no match and are past their expiry. Returns the removed ones. */
  sweep() {
    const t = now();
    const gone = [];
    for (const s of this.map.values()) {
      if (!s.client && !s.room && t > s.expireAt) gone.push(s);
    }
    for (const s of gone) this.map.delete(s.id);
    return gone;
  }
}

module.exports = { Sessions };
