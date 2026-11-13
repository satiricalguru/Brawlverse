// Runs against a local `npm run dev` (wrangler dev on :8787), or ROOMS_URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.ROOMS_URL || 'ws://127.0.0.1:8787';
const ORIGIN = 'http://localhost:5179';

function open(code, origin = ORIGIN) {
  const ws = new WebSocket(`${BASE}/room/${code}`, { headers: { Origin: origin } });
  ws.binaryType = 'arraybuffer';
  const inbox = [];
  const waiters = [];
  ws.addEventListener('message', (e) => {
    const m = typeof e.data === 'string' ? JSON.parse(e.data) : new Uint8Array(e.data);
    const w = waiters.shift();
    if (w) w(m);
    else inbox.push(m);
  });
  const next = (ms = 3000) =>
    inbox.length
      ? Promise.resolve(inbox.shift())
      : new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('timed out waiting for a message')), ms);
          waiters.push((m) => {
            clearTimeout(t);
            res(m);
          });
        });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  return { ws, next, ready };
}

const code = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[(Math.random() * 31) | 0]).join('');

test('two peers are seated, introduced, and can relay signalling and packets', async () => {
  const c = code();
  const a = open(c);
  await a.ready;
  assert.deepEqual(await a.next(), { type: 'welcome', seat: 0 });
  const b = open(c);
  await b.ready;
  assert.deepEqual(await b.next(), { type: 'welcome', seat: 1 });
  assert.equal((await a.next()).type, 'peer-joined');
  assert.equal((await b.next()).type, 'peer-joined');

  a.ws.send(JSON.stringify({ type: 'offer', sdp: 'v=0 test' }));
  assert.deepEqual(await b.next(), { type: 'offer', sdp: 'v=0 test' });
  b.ws.send(JSON.stringify({ type: 'answer', sdp: 'v=0 back' }));
  assert.deepEqual(await a.next(), { type: 'answer', sdp: 'v=0 back' });

  a.ws.send(new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual([...(await b.next())], [1, 2, 3, 4]);

  // unknown message types are not forwarded
  a.ws.send(JSON.stringify({ type: 'evil', x: 1 }));
  a.ws.send(JSON.stringify({ type: 'ice', candidate: null }));
  assert.deepEqual(await b.next(), { type: 'ice', candidate: null });

  b.ws.close();
  assert.equal((await a.next()).type, 'peer-left');
  a.ws.close();
});

test('a third peer is turned away', async () => {
  const c = code();
  const a = open(c);
  const b = open(c);
  await Promise.all([a.ready, b.ready]);
  const x = open(c);
  await x.ready;
  assert.deepEqual(await x.next(), { type: 'full' });
  a.ws.close();
  b.ws.close();
});

test('bad codes and foreign origins are refused', async () => {
  const bad = await fetch(`${BASE.replace('ws', 'http')}/room/O0O0O`);
  assert.equal(bad.status, 400);
  // a socket from another site is rejected during the handshake
  const evil = open(code(), 'https://evil.example');
  await assert.rejects(evil.ready);
  // and one with no Origin at all (a script, not a browser page) too
  const none = new WebSocket(`${BASE}/room/${code()}`);
  await assert.rejects(new Promise((res, rej) => {
    none.addEventListener('open', res);
    none.addEventListener('error', rej);
  }));
});
