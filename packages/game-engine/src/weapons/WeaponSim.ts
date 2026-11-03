import type { WeaponDef } from './WeaponDef.ts';

export interface TriggerInput {
  /** Trigger is held this tick. */
  trigger: boolean;
  /** Trigger went down this tick (edge). */
  triggerPressed: boolean;
  reloadPressed: boolean;
}

export interface Stance {
  /** Horizontal speed in m/s. */
  speed: number;
  grounded: boolean;
  crouching: boolean;
}

export type WeaponEvent =
  | {
      type: 'fired';
      shotIndex: number;
      /** Cone half-angle (radians) in effect for this shot. */
      spread: number;
      /** Deterministic aim offset within the cone, in tangent-plane radians. */
      offset: { dx: number; dy: number };
      /** View recoil *before* this shot's kick is applied. */
      recoil: { pitch: number; yaw: number };
    }
  | { type: 'dry' }
  | { type: 'reloadStart' }
  | { type: 'reloadDone' };

/** Small, fast, deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Authoritative-style weapon state machine. Pure simulation (no rendering, audio or DOM),
 * driven by fixed-step `update`. The same class will run on the server.
 */
export class WeaponSim {
  ammo: number;
  reserve: number;
  reloading = false;
  /** Accumulated view recoil in radians (positive pitch = up). */
  readonly recoil = { pitch: 0, yaw: 0 };
  private reloadLeft = 0;
  private cooldown = 0;
  private bloom = 0;
  private burstIndex = 0;
  private sinceShot = Infinity;
  private shotCounter = 0;

  constructor(
    readonly def: WeaponDef,
    private readonly seed = 1,
  ) {
    this.ammo = def.magSize;
    this.reserve = def.reserveMax;
  }

  get reloadProgress(): number {
    return this.reloading ? 1 - this.reloadLeft / this.def.reloadSeconds : 0;
  }

  currentSpread(stance: Stance): number {
    const s = this.def.spread;
    let spread = s.base + this.bloom;
    spread += s.moving * Math.min(1.5, stance.speed / s.refSpeed);
    if (!stance.grounded) spread += s.air;
    if (stance.crouching) spread *= s.crouchMultiplier;
    return spread;
  }

  update(dt: number, input: TriggerInput, stance: Stance): WeaponEvent[] {
    const events: WeaponEvent[] = [];
    const def = this.def;

    this.sinceShot += dt;
    this.cooldown = Math.max(this.cooldown - dt, -dt); // never bank more than one tick of lead
    this.bloom = Math.max(0, this.bloom - def.spread.bloomDecay * dt);
    if (this.sinceShot > def.recoil.recoverDelay) {
      const k = Math.exp(-def.recoil.recoverRate * dt);
      this.recoil.pitch *= k;
      this.recoil.yaw *= k;
    }
    if (this.sinceShot > def.recoil.resetDelay) this.burstIndex = 0;

    if (this.reloading) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        const take = Math.min(def.magSize - this.ammo, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.reloading = false;
        events.push({ type: 'reloadDone' });
      }
      return events;
    }

    if (input.reloadPressed && this.startReload()) events.push({ type: 'reloadStart' });

    const wantsFire = def.auto ? input.trigger : input.triggerPressed;
    if (!wantsFire || this.reloading) return events;

    if (this.ammo <= 0) {
      if (input.triggerPressed) {
        events.push({ type: 'dry' });
        if (this.startReload()) events.push({ type: 'reloadStart' });
      }
      return events;
    }
    if (this.cooldown > 0) return events;

    // Fire.
    const spread = this.currentSpread(stance);
    const rand = mulberry32((this.seed * 0x9e3779b1 + this.shotCounter * 0x85ebca6b) >>> 0);
    const angle = rand() * Math.PI * 2;
    const radius = spread * Math.sqrt(rand());
    events.push({
      type: 'fired',
      shotIndex: this.shotCounter,
      spread,
      offset: { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius },
      recoil: { pitch: this.recoil.pitch, yaw: this.recoil.yaw },
    });
    this.shotCounter++;
    this.ammo--;
    this.cooldown += 60 / def.rpm;
    this.sinceShot = 0;
    this.bloom = Math.min(def.spread.bloomMax, this.bloom + def.spread.bloomPerShot);
    const kick = def.recoil.pattern[Math.min(this.burstIndex, def.recoil.pattern.length - 1)];
    if (kick) {
      this.recoil.pitch += kick[0];
      this.recoil.yaw += kick[1];
    }
    this.burstIndex++;
    return events;
  }

  private startReload(): boolean {
    if (this.reloading || this.ammo >= this.def.magSize || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadLeft = this.def.reloadSeconds;
    return true;
  }

  refill(): void {
    this.ammo = this.def.magSize;
    this.reserve = this.def.reserveMax;
    this.reloading = false;
  }
}
