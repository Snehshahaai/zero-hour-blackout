import { MAP_01, initPhysics } from '@zhb/game-engine/sim';
import type { InputMessage } from '@zhb/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchSim, type SimEvent } from './MatchSim.ts';

beforeAll(async () => {
  await initPhysics();
});

let seq = 0;
const input = (over: Partial<InputMessage> = {}, sim?: MatchSim): InputMessage => ({
  seq: seq++,
  forward: 0,
  right: 0,
  jump: false,
  sprint: false,
  crouch: false,
  fire: false,
  reload: false,
  yaw: 0,
  pitch: 0,
  renderTime: sim ? sim.timeMs : 0,
  ...over,
});

function setup() {
  const events: SimEvent[] = [];
  const sim = new MatchSim(MAP_01, (e) => events.push(e));
  const a = sim.addPlayer('A', 'Alice', 'attackers');
  const d = sim.addPlayer('D', 'Dave', 'defenders');
  return { sim, a, d, events };
}
const idle = (sim: MatchSim, n: number) => {
  for (let i = 0; i < n; i++) sim.step();
};
/** Yaw/pitch that aim from `from` at `to` (Three.js convention). */
function aim(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(to.y - from.y, Math.hypot(dx, dz)) };
}

describe('MatchSim movement', () => {
  it('applies one input per tick and moves at walk speed', () => {
    const { sim, a } = setup();
    a.controller.teleport(33, 0.05, 24);
    idle(sim, 30);
    const z0 = a.controller.state.z;
    for (let i = 0; i < 60; i++) {
      sim.queueInput('A', input({ forward: 1 }));
      sim.step();
    }
    const dist = Math.abs(a.controller.state.z - z0);
    expect(dist).toBeGreaterThan(3.2);
    expect(dist).toBeLessThan(4.1);
  });

  it('cannot be sped up by flooding inputs (one consumed per tick, queue capped)', () => {
    const { sim, a } = setup();
    a.controller.teleport(33, 0.05, 24);
    idle(sim, 30);
    const z0 = a.controller.state.z;
    for (let i = 0; i < 500; i++) sim.queueInput('A', input({ forward: 1 }));
    expect(a.queue.length).toBeLessThanOrEqual(8);
    for (let i = 0; i < 10; i++) sim.step();
    expect(Math.abs(a.controller.state.z - z0)).toBeLessThan(0.7); // 10 ticks, not 500
  });

  it('absorbs a short jitter burst, but an idle player is not simulated or sped up', () => {
    const { sim, a } = setup();
    a.controller.teleport(33, 0.05, 24);
    idle(sim, 30);
    const z0 = a.controller.state.z;
    idle(sim, 3); // client stalled for 3 ticks: nothing queued, nothing simulated
    expect(a.controller.state.z).toBeCloseTo(z0, 3);
    const burst = [input({ forward: 1 }), input({ forward: 1 }), input({ forward: 1 })];
    burst.forEach((m) => sim.queueInput('A', m));
    sim.step(); // saved-up credit lets all 3 through at once
    expect(a.ackSeq).toBe(burst[2]?.seq);
    expect(a.queue.length).toBe(0);
  });

  it('acknowledges the last processed input sequence', () => {
    const { sim, a } = setup();
    const i1 = input();
    const i2 = input();
    sim.queueInput('A', i1);
    sim.queueInput('A', i2);
    sim.step();
    expect(a.ackSeq).toBe(i1.seq);
    sim.step();
    expect(a.ackSeq).toBe(i2.seq);
  });
});

