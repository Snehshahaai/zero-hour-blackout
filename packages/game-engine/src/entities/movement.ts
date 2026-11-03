export interface Vec2 {
  x: number;
  z: number;
}

/** Tunable movement constants (metres, seconds). Shared by client prediction and, later, the server. */
export const MOVEMENT = {
  walkSpeed: 4.0,
  sprintSpeed: 6.2,
  crouchSpeed: 2.0,
  groundAccel: 45,
  groundDecel: 35,
  airAccel: 8,
  airDecel: 0.5,
  gravity: 22,
  jumpSpeed: 6.4,
  /** Jump presses slightly before landing still count. */
  jumpBufferSeconds: 0.1,
  /** Jump presses slightly after leaving a ledge still count. */
  coyoteSeconds: 0.08,
  standHeight: 1.8,
  crouchHeight: 1.2,
  radius: 0.35,
  standEye: 1.65,
  crouchEye: 1.1,
  /** How fast the eye height eases between stand and crouch (1/s). */
  eyeSmoothing: 14,
  maxFallSpeed: 40,
} as const;

/**
 * Moves `vel` toward `wish * targetSpeed` by at most `accel * dt` (or `decel * dt` when there
 * is no input). Linear acceleration keeps movement responsive but weighty.
 */
export function accelerate(
  vel: Vec2,
  wish: Vec2,
  targetSpeed: number,
  accel: number,
  decel: number,
  dt: number,
): Vec2 {
  const hasInput = wish.x !== 0 || wish.z !== 0;
  const tx = hasInput ? wish.x * targetSpeed : 0;
  const tz = hasInput ? wish.z * targetSpeed : 0;
  const dx = tx - vel.x;
  const dz = tz - vel.z;
  const dist = Math.hypot(dx, dz);
  const maxStep = (hasInput ? accel : decel) * dt;
  if (dist <= maxStep || dist === 0) return { x: tx, z: tz };
  const k = maxStep / dist;
  return { x: vel.x + dx * k, z: vel.z + dz * k };
}

/**
 * World-space unit wish direction from input axes and camera yaw.
 * Yaw 0 looks toward -Z (Three.js convention); `forward`/`right` are in [-1, 1].
 */
export function wishDirection(forward: number, right: number, yaw: number): Vec2 {
  const len = Math.hypot(forward, right);
  if (len === 0) return { x: 0, z: 0 };
  const f = forward / len;
  const r = right / len;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return { x: -sin * f + cos * r, z: -cos * f - sin * r };
}
