import type { Hitscan, Hittable } from '../physics/Hitscan.ts';
import { RAPIER, type PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Health } from '../weapons/Health.ts';

const HEIGHT = 1.8;
const RADIUS = 0.35;

/** Stationary practice target: a solid capsule with health that respawns after a delay. */
export class TargetDummy implements Hittable {
  readonly feetY = 0;
  readonly height = HEIGHT;
  readonly health = new Health(100);
  /** Seconds since the last hit; drives the damage flash. */
  sinceHit = Infinity;
  private readonly collider: RAPIER.Collider;
  private respawnIn = 0;

  constructor(
    readonly id: number,
    readonly x: number,
    readonly z: number,
    private readonly hitscan: Hitscan,
    private readonly physics: PhysicsWorld,
    private readonly respawnSeconds = 3,
  ) {
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule((HEIGHT - 2 * RADIUS) / 2, RADIUS).setTranslation(
        x,
        HEIGHT / 2,
        z,
      ),
    );
    hitscan.register(this.collider, this);
    physics.refreshQueries();
  }

  get alive(): boolean {
    return this.health.alive;
  }

  applyDamage(amount: number): { dealt: number; killed: boolean } {
    const r = this.health.takeDamage(amount);
    if (r.dealt > 0) this.sinceHit = 0;
    if (r.killed) {
      this.collider.setEnabled(false);
      this.physics.refreshQueries();
      this.respawnIn = this.respawnSeconds;
    }
    return r;
  }

  update(dt: number): void {
    this.sinceHit += dt;
    if (!this.alive) {
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) {
        this.health.reset();
        this.collider.setEnabled(true);
        this.physics.refreshQueries();
      }
    }
  }

  dispose(): void {
    this.hitscan.unregister(this.collider);
  }
}
