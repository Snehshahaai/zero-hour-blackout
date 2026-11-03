/** Pure touch-input model (no DOM), so the maths is unit-testable. */

export const STICK_DEAD_ZONE = 0.15;
/** Stick deflection above which the player sprints (push the stick all the way). */
export const SPRINT_THRESHOLD = 0.92;
/** Axis value above which a stick direction counts as "pressed" for the digital game inputs. */
export const AXIS_PRESS = 0.35;

export interface StickValue {
  /** -1 (left) .. 1 (right) */
  x: number;
  /** -1 (back) .. 1 (forward) */
  y: number;
  /** 0..1 deflection */
  magnitude: number;
}

/**
 * Converts a thumb offset from the stick centre (screen pixels, y grows downward) to normalised
 * axes. Inside the dead zone nothing moves; deflection is rescaled so it still reaches 1.
 */
export function stickAxes(dx: number, dy: number, radius: number): StickValue {
  const dist = Math.hypot(dx, dy);
  const raw = Math.min(1, radius > 0 ? dist / radius : 0);
  if (raw <= STICK_DEAD_ZONE || dist === 0) return { x: 0, y: 0, magnitude: 0 };
  const scaled = (raw - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE);
  const ux = dx / dist;
  const uy = dy / dist;
  return { x: ux * scaled, y: -uy * scaled, magnitude: scaled };
}

/** Everything the on-screen controls write and the game loop reads. */
export class TouchState {
  moveX = 0;
  moveY = 0;
  magnitude = 0;
  fire = false;
  crouch = false;
  interact = false;
  private lookX = 0;
  private lookY = 0;
  private jump = false;
  private reload = false;
  /** Pixels of finger travel -> mouse-equivalent pixels (touch needs more gain than a mouse). */
  lookGain = 1.9;

  setStick(v: StickValue): void {
    this.moveX = v.x;
    this.moveY = v.y;
    this.magnitude = v.magnitude;
  }

  addLook(dxPx: number, dyPx: number): void {
    this.lookX += dxPx * this.lookGain;
    this.lookY += dyPx * this.lookGain;
  }

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookX, dy: this.lookY };
    this.lookX = this.lookY = 0;
    return r;
  }

  pressJump(): void {
    this.jump = true;
  }
  consumeJump(): boolean {
    const j = this.jump;
    this.jump = false;
    return j;
  }
  pressReload(): void {
    this.reload = true;
  }
  consumeReload(): boolean {
    const r = this.reload;
    this.reload = false;
    return r;
  }

  /** Digital view of the keyboard-style codes the game loop asks for. */
  isDown(code: string): boolean {
    switch (code) {
      case 'KeyW':
        return this.moveY > AXIS_PRESS;
      case 'KeyS':
        return this.moveY < -AXIS_PRESS;
      case 'KeyD':
        return this.moveX > AXIS_PRESS;
      case 'KeyA':
        return this.moveX < -AXIS_PRESS;
      case 'ShiftLeft':
        // Pressing Fire drops you out of the sprint (sprinting blocks firing), so a thumb that is
        // pushing the stick all the way forward can still shoot without letting go first.
        return this.magnitude >= SPRINT_THRESHOLD && this.moveY > AXIS_PRESS && !this.fire;
      case 'ControlLeft':
        return this.crouch;
      case 'KeyE':
        return this.interact;
      default:
        return false;
    }
  }

  reset(): void {
    this.moveX = this.moveY = this.magnitude = 0;
    this.fire = this.crouch = this.interact = false;
    this.lookX = this.lookY = 0;
    this.jump = this.reload = false;
  }
}
