/* DASHDUEL - networking: matchmaking queue + peer-to-peer link.
 *
 * There is no game server. Players find each other through a free public MQTT-over-WebSocket
 * relay (only used to swap connection details: names, ids and WebRTC offers/answers), then
 * the match itself runs over a direct WebRTC data channel between the two browsers.
 *
 *   queue     everyone searching publishes {seek, id, name} on a shared topic. When two players see
 *             each other, the one with the smaller id sends a WebRTC offer to the other one's private
 *             topic; the answer comes back the same way. Only one negotiation per player at a time.
 *   link      two data channels: "ev" (reliable, ordered: shots, rounds, hits) and "st" (unreliable,
 *             unordered: 30 Hz position snapshots), plus a 1 s ping for round-trip time and a
 *             7 s silence timeout.
 *
 * No library: a tiny MQTT 3.1.1 client (CONNECT / SUBSCRIBE / PUBLISH / PING, QoS 0) is below.
 * Limits (honest): the relay is public (names are visible while searching) and there is no TURN
 * server, so two players behind strict NATs may fail to connect.
 */
(function () {
  'use strict';
  const RV = window.RV;
  const NET = (RV.net = { VERSION: 1 });

  const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081'];
  const NS = 'dashduel/v1/';
  const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  NET.brokers = BROKERS;
  NET.log = []; // short diagnostic trail (visible via RV.net.log in the console)
  const dbg = (...a) => {
    NET.log.push(Math.round(performance.now()) + ' ' + a.join(' '));
    if (NET.log.length > 80) NET.log.shift();
  };

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ---------------------------------------------------------------------------
  // minimal MQTT 3.1.1 client
  // ---------------------------------------------------------------------------
  function varint(n) {
    const out = [];
    do {
      let b = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) b |= 128;
      out.push(b);
    } while (n > 0);
    return out;
  }
  function lp(bytes) {
    const o = new Uint8Array(2 + bytes.length);
    o[0] = bytes.length >> 8;
    o[1] = bytes.length & 255;
    o.set(bytes, 2);
    return o;
  }
  function cat(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const o = new Uint8Array(n);
    let k = 0;
    for (const p of parts) {
      o.set(p, k);
      k += p.length;
    }
    return o;
  }
  function packet(first, body) {
    return cat([Uint8Array.from([first, ...varint(body.length)]), body]);
  }

  class Mqtt {
    constructor(clientId) {
      this.clientId = clientId;
      this.ws = null;
      this.ready = false;
      this.buf = new Uint8Array(0);
      this.onmessage = null;
      this.onclose = null;
      this.pid = 1;
      this.pingT = null;
      this.url = '';
    }

    /** Try each broker in turn; resolves with the url that accepted us. */
    async connect(urls) {
      let last = null;
      for (const u of urls) {
        try {
          await this._try(u, 6000);
          this.url = u;
          return u;
        } catch (e) {
          last = e;
        }
      }
      throw last || new Error('no broker reachable');
    }

    _try(url, timeout) {
      return new Promise((resolve, reject) => {
        let ws;
        try {
          ws = new WebSocket(url, 'mqtt');
        } catch (e) {
          reject(e);
          return;
        }
        ws.binaryType = 'arraybuffer';
        this.ws = ws;
        this.ready = false;
        this.buf = new Uint8Array(0);
        let done = false;
        const fail = (m) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try {
            ws.close();
          } catch (e) {
            /* ignore */
          }
          reject(new Error(m));
        };
        const timer = setTimeout(() => fail('timeout'), timeout);
        ws.onopen = () => {
          const vh = Uint8Array.from([0, 4, 77, 81, 84, 84, 4, 2, 0, 45]); // "MQTT" v3.1.1, clean session, keep-alive 45 s
          ws.send(packet(0x10, cat([vh, lp(enc.encode(this.clientId))])));
        };
        ws.onmessage = (e) => {
          this._feed(new Uint8Array(e.data));
          if (this.ready && !done) {
            done = true;
            clearTimeout(timer);
            this.pingT = setInterval(() => this._raw(Uint8Array.from([0xc0, 0])), 20000);
            resolve();
          }
        };
        ws.onerror = () => fail('error');
        ws.onclose = () => {
          if (!done) fail('closed');
          else if (this.ws === ws) {
            this.ready = false;
            clearInterval(this.pingT);
            if (this.onclose) this.onclose();
          }
        };
      });
    }

    _raw(bytes) {
      if (this.ws && this.ws.readyState === 1) this.ws.send(bytes);
    }

    subscribe(topic) {
      const id = this.pid++;
      this._raw(packet(0x82, cat([Uint8Array.from([id >> 8, id & 255]), lp(enc.encode(topic)), Uint8Array.from([0])])));
    }

    publish(topic, text) {
      this._raw(packet(0x30, cat([lp(enc.encode(topic)), enc.encode(text)])));
    }

    close() {
      clearInterval(this.pingT);
      const ws = this.ws;
      this.ws = null;
      this.ready = false;
      if (ws) {
        try {
          if (ws.readyState === 1) ws.send(Uint8Array.from([0xe0, 0]));
          ws.close();
        } catch (e) {
          /* ignore */
        }
      }
    }

    _feed(chunk) {
      this.buf = this.buf.length ? cat([this.buf, chunk]) : chunk;
      for (;;) {
        const b = this.buf;
        if (b.length < 2) return;
        let mult = 1,
          len = 0,
          i = 1,
          ok = false;
        while (i < b.length && i <= 4) {
          const d = b[i++];
          len += (d & 127) * mult;
          mult *= 128;
          if (!(d & 128)) {
            ok = true;
            break;
          }
        }
        if (!ok || b.length < i + len) return;
        const type = b[0] >> 4;
        const body = b.subarray(i, i + len);
        if (type === 2) {
          if (body.length >= 2 && body[1] === 0) this.ready = true;
        } else if (type === 3) {
          const qos = (b[0] >> 1) & 3;
          const tl = (body[0] << 8) | body[1];
          const topic = dec.decode(body.subarray(2, 2 + tl));
          const off = 2 + tl + (qos > 0 ? 2 : 0);
          if (this.onmessage) this.onmessage(topic, dec.decode(body.subarray(off)));
        }
        this.buf = b.subarray(i + len);
      }
    }
  }
  NET.Mqtt = Mqtt;

  /**
   * Several public brokers at once. Brokers are separate networks, so two players must meet on at
   * least one common broker: everyone connects to ALL of them, subscribes and publishes on every
   * connected one, and duplicates (same message id arriving over two brokers) are dropped.
   */
  class Relay {
    constructor(clientId) {
      this.clientId = clientId;
      this.clients = [];
      this.subs = [];
      this.seen = new Set();
      this.seenQ = [];
      this.onmessage = null; // (topic, object)
      this.onclose = null;
      this.closed = false;
      this.url = '';
    }

    /** Resolves as soon as ONE broker accepted us; the others keep connecting in the background. */
    connect(urls) {
      return new Promise((resolve, reject) => {
        let fails = 0,
          done = false;
        urls.forEach((u, i) => {
          const m = new Mqtt(this.clientId + i);
          m._try(u, 8000)
            .then(() => {
              if (this.closed) {
                m.close();
                return;
              }
              m.url = u;
              this.clients.push(m);
              m.onmessage = (topic, text) => this._rx(topic, text);
              m.onclose = () => {
                this.clients = this.clients.filter((c) => c !== m);
                if (!this.clients.length && !this.closed && this.onclose) this.onclose();
              };
              for (const t of this.subs) m.subscribe(t);
              dbg('broker up', u);
              this.url = this.clients.map((c) => c.url.replace(/^wss:\/\//, '').split('/')[0]).join(', ');
              if (!done) {
                done = true;
                resolve(u);
              }
            })
            .catch(() => {
              fails++;
              if (fails === urls.length && !done) reject(new Error('no broker reachable'));
            });
        });
      });
    }

    subscribe(topic) {
      this.subs.push(topic);
      for (const c of this.clients) c.subscribe(topic);
    }

    publish(topic, obj) {
      obj.mid = Math.random().toString(36).slice(2, 10);
      const text = JSON.stringify(obj);
      for (const c of this.clients) c.publish(topic, text);
    }

    _rx(topic, text) {
      let m;
      try {
        m = JSON.parse(text);
      } catch (e) {
        return;
      }
      if (!m || typeof m !== 'object') return;
      if (m.mid) {
        if (this.seen.has(m.mid)) return;
        this.seen.add(m.mid);
        this.seenQ.push(m.mid);
        if (this.seenQ.length > 300) this.seen.delete(this.seenQ.shift());
      }
      if (this.onmessage) this.onmessage(topic, m);
    }

    close() {
      this.closed = true;
      for (const c of this.clients) c.close();
      this.clients = [];
    }
  }
  NET.Relay = Relay;

  // ---------------------------------------------------------------------------
  // peer link (WebRTC data channels)
  // ---------------------------------------------------------------------------
  class Link {
    constructor(initiator) {
      this.initiator = initiator;
      this.pc = new RTCPeerConnection({ iceServers: ICE });
      this.ch = {};
      this.open = false;
      this.closed = false;
      this.rtt = 0.08;
      this.lastRx = performance.now();
      this.onopen = null;
      this.onclose = null;
      this.onmessage = null; // (type, data) reliable events
      this.onstate = null; // (obj) unreliable snapshots
      this.timer = null;
      if (initiator) {
        this._setup(this.pc.createDataChannel('ev', { ordered: true }));
        this._setup(this.pc.createDataChannel('st', { ordered: false, maxRetransmits: 0 }));
      } else {
        this.pc.ondatachannel = (e) => this._setup(e.channel);
      }
      this.pc.oniceconnectionstatechange = () => dbg('ice', this.pc.iceConnectionState);
      this.pc.onconnectionstatechange = () => {
        const s = this.pc.connectionState;
        dbg('pc', s);
        if (s === 'failed' || s === 'closed') this.close('connection ' + s);
      };
    }

    _setup(ch) {
      const label = ch.label;
      this.ch[label] = ch;
      const check = () => {
        const a = this.ch.ev,
          b = this.ch.st;
        if (!this.open && a && b && a.readyState === 'open' && b.readyState === 'open') {
          this.open = true;
          this.lastRx = performance.now();
          this.timer = setInterval(() => this._beat(), 1000);
          if (this.onopen) this.onopen();
        }
      };
      ch.onopen = check;
      ch.onclose = () => this.close('channel closed');
      ch.onmessage = (e) => {
        this.lastRx = performance.now();
        let m;
        try {
          m = JSON.parse(e.data);
        } catch (err) {
          return;
        }
        if (label === 'st') {
          if (this.onstate) this.onstate(m);
          return;
        }
        if (!m || typeof m.t !== 'string') return;
        if (m.t === 'ping') {
          this.send('pong', { ts: m.d && m.d.ts });
          return;
        }
        if (m.t === 'pong') {
          const r = (performance.now() - (m.d && m.d.ts)) / 1000;
          if (r >= 0 && r < 5) this.rtt = this.rtt * 0.7 + r * 0.3;
          return;
        }
        if (this.onmessage) this.onmessage(m.t, m.d || {});
      };
      check();
    }

    _beat() {
      this.send('ping', { ts: performance.now() });
      if (performance.now() - this.lastRx > 7000) this.close('timed out');
    }

    send(type, data) {
      const ch = this.ch.ev;
      if (ch && ch.readyState === 'open') ch.send(JSON.stringify({ t: type, d: data || {} }));
    }

    sendState(obj) {
      const ch = this.ch.st;
      if (ch && ch.readyState === 'open' && ch.bufferedAmount < 16384) ch.send(JSON.stringify(obj));
    }

    _gathered() {
      const pc = this.pc;
      return new Promise((res) => {
        if (pc.iceGatheringState === 'complete') return res();
        const t = setTimeout(res, 3500);
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(t);
            res();
          }
        };
      });
    }

    async makeOffer() {
      await this.pc.setLocalDescription(await this.pc.createOffer());
      await this._gathered();
      return this.pc.localDescription.sdp;
    }
    async acceptOffer(sdp) {
      await this.pc.setRemoteDescription({ type: 'offer', sdp });
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      await this._gathered();
      return this.pc.localDescription.sdp;
    }
    async acceptAnswer(sdp) {
      await this.pc.setRemoteDescription({ type: 'answer', sdp });
    }

    close(reason) {
      if (this.closed) return;
      this.closed = true;
      clearInterval(this.timer);
      const was = this.open;
      this.open = false;
      try {
        this.pc.close();
      } catch (e) {
        /* ignore */
      }
      if (this.onclose) this.onclose(reason || 'closed', was);
    }
  }
  NET.Link = Link;

  // ---------------------------------------------------------------------------
  // matchmaking queue
  // ---------------------------------------------------------------------------
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

  /**
   * Join the public queue. opts: {name, onStatus(text, phase), onMatched(link, isHost, oppName), onError(text)}
   * Returns {cancel()}.
   */
  NET.queue = function (opts) {
    const me = { id: rid(), name: opts.name };
    const q = { state: 'connecting', mqtt: null, link: null, peer: null, timers: [], cancelled: false, avoid: {} };
    const status = (t, ph) => opts.onStatus && opts.onStatus(t, ph || q.state);
    const later = (fn, ms) => {
      const t = setTimeout(fn, ms);
      q.timers.push(t);
      return t;
    };
    const cleanup = () => {
      q.cancelled = true;
      for (const t of q.timers) {
        clearTimeout(t);
        clearInterval(t);
      }
      q.timers.length = 0;
      if (q.mqtt) {
        q.mqtt.close();
        q.mqtt = null;
      }
    };
    const resetNegotiation = (why) => {
      if (q.link) {
        q.link.onclose = null;
        q.link.close('abandoned');
        q.link = null;
      }
      if (q.peer) q.avoid[q.peer] = Date.now() + 8000;
      q.peer = null;
      if (!q.cancelled) {
        q.state = 'searching';
        status('Searching for an opponent…', 'searching');
      }
    };

    const wire = (link, isHost, oppName) => {
      link.onopen = () => {
        if (q.cancelled) {
          link.onclose = null;
          link.close('cancelled');
          return;
        }
        q.state = 'connected';
        const l = link;
        // the relay is no longer needed: leave it politely and hand the link over
        const m = q.mqtt;
        cleanup();
        q.cancelled = true;
        if (m) m.close();
        opts.onMatched(l, isHost, oppName);
      };
      link.onclose = () => {
        if (q.state === 'negotiating') resetNegotiation('closed');
      };
    };

    const onMsg = (topic, m) => {
      if (q.cancelled) return;
      if (!m || m.from === me.id) return;
      dbg('rx', m.t, 'from', String(m.from).slice(0, 4), 'state', q.state);
      if (m.t === 'seek') {
        if (q.state !== 'searching' || m.v !== NET.VERSION) return;
        if (q.avoid[m.from] && q.avoid[m.from] > Date.now()) return;
        if (me.id < m.from) initiate(m.from, RV.profile ? RV.profile.clean(m.name) : String(m.name || '').slice(0, 16));
      } else if (m.t === 'offer' && m.to === me.id) {
        if (q.state !== 'searching') {
          q.mqtt.publish(NS + 'to/' + m.from, { t: 'busy', from: me.id, to: m.from });
          return;
        }
        accept(m);
      } else if (m.t === 'answer' && m.to === me.id) {
        if (q.state === 'negotiating' && q.peer === m.from && q.link && q.link.initiator) q.link.acceptAnswer(m.sdp).catch(() => resetNegotiation('bad answer'));
      } else if (m.t === 'busy' && m.to === me.id) {
        if (q.state === 'negotiating' && q.peer === m.from) resetNegotiation('busy');
      }
    };

    const initiate = async (peerId, peerName) => {
      dbg('initiate ->', String(peerId).slice(0, 4));
      q.state = 'negotiating';
      q.peer = peerId;
      status('Opponent found: ' + peerName + ' — connecting…', 'negotiating');
      const link = new Link(true);
      q.link = link;
      wire(link, true, peerName);
      later(() => {
        if (q.state === 'negotiating' && q.peer === peerId) resetNegotiation('timeout');
      }, 12000);
      try {
        const sdp = await link.makeOffer();
        if (q.cancelled || q.link !== link) return;
        q.mqtt.publish(NS + 'to/' + peerId, { t: 'offer', from: me.id, to: peerId, name: me.name, sdp });
      } catch (e) {
        resetNegotiation('offer failed');
      }
    };

    const accept = async (m) => {
      dbg('accept offer from', String(m.from).slice(0, 4));
      q.state = 'negotiating';
      q.peer = m.from;
      const oppName = RV.profile ? RV.profile.clean(m.name) : String(m.name || '').slice(0, 16);
      status('Opponent found: ' + oppName + ' — connecting…', 'negotiating');
      const link = new Link(false);
      q.link = link;
      wire(link, false, oppName);
      later(() => {
        if (q.state === 'negotiating' && q.peer === m.from) resetNegotiation('timeout');
      }, 12000);
      try {
        const sdp = await link.acceptOffer(m.sdp);
        if (q.cancelled || q.link !== link) return;
        q.mqtt.publish(NS + 'to/' + m.from, { t: 'answer', from: me.id, to: m.from, sdp });
      } catch (e) {
        resetNegotiation('answer failed');
      }
    };

    (async () => {
      status('Connecting to matchmaking…', 'connecting');
      const mq = new Relay('dd-' + me.id);
      q.mqtt = mq;
      try {
        await mq.connect(BROKERS);
      } catch (e) {
        if (!q.cancelled) {
          cleanup();
          opts.onError && opts.onError('Could not reach the matchmaking relay. Check your internet connection and try again.');
        }
        return;
      }
      if (q.cancelled) {
        mq.close();
        return;
      }
      mq.onmessage = onMsg;
      mq.onclose = () => {
        if (!q.cancelled && q.state !== 'connected') {
          cleanup();
          opts.onError && opts.onError('Lost the connection to the matchmaking relay.');
        }
      };
      dbg('broker', mq.url);
      mq.subscribe(NS + 'queue');
      mq.subscribe(NS + 'to/' + me.id);
      q.state = 'searching';
      status('Searching for an opponent…', 'searching');
      const seek = () => {
        if (q.state === 'searching' && q.mqtt) q.mqtt.publish(NS + 'queue', { t: 'seek', from: me.id, name: me.name, v: NET.VERSION });
      };
      // small random offset so two players do not lock-step
      later(seek, 300 + Math.random() * 400);
      const iv = setInterval(seek, 1800);
      q.timers.push(iv);
    })();

    return {
      id: me.id,
      cancel() {
        if (q.mqtt && q.state === 'searching') q.mqtt.publish(NS + 'queue', { t: 'left', from: me.id });
        if (q.link) {
          q.link.onclose = null;
          q.link.close('cancelled');
        }
        cleanup();
      },
    };
  };
})();
