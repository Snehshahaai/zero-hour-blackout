import type { MapDef, ZoneDef } from './MapData.ts';

/** The zone containing (x, z), or null (outside the map). Zones do not overlap. */
export function zoneAt(map: MapDef, x: number, z: number): ZoneDef | null {
  for (const zone of map.zones) {
    if (x >= zone.minX && x < zone.maxX && z >= zone.minZ && z < zone.maxZ) return zone;
  }
  return null;
}

export function surfaceAt(map: MapDef, x: number, z: number): ZoneDef['surface'] {
  return zoneAt(map, x, z)?.surface ?? 'concrete';
}

export function isIndoor(map: MapDef, x: number, z: number): boolean {
  return zoneAt(map, x, z)?.indoor ?? false;
}
