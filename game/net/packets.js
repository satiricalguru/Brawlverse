// Compact binary messages for the netcode. An input packet for 8 frames is 22 bytes.
//
// INPUT: u8 type, u8 player, u32 start, u32 ack, u32 frame, i8 adv, u8 n, n × u8 bits
// HASH:  u8 type, u32 frame, u32 hash

export const MSG = { INPUT: 1, HASH: 2 };

export function encode(m) {
  if (m.type === MSG.INPUT) {
    const n = m.bits.length;
    const b = new Uint8Array(16 + n);
    const v = new DataView(b.buffer);
    v.setUint8(0, MSG.INPUT);
    v.setUint8(1, m.player);
    v.setUint32(2, Math.max(0, m.start), true);
    v.setInt32(6, m.ack, true);
    v.setUint32(10, m.frame, true);
    v.setInt8(14, Math.max(-128, Math.min(127, m.adv | 0)));
    v.setUint8(15, n);
    b.set(m.bits, 16);
    return b;
  }
  if (m.type === MSG.HASH) {
    const b = new Uint8Array(9);
    const v = new DataView(b.buffer);
    v.setUint8(0, MSG.HASH);
    v.setUint32(1, m.frame, true);
    v.setUint32(5, m.hash >>> 0, true);
    return b;
  }
  throw new Error(`unknown message type ${m.type}`);
}

// returns null for anything malformed: the network is not trusted
export function decode(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 1) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const type = v.getUint8(0);
  if (type === MSG.INPUT) {
    if (b.length < 16) return null;
    const n = v.getUint8(15);
    if (b.length !== 16 + n) return null;
    const player = v.getUint8(1);
    if (player > 7) return null;
    return {
      type,
      player,
      start: v.getUint32(2, true),
      ack: v.getInt32(6, true),
      frame: v.getUint32(10, true),
      adv: v.getInt8(14),
      bits: Array.from(b.subarray(16, 16 + n)),
    };
  }
  if (type === MSG.HASH) {
    if (b.length !== 9) return null;
    return { type, frame: v.getUint32(1, true), hash: v.getUint32(5, true) };
  }
  return null;
}
