import { describe, expect, it } from 'vitest';
import { MAP_01 } from './map01.ts';

const solids = MAP_01.boxes.filter((b) => b.tag !== 'roof' && b.tag !== 'glass' && b.pos[1] >= 0);

function insideSolid(x: number, z: number): boolean {
  return solids.some(
    (b) =>
      x > b.pos[0] &&
      x < b.pos[0] + b.size[0] &&
      z > b.pos[2] &&
      z < b.pos[2] + b.size[2] &&
      b.size[1] > 0.5,
  );
}

describe('MAP_01', () => {
  it('has only valid box dimensions', () => {
    for (const b of MAP_01.boxes) expect(b.size.every((s) => s > 0)).toBe(true);
  });
  it('has two objectives not inside solid geometry', () => {
    expect(MAP_01.objectives.map((o) => o.id)).toEqual(['A', 'B']);
    for (const o of MAP_01.objectives) expect(insideSolid(...o.center)).toBe(false);
  });
  it('has enough spawns per side for future 5v5, all inside bounds and free', () => {
    const { minX, maxX, minZ, maxZ } = MAP_01.bounds;
    for (const side of [MAP_01.spawns.attackers, MAP_01.spawns.defenders]) {
      expect(side.length).toBeGreaterThanOrEqual(5);
      for (const [x, z] of side) {
        expect(x).toBeGreaterThan(minX);
        expect(x).toBeLessThan(maxX);
        expect(z).toBeGreaterThan(minZ);
        expect(z).toBeLessThan(maxZ);
        expect(insideSolid(x, z)).toBe(false);
      }
    }
  });
});
