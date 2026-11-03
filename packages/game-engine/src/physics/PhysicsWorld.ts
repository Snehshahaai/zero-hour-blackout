import RAPIER from '@dimforge/rapier3d-compat';
import type { MapDef } from '../world/MapData.ts';

let initPromise: Promise<void> | null = null;
/** Rapier's WASM must be initialised exactly once per page. */
export function initPhysics(): Promise<void> {
  return (initPromise ??= RAPIER.init());
}

export const FIXED_DT = 1 / 60;

/** Static collision world built from a `MapDef`, plus a shared home for dynamic characters. */
export class PhysicsWorld {
  readonly world: RAPIER.World;

  private constructor(world: RAPIER.World) {
    this.world = world;
  }

  /** Call `initPhysics()` first. */
  static fromMap(map: MapDef): PhysicsWorld {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = FIXED_DT;

    for (const b of map.boxes) {
      const [w, h, d] = b.size;
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(
          b.pos[0] + w / 2,
          b.pos[1] + h / 2,
          b.pos[2] + d / 2,
        ),
      );
    }
    for (const c of map.cylinders) {
      world.createCollider(
        RAPIER.ColliderDesc.cylinder(c.height / 2, c.radius).setTranslation(
          c.pos[0],
          c.pos[1] + c.height / 2,
          c.pos[2],
        ),
      );
    }
    for (const c of map.crates) {
      const half = Math.sin(c.rotY / 2);
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(c.size[0] / 2, c.size[1] / 2, c.size[2] / 2)
          .setTranslation(c.x, c.size[1] / 2, c.z)
          .setRotation({ x: 0, y: half, z: 0, w: Math.cos(c.rotY / 2) }),
      );
    }
    world.step(); // builds the query pipeline so character queries see the static geometry
    return new PhysicsWorld(world);
  }

  /**
   * Rapier 0.21 only refreshes its query pipeline on `step()`. Call this after creating,
   * enabling or disabling a collider that ray/shape queries must see immediately.
   */
  refreshQueries(): void {
    this.world.step();
  }

  dispose(): void {
    this.world.free();
  }
}

export { RAPIER };
