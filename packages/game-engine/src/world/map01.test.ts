import { POWER_RULES, ROUND_RULES } from '@zhb/shared';
import { describe, expect, it } from 'vitest';
import { MAP_01 } from './map01.ts';
import { isIndoor, surfaceAt, zoneAt } from './zones.ts';

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

describe('MAP_01 zones, panels and doors', () => {
  it('every spawn, objective and panel lies in exactly one zone', () => {
    const points: [string, readonly [number, number]][] = [
      ...MAP_01.spawns.attackers.map((p, i): [string, readonly [number, number]] => [`att${i}`, p]),
      ...MAP_01.spawns.defenders.map((p, i): [string, readonly [number, number]] => [`def${i}`, p]),
      ...MAP_01.objectives.map((o): [string, readonly [number, number]] => [
        `obj${o.id}`,
        o.center,
      ]),
      ...MAP_01.panels.map((p): [string, readonly [number, number]] => [p.id, p.pos]),
    ];
    for (const [name, [x, z]] of points) {
      const hits = MAP_01.zones.filter(
        (q) => x >= q.minX && x < q.maxX && z >= q.minZ && z < q.maxZ,
      );
      expect(hits.length, name).toBe(1);
    }
  });

  it('lights, panels and doors reference real zones', () => {
    const ids = new Set(MAP_01.zones.map((z) => z.id));
    for (const l of MAP_01.lights) expect(ids.has(l.zone)).toBe(true);
    for (const p of MAP_01.panels) expect(ids.has(p.zone)).toBe(true);
    for (const d of MAP_01.doors) expect(ids.has(d.zone)).toBe(true);
  });

  it('panels stand on free floor, away from both objective sites, in zones that never hold a site', () => {
    for (const p of MAP_01.panels) {
      expect(insideSolid(...p.pos), p.id).toBe(false);
      for (const o of MAP_01.objectives) {
        // Panel reach must never overlap a plant zone, so one hold can't do both jobs.
        const gap = Math.hypot(p.pos[0] - o.center[0], p.pos[1] - o.center[1]);
        expect(gap).toBeGreaterThan(
          o.radius + ROUND_RULES.plantRadiusBonus + POWER_RULES.panelReach + 0.5,
        );
      }
      expect(zoneAt(MAP_01, ...p.pos)?.id).toBe(p.zone);
    }
    // Sites (generator room, dock) are not cuttable zones: no blackout can ever hide a plant.
    const cuttable = new Set(MAP_01.panels.map((p) => p.zone));
    for (const o of MAP_01.objectives)
      expect(cuttable.has(zoneAt(MAP_01, ...o.center)?.id ?? '')).toBe(false);
  });

  it('the electronic door never seals a zone: its zone has another exit', () => {
    const door = MAP_01.doors[0]!;
    // Security office has doors on its west and east walls besides the south shutter.
    const gaps = MAP_01.boxes.filter((b) => b.pos[0] === 14.8 || b.pos[0] === 26.8);
    expect(door.zone).toBe('security');
    expect(gaps.length).toBeGreaterThan(0);
  });

  it('surface and indoor lookups follow the zones', () => {
    expect(surfaceAt(MAP_01, 52, 20)).toBe('asphalt');
    expect(surfaceAt(MAP_01, 39, 5)).toBe('metal');
    expect(isIndoor(MAP_01, 52, 20)).toBe(false);
    expect(isIndoor(MAP_01, 30, 20)).toBe(true);
  });
});
