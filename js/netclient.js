/* DASHDUEL - connection to the game server (one persistent WebSocket).
 *
 * This module only talks to the server: connect, handshake, heartbeat, latency, status. What the messages
 * mean is handled in online.js. It never simulates anything and has no fallback opponent.
 */
(function () {
  'use strict';
  const RV = window.RV;
  const CFG = () => window.DASHDUEL_CONFIG || {};

  const NC = (RV.netclient = {
    state: 'idle', // idle | connecting | open | closed
    ws: null,
    url: '',
    source: '',
    id: '',
    rtt: 0, // smoothed round trip, ms
    online: 0,
    queued: 0,
    error: '',
    onmessage: null, // (msg)
    onclose: null, // (reason)
    onstatus: null, // ()
  });
  const KEY = 'dashduel.server';
  const SKEY = 'dashduel.session'; // the session token: this tab only (sessionStorage), never sent anywhere but to the game server
  const readTok = () => {
    try {
      return sessionStorage.getItem(SKEY) || '';
    } catch (e) {
      return '';
    }
  };
  const saveTok = (t) => {
    try {
      if (t) sessionStorage.setItem(SKEY, t);
      else sessionStorage.removeItem(SKEY);
    } catch (e) {
      /* storage blocked: the match still works, it just cannot be resumed after a reload */
    }
  };

  /** Where is the server? Returns {url, source} or {error}. */
  NC.resolveUrl = function () {
    const c = CFG();
    const loc = window.location;
    const local = loc.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(loc.hostname);
    const q = new URLSearchParams(loc.search).get('server');
    let saved = '';
    try {
      saved = localStorage.getItem(KEY) || '';
    } catch (e) {
      /* storage blocked */
    }
    const pick = [
      [q, 'address bar (?server=)'],
      [saved, 'Settings > Network'],
      [c.SERVER_URL, 'js/config.js'],
      [c.SAME_ORIGIN_SERVER && !local ? (loc.protocol === 'https:' ? 'wss://' : 'ws://') + loc.host + '/ws' : '', 'same host as this page'],
      [local ? c.LOCAL_SERVER_URL : '', 'local development default'],
    ];
    for (const [u, source] of pick) {
      if (!u) continue;
      const url = String(u).trim();
      if (!/^wss?:\/\/[^\s/]+(\/\S*)?$/i.test(url)) return { error: 'The server address "' + url + '" is not a valid ws:// or wss:// URL (from ' + source + ').' };
      if (loc.protocol === 'https:' && /^ws:\/\//i.test(url) && !/^ws:\/\/(localhost|127\.0\.0\.1)/i.test(url)) {
        return { error: 'This page is secure (https), so the browser only allows a secure wss:// server address (got ' + url + ').' };
      }
      return { url, source };
    }
    return { error: 'No game server is configured. Set SERVER_URL in js/config.js (or Settings > Network), or run the local server: node server/server.js' };
  };

  NC.setSavedUrl = function (u) {
    try {
      if (u) localStorage.setItem(KEY, u);
      else localStorage.removeItem(KEY);
    } catch (e) {
      /* ignore */
    }
  };
  NC.getSavedUrl = function () {
    try {
      return localStorage.getItem(KEY) || '';
    } catch (e) {
      return '';
    }
  };

  function status() {
    if (NC.onstatus) NC.onstatus();
  }

  /** Open the socket and complete the handshake. Resolves with the welcome message. */
  NC.connect = function (name) {
    NC.close(true);
    const r = NC.resolveUrl();
    if (r.error) return Promise.reject(new Error(r.error));
    NC.url = r.url;
    NC.source = r.source;
    NC.state = 'connecting';
    NC.error = '';
    status();
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(r.url);
      } catch (e) {
        NC.state = 'closed';
        return reject(new Error('Could not open ' + r.url + ': ' + e.message));
      }
      NC.ws = ws;
      let done = false;
      const fail = (msg) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        NC.state = 'closed';
        NC.error = msg;
        try {
          ws.close();
        } catch (e) {
          /* ignore */
        }
        status();
        reject(new Error(msg));
      };
      const timer = setTimeout(() => fail('The game server at ' + r.url + ' did not answer in time.'), 8000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: CFG().PROTOCOL || 2, name, tok: readTok() || undefined }));
      ws.onerror = () => fail('Could not reach the game server at ' + r.url + '. Is it running?');
      ws.onclose = (e) => {
        if (!done) return fail(e.reason || 'The connection to the game server was closed (code ' + e.code + ').');
        const was = NC.state;
        NC.state = 'closed';
        clearInterval(NC.pingT);
        status();
        if (NC.ws === ws && was === 'open' && NC.onclose) NC.onclose(e.reason || 'connection lost');
      };
      ws.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch (err) {
          return;
        }
        if (m.t === 'sping') {
          NC.send({ t: 'spong', ts: m.ts });
          return;
        }
        if (m.t === 'pong') {
          const s = performance.now() - m.ts;
          if (s >= 0 && s < 5000) NC.rtt = NC.rtt ? NC.rtt * 0.7 + s * 0.3 : s;
          return;
        }
        if (m.t === 'welcome' && !done) {
          done = true;
          clearTimeout(timer);
          NC.state = 'open';
          NC.id = m.id;
          NC.resumed = !!m.resumed;
          if (m.tok) saveTok(m.tok); // a new session: keep the token so a dropped connection can come back to this match
          NC.online = m.online || 0;
          NC.queued = m.queued || 0;
          NC.pingT = setInterval(() => NC.send({ t: 'ping', ts: performance.now() }), 2000);
          NC.send({ t: 'ping', ts: performance.now() });
          status();
          resolve(m);
          return;
        }
        if (m.t === 'err' && !done) {
          if (m.code === 'replaced') return;
          return fail(m.msg || 'The server refused the connection.');
        }
        if (m.t === 'queued') {
          NC.online = m.online || NC.online;
          NC.queued = m.queued || 0;
          status();
        }
        if (NC.onmessage) NC.onmessage(m);
      };
    });
  };

  /** Forget the session (after a match is over and the player leaves for good). */
  NC.forgetSession = () => saveTok('');

  NC.send = function (obj) {
    const ws = NC.ws;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  };

  NC.close = function (quiet) {
    const ws = NC.ws;
    NC.ws = null;
    clearInterval(NC.pingT);
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      try {
        ws.close(1000, 'bye');
      } catch (e) {
        /* ignore */
      }
    }
    NC.state = 'idle';
    NC.rtt = 0;
    if (!quiet) status();
  };

  /**
   * Settings > Network "Test connection": a separate short-lived socket (it never touches the live
   * connection, so it is safe to use from the pause menu). Resolves {ok, ms, online, queued} or {ok:false, error}.
   */
  NC.probe = function (urlOverride) {
    const r = urlOverride ? { url: urlOverride, source: 'typed' } : NC.resolveUrl();
    if (r.error) return Promise.resolve({ ok: false, error: r.error });
    if (!/^wss?:\/\/[^\s/]+(\/\S*)?$/i.test(r.url)) return Promise.resolve({ ok: false, error: 'Not a valid ws:// or wss:// address.' });
    return new Promise((resolve) => {
      let ws,
        done = false;
      const t0 = performance.now();
      const finish = (res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch (e) {
          /* ignore */
        }
        resolve(res);
      };
      const timer = setTimeout(() => finish({ ok: false, error: 'No answer within 6 seconds.' }), 6000);
      try {
        ws = new WebSocket(r.url);
      } catch (e) {
        return finish({ ok: false, error: e.message });
      }
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: CFG().PROTOCOL || 2, name: 'Probe' })); // (no token: a probe never touches a real session)
      ws.onerror = () => finish({ ok: false, error: 'Could not connect. Is the server running and the address right?' });
      ws.onclose = () => finish({ ok: false, error: 'The server closed the connection.' });
      let info = null;
      ws.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch (err) {
          return;
        }
        if (m.t === 'welcome') {
          info = m;
          ws.send(JSON.stringify({ t: 'ping', ts: performance.now() }));
        } else if (m.t === 'pong' && info) finish({ ok: true, ms: Math.round(performance.now() - m.ts), connectMs: Math.round(performance.now() - t0), online: info.online, queued: info.queued });
        else if (m.t === 'err') finish({ ok: false, error: m.msg || 'The server refused the connection.' });
      };
    });
  };

  /** One line for the interface. */
  NC.describe = function () {
    if (NC.state === 'open') return 'Connected · ' + Math.round(NC.rtt) + ' ms' + (NC.online ? ' · ' + NC.online + ' online' : '');
    if (NC.state === 'connecting') return 'Connecting…';
    if (NC.state === 'closed') return 'Disconnected';
    return 'Not connected';
  };
})();
