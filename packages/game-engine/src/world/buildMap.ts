import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  Vector3,
  Euler,
  type BufferGeometry,
  type Material,
} from 'three';
import { concreteTexture, metalTexture } from '../rendering/textures.ts';
import type { QualitySettings } from '../rendering/quality.ts';
import type { BoxDef, MapDef, MaterialId } from './MapData.ts';

const TILE = 2.5; // metres per texture repeat

export type ProgressFn = (fraction: number, label: string) => void;

export interface BuiltMap {
  root: Group;
  roofs: Mesh[];
  pointLights: PointLight[];
  objectiveMarkers: Mesh[];
  setAnisotropy(n: number): void;
  setPointLightCount(n: number): void;
  /** Cut/restore a zone's lights (cut = dim red emergency lighting). */
  setZoneCut(zone: string, cut: boolean): void;
  /** Show/hide a door shutter mesh. */
  setDoorClosed(id: string, closed: boolean): void;
  setShadows(enabled: boolean): void;
  dispose(): void;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Box whose UVs are scaled to world size so textures keep a constant texel density. */
function boxGeometry(w: number, h: number, d: number): BoxGeometry {
  const g = new BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  // Face order: +x, -x, +y, -y, +z, -z; 4 vertices each.
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [u, v] = dims[f] as [number, number];
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, (uv.getX(idx) * u) / TILE, (uv.getY(idx) * v) / TILE);
    }
  }
  uv.needsUpdate = true;
  return g;
}

