import { RAPIER, type PhysicsWorld } from './PhysicsWorld.ts';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Anything a bullet can hurt. Its collider must be registered with `Hitscan.register`. */
export interface Hittable {
  readonly id: number;
  readonly feetY: number;
  readonly height: number;
}

export type HitResult =
  | { kind: 'miss' }
  | { kind: 'world'; point: Point3; normal: Point3; distance: number }
  | {
      kind: 'target';
      target: Hittable;
      point: Point3;
      normal: Point3;
      distance: number;
      headshot: boolean;
    };

/** Top fraction of a target's height that counts as a headshot. */
export const HEAD_FRACTION = 0.18;

/** Instant-hit ray queries against static map geometry and registered targets. */
export class Hitscan {
  private readonly targets = new Map<number, Hittable>();

  constructor(private readonly physics: PhysicsWorld) {}

  register(collider: RAPIER.Collider, target: Hittable): void {
    this.targets.set(collider.handle, target);
  }

  unregister(collider: RAPIER.Collider): void {
    this.targets.delete(collider.handle);
  }

  /** `dir` must be normalised. `exclude` is usually the shooter's own collider. */
  cast(origin: Point3, dir: Point3, maxDistance: number, exclude?: RAPIER.Collider): HitResult {
    const hit = this.physics.world.castRayAndGetNormal(
      new RAPIER.Ray(origin, dir),
      maxDistance,
      true,
      undefined,
      undefined,
      exclude,
    );
    if (!hit) return { kind: 'miss' };
    const point = {
      x: origin.x + dir.x * hit.timeOfImpact,
      y: origin.y + dir.y * hit.timeOfImpact,
      z: origin.z + dir.z * hit.timeOfImpact,
    };
    const normal = { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z };
    const target = this.targets.get(hit.collider.handle);
    if (!target) return { kind: 'world', point, normal, distance: hit.timeOfImpact };
    const headshot = point.y - target.feetY > target.height * (1 - HEAD_FRACTION);
    return { kind: 'target', target, point, normal, distance: hit.timeOfImpact, headshot };
  }
}

/** Unit view direction for yaw/pitch (Three.js convention: yaw 0 looks toward -Z). */
export function viewDirection(yaw: number, pitch: number, dx = 0, dy = 0): Point3 {
  const cp = Math.cos(pitch);
  const f = { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
  const r = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  // up = right x forward
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const x = f.x + r.x * dx + u.x * dy;
  const y = f.y + r.y * dx + u.y * dy;
  const z = f.z + r.z * dx + u.z * dy;
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
}
