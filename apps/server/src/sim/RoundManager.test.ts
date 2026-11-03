import { MAP_01, initPhysics } from '@zhb/game-engine/sim';
import type { InputMessage } from '@zhb/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchSim } from './MatchSim.ts';
import { RoundManager, type RoundEvent } from './RoundManager.ts';

beforeAll(async () => {
  await initPhysics();
});

let seq = 0;
const input = (over: Partial<InputMessage> = {}): InputMessage => ({
  seq: seq++,
  forward: 0,
  right: 0,
  jump: false,
  sprint: false,
  crouch: false,
  fire: false,
  reload: false,
  interact: false,
  yaw: 0,
  pitch: 0,
  renderTime: 0,
  ...over,
});

const FAST = {
  freezeSeconds: 0.2,
  roundSeconds: 3,
  plantSeconds: 0.5,
  defuseSeconds: 0.5,
  fuseSeconds: 2,
  roundEndSeconds: 0.2,
  matchEndSeconds: 0.5,
  roundsToWin: 2,
  swapAfterRounds: 1,
};

function setup(rules: Partial<typeof FAST> = {}) {
  const events: RoundEvent[] = [];
  const sim = new MatchSim(MAP_01, () => undefined, null);
  const a = sim.addPlayer('A', 'Alice', 'attackers');
  const d = sim.addPlayer('D', 'Dave', 'defenders');
  const rm = new RoundManager(sim, MAP_01, (e) => events.push(e), { ...FAST, ...rules });
  rm.start();
  const run = (seconds: number, perTick?: () => void) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      perTick?.();
      sim.step();
      rm.step();
    }
  };
  const goLive = () => run(0.25);
  const kill = (p: typeof a) => {
    p.alive = false;
    p.controller.setEnabled(false);
  };
  const types = () => events.map((e) => e.type);
  return { sim, a, d, rm, events, run, goLive, kill, types };
}
const siteA = MAP_01.objectives[0]!;
const siteCenter = (o: typeof siteA) => ({ x: o.center[0], z: o.center[1] });

describe('round flow', () => {
  it('starts in freeze: players cannot move or shoot, then goes live', () => {
    const { sim, a, rm, run } = setup();
    expect(rm.phase).toBe('freeze');
    run(0.05);
    const before = { ...a.controller.state };
    sim.queueInput('A', input({ forward: 1, yaw: -Math.PI / 2 }));
    sim.step();
    expect(a.controller.state.x).toBe(before.x);
    run(0.25);
    expect(rm.phase).toBe('live');
  });

  it('attackers win by eliminating defenders; point goes to the attackers team', () => {
    const { rm, d, run, goLive, kill, events } = setup();
    goLive();
    kill(d);
    run(0.05);
    expect(rm.phase).toBe('roundEnd');
    expect(rm.scores).toEqual({ attackers: 1, defenders: 0 });
    expect(events.find((e) => e.type === 'roundEnd')).toMatchObject({
      winnerSide: 'attackers',
      reason: 'elimination',
    });
  });

  it('defenders win when attackers are eliminated before a plant, or when time runs out', () => {
    const t1 = setup();
    t1.goLive();
    t1.kill(t1.a);
    t1.run(0.05);
    expect(t1.rm.scores).toEqual({ attackers: 0, defenders: 1 });

    const t2 = setup();
    t2.goLive();
    t2.run(3.05);
    expect(t2.rm.phase).toBe('roundEnd');
    expect(t2.events.find((e) => e.type === 'roundEnd')).toMatchObject({ reason: 'time' });
    expect(t2.rm.scores).toEqual({ attackers: 0, defenders: 1 });
  });

  it('survivors respawn at full health in the next round', () => {
    const { rm, d, a, run, goLive, kill } = setup();
    goLive();
    kill(d);
    a.health.takeDamage(40);
    run(0.3);
    expect(rm.round).toBe(2);
    expect(rm.phase).toBe('freeze');
    expect(d.alive).toBe(true);
    expect(a.health.current).toBe(100);
  });
});

