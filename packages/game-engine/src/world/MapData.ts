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
  /** Zone whose power controls this light. */
  zone: string;
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

export interface ZoneDef {
  id: string;
  label: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  indoor: boolean;
  surface: 'concrete' | 'metal' | 'asphalt';
}

export interface PowerPanelDef {
  id: string;
  /** Zone this panel cuts. */
  zone: string;
  pos: readonly [number, number];
}

/** Electronic door: open while powered, fails closed during an outage of its zone. */
export interface DoorDef {
  id: string;
  zone: string;
  /** Collision/visual box (minimum corner + size), same convention as `BoxDef`. */
  box: BoxDef;
}

export interface MapDef {
  name: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  boxes: BoxDef[];
  cylinders: CylinderDef[];
  crates: CrateDef[];
  lights: LightDef[];
  zones: ZoneDef[];
  panels: PowerPanelDef[];
  doors: DoorDef[];
  objectives: ObjectiveDef[];
  /** Spawn points as [x, z]. */
  spawns: { attackers: (readonly [number, number])[]; defenders: (readonly [number, number])[] };
}
