import { describe, expect, it } from 'vitest';
import {
  AXIS_PRESS,
  SPRINT_THRESHOLD,
  STICK_DEAD_ZONE,
  TouchState,
  stickAxes,
} from './touchState.ts';

describe('stickAxes', () => {
  it('ignores the dead zone and reaches full deflection at the radius', () => {
    expect(stickAxes(0, 0, 60)).toEqual({ x: 0, y: 0, magnitude: 0 });
    expect(stickAxes(5, -5, 60).magnitude).toBe(0); // inside dead zone
    const full = stickAxes(0, -60, 60);
    expect(full.y).toBeCloseTo(1);
    expect(full.x).toBeCloseTo(0);
    expect(stickAxes(0, -600, 60).magnitude).toBeCloseTo(1); // clamped beyond the radius
  });

  it('screen up is forward, screen right is right; diagonals keep their direction', () => {
    expect(stickAxes(0, -40, 60).y).toBeGreaterThan(0);
    expect(stickAxes(0, 40, 60).y).toBeLessThan(0);
    expect(stickAxes(40, 0, 60).x).toBeGreaterThan(0);
    const d = stickAxes(40, -40, 80);
    expect(d.x).toBeGreaterThan(0);
    expect(d.y).toBeGreaterThan(0);
    expect(d.x).toBeCloseTo(d.y);
  });

  it('is continuous just outside the dead zone (no jump from 0)', () => {
    const justOut = stickAxes(60 * (STICK_DEAD_ZONE + 0.01), 0, 60);
    expect(justOut.magnitude).toBeLessThan(0.05);
  });
});

describe('TouchState', () => {
  it('maps the stick to the keyboard-style codes the game reads', () => {
    const t = new TouchState();
    t.setStick(stickAxes(0, -60, 60));
    expect(t.isDown('KeyW')).toBe(true);
    expect(t.isDown('KeyS')).toBe(false);
    expect(t.isDown('ShiftLeft')).toBe(true); // pushed all the way forward = sprint
    t.setStick(stickAxes(0, -30, 60)); // about half deflection
    expect(t.isDown('KeyW')).toBe(true);
    expect(t.isDown('ShiftLeft')).toBe(false); // walking
    t.setStick(stickAxes(-60, 0, 60));
    expect(t.isDown('KeyA')).toBe(true);
    expect(t.isDown('ShiftLeft')).toBe(false); // never sprint sideways/backwards
    expect(AXIS_PRESS).toBeLessThan(SPRINT_THRESHOLD);

    // Holding Fire cancels the sprint even with the stick fully forward.
    t.setStick(stickAxes(0, -60, 60));
    expect(t.isDown('ShiftLeft')).toBe(true);
    t.fire = true;
    expect(t.isDown('ShiftLeft')).toBe(false);
    expect(t.isDown('KeyW')).toBe(true); // still moving forward, just walking
  });

  it('buttons: crouch/interact are held states; jump/reload are one-shot edges', () => {
    const t = new TouchState();
    t.crouch = true;
    t.interact = true;
    expect(t.isDown('ControlLeft')).toBe(true);
    expect(t.isDown('KeyE')).toBe(true);
    t.pressJump();
    expect(t.consumeJump()).toBe(true);
    expect(t.consumeJump()).toBe(false);
    t.pressReload();
    expect(t.consumeReload()).toBe(true);
    expect(t.consumeReload()).toBe(false);
  });

  it('accumulates look movement with gain and consumes it once', () => {
    const t = new TouchState();
    t.addLook(10, -4);
    t.addLook(5, 0);
    const l = t.consumeLook();
    expect(l.dx).toBeCloseTo(15 * t.lookGain);
    expect(l.dy).toBeCloseTo(-4 * t.lookGain);
    expect(t.consumeLook()).toEqual({ dx: 0, dy: 0 });
  });

  it('reset clears everything (used when the player pauses)', () => {
    const t = new TouchState();
    t.setStick(stickAxes(0, -60, 60));
    t.fire = true;
    t.pressJump();
    t.addLook(3, 3);
    t.reset();
    expect(t.isDown('KeyW')).toBe(false);
    expect(t.fire).toBe(false);
    expect(t.consumeJump()).toBe(false);
    expect(t.consumeLook()).toEqual({ dx: 0, dy: 0 });
  });

  it('eases pending look movement over frames without losing any of it', () => {
    const t = new TouchState();
    t.addLook(100, 0);
    let total = 0;
    const first = t.consumeLook(1 / 60).dx;
    total += first;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(100 * t.lookGain); // not all at once
    for (let i = 0; i < 60; i++) total += t.consumeLook(1 / 60).dx;
    expect(total).toBeCloseTo(100 * t.lookGain, 0);
  });
});