describe('bomb', () => {
  const plant = (ctx: ReturnType<typeof setup>, seconds = 0.7) => {
    const c = siteCenter(siteA);
    ctx.a.controller.teleport(c.x, 0.05, c.z);
    ctx.run(0.1);
    ctx.run(seconds, () => ctx.sim.queueInput('A', input({ interact: true })));
  };

  it('plants only inside a site, and only after holding for the full time', () => {
    const ctx = setup();
    ctx.goLive();
    ctx.a.controller.teleport(33, 0.05, 24); // open warehouse floor, not a site
    ctx.run(0.1);
    ctx.run(1, () => ctx.sim.queueInput('A', input({ interact: true })));
    expect(ctx.rm.bomb.planted).toBe(false);

    const c = siteCenter(siteA);
    ctx.a.controller.teleport(c.x, 0.05, c.z);
    ctx.run(0.1);
    ctx.run(0.3, () => ctx.sim.queueInput('A', input({ interact: true })));
    expect(ctx.rm.bomb.planted).toBe(false);
    expect(ctx.a.interactProgress).toBeGreaterThan(0.3);
    ctx.run(0.4, () => ctx.sim.queueInput('A', input({ interact: true })));
    expect(ctx.rm.bomb.planted).toBe(true);
    expect(ctx.rm.phase).toBe('planted');
    expect(ctx.rm.bomb.site).toBe(siteA.id);
  });

  it('releasing the key (or dying) resets plant progress', () => {
    const ctx = setup();
    ctx.goLive();
    const c = siteCenter(siteA);
    ctx.a.controller.teleport(c.x, 0.05, c.z);
    ctx.run(0.1);
    ctx.run(0.35, () => ctx.sim.queueInput('A', input({ interact: true })));
    ctx.run(0.1, () => ctx.sim.queueInput('A', input({ interact: false })));
    expect(ctx.a.interactProgress).toBe(0);
    ctx.run(0.35, () => ctx.sim.queueInput('A', input({ interact: true })));
    expect(ctx.rm.bomb.planted).toBe(false); // started over, 0.35 < 0.5
  });

  it('defenders cannot plant', () => {
    const ctx = setup();
    ctx.goLive();
    const c = siteCenter(siteA);
    ctx.d.controller.teleport(c.x, 0.05, c.z);
    ctx.run(0.1);
    ctx.run(1, () => ctx.sim.queueInput('D', input({ interact: true })));
    expect(ctx.rm.bomb.planted).toBe(false);
  });

  it('detonation: attackers win the round when the fuse runs out', () => {
    const ctx = setup();
    ctx.goLive();
    plant(ctx);
    expect(ctx.rm.bomb.planted).toBe(true);
    ctx.run(1.85); // fuse has ~1.8 s left after the plant completes
    expect(ctx.rm.phase).toBe('roundEnd');
    expect(ctx.events.find((e) => e.type === 'roundEnd')).toMatchObject({
      winnerSide: 'attackers',
      reason: 'detonation',
    });
    expect(ctx.events.some((e) => e.type === 'bomb' && e.event === 'exploded')).toBe(true);
  });

  it('defuse: defenders must stand at the bomb for the full time, then win', () => {
    const ctx = setup({ fuseSeconds: 5 });
    ctx.goLive();
    plant(ctx);
    const c = siteCenter(siteA);
    ctx.d.controller.teleport(c.x + 8, 0.05, c.z); // too far
    ctx.run(0.1);
    ctx.run(1, () => ctx.sim.queueInput('D', input({ interact: true })));
    expect(ctx.rm.phase).toBe('planted');
    ctx.d.controller.teleport(c.x + 1, 0.05, c.z);
    ctx.run(0.1);
    ctx.run(0.7, () => ctx.sim.queueInput('D', input({ interact: true })));
    expect(ctx.rm.phase).toBe('roundEnd');
    expect(ctx.events.find((e) => e.type === 'roundEnd')).toMatchObject({
      winnerSide: 'defenders',
      reason: 'defused',
    });
  });

  it('after a plant, eliminating defenders wins for attackers; attackers dying does not end the round', () => {
    const t1 = setup({ fuseSeconds: 5 });
    t1.goLive();
    plant(t1);
    t1.kill(t1.a);
    t1.run(0.2);
    expect(t1.rm.phase).toBe('planted'); // bomb still ticking, defenders must defuse
    const t2 = setup({ fuseSeconds: 5 });
    t2.goLive();
    plant(t2);
    t2.kill(t2.d);
    t2.run(0.1);
    expect(t2.rm.phase).toBe('roundEnd');
  });
});

describe('match flow', () => {
  it('swaps sides at halftime but score stays with the teams', () => {
    const ctx = setup();
    ctx.goLive();
    ctx.kill(ctx.d); // round 1: attackers (team attackers) win
    ctx.run(0.5);
    expect(ctx.events.some((e) => e.type === 'halftime')).toBe(true);
    expect(ctx.rm.swapped).toBe(true);
    expect(ctx.a.side).toBe('defenders');
    expect(ctx.d.side).toBe('attackers');
    ctx.run(0.25); // round 2 live; Dave (now attacker side) kills Alice
    ctx.kill(ctx.a);
    ctx.run(0.1);
    // Alice's team is the *defenders* side now, so Dave's team (defenders team) wins round 2
    expect(ctx.rm.scores).toEqual({ attackers: 1, defenders: 1 });
  });

  it('first to roundsToWin wins the match; then the match is finished once', () => {
    const ctx = setup({ swapAfterRounds: 99, roundsToWin: 2 });
    for (let r = 0; r < 2; r++) {
      ctx.goLive();
      ctx.kill(ctx.d);
      ctx.run(0.45);
    }
    expect(ctx.rm.matchWinner).toBe('attackers');
    expect(ctx.rm.phase).toBe('matchEnd');
    ctx.run(1);
    expect(ctx.types().filter((t) => t === 'matchEnd')).toHaveLength(1);
    expect(ctx.types().filter((t) => t === 'finished')).toHaveLength(1);
    expect(ctx.events.find((e) => e.type === 'matchEnd')).toMatchObject({ reason: 'score' });
  });

  it('a team that loses all its players forfeits the match', () => {
    const ctx = setup();
    ctx.goLive();
    ctx.sim.removePlayer('D');
    ctx.run(0.05);
    expect(ctx.rm.phase).toBe('matchEnd');
    expect(ctx.rm.matchWinner).toBe('attackers');
    expect(ctx.events.find((e) => e.type === 'matchEnd')).toMatchObject({ reason: 'forfeit' });
  });
});
