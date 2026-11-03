import type { MapDef, ObjectiveDef } from './MapData.ts';

/** The objective site whose plant zone contains (x, z), or null. `bonus` widens the zone. */
export function siteAt(map: MapDef, x: number, z: number, bonus: number): ObjectiveDef | null {
  for (const o of map.objectives) {
    if (Math.hypot(x - o.center[0], z - o.center[1]) <= o.radius + bonus) return o;
  }
  return null;
}
