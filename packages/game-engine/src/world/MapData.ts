export type MaterialId = 'concrete' | 'concreteDark' | 'metal' | 'asphalt' | 'crate' | 'glass';
export type Vec3 = readonly [number, number, number];

/** Axis-aligned box. `pos` is the minimum corner (x, y, z); `size` is (width, height, depth). */
export interface BoxDef {
  pos: Vec3;
  size: Vec3;
  mat: MaterialId;
  tag?: 'roof' | 'glass';
}

/** Vertical cylinder; `pos` is the centre of its base. */
export interface CylinderDef {
  pos: Vec3;
  radius: number;
  height: number;
  mat: MaterialId;
}

export interface CrateDef {
  x: number;
  z: number;
  size: Vec3;
  rotY: number;
}

export interface LightDef {
  pos: Vec3;
  color: number;
  intensity: number;
  distance: number;
}

export interface ObjectiveDef {
  id: 'A' | 'B';
  center: readonly [number, number];
  radius: number;
}

export interface MapDef {
  name: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  boxes: BoxDef[];
  cylinders: CylinderDef[];
  crates: CrateDef[];
  lights: LightDef[];
  objectives: ObjectiveDef[];
  /** Spawn points as [x, z]. */
  spawns: { attackers: (readonly [number, number])[]; defenders: (readonly [number, number])[] };
}
