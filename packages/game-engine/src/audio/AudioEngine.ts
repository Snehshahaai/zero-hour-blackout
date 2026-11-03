export type SoundName =
  'shot' | 'dry' | 'magOut' | 'magIn' | 'chamber' | 'hit' | 'headshot' | 'kill' | 'impact';

type Synth = (t: number, rand: () => number, state: { lp: number }) => number;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

/**
 * Procedurally synthesised sound effects (no audio files to license or download) played
 * through a single master gain. Spatial audio arrives in Phase 7.
 * The AudioContext must be created from a user gesture: call `unlock()` on click.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private volume = 0.6;

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const limiter = this.ctx.createDynamicsCompressor();
      this.master.connect(limiter).connect(this.ctx.destination);
      this.buildBuffers(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  play(name: SoundName, gain = 1, rate = 1): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(name);
    if (!ctx || !this.master || !buf || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Slight random pitch so repeated sounds don't machine-gun identically.
    src.playbackRate.value = rate * (0.97 + Math.random() * 0.06);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start();
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.buffers.clear();
  }

  private make(ctx: AudioContext, name: SoundName, seconds: number, fn: Synth): void {
    const sr = ctx.sampleRate;
    const n = Math.floor(seconds * sr);
    const buf = ctx.createBuffer(1, n, sr);
    const data = buf.getChannelData(0);
    const rand = lcg(name.length * 7919 + n);
    const state = { lp: 0 };
    for (let i = 0; i < n; i++) data[i] = Math.tanh(fn(i / sr, rand, state));
    this.buffers.set(name, buf);
  }

  private buildBuffers(ctx: AudioContext): void {
    const tau = Math.PI * 2;
    // Rifle shot: bright crack + low thump + lowpassed tail (a cheap stand-in for room reverb).
    this.make(ctx, 'shot', 0.6, (t, r, s) => {
      const noise = r() * 2;
      const a = 0.05 + 0.6 * Math.exp(-t * 60);
      s.lp += a * (noise - s.lp);
      const crack = noise * Math.exp(-t * 110) * 0.9;
      const body = s.lp * Math.exp(-t * 18) * 1.6;
      const thump = Math.sin(tau * (45 + 90 * Math.exp(-t * 45)) * t) * Math.exp(-t * 13) * 1.1;
      const tail = s.lp * Math.exp(-t * 6) * 0.35;
      return crack + body + thump + tail;
    });
    this.make(
      ctx,
      'dry',
      0.08,
      (t, r) =>
        r() * 2 * Math.exp(-t * 180) * 0.5 + Math.sin(tau * 900 * t) * Math.exp(-t * 150) * 0.3,
    );
    this.make(ctx, 'magOut', 0.18, (t, r, s) => {
      s.lp += 0.25 * (r() * 2 - s.lp);
      return s.lp * Math.exp(-t * 35) * 1.3 + Math.sin(tau * 160 * t) * Math.exp(-t * 40) * 0.5;
    });
    this.make(ctx, 'magIn', 0.2, (t, r, s) => {
      s.lp += 0.5 * (r() * 2 - s.lp);
      return s.lp * Math.exp(-t * 60) * 1.4 + Math.sin(tau * 110 * t) * Math.exp(-t * 28) * 0.8;
    });
    this.make(ctx, 'chamber', 0.25, (t, r, s) => {
      s.lp += 0.6 * (r() * 2 - s.lp);
      const second = t > 0.1 ? Math.exp(-(t - 0.1) * 90) : 0;
      return (
        s.lp * (Math.exp(-t * 90) + second) * 1.1 +
        Math.sin(tau * 420 * t) * Math.exp(-t * 70) * 0.25
      );
    });
    this.make(
      ctx,
      'hit',
      0.07,
      (t) => (Math.sin(tau * 1700 * t) + 0.5 * Math.sin(tau * 2600 * t)) * Math.exp(-t * 60) * 0.45,
    );
    this.make(ctx, 'headshot', 0.16, (t) => {
      const second = t > 0.06 ? Math.exp(-(t - 0.06) * 45) : 0;
      return (
        (Math.sin(tau * 2300 * t) * Math.exp(-t * 45) + Math.sin(tau * 3100 * t) * second) * 0.5
      );
    });
    this.make(
      ctx,
      'kill',
      0.35,
      (t) => (Math.sin(tau * 880 * t) + 0.5 * Math.sin(tau * 1320 * t)) * Math.exp(-t * 12) * 0.4,
    );
    this.make(ctx, 'impact', 0.1, (t, r, s) => {
      s.lp += 0.2 * (r() * 2 - s.lp);
      return s.lp * Math.exp(-t * 45) * 1.5;
    });
  }
}
