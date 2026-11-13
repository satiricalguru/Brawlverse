// Connects two browsers for a match: meet in a room on the room service, try a direct
// WebRTC data channel (unordered, no retransmits: UDP-like, ideal for rollback), and fall
// back to relaying packets through the room's WebSocket if no direct path is found.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L lookalikes
export const ROOM_CODE = /^[A-HJ-NP-Z2-9]{5}$/;

export function newRoomCode() {
  const r = crypto.getRandomValues(new Uint8Array(5));
  return [...r].map((b) => ALPHABET[b & 31]).join('');
}

const ICE = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const P2P_TIMEOUT = 8000; // ms to find a direct path before relaying

/**
 * @param {object} o
 * @param {string} o.url      room service base, e.g. wss://brawlverse-rooms.example.workers.dev
 * @param {string} o.code
 * @param {(status: string, detail?: object) => void} o.onStatus
 *   'connecting' | 'waiting' | 'joined' | 'ready' | 'full' | 'left' | 'error'
 */
export function joinRoom({ url, code, onStatus }) {
  let ws;
  let pc = null;
  let dc = null;
  let seat = -1;
  let mode = null; // 'p2p' | 'relay'
  let handler = null;
  let timer = 0;
  let closed = false;
  const pendingIce = [];

  const transport = {
    get seat() {
      return seat;
    },
    get mode() {
      return mode;
    },
    send(bytes) {
      if (mode === 'p2p' && dc?.readyState === 'open') dc.send(bytes);
      else if (mode === 'relay' && ws.readyState === WebSocket.OPEN) ws.send(bytes);
    },
    onMessage(fn) {
      handler = fn;
    },
    close() {
      closed = true;
      clearTimeout(timer);
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'bye' }));
      } catch {
        /* closing anyway */
      }
      dc?.close();
      pc?.close();
      ws?.close();
    },
  };

  const signal = (m) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
  const ready = (how) => {
    if (mode) return;
    mode = how;
    clearTimeout(timer);
    onStatus('ready', { mode, seat });
  };
  const relay = () => {
    if (mode) return;
    signal({ type: 'relay-on' });
    ready('relay');
  };

  function setupPeer() {
    pc = new RTCPeerConnection({ iceServers: ICE });
    pc.onicecandidate = (e) => signal({ type: 'ice', candidate: e.candidate ? e.candidate.toJSON() : null });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') relay();
    };
    const wire = (ch) => {
      dc = ch;
      dc.binaryType = 'arraybuffer';
      dc.onopen = () => ready('p2p');
      dc.onmessage = (e) => handler?.(new Uint8Array(e.data));
    };
    if (seat === 0) wire(pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 }));
    else pc.ondatachannel = (e) => wire(e.channel);
    timer = setTimeout(relay, P2P_TIMEOUT);
  }

  async function onSignal(m) {
    switch (m.type) {
      case 'welcome':
        seat = m.seat;
        onStatus('waiting', { seat });
        break;
      case 'full':
        onStatus('full');
        break;
      case 'peer-joined':
        onStatus('joined', { seat });
        if (pc) break;
        setupPeer();
        if (seat === 0) {
          await pc.setLocalDescription(await pc.createOffer());
          signal({ type: 'offer', sdp: pc.localDescription.sdp });
        }
        break;
      case 'offer':
        if (!pc) setupPeer();
        await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        for (const c of pendingIce.splice(0)) await pc.addIceCandidate(c);
        await pc.setLocalDescription(await pc.createAnswer());
        signal({ type: 'answer', sdp: pc.localDescription.sdp });
        break;
      case 'answer':
        await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
        for (const c of pendingIce.splice(0)) await pc.addIceCandidate(c);
        break;
      case 'ice':
        if (!pc || !pc.remoteDescription) pendingIce.push(m.candidate || undefined);
        else await pc.addIceCandidate(m.candidate || undefined);
        break;
      case 'relay-on':
        ready('relay');
        break;
      case 'peer-left':
      case 'bye':
        if (!closed) onStatus('left');
        break;
    }
  }

  onStatus('connecting');
  ws = new WebSocket(`${url.replace(/\/$/, '')}/room/${code}`);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (e) => {
    if (typeof e.data !== 'string') {
      handler?.(new Uint8Array(e.data)); // relayed game packet
      return;
    }
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    onSignal(m).catch((err) => onStatus('error', { message: err.message }));
  };
  ws.onerror = () => !closed && onStatus('error', { message: 'Could not reach the room service.' });
  ws.onclose = (e) => {
    if (closed || e.code === 4001) return;
    if (!mode) onStatus('error', { message: 'The room service closed the connection.' });
    else if (mode === 'relay') onStatus('left');
  };
  return transport;
}
