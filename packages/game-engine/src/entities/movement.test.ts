import { describe, expect, it } from 'vitest';
import { accelerate, wishDirection } from './movement.ts';

describe('accelerate', () => {
  it('ramps up linearly and never overshoots the target speed', () => {
    let v = { x: 0, z: 0 };
    v = accelerate(v, { x: 1, z: 0 }, 4, 40, 30, 0.05);
    expect(v.x).toBeCloseTo(2);
    v = accelerate(v, { x: 1, z: 0 }, 4, 40, 30, 1);
    expect(v).toEqual({ x: 4, z: 0 });
  });
  it('decelerates to a full stop without input', () => {
    let v = { x: 4, z: 0 };
    v = accelerate(v, { x: 0, z: 0 }, 4, 40, 30, 0.1);
    expect(v.x).toBeCloseTo(1);
    v = accelerate(v, { x: 0, z: 0 }, 4, 40, 30, 0.1);
    expect(v).toEqual({ x: 0, z: 0 });
  });
});

describe('wishDirection', () => {
  it('forward at yaw 0 is -Z; diagonal input is normalised', () => {
    const f = wishDirection(1, 0, 0);
    expect(f.x).toBeCloseTo(0);
    expect(f.z).toBeCloseTo(-1);
    const d = wishDirection(1, 1, 0);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1);
  });
  it('rotates with yaw (turn left 90deg: forward becomes -X)', () => {
    const f = wishDirection(1, 0, Math.PI / 2);
    expect(f.x).toBeCloseTo(-1);
    expect(f.z).toBeCloseTo(0);
  });
  it('returns zero for no input', () => {
    expect(wishDirection(0, 0, 1)).toEqual({ x: 0, z: 0 });
  });
});
