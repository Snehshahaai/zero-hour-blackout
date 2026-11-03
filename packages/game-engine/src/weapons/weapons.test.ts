import { describe, expect, it } from 'vitest';
import { computeDamage } from './damage.ts';
import { Health } from './Health.ts';
import { HX27 } from './WeaponDef.ts';
import { WeaponSim, type Stance, type WeaponEvent } from './WeaponSim.ts';

const DT = 1 / 60;
const still: Stance = { speed: 0, grounded: true, crouching: false };
const hold = { trigger: true, triggerPressed: false, reloadPressed: false };
const none = { trigger: false, triggerPressed: false, reloadPressed: false };

function run(w: WeaponSim, ticks: number, input = hold, stance = still): WeaponEvent[] {
  const out: WeaponEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...w.update(DT, input, stance));
  return out;
}
const shots = (e: WeaponEvent[]) => e.filter((x) => x.type === 'fired').length;

describe('WeaponSim', () => {
  it('fires at the configured rate (700 rpm ~ 11-12 shots in 1 s)', () => {
    const w = new WeaponSim(HX27);
    const n = shots(run(w, 60, { ...hold, triggerPressed: true }));
    expect(n).toBeGreaterThanOrEqual(11);
    expect(n).toBeLessThanOrEqual(12);
    expect(w.ammo).toBe(30 - n);
  });

  it('empties the magazine, dry-fires, and auto-reloads from reserve', () => {
    const w = new WeaponSim(HX27);
    const ev = run(w, 300);
    expect(shots(ev)).toBe(30);
    expect(w.ammo).toBe(0);
    const dry = run(w, 1, { ...hold, triggerPressed: true });
    expect(dry.map((e) => e.type)).toEqual(['dry', 'reloadStart']);
    expect(w.reloading).toBe(true);
    // cannot fire while reloading
    expect(shots(run(w, 60))).toBe(0);
    run(w, 100, none);
    expect(w.reloading).toBe(false);
    expect(w.ammo).toBe(30);
    expect(w.reserve).toBe(90);
  });

  it('reload only tops up what is missing and never goes negative on reserve', () => {
    const w = new WeaponSim(HX27);
    run(w, 30);
    const fired = 30 - w.ammo;
    expect(fired).toBeGreaterThan(0);
    run(w, 1, { ...none, reloadPressed: true });
    run(w, 200, none);
    expect(w.ammo).toBe(30);
    expect(w.reserve).toBe(120 - fired);
    w.reserve = 5;
    w.ammo = 10;
    run(w, 1, { ...none, reloadPressed: true });
    run(w, 200, none);
    expect(w.ammo).toBe(15);
    expect(w.reserve).toBe(0);
  });

  it('does not start a reload with a full magazine', () => {
    const w = new WeaponSim(HX27);
    const ev = run(w, 1, { ...none, reloadPressed: true });
    expect(ev).toEqual([]);
    expect(w.reloading).toBe(false);
  });

  it('builds recoil while firing and recovers afterwards', () => {
    const w = new WeaponSim(HX27);
    run(w, 40);
    const peak = w.recoil.pitch;
    expect(peak).toBeGreaterThan(0.05);
    run(w, 120, none);
    expect(w.recoil.pitch).toBeLessThan(peak * 0.05);
  });

  it('is deterministic for the same seed, and spread grows when moving or airborne', () => {
    const a = run(new WeaponSim(HX27, 7), 30).filter((e) => e.type === 'fired');
    const b = run(new WeaponSim(HX27, 7), 30).filter((e) => e.type === 'fired');
    expect(a).toEqual(b);
    const w = new WeaponSim(HX27);
    const base = w.currentSpread(still);
    expect(w.currentSpread({ ...still, speed: 4 })).toBeGreaterThan(base * 3);
    expect(w.currentSpread({ ...still, grounded: false })).toBeGreaterThan(base * 3);
    expect(w.currentSpread({ ...still, crouching: true })).toBeLessThan(base);
  });

  it('keeps every shot offset inside the spread cone', () => {
    const w = new WeaponSim(HX27, 3);
    for (const e of run(w, 120, hold, { speed: 4, grounded: true, crouching: false })) {
      if (e.type !== 'fired') continue;
      expect(Math.hypot(e.offset.dx, e.offset.dy)).toBeLessThanOrEqual(e.spread + 1e-9);
    }
  });
});

describe('damage and health', () => {
  it('applies falloff and headshot multiplier', () => {
    expect(computeDamage(HX27, 10, false)).toBe(27);
    expect(computeDamage(HX27, 10, true)).toBe(54);
    expect(computeDamage(HX27, 90, false)).toBe(Math.round(27 * 0.65));
    expect(computeDamage(HX27, 500, false)).toBe(Math.round(27 * 0.65));
  });
  it('kills exactly once and ignores damage on the dead', () => {
    const h = new Health(100);
    expect(h.takeDamage(60)).toEqual({ dealt: 60, killed: false });
    expect(h.takeDamage(60)).toEqual({ dealt: 40, killed: true });
    expect(h.takeDamage(10)).toEqual({ dealt: 0, killed: false });
    h.reset();
    expect(h.current).toBe(100);
  });
  it('time-to-kill: 3 body shots leave 100 HP alive, 4 kill; 2 headshots kill', () => {
    const body = new Health(100);
    for (let i = 0; i < 3; i++) body.takeDamage(computeDamage(HX27, 10, false));
    expect(body.alive).toBe(true);
    body.takeDamage(computeDamage(HX27, 10, false));
    expect(body.alive).toBe(false);
    const head = new Health(100);
    for (let i = 0; i < 2; i++) head.takeDamage(computeDamage(HX27, 10, true));
    expect(head.alive).toBe(false);
  });
});
