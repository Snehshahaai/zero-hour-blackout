export interface WeaponDef {
  id: string;
  name: string;
  /** Body damage at point blank. */
  damage: number;
  headshotMultiplier: number;
  rpm: number;
  magSize: number;
  reserveMax: number;
  reloadSeconds: number;
  auto: boolean;
  range: number;
  /** Damage is full up to `falloffStart` metres, then fades to `minDamageFraction` at `falloffEnd`. */
  falloffStart: number;
  falloffEnd: number;
  minDamageFraction: number;
  /** Cone half-angles in radians. */
  spread: {
    base: number;
    /** Added at full walking speed (scaled by speed / `refSpeed`). */
    moving: number;
    refSpeed: number;
    air: number;
    crouchMultiplier: number;
    bloomPerShot: number;
    bloomMax: number;
    /** Radians of bloom recovered per second. */
    bloomDecay: number;
  };
  recoil: {
    /** Per-shot view kick [pitch up, yaw] in radians; the last entry repeats. */
    pattern: readonly (readonly [number, number])[];
    recoverDelay: number;
    /** Exponential recovery rate (1/s) once `recoverDelay` has passed. */
    recoverRate: number;
    /** Seconds without firing after which the pattern restarts. */
    resetDelay: number;
  };
}

const deg = (d: number) => (d * Math.PI) / 180;

/** Original design: "HX-27 Rifle", a controllable full-auto assault rifle. */
export const HX27: WeaponDef = {
  id: 'hx27',
  name: 'HX-27',
  damage: 27,
  headshotMultiplier: 2,
  rpm: 700,
  magSize: 30,
  reserveMax: 120,
  reloadSeconds: 2.4,
  auto: true,
  range: 200,
  falloffStart: 30,
  falloffEnd: 90,
  minDamageFraction: 0.65,
  spread: {
    base: deg(0.1),
    moving: deg(1.1),
    refSpeed: 4,
    air: deg(2.5),
    crouchMultiplier: 0.6,
    bloomPerShot: deg(0.06),
    bloomMax: deg(0.7),
    bloomDecay: deg(2.5),
  },
  recoil: {
    pattern: [
      [deg(0.8), deg(0.0)],
      [deg(0.85), deg(0.05)],
      [deg(0.8), deg(-0.1)],
      [deg(0.75), deg(0.15)],
      [deg(0.7), deg(0.2)],
      [deg(0.6), deg(0.1)],
      [deg(0.5), deg(-0.15)],
      [deg(0.45), deg(-0.25)],
      [deg(0.4), deg(-0.2)],
      [deg(0.35), deg(0.1)],
      [deg(0.3), deg(0.2)],
      [deg(0.3), deg(0.15)],
    ],
    recoverDelay: 0.12,
    recoverRate: 9,
    resetDelay: 0.3,
  },
};
