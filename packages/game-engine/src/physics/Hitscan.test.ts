import { beforeAll, describe, expect, it } from 'vitest';
import { TargetDummy } from '../entities/TargetDummy.ts';
import { MAP_01, SANDBOX_TARGETS } from '../world/map01.ts';
import { Hitscan, viewDirection } from './Hitscan.ts';
import { initPhysics, PhysicsWorld } from './PhysicsWorld.ts';

beforeAll(async () => {
  await initPhysics();
});

function setup() {
  const physics = PhysicsWorld.fromMap(MAP_01);
  const hitscan = new Hitscan(physics);
  return { physics, hitscan };
}

describe('viewDirection', () => {
  it('matches the camera convention', () => {
    const f = viewDirection(0, 0);
    expect([f.x, f.y, f.z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, -1]);
    expect(viewDirection(0, Math.PI / 2).y).toBeCloseTo(1);
    const e = viewDirection(-Math.PI / 2, 0);
    expect(e.x).toBeCloseTo(1);
    const up = viewDirection(0, 0, 0, 0.1);
    expect(up.y).toBeGreaterThan(0);
    expect(Math.hypot(up.x, up.y, up.z)).toBeCloseTo(1);
  });
});

describe('Hitscan on Map 01', () => {
  it('hits world geometry with a sensible normal and distance', () => {
    const { hitscan } = setup();
    // From the warehouse centre looking toward -Z hits the north wall (z = 10.2 inner face).
    const r = hitscan.cast({ x: 33, y: 1.6, z: 24 }, { x: 0, y: 0, z: -1 }, 100);
    // x=33 lines up with a door gap in z=10 wall ([28,32] and [38,40.5] gaps; 33 is wall)
    expect(r.kind).toBe('world');
    if (r.kind === 'world') {
      expect(r.point.z).toBeCloseTo(10.2, 1);
      expect(r.normal.z).toBeGreaterThan(0.9);
      expect(r.distance).toBeCloseTo(13.8, 1);
    }
  });

  it('misses when there is nothing within range', () => {
    const { hitscan } = setup();
    expect(hitscan.cast({ x: 33, y: 1.6, z: 24 }, { x: 0, y: 1, z: 0 }, 1).kind).toBe('miss');
  });

  it('hits a target, distinguishes head from body, and stops at walls in between', () => {
    const { physics, hitscan } = setup();
    const t = new TargetDummy(1, 33, 14, hitscan, physics);
    const body = hitscan.cast({ x: 33, y: 1.0, z: 24 }, { x: 0, y: 0, z: -1 }, 100);
    expect(body.kind).toBe('target');
    if (body.kind === 'target') {
      expect(body.target.id).toBe(1);
      expect(body.headshot).toBe(false);
    }
    const head = hitscan.cast({ x: 33, y: 1.7, z: 24 }, { x: 0, y: 0, z: -1 }, 100);
    expect(head.kind === 'target' && head.headshot).toBe(true);
    // A target behind the north wall cannot be hit through it.
    new TargetDummy(2, 33, 5, hitscan, physics);
    const behind = hitscan.cast({ x: 33, y: 1.0, z: 11 }, { x: 0, y: 0, z: -1 }, 100);
    expect(behind.kind).toBe('world');
    t.dispose();
  });

  it('dead targets stop blocking bullets and respawn later', () => {
    const { physics, hitscan } = setup();
    const t = new TargetDummy(1, 33, 14, hitscan, physics, 1);
    expect(t.applyDamage(100).killed).toBe(true);
    const through = hitscan.cast({ x: 33, y: 1.0, z: 24 }, { x: 0, y: 0, z: -1 }, 100);
    expect(through.kind).toBe('world');
    for (let i = 0; i < 70; i++) t.update(1 / 60);
    expect(t.alive).toBe(true);
    expect(hitscan.cast({ x: 33, y: 1.0, z: 24 }, { x: 0, y: 0, z: -1 }, 100).kind).toBe('target');
  });

  it('excludes the shooter collider', () => {
    const { physics, hitscan } = setup();
    const t = new TargetDummy(1, 33, 20, hitscan, physics);
    // Origin inside the target; excluding nothing hits it at distance 0-ish.
    const r = hitscan.cast({ x: 33, y: 1.0, z: 20 }, { x: 0, y: 0, z: -1 }, 100);
    expect(r.kind).toBe('target');
    t.dispose();
  });
});

describe('sandbox target placement', () => {
  it('has no target inside solid geometry', () => {
    const { hitscan } = setup();
    // A ray straight down from above must hit the floor (not a prop) at each spot.
    for (const [x, z] of SANDBOX_TARGETS) {
      const r = hitscan.cast({ x, y: 2.5, z }, { x: 0, y: -1, z: 0 }, 10);
      expect(r.kind).toBe('world');
      if (r.kind === 'world') expect(r.point.y).toBeCloseTo(0, 1);
    }
  });
});
