import { MAP_01, initPhysics } from '@zhb/game-engine/sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { CoopMission, type MissionEvent } from './CoopMission.ts';
import { MatchSim } from './MatchSim.ts';

beforeAll(async () => {
  await initPhysics();
});

const FAST = { briefingSeconds: 0.1, holdSeconds: 0.5, resultSeconds: 0.2, timeLimitSeconds: 30 };

function setup(rules: Partial<typeof FAST> = {}) {
  const events: MissionEvent[] = [];
  const sim = new MatchSim(MAP_01, () => undefined, null);
  const op = sim.addPlayer('OP', 'Operator', 'attackers');
  const mission = new CoopMission(sim, MAP_01, (e) => events.push(e), { ...FAST, ...rules }, 5);
  mission.start();
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      sim.step();
      mission.step();
    }
  };
  const bots = () => [...sim.players.values()].filter((p) => p.isBot);
  const killBots = () => {
    for (const b of bots()) {
      b.alive = false;
      b.controller.setEnabled(false);
    }
  };
  const site = (id: 'A' | 'B') => MAP_01.objectives.find((o) => o.id === id)!;
  const stand = (id: 'A' | 'B') =>
    op.controller.teleport(site(id).center[0], 0.05, site(id).center[1]);
  const goActive = () => run(0.2);
  /** Make an objective-0 clear without the operator being shot while waiting. */
  const clearWave = () => {
    killBots();
    run(0.1);
  };
  return { sim, op, mission, events, run, bots, killBots, site, stand, goActive, clearWave };
}

describe('mission flow', () => {
  it('starts in briefing (frozen) with the first patrol wave, then goes active', () => {
    const { mission, sim, bots, goActive, events } = setup();
    expect(mission.state).toBe('briefing');
    expect(sim.frozen).toBe(true);
    expect(bots()).toHaveLength(4);
    expect(bots().every((b) => b.team === 'defenders')).toBe(true);
    goActive();
    expect(mission.state).toBe('active');
    expect(sim.frozen).toBe(false);
    expect(events).toContainEqual({
      type: 'mission',
      event: 'objective',
      index: 0,
      label: 'Eliminate the hostile patrols',
    });
  });

  it('clearing the patrols advances to objective 2 and brings in reinforcements', () => {
    const t = setup();
    t.goActive();
    t.op.controller.teleport(9, 0.05, 36.5);
    t.clearWave();
    expect(t.mission.objective).toBe(1);
    expect(t.mission.label).toBe('Secure the generator room');
    expect(t.bots().filter((b) => b.alive)).toHaveLength(2);
  });

  it('holding a site (alone, uncontested) secures it; leaving makes progress decay', () => {
    const t = setup();
    t.goActive();
    t.clearWave();
    t.killBots(); // wave 2 arrives; remove it so the hold is uncontested
    t.stand('A');
    t.run(0.3);
    expect(t.mission.progress).toBeGreaterThan(0.4);
    t.op.controller.teleport(9, 0.05, 36.5);
    t.run(0.2);
    expect(t.mission.progress).toBeLessThan(0.5);
    t.stand('A');
    t.run(0.7);
    expect(t.mission.objective).toBe(2);
  });

  it('a hostile near the site contests it: no progress while it is alive', () => {
    const t = setup();
    t.goActive();
    t.clearWave();
    const a = t.site('A');
    const hostile = t.bots().find((b) => b.alive)!;
    hostile.controller.teleport(a.center[0] + 2.5, 0.05, a.center[1]);
    t.stand('A');
    t.run(0.3);
    expect(t.mission.progress).toBe(0);
  });

  it('completing the dock objective completes the mission; the room is told to finish after the result', () => {
    const t = setup();
    t.goActive();
    t.clearWave();
    t.killBots();
    t.stand('A');
    t.run(0.7);
    expect(t.mission.objective).toBe(2);
    t.killBots();
    t.stand('B');
    t.run(0.7);
    expect(t.mission.state).toBe('complete');
    expect(t.events).toContainEqual({ type: 'mission', event: 'complete' });
    t.run(0.4);
    expect(t.events.filter((e) => e.type === 'finished')).toHaveLength(1);
  });
});

describe('failure and checkpoints', () => {
  it('fails when every operator is down', () => {
    const t = setup();
    t.goActive();
    t.op.alive = false;
    t.op.controller.setEnabled(false);
    t.run(0.05);
    expect(t.mission.state).toBe('failed');
    expect(t.events).toContainEqual({ type: 'mission', event: 'failed', reason: 'wiped' });
  });

  it('fails when time runs out', () => {
    const t = setup({ timeLimitSeconds: 0.5 });
    t.goActive();
    t.op.controller.teleport(9, 0.05, 36.5);
    t.run(0.6);
    expect(t.mission.state === 'failed' || t.mission.state === 'complete').toBe(true);
    expect(t.events).toContainEqual(expect.objectContaining({ event: 'failed' }));
  });

  it('an objective is a checkpoint: fallen operators come back at full health', () => {
    const t = setup();
    const buddy = t.sim.addPlayer('B2', 'Buddy', 'attackers');
    t.goActive();
    buddy.alive = false;
    buddy.controller.setEnabled(false);
    buddy.health.takeDamage(100);
    t.clearWave();
    expect(t.mission.objective).toBe(1);
    expect(buddy.alive).toBe(true);
    expect(buddy.health.current).toBe(100);
  });

  it('dead hostiles are cleaned out of the simulation after a few seconds', () => {
    const t = setup();
    t.goActive();
    t.killBots();
    t.run(0.1);
    t.run(3.2);
    expect(t.bots().filter((b) => !b.alive)).toHaveLength(0);
  });
});
