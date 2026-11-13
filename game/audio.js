// Placeholder sound: every effect is synthesised with Web Audio at runtime (no sample
// files, nothing to license). Hits scale with knockback so a smash sounds like one.

export function createAudio() {
  let ctx = null;
  let master = null;
  let noise = null;
  let muted = false;

  function ensure() {
    if (ctx) return ctx.state === 'running';
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master.connect(comp).connect(ctx.destination);
    // one second of white noise, reused by every noisy effect
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx.state === 'running';
  }

  // browsers start audio only after a user gesture
  const unlock = () => {
    ensure();
    if (ctx?.state === 'suspended') ctx.resume();
  };
  window.addEventListener('keydown', unlock);
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('gamepadconnected', unlock);

  const ok = () => !muted && ctx && ctx.state === 'running';

  function env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function burst({ freq = 1200, q = 0.8, type = 'lowpass', peak = 0.5, attack = 0.002, decay = 0.12, sweep = 0, pan = 0 }) {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + attack + decay);
    const g = ctx.createGain();
    env(g, t, peak, attack, decay);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + decay + 0.05);
  }

  function tone({ freq = 120, to = 50, type = 'sine', peak = 0.6, attack = 0.003, decay = 0.18, pan = 0 }) {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + attack + decay);
    const g = ctx.createGain();
    env(g, t, peak, attack, decay);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(master);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  return {
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    // pan: -1 left .. 1 right, from the fighter's screen position
    hit(kb, pan = 0) {
      if (!ok()) return;
      const k = Math.min(1, kb / 140);
      tone({ freq: 160 + 60 * k, to: 38, peak: 0.45 + 0.45 * k, decay: 0.12 + 0.25 * k, pan });
      burst({ freq: 2600 - 1200 * k, q: 0.6, peak: 0.35 + 0.4 * k, decay: 0.06 + 0.16 * k, sweep: 0.3, pan });
      if (k > 0.6) burst({ freq: 5200, type: 'highpass', q: 0.4, peak: 0.25, decay: 0.3, pan });
    },
    block(pan = 0) {
      if (!ok()) return;
      tone({ freq: 1400, to: 900, type: 'triangle', peak: 0.22, decay: 0.09, pan });
      burst({ freq: 3800, type: 'bandpass', q: 3, peak: 0.18, decay: 0.07, pan });
    },
    swing(heavy, pan = 0) {
      if (!ok()) return;
      burst({ freq: heavy ? 700 : 1500, type: 'bandpass', q: 1.4, peak: heavy ? 0.22 : 0.12, attack: 0.03, decay: heavy ? 0.22 : 0.12, sweep: 2.4, pan });
    },
    jump(pan = 0) {
      if (!ok()) return;
      burst({ freq: 900, type: 'bandpass', q: 1.2, peak: 0.08, attack: 0.01, decay: 0.08, sweep: 1.8, pan });
    },
    land(pan = 0) {
      if (!ok()) return;
      tone({ freq: 90, to: 45, peak: 0.18, decay: 0.07, pan });
    },
    ko(pan = 0) {
      if (!ok()) return;
      tone({ freq: 70, to: 24, peak: 0.9, attack: 0.005, decay: 0.9, pan });
      burst({ freq: 1800, q: 0.5, peak: 0.6, decay: 0.8, sweep: 0.15, pan });
      burst({ freq: 6000, type: 'highpass', q: 0.3, peak: 0.3, decay: 0.5, pan });
    },
    shieldBreak(pan = 0) {
      if (!ok()) return;
      tone({ freq: 900, to: 120, type: 'sawtooth', peak: 0.25, decay: 0.5, pan });
      burst({ freq: 4200, type: 'bandpass', q: 2, peak: 0.3, decay: 0.4, pan });
    },
  };
}
