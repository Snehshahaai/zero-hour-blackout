import type { WeaponDef } from './WeaponDef.ts';

/** Damage after range falloff and headshot multiplier, rounded to whole HP. */
export function computeDamage(def: WeaponDef, distance: number, headshot: boolean): number {
  const span = Math.max(1e-6, def.falloffEnd - def.falloffStart);
  const t = Math.min(1, Math.max(0, (distance - def.falloffStart) / span));
  const falloff = 1 - t * (1 - def.minDamageFraction);
  return Math.round(def.damage * falloff * (headshot ? def.headshotMultiplier : 1));
}
