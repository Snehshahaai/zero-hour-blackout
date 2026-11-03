import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { FIXED_DT, RAPIER } from '../physics/PhysicsWorld.ts';
import { accelerate, MOVEMENT, wishDirection } from './movement.ts';

export interface MoveInput {
  /** -1..1, positive is forward. */
  forward: number;
  /** -1..1, positive is right. */
  right: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  /** Camera yaw in radians. */
  yaw: number;
}

export interface PlayerState {
  /** Feet position. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  crouching: boolean;
  sprinting: boolean;
  eyeHeight: number;
}

const { radius, standHeight, crouchHeight } = MOVEMENT;
const halfFor = (total: number) => (total - 2 * radius) / 2;

/**
 * Kinematic first-person character: our own acceleration/gravity model on top of Rapier's
 * character controller for collision, stepping and ground detection.
 * Pure simulation: no DOM, no rendering, so it can be reused by the server.
 */
export class PlayerController {
  readonly state: PlayerState;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly standShape = new RAPIER.Capsule(halfFor(standHeight), radius - 0.02);
  private height: number = standHeight;
  private jumpBuffer = 0;
  private coyote = 0;

  constructor(
    private readonly physics: PhysicsWorld,
    feet: { x: number; y: number; z: number },
  ) {
    const { world } = physics;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        feet.x,
        feet.y + standHeight / 2,
        feet.z,
      ),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(halfFor(standHeight), radius),
      this.body,
    );
    this.controller = world.createCharacterController(0.01);
    this.controller.enableAutostep(0.3, 0.2, false);
    this.controller.enableSnapToGround(0.25);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    this.state = {
      ...feet,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: false,
      crouching: false,
      sprinting: false,
      eyeHeight: MOVEMENT.standEye,
    };
    world.step();
  }

  teleport(x: number, y: number, z: number): void {
    Object.assign(this.state, { x, y, z, vx: 0, vy: 0, vz: 0 });
    this.syncBody();
  }

  /** Advance one fixed step (`FIXED_DT`). */
  update(input: MoveInput): void {
    const dt = FIXED_DT;
    const s = this.state;

    this.updateCrouch(input.crouch);

    const moving = input.forward !== 0 || input.right !== 0;
    s.sprinting = input.sprint && !s.crouching && input.forward > 0 && s.grounded;
    const speed = s.crouching
      ? MOVEMENT.crouchSpeed
      : s.sprinting
        ? MOVEMENT.sprintSpeed
        : MOVEMENT.walkSpeed;
    const wish = moving ? wishDirection(input.forward, input.right, input.yaw) : { x: 0, z: 0 };
    const accel = s.grounded ? MOVEMENT.groundAccel : MOVEMENT.airAccel;
    const decel = s.grounded ? MOVEMENT.groundDecel : MOVEMENT.airDecel;
    const v = accelerate({ x: s.vx, z: s.vz }, wish, speed, accel, decel, dt);
    s.vx = v.x;
    s.vz = v.z;

    // Jump: buffered press + coyote time.
    this.jumpBuffer = input.jump ? MOVEMENT.jumpBufferSeconds : Math.max(0, this.jumpBuffer - dt);
    this.coyote = s.grounded ? MOVEMENT.coyoteSeconds : Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0 && !s.crouching) {
      s.vy = MOVEMENT.jumpSpeed;
      this.jumpBuffer = 0;
      this.coyote = 0;
      s.grounded = false;
    }

    if (!s.grounded || s.vy > 0)
      s.vy = Math.max(s.vy - MOVEMENT.gravity * dt, -MOVEMENT.maxFallSpeed);
    else s.vy = 0;

    this.controller.computeColliderMovement(this.collider, {
      x: s.vx * dt,
      y: s.vy * dt,
      z: s.vz * dt,
    });
    const m = this.controller.computedMovement();
    // Zero velocity components that were blocked so we don't build up speed against walls.
    if (Math.abs(m.x) < Math.abs(s.vx * dt) * 0.5) s.vx *= 0.5;
    if (Math.abs(m.z) < Math.abs(s.vz * dt) * 0.5) s.vz *= 0.5;
    if (s.vy > 0 && m.y < s.vy * dt * 0.5) s.vy = 0; // bumped head
    s.x += m.x;
    s.y += m.y;
    s.z += m.z;
    s.grounded = this.controller.computedGrounded();
    if (s.grounded && s.vy < 0) s.vy = 0;

    // Ease eye height toward the stance target.
    const targetEye = s.crouching ? MOVEMENT.crouchEye : MOVEMENT.standEye;
    s.eyeHeight += (targetEye - s.eyeHeight) * Math.min(1, MOVEMENT.eyeSmoothing * dt);

    this.syncBody();
    this.physics.world.step();
  }

  private updateCrouch(wantCrouch: boolean): void {
    const s = this.state;
    if (wantCrouch && !s.crouching) {
      this.setHeight(crouchHeight);
      s.crouching = true;
    } else if (!wantCrouch && s.crouching && this.hasHeadroom()) {
      this.setHeight(standHeight);
      s.crouching = false;
    }
  }

  private hasHeadroom(): boolean {
    const s = this.state;
    const hit = this.physics.world.intersectionWithShape(
      { x: s.x, y: s.y + standHeight / 2 + 0.02, z: s.z },
      { x: 0, y: 0, z: 0, w: 1 },
      this.standShape,
      undefined,
      undefined,
      this.collider,
    );
    return hit === null;
  }

  private setHeight(total: number): void {
    this.height = total;
    this.collider.setHalfHeight(halfFor(total));
    this.syncBody();
  }

  private syncBody(): void {
    const s = this.state;
    this.body.setTranslation({ x: s.x, y: s.y + this.height / 2, z: s.z }, true);
  }
}