describe('MatchSim combat', () => {
  function duel() {
    const ctx = setup();
    // Open floor in the warehouse, victim 8 m north of the shooter.
    ctx.a.controller.teleport(33, 0.05, 24);
    ctx.d.controller.teleport(33, 0.05, 16);
    idle(ctx.sim, 30);
    return ctx;
  }
  const eyeOf = (p: {
    controller: { state: { x: number; y: number; z: number; eyeHeight: number } };
  }) => ({
    x: p.controller.state.x,
    y: p.controller.state.y + p.controller.state.eyeHeight,
    z: p.controller.state.z,
  });

  it('server resolves a body hit and applies damage', () => {
    const { sim, a, d, events } = duel();
    const { yaw, pitch } = aim(eyeOf(a), { x: 33, y: 1.0, z: 16 });
    sim.queueInput('A', input({ yaw, pitch, fire: true }, sim));
    sim.step();
    expect(events.some((e) => e.type === 'hit')).toBe(true);
    expect(d.health.current).toBeLessThan(100);
    expect(d.health.current).toBeGreaterThanOrEqual(100 - 54 - 1);
  });

  it('headshots hurt more than body shots', () => {
    const body = duel();
    const bAim = aim(eyeOf(body.a), { x: 33, y: 1.0, z: 16 });
    body.sim.queueInput('A', input({ ...bAim, fire: true }, body.sim));
    body.sim.step();
    const head = duel();
    const hAim = aim(eyeOf(head.a), { x: 33, y: 1.7, z: 16 });
    head.sim.queueInput('A', input({ ...hAim, fire: true }, head.sim));
    head.sim.step();
    expect(head.d.health.current).toBeLessThan(body.d.health.current);
  });

  it('no friendly fire; walls block shots', () => {
    const { sim, a } = setup();
    const mate = sim.addPlayer('M', 'Mate', 'attackers');
    a.controller.teleport(33, 0.05, 24);
    mate.controller.teleport(33, 0.05, 16);
    idle(sim, 30);
    const ang = aim(eyeOf(a), { x: 33, y: 1.0, z: 16 });
    sim.queueInput('A', input({ ...ang, fire: true }, sim));
    sim.step();
    expect(mate.health.current).toBe(100);

    const w = setup();
    w.a.controller.teleport(33, 0.05, 24);
    w.d.controller.teleport(33, 0.05, 5); // behind the warehouse north wall (z = 10)
    idle(w.sim, 30);
    const wAng = aim(eyeOf(w.a), { x: 33, y: 1.0, z: 5 });
    w.sim.queueInput('A', input({ ...wAng, fire: true }, w.sim));
    w.sim.step();
    expect(w.d.health.current).toBe(100);
  });

  it('kills, scores, and respawns the victim after the delay', () => {
    const { sim, a, d, events } = duel();
    const ang = aim(eyeOf(a), { x: 33, y: 1.7, z: 16 });
    for (let i = 0; i < 90 && d.alive; i++) {
      sim.queueInput('A', input({ ...ang, fire: true }, sim));
      sim.step();
    }
    expect(d.alive).toBe(false);
    expect(events.some((e) => e.type === 'kill')).toBe(true);
    expect(a.kills).toBe(1);
    expect(d.deaths).toBe(1);
    idle(sim, 200); // 3 s respawn
    expect(d.alive).toBe(true);
    expect(d.health.current).toBe(100);
    expect(d.weapon.ammo).toBe(30);
  });

  it('dead players cannot be hit and cannot act', () => {
    const { sim, a, d } = duel();
    d.alive = false;
    d.respawnIn = 10;
    d.controller.setEnabled(false);
    const ang = aim(eyeOf(a), { x: 33, y: 1.0, z: 16 });
    sim.queueInput('A', input({ ...ang, fire: true }, sim));
    sim.queueInput('D', input({ forward: 1 }, sim));
    const before = { ...d.controller.state };
    sim.step();
    expect(d.health.current).toBe(100);
    expect(d.controller.state.z).toBe(before.z);
  });

  it('lag compensation: a shot at where the target WAS hits only when rewound to that time', () => {
    const run = (useRenderTime: boolean) => {
      const { sim, a, d } = setup();
      a.controller.teleport(33, 0.05, 24);
      d.controller.teleport(33, 0.05, 16);
      idle(sim, 30);
      const seenAtMs = sim.timeMs; // shooter's view: Dave standing at x = 33
      for (let i = 0; i < 12; i++) {
        sim.queueInput('D', input({ right: 1 }, sim)); // ~0.8 m east in 0.2 s
        sim.step();
      }
      expect(d.controller.state.x).toBeGreaterThan(33.6); // ray at x=33 now misses his capsule
      const ang = aim(eyeOf(a), { x: 33, y: 1.0, z: 16 });
      sim.queueInput(
        'A',
        input({ ...ang, fire: true, renderTime: useRenderTime ? seenAtMs : sim.timeMs }, sim),
      );
      sim.step();
      return d.health.current;
    };
    expect(run(true)).toBeLessThan(100); // rewound: hit
    expect(run(false)).toBe(100); // no rewind: miss
  });

  it('rewind is capped: ancient render times cannot reach further back than 250 ms', () => {
    const { sim, a, d } = setup();
    a.controller.teleport(33, 0.05, 24);
    d.controller.teleport(33, 0.05, 16);
    idle(sim, 30);
    const longAgo = sim.timeMs;
    for (let i = 0; i < 60; i++) {
      sim.queueInput('D', input({ right: 1 }, sim)); // 1 s of sidestepping
      sim.step();
    }
    const ang = aim(eyeOf(a), { x: 33, y: 1.0, z: 16 });
    sim.queueInput('A', input({ ...ang, fire: true, renderTime: longAgo }, sim));
    sim.step();
    expect(d.health.current).toBe(100);
  });
});
