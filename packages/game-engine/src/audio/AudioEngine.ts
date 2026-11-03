export type SoundName =
  | 'shot'
  | 'dry'
  | 'magOut'
  | 'magIn'
  | 'chamber'
  | 'hit'
  | 'headshot'
  | 'kill'
  | 'impact'
  | 'beep'
  | 'explosion'
  | 'stepConcrete'
  | 'stepMetal'
  | 'stepAsphalt'
  | 'powerDown'
  | 'powerUp';

import { occlusionFilter, reverbWet } from './spatial.ts';

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
  private convolver: ConvolverNode | null = null;
  private ambience: { hum: GainNode; wind: GainNode; rain: GainNode } | null = null;
  private hrtf = true;

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
      this.buildReverb(this.ctx);
      this.buildAmbience(this.ctx);
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

  /** Low quality uses cheap equal-power panning instead of HRTF. */
  setHrtf(enabled: boolean): void {
    this.hrtf = enabled;
  }

  /** Call every frame with the camera pose so panning follows where the player looks. */
  setListener(x: number, y: number, z: number, yaw: number, pitch: number): void {
    const l = this.ctx?.listener;
    if (!l) return;
    const cp = Math.cos(pitch);
    const f = { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
      l.forwardX.value = f.x;
      l.forwardY.value = f.y;
      l.forwardZ.value = f.z;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    }
  }

  /**
   * Plays a sound at a world position: panned and attenuated by distance, muffled when a wall
   * is in the way, with a reverb tail whose size depends on whether the listener is indoors.
   */
  playAt(
    name: SoundName,
    pos: { x: number; y: number; z: number },
    opts: { gain?: number; occluded?: boolean; indoor?: boolean } = {},
  ): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(name);
    if (!ctx || !this.master || !buf || ctx.state !== 'running') return;
    const occ = occlusionFilter(opts.occluded ?? false);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.97 + Math.random() * 0.06;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = occ.cutoffHz;
    const panner = ctx.createPanner();
    panner.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 3;
    panner.rolloffFactor = 1.4;
    panner.maxDistance = 80;
    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;
    const dry = ctx.createGain();
    dry.gain.value = (opts.gain ?? 1) * occ.gain;
    src.connect(lp).connect(panner);
    panner.connect(dry).connect(this.master);
    if (this.convolver) {
      const wet = ctx.createGain();
      wet.gain.value = reverbWet(opts.indoor ?? true) * (opts.gain ?? 1) * occ.gain;
      panner.connect(wet).connect(this.convolver);
    }
    src.start();
  }

  /** Crossfades the ambient beds: room hum indoors, wind outside, rain when it rains. */
  setEnvironment(env: { indoor: boolean; rain: boolean; powerCut: boolean }): void {
    const a = this.ambience;
    const ctx = this.ctx;
    if (!a || !ctx) return;
    const t = ctx.currentTime;
    const hum = env.indoor ? (env.powerCut ? 0.012 : 0.05) : 0;
    const wind = env.indoor ? 0.012 : 0.06;
    const rain = env.rain ? (env.indoor ? 0.035 : 0.11) : 0;
    a.hum.gain.setTargetAtTime(hum, t, 0.6);
    a.wind.gain.setTargetAtTime(wind, t, 0.6);
    a.rain.gain.setTargetAtTime(rain, t, 0.6);
  }

  private buildReverb(ctx: AudioContext): void {
    const seconds = 1.5;
    const n = Math.floor(ctx.sampleRate * seconds);
    const ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      const r = lcg(1234 + ch * 77);
      for (let i = 0; i < n; i++) d[i] = r() * 2 * Math.pow(1 - i / n, 2.6);
    }
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = ir;
    const out = ctx.createGain();
    out.gain.value = 0.8;
    this.convolver.connect(out).connect(this.master as GainNode);
  }

  private buildAmbience(ctx: AudioContext): void {
    const bed = (filterType: BiquadFilterType, freq: number, q = 0.7): GainNode => {
      const n = ctx.sampleRate * 4;
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      const r = lcg(Math.floor(freq) * 31);
      for (let i = 0; i < n; i++) d[i] = r() * 2;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src
        .connect(f)
        .connect(g)
        .connect(this.master as GainNode);
      src.start();
      return g;
    };
    this.ambience = {
      hum: bed('lowpass', 140, 1.2),
      wind: bed('bandpass', 420, 0.5),
      rain: bed('highpass', 3200, 0.4),
    };
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
    this.make(ctx, 'beep', 0.09, (t) => Math.sin(tau * 1050 * t) * Math.exp(-t * 28) * 0.7);
    this.make(ctx, 'explosion', 1.6, (t, r, s) => {
      s.lp += (0.04 + 0.2 * Math.exp(-t * 3)) * (r() * 2 - s.lp);
      const boom = Math.sin(tau * (38 + 50 * Math.exp(-t * 5)) * t) * Math.exp(-t * 3.2) * 1.4;
      return s.lp * Math.exp(-t * 2.2) * 3 + boom;
    });
    this.make(ctx, 'stepConcrete', 0.14, (t, r, s) => {
      s.lp += 0.3 * (r() * 2 - s.lp);
      return s.lp * Math.exp(-t * 55) * 1.3 + Math.sin(tau * 105 * t) * Math.exp(-t * 38) * 0.6;
    });
    this.make(ctx, 'stepMetal', 0.24, (t, r) => {
      return (
        r() * 2 * Math.exp(-t * 90) * 0.5 +
        Math.sin(tau * 720 * t) * Math.exp(-t * 20) * 0.35 +
        Math.sin(tau * 1180 * t) * Math.exp(-t * 28) * 0.2
      );
    });
    this.make(ctx, 'stepAsphalt', 0.16, (t, r, s) => {
      s.lp += 0.55 * (r() * 2 - s.lp);
      return s.lp * Math.exp(-t * 38) * 1.0 + Math.sin(tau * 90 * t) * Math.exp(-t * 35) * 0.5;
    });
    this.make(ctx, 'powerDown', 0.9, (t, r, s) => {
      s.lp += 0.1 * (r() * 2 - s.lp);
      return (
        Math.sin(tau * (180 - 130 * t) * t) * Math.exp(-t * 3) * 0.6 +
        s.lp * Math.exp(-t * 14) * 1.2
      );
    });
    this.make(
      ctx,
      'powerUp',
      0.7,
      (t) => Math.sin(tau * (60 + 200 * t) * t) * Math.exp(-t * 4) * 0.5 * Math.min(1, t * 12),
    );
    this.make(ctx, 'impact', 0.1, (t, r, s) => {
      s.lp += 0.2 * (r() * 2 - s.lp);
      return s.lp * Math.exp(-t * 45) * 1.5;
    });
  }
}
