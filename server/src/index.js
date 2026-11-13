// Brawlverse room service: a Cloudflare Worker with one Durable Object per room.
//
// Two browsers that share a 5-character room code connect here over WebSocket. The room
// seats them (first in = player 1, second = player 2), passes their WebRTC offer, answer
// and ICE candidates to each other, and then steps aside: the match itself runs peer to
// peer. If the peers cannot connect directly, the same socket relays their (small,
// binary) game packets instead. Nothing is stored; an empty room simply goes away.

const CODE = /^[A-HJ-NP-Z2-9]{5}$/; // no 0/O, 1/I/L lookalikes
const MAX_TEXT = 8 * 1024; // signalling messages (SDP) stay well under this
const MAX_BINARY = 512; // game packets are ~20-60 bytes
const RATE = 400; // messages per peer per second; 60 fps input plus slack

function allowedOrigin(origin, env) {
  if (!origin) return false;
  const list = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return (
    list.includes(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
    /^https:\/\/brawlverse-[a-z0-9-]+\.vercel\.app$/.test(origin) // Vercel preview deploys
  );
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('ok');

    const m = url.pathname.match(/^\/room\/([^/]+)$/);
    if (!m) return new Response('not found', { status: 404 });
    const code = m[1].toUpperCase();
    if (!CODE.test(code)) return new Response('bad room code', { status: 400 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    if (!allowedOrigin(req.headers.get('Origin'), env)) return new Response('origin not allowed', { status: 403 });

    const room = env.ROOMS.get(env.ROOMS.idFromName(code));
    return room.fetch(req);
  },
};

export class Room {
  constructor(state) {
    this.state = state;
  }

  peers() {
    return this.state.getWebSockets();
  }

  async fetch() {
    const taken = new Set(this.peers().map((ws) => ws.deserializeAttachment()?.seat));
    const seat = !taken.has(0) ? 0 : !taken.has(1) ? 1 : -1;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (seat < 0) {
      // accept just long enough to say why, so the browser can show it
      server.accept();
      server.send(JSON.stringify({ type: 'full' }));
      server.close(4001, 'room full');
      return new Response(null, { status: 101, webSocket: client });
    }
    // hibernatable: the object can sleep between messages without dropping sockets
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ seat, windowStart: Date.now(), count: 0 });
    server.send(JSON.stringify({ type: 'welcome', seat }));
    const other = this.other(server);
    if (other) {
      other.send(JSON.stringify({ type: 'peer-joined' }));
      server.send(JSON.stringify({ type: 'peer-joined' }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  other(ws) {
    return this.peers().find((p) => p !== ws) || null;
  }

  // crude per-socket rate limit, so one client cannot flood the other through us
  allow(ws) {
    const a = ws.deserializeAttachment();
    const now = Date.now();
    if (now - a.windowStart > 1000) {
      a.windowStart = now;
      a.count = 0;
    }
    a.count++;
    ws.serializeAttachment(a);
    return a.count <= RATE;
  }

  async webSocketMessage(ws, msg) {
    if (!this.allow(ws)) return;
    const other = this.other(ws);
    if (typeof msg === 'string') {
      if (msg.length > MAX_TEXT) return;
      let m;
      try {
        m = JSON.parse(msg);
      } catch {
        return;
      }
      // only signalling passes through; the room never interprets SDP or candidates
      if (!m || !['offer', 'answer', 'ice', 'relay-on', 'bye'].includes(m.type)) return;
      other?.send(msg);
    } else {
      if (msg.byteLength > MAX_BINARY) return;
      other?.send(msg); // relayed game packet
    }
  }

  async webSocketClose(ws) {
    this.other(ws)?.send(JSON.stringify({ type: 'peer-left' }));
  }

  async webSocketError(ws) {
    this.other(ws)?.send(JSON.stringify({ type: 'peer-left' }));
  }
}