export async function buildMap(
  def: MapDef,
  quality: QualitySettings,
  onProgress: ProgressFn = () => undefined,
): Promise<BuiltMap> {
  const root = new Group();
  root.name = def.name;

  onProgress(0.05, 'Generating materials');
  await nextFrame();
  const concrete = concreteTexture(150, 1);
  const concreteDark = concreteTexture(95, 2);
  const asphalt = concreteTexture(60, 3);
  const metal = metalTexture(120, 4);
  const textures = [concrete, concreteDark, asphalt, metal];

  const materials: Record<MaterialId, MeshStandardMaterial> = {
    concrete: new MeshStandardMaterial({ map: concrete, roughness: 0.92, metalness: 0 }),
    concreteDark: new MeshStandardMaterial({ map: concreteDark, roughness: 0.95, metalness: 0 }),
    asphalt: new MeshStandardMaterial({ map: asphalt, roughness: 1, metalness: 0 }),
    metal: new MeshStandardMaterial({ map: metal, roughness: 0.5, metalness: 0.3 }),
    crate: new MeshStandardMaterial({ color: 0x4b5a3a, roughness: 0.7, metalness: 0.2 }),
    glass: new MeshStandardMaterial({
      color: 0x9fc4d4,
      roughness: 0.05,
      metalness: 0.1,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    }),
  };
  const setAnisotropy = (n: number) => {
    for (const t of textures) {
      t.anisotropy = n;
      t.needsUpdate = true;
    }
  };
  setAnisotropy(quality.anisotropy);

  const geoms = new Map<string, BufferGeometry>();
  const geom = (key: string, make: () => BufferGeometry): BufferGeometry => {
    let g = geoms.get(key);
    if (!g) geoms.set(key, (g = make()));
    return g;
  };

  onProgress(0.2, 'Building structures');
  await nextFrame();
  const roofs: Mesh[] = [];
  const meshes: Mesh[] = [];
  const addBox = (b: BoxDef) => {
    const [w, h, d] = b.size;
    const g = geom(`b${w}|${h}|${d}`, () => boxGeometry(w, h, d));
    const m = new Mesh(g, materials[b.mat]);
    m.position.set(b.pos[0] + w / 2, b.pos[1] + h / 2, b.pos[2] + d / 2);
    m.castShadow = b.tag !== 'glass';
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    if (b.tag === 'roof') roofs.push(m);
    root.add(m);
    meshes.push(m);
  };
  def.boxes.forEach(addBox);

  for (const c of def.cylinders) {
    const m = new Mesh(
      geom(
        `c${c.radius}|${c.height}`,
        () => new CylinderGeometry(c.radius, c.radius, c.height, 16),
      ),
      materials[c.mat],
    );
    m.position.set(c.pos[0], c.pos[1] + c.height / 2, c.pos[2]);
    m.castShadow = m.receiveShadow = true;
    root.add(m);
    meshes.push(m);
  }

  onProgress(0.6, 'Placing props');
  await nextFrame();
  // Crates share one geometry and material and render in a single draw call.
  const crateGeo = new BoxGeometry(1, 1, 1);
  const crateMesh = new InstancedMesh(crateGeo, materials.crate, def.crates.length);
  const mtx = new Matrix4();
  def.crates.forEach((c, i) => {
    mtx.compose(
      new Vector3(c.x, c.size[1] / 2, c.z),
      new Quaternion().setFromEuler(new Euler(0, c.rotY, 0)),
      new Vector3(...c.size),
    );
    crateMesh.setMatrixAt(i, mtx);
  });
  crateMesh.castShadow = crateMesh.receiveShadow = true;
  root.add(crateMesh);

  onProgress(0.8, 'Lighting');
  await nextFrame();
  const lightInfo = new Map<PointLight, { zone: string; color: Color; intensity: number }>();
  const pointLights = def.lights.map((l) => {
    const p = new PointLight(new Color(l.color), l.intensity, l.distance, 2);
    p.position.set(...l.pos);
    root.add(p);
    lightInfo.set(p, { zone: l.zone, color: new Color(l.color), intensity: l.intensity });
    return p;
  });
  const emergency = new Color(0xff2a18);
  const setZoneCut = (zone: string, cut: boolean) => {
    for (const [light, info] of lightInfo) {
      if (info.zone !== zone) continue;
      light.color.copy(cut ? emergency : info.color);
      light.intensity = cut ? info.intensity * 0.18 : info.intensity;
    }
  };

  const doorMeshes = new Map<string, Mesh>();
  for (const d of def.doors) {
    const [w, h, dd] = d.box.size;
    const m = new Mesh(
      geom(`door${d.id}`, () => boxGeometry(w, h, dd)),
      materials[d.box.mat],
    );
    m.position.set(d.box.pos[0] + w / 2, d.box.pos[1] + h / 2, d.box.pos[2] + dd / 2);
    m.castShadow = m.receiveShadow = true;
    m.visible = false; // doors start open
    root.add(m);
    doorMeshes.set(d.id, m);
  }
  const setDoorClosed = (id: string, closed: boolean) => {
    const m = doorMeshes.get(id);
    if (m) m.visible = closed;
  };
  const setPointLightCount = (n: number) => pointLights.forEach((p, i) => (p.visible = i < n));
  setPointLightCount(quality.maxPointLights);

  // Objective markers: flat emissive discs on the floor.
  const markerMat = new MeshStandardMaterial({
    color: 0xe8a526,
    emissive: 0xe8a526,
    emissiveIntensity: 1.2,
    transparent: true,
    opacity: 0.55,
  });
  const objectiveMarkers = def.objectives.map((o) => {
    const m = new Mesh(new CylinderGeometry(o.radius, o.radius, 0.04, 40), markerMat);
    m.position.set(o.center[0], 0.03, o.center[1]);
    m.name = `objective-${o.id}`;
    root.add(m);
    return m;
  });

  onProgress(1, 'Ready');

  const setShadows = (enabled: boolean) => {
    for (const m of meshes) m.castShadow = m.receiveShadow = enabled;
    crateMesh.castShadow = crateMesh.receiveShadow = enabled;
  };

  return {
    root,
    roofs,
    pointLights,
    objectiveMarkers,
    setAnisotropy,
    setPointLightCount,
    setZoneCut,
    setDoorClosed,
    setShadows,
    dispose() {
      for (const g of geoms.values()) g.dispose();
      crateGeo.dispose();
      crateMesh.dispose();
      objectiveMarkers.forEach((m) => m.geometry.dispose());
      markerMat.dispose();
      for (const m of Object.values(materials) as Material[]) m.dispose();
      textures.forEach((t) => t.dispose());
    },
  };
}
