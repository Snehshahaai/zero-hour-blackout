import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { MapDef } from '../world/MapData.ts';
import { MAP_01 } from '../world/map01.ts';
import { PlayerController, type MoveInput } from './PlayerController.ts';

const idle: MoveInput = { forward: 0, right: 0, jump: false, sprint: false, crouch: false, yaw: 0 };

function setup(at: [number, number, number] = [33, 0.5, 24]) {
  const physics = PhysicsWorld.fromMap(MAP_01);
  const p = new PlayerController(physics, { x: at[0], y: at[1], z: at[2] });
  return { physics, p };
}
function run(p: PlayerController, input: Partial<MoveInput>, steps: number) {
  for (let i = 0; i < steps; i++) p.update({ ...idle, ...input });
}

beforeAll(async () => {
  await initPhysics();
});

describe('PlayerController on Map 01', () => {
  it('falls onto the floor and becomes grounded', () => {
    const { p } = setup();
    run(p, {}, 60);
    expect(p.state.grounded).toBe(true);
    expect(p.state.y).toBeCloseTo(0, 1);
  });

  it('accelerates up to walk speed and sprint is faster', () => {
    const { p } = setup([33, 0.5, 24]);
    run(p, {}, 30);
    run(p, { forward: 1 }, 20);
    expect(Math.hypot(p.state.vx, p.state.vz)).toBeCloseTo(4.0, 1);
    run(p, { forward: 1, sprint: true }, 1);
    // sprint accelerates toward 6.2 (not instant)
    expect(Math.hypot(p.state.vx, p.state.vz)).toBeGreaterThan(4.0);
  });

  it('cannot walk through the north wall of the generator room', () => {
    const { p } = setup([39, 0.2, 8.2]); // generator room, yaw 0 walks toward -Z (z=0 wall)
    run(p, {}, 30);
    run(p, { forward: 1 }, 300);
    expect(p.state.z).toBeGreaterThan(0.2); // never crosses the wall's inner face
    expect(p.state.z).toBeLessThan(8.2);
  });

  it('walks through a doorway (warehouse west door) without getting stuck', () => {
    // Door gap z 18..21 in wall x=15. Start in the west corridor, walk east (+X: yaw = -90deg).
    const { p } = setup([10, 0.2, 19.5]);
    run(p, {}, 30);
    run(p, { forward: 1, yaw: -Math.PI / 2 }, 240);
    expect(p.state.x).toBeGreaterThan(16);
  });

  it('jumps, and cannot jump again mid-air', () => {
    const { p } = setup();
    run(p, {}, 30);
    run(p, { jump: true }, 1);
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      p.update({ ...idle, jump: true });
      peak = Math.max(peak, p.state.y);
    }
    expect(peak).toBeGreaterThan(0.7);
    expect(peak).toBeLessThan(1.3);
    run(p, {}, 60);
    expect(p.state.grounded).toBe(true);
  });

  it('crouches, and stays crouched under low headroom, stands when clear', () => {
    const { p } = setup();
    run(p, {}, 30);
    run(p, { crouch: true }, 30);
    expect(p.state.crouching).toBe(true);
    expect(p.state.eyeHeight).toBeLessThan(1.3);
    run(p, {}, 30);
    expect(p.state.crouching).toBe(false);
    expect(p.state.eyeHeight).toBeGreaterThan(1.55);
  });
});

describe('stance rules', () => {
  it('stays crouched under a low ceiling and stands once it is clear', () => {
    // Floor plus a 1.4 m-high slab: crouch (1.2 m) fits, standing (1.8 m) does not.
    const tiny: MapDef = {
      name: 'tunnel',
      bounds: { minX: 0, maxX: 20, minZ: 0, maxZ: 10 },
      boxes: [
        { pos: [0, -0.3, 0], size: [20, 0.3, 10], mat: 'concrete' },
        { pos: [8, 1.4, 0], size: [4, 0.3, 10], mat: 'concrete' },
      ],
      cylinders: [],
      crates: [],
      lights: [],
      zones: [],
      panels: [],
      doors: [],
      objectives: [],
      spawns: { attackers: [], defenders: [] },
    };
    const p = new PlayerController(PhysicsWorld.fromMap(tiny), { x: 10, y: 0.2, z: 5 });
    run(p, {}, 30);
    run(p, { crouch: true }, 20);
    expect(p.state.crouching).toBe(true);
    run(p, {}, 30); // released crouch, ceiling overhead
    expect(p.state.crouching).toBe(true);
    p.teleport(5, 0.05, 5); // outside the slab
    run(p, {}, 10);
    expect(p.state.crouching).toBe(false);
  });
  it('cannot jump while crouched', () => {
    const { p } = setup();
    run(p, {}, 30);
    run(p, { crouch: true }, 20);
    run(p, { crouch: true, jump: true }, 10);
    expect(p.state.y).toBeLessThan(0.05);
  });
});
