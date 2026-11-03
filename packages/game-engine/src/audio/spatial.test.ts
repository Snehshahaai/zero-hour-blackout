import { describe, expect, it } from 'vitest';
import {
  StrideTracker,
  distanceGain,
  gaitFor,
  jitterPosition,
  occlusionFilter,
  reverbWet,
} from './spatial.ts';

describe('footsteps', () => {
  it('produces one step per stride of travel, carrying the remainder', () => {
    const t = new StrideTracker();
    expect(t.advance(1, 2.2)).toBe(0);
    expect(t.advance(1.5, 2.2)).toBe(1); // 2.5 total
    expect(t.advance(4.4, 2.2)).toBe(2); // 0.3 + 4.4 = 4.7
    t.reset();
    expect(t.advance(2.1, 2.2)).toBe(0);
  });

  it('crouching and slow movement are silent; sprinting is louder with longer strides', () => {
    expect(gaitFor(2, true)).toBeNull();
    expect(gaitFor(4, true)).toBeNull();
    expect(gaitFor(1, false)).toBeNull();
    const walk = gaitFor(4, false);
    const run = gaitFor(6.2, false);
    expect(walk).not.toBeNull();
    expect(run!.gain).toBeGreaterThan(walk!.gain);
    expect(run!.stride).toBeGreaterThan(walk!.stride);
  });
});

describe('distance, occlusion, reverb', () => {
  it('attenuates smoothly with distance and is clamped at both ends', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(3)).toBe(1);
    expect(distanceGain(10)).toBeLessThan(distanceGain(5));
    expect(distanceGain(1000)).toBe(distanceGain(80));
    expect(distanceGain(20)).toBeGreaterThan(0.1);
  });
  it('occlusion muffles and quietens; reverb is wetter indoors', () => {
    const open = occlusionFilter(false);
    const blocked = occlusionFilter(true);
    expect(blocked.cutoffHz).toBeLessThan(open.cutoffHz / 10);
    expect(blocked.gain).toBeLessThan(open.gain);
    expect(reverbWet(true)).toBeGreaterThan(reverbWet(false) * 3);
  });
  it('jitter stays within the requested radius per axis and keeps height', () => {
    const p = { x: 10, y: 1.7, z: 20 };
    for (let i = 0; i < 100; i++) {
      const j = jitterPosition(p, 1.5);
      expect(Math.abs(j.x - p.x)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(j.z - p.z)).toBeLessThanOrEqual(1.5);
      expect(j.y).toBe(p.y);
    }
    expect(jitterPosition(p, 2, () => 0.5)).toEqual(p);
  });
});
