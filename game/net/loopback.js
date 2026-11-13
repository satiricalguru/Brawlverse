// A fake network between two peers in one process, for tests and the /play lag
// simulator: messages arrive after a latency with jitter, and some are dropped.
// Delivery order is not guaranteed, like an unordered WebRTC data channel.

export function createLoopback({ latency = 50, jitter = 10, loss = 0, random = Math.random, now = () => performance.now() } = {}) {
  const queue = []; // { at, to, bytes }
  const handlers = [null, null];
  const stats = { sent: 0, dropped: 0, bytes: 0 };

  const endpoint = (self) => ({
    send(bytes) {
      stats.sent++;
      stats.bytes += bytes.length;
      if (random() < loss) {
        stats.dropped++;
        return;
      }
      const at = now() + Math.max(0, latency + (random() * 2 - 1) * jitter);
      queue.push({ at, to: 1 - self, bytes: bytes.slice() });
    },
    onMessage(fn) {
      handlers[self] = fn;
    },
  });

  return {
    a: endpoint(0),
    b: endpoint(1),
    stats,
    // deliver everything that is due
    pump() {
      const t = now();
      for (let i = 0; i < queue.length; ) {
        if (queue[i].at <= t) {
          const m = queue.splice(i, 1)[0];
          handlers[m.to]?.(m.bytes);
        } else i++;
      }
    },
    set(opts) {
      if (opts.latency !== undefined) latency = opts.latency;
      if (opts.jitter !== undefined) jitter = opts.jitter;
      if (opts.loss !== undefined) loss = opts.loss;
    },
  };
}
