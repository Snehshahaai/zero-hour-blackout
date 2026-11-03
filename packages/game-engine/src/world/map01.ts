import type { BoxDef, MapDef, MaterialId } from './MapData.ts';

const T = 0.4; // wall thickness
const DOOR_H = 3;

type Gap = readonly [number, number];

/**
 * Builds a straight wall along `axis` at coordinate `fixed`, from `from` to `to`, with door
 * gaps (each gets a lintel above it).
 */
function wall(
  out: BoxDef[],
  axis: 'x' | 'z',
  fixed: number,
  from: number,
  to: number,
  h: number,
  gaps: Gap[] = [],
  mat: MaterialId = 'concrete',
): void {
  const seg = (a: number, b: number, y: number, height: number) => {
    if (b - a <= 0 || height <= 0) return;
    out.push(
      axis === 'x'
        ? { pos: [a, y, fixed - T / 2], size: [b - a, height, T], mat }
        : { pos: [fixed - T / 2, y, a], size: [T, height, b - a], mat },
    );
  };
  let cursor = from;
  for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
    seg(cursor, g0, 0, h);
    seg(g0, g1, DOOR_H, h - DOOR_H);
    cursor = g1;
  }
  seg(cursor, to, 0, h);
}

function build(): MapDef {
  const boxes: BoxDef[] = [];

  // Floors (top surface at y = 0)
  boxes.push(
    { pos: [5, -0.3, 0], size: [40, 0.3, 40], mat: 'concrete' },
    { pos: [45, -0.3, 30], size: [15, 0.3, 10], mat: 'concrete' },
    { pos: [45, -0.3, 10], size: [15, 0.3, 20], mat: 'asphalt' },
  );

  // Roofs (hidden in the menu fly-over). Warehouse 8 m, everything else 5 m. Dock is open air.
  const roof = (x: number, z: number, w: number, d: number, y: number): BoxDef => ({
    pos: [x, y, z],
    size: [w, 0.3, d],
    mat: 'metal',
    tag: 'roof',
  });
  boxes.push(
    roof(5, 0, 10, 40, 5), // west corridor
    roof(15, 0, 30, 10, 5), // security + north corridor + generator room
    roof(15, 10, 30, 20, 8), // warehouse
    roof(15, 30, 45, 10, 5), // maintenance
  );

  // Outer shell
  wall(boxes, 'x', 0, 5, 45, 5); // north
  wall(boxes, 'x', 40, 5, 60, 5); // south
  wall(boxes, 'z', 5, 0, 40, 5); // west
  wall(boxes, 'z', 60, 10, 40, 4); // dock + maintenance east fence

  // West corridor / interior partitions
  wall(boxes, 'z', 15, 0, 10, 5, [[3, 5.5]]); // security west door
  wall(boxes, 'z', 15, 10, 30, 8, [[18, 21]]); // warehouse west door
  wall(boxes, 'z', 15, 30, 40, 5, [[33, 36]]); // maintenance west door

  // Security office | north corridor | generator room
  wall(boxes, 'z', 27, 0, 10, 5, [[3, 5.5]]);
  wall(boxes, 'z', 33, 0, 10, 5, [[3, 5.5]]);
  wall(boxes, 'z', 45, 0, 10, 5);

  // Warehouse north (shared with the three rooms above), east and south walls
  wall(boxes, 'x', 10, 15, 45, 8, [
    [19, 21.5],
    [28, 32],
    [38, 40.5],
  ]);
  wall(boxes, 'z', 45, 10, 30, 8, [[17, 22]]); // dock door
  wall(boxes, 'x', 30, 15, 60, 5, [
    [20, 23],
    [28, 32],
    [50, 54], // dock <-> maintenance shortcut
  ]);
  wall(boxes, 'x', 10, 45, 60, 4); // dock north fence

  // Security office window overlooking the warehouse (glass sits above the door gap sill)
  boxes.push({ pos: [23, 1, 9.9], size: [3, 1.5, 0.15], mat: 'glass', tag: 'glass' });

  // Props that are structural, not instanced
  const solid = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    mat: MaterialId,
  ) => boxes.push({ pos: [x, y, z], size: [w, h, d], mat });
  solid(17, 0, 1.5, 4, 0.9, 1.2, 'crate'); // security desk
  solid(21, 0, 1, 1.2, 2, 1.2, 'metal'); // security locker
  solid(35, 0, 3.5, 4, 2, 3, 'metal'); // generator A body
  solid(40, 0, 3.5, 4, 2, 3, 'metal'); // generator B body
  solid(18, 0, 14, 1.2, 3.5, 8, 'metal'); // warehouse shelf row 1
  solid(24, 0, 24, 1.2, 3.5, 5, 'metal'); // shelf row 2
  solid(36, 0, 13, 1.2, 3.5, 8, 'metal'); // shelf row 3
  solid(47, 0, 12, 6, 2.8, 2.6, 'metal'); // trailer 1
  solid(55, 0, 24, 2.6, 2.8, 5, 'metal'); // trailer 2
  solid(20, 0, 34, 6, 1.1, 2, 'concreteDark'); // maintenance bench
  solid(32, 0, 36, 3, 1.4, 3, 'concreteDark'); // maintenance machinery
  // Cover walls in the warehouse centre
  solid(28.5, 0, 19, 3, 1.2, 0.6, 'concreteDark');
  solid(31, 0, 22, 0.6, 1.2, 3, 'concreteDark');

  const cylinders = [
    { pos: [34, 0, 8] as const, radius: 0.35, height: 4.9, mat: 'metal' as const },
    { pos: [44, 0, 8] as const, radius: 0.35, height: 4.9, mat: 'metal' as const },
    { pos: [26, 0, 36] as const, radius: 0.45, height: 4.9, mat: 'metal' as const },
    { pos: [40, 0, 31] as const, radius: 0.3, height: 4.9, mat: 'metal' as const },
  ];

  const crates = [
    { x: 26, z: 14, size: [1.2, 1.2, 1.2], rotY: 0.3 },
    { x: 27.2, z: 14.4, size: [1, 1, 1], rotY: 0 },
    { x: 26.5, z: 14.1, size: [0.9, 0.9, 0.9], rotY: 0.8 },
    { x: 41, z: 26, size: [1.5, 1.5, 1.5], rotY: 0.1 },
    { x: 42.7, z: 27, size: [1.2, 1.2, 1.2], rotY: -0.3 },
    { x: 22, z: 17, size: [1, 1, 1], rotY: 0.5 },
    { x: 53, z: 18, size: [1.4, 1.4, 1.4], rotY: 0.2 },
    { x: 56, z: 15, size: [1.2, 1.2, 1.2], rotY: 0.9 },
    { x: 52, z: 28, size: [1.2, 1.2, 1.2], rotY: 0 },
    { x: 10, z: 20, size: [1.2, 1.2, 1.2], rotY: 0.4 },
    { x: 8, z: 12, size: [1, 1, 1], rotY: 0 },
    { x: 46, z: 36, size: [1.3, 1.3, 1.3], rotY: 0.6 },
  ].map((c) => ({ ...c, size: c.size as unknown as readonly [number, number, number] }));

  return {
    name: 'Abandoned Industrial Facility',
    bounds: { minX: 5, maxX: 60, minZ: 0, maxZ: 40 },
    boxes,
    cylinders,
    crates,
    lights: [
      { zone: 'warehouse', pos: [30, 7.5, 16], color: 0xffd9a0, intensity: 360, distance: 28 },
      { zone: 'warehouse', pos: [30, 7.5, 25], color: 0xffd9a0, intensity: 360, distance: 28 },
      { zone: 'generator', pos: [39, 4.5, 5], color: 0xff9a50, intensity: 160, distance: 14 },
      { zone: 'security', pos: [21, 4.5, 5], color: 0xcfe6ff, intensity: 140, distance: 12 },
      { zone: 'westCorridor', pos: [10, 4.5, 10], color: 0xffd9a0, intensity: 120, distance: 16 },
      { zone: 'westCorridor', pos: [10, 4.5, 30], color: 0xffd9a0, intensity: 120, distance: 16 },
      { zone: 'maintenance', pos: [35, 4.5, 35], color: 0xffd9a0, intensity: 140, distance: 18 },
      { zone: 'dock', pos: [52, 3.5, 20], color: 0xcfe6ff, intensity: 100, distance: 16 },
    ],
    zones: [
      {
        id: 'security',
        label: 'Security office',
        minX: 15,
        maxX: 27,
        minZ: 0,
        maxZ: 10,
        indoor: true,
        surface: 'concrete',
      },
      {
        id: 'corridor',
        label: 'North corridor',
        minX: 27,
        maxX: 33,
        minZ: 0,
        maxZ: 10,
        indoor: true,
        surface: 'concrete',
      },
      {
        id: 'generator',
        label: 'Generator room',
        minX: 33,
        maxX: 45,
        minZ: 0,
        maxZ: 10,
        indoor: true,
        surface: 'metal',
      },
      {
        id: 'warehouse',
        label: 'Warehouse',
        minX: 15,
        maxX: 45,
        minZ: 10,
        maxZ: 30,
        indoor: true,
        surface: 'concrete',
      },
      {
        id: 'westCorridor',
        label: 'West corridor',
        minX: 5,
        maxX: 15,
        minZ: 0,
        maxZ: 40,
        indoor: true,
        surface: 'concrete',
      },
      {
        id: 'maintenance',
        label: 'Maintenance',
        minX: 15,
        maxX: 60,
        minZ: 30,
        maxZ: 40,
        indoor: true,
        surface: 'metal',
      },
      {
        id: 'dock',
        label: 'Loading dock',
        minX: 45,
        maxX: 60,
        minZ: 10,
        maxZ: 30,
        indoor: false,
        surface: 'asphalt',
      },
    ],
    // Only these three zones can be cut; the generator room (site A) and dock (site B) never lose power.
    panels: [
      { id: 'P-warehouse', zone: 'warehouse', pos: [44.2, 11] },
      { id: 'P-security', zone: 'security', pos: [16.2, 8.6] },
      { id: 'P-maintenance', zone: 'maintenance', pos: [58, 38.4] },
    ],
    doors: [
      {
        id: 'D-security-south',
        zone: 'security',
        box: { pos: [19, 0, 9.8], size: [2.5, 3, 0.4], mat: 'metal' },
      },
    ],
    objectives: [
      { id: 'A', center: [39, 8.2], radius: 1.6 }, // generator room
      { id: 'B', center: [52, 20], radius: 2.8 }, // loading dock
    ],
    // NOTE: first-pass positions; fairness must be tuned with playtests (Phase 6).
    spawns: {
      attackers: [
        [8, 36],
        [10, 37],
        [8, 38],
        [12, 37],
        [10, 34],
      ],
      defenders: [
        [56, 36],
        [58, 34],
        [54, 38],
        [57, 38],
        [52, 36],
      ],
    },
  };
}

export const MAP_01: MapDef = build();

/** Practice-target spots for the solo sandbox ([x, z]); all in open floor space. */
export const SANDBOX_TARGETS: readonly (readonly [number, number])[] = [
  [34, 25],
  [38.5, 16],
  [24, 21],
  [33, 13.5],
  [50, 24],
  [22, 38],
];
