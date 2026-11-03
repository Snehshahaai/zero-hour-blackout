import { MAP_01, initPhysics } from '@zhb/game-engine/sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { BotBrain, type BotConfig } from './BotBrain.ts';
import { MatchSim } from './MatchSim.ts';
import { MAP01_NAV_NODES, NavGraph } from './nav.ts';

beforeAll(async () => {
  await initPhysics();
});

function world() {
  const sim = new MatchSim(MAP_01, () => undefined, null);
  const nav = new NavGraph(MAP01_NAV_NODES, (a, b, c, d) => sim.segmentClear(a, b, c, d));
  const op = sim.addPlayer('OP', 'Operator', 'attackers');
  const bots: BotBrain[] = [];
  const addBot = (cfg: Partial<BotConfig> & { x: number; z: number; yaw?: number }, seed = 7) => {
    const config: BotConfig = {
      id: cfg.id ?? 'B1',
      mode: cfg.mode ?? 'patrol',
      route: cfg.route ?? ['wh_c2'],
    };
    const bot = sim.addBot(config.id, 'Hostile', 'defenders', cfg.x, cfg.z, cfg.yaw ?? 0);
    const brain = new BotBrain(config, sim, nav, seed);
    bots.push(brain);
    return { bot, brain };
  };
  const run = (seconds: number, perTick?: () => void) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      perTick?.();
      for (const b of bots) b.step();
      sim.step();
    }
  };
  sim.shotListener = (shooter, from) => {
    if (shooter.isBot) return;
    for (const b of bots) b.hear(from.x, from.z, 38);
  };
  return { sim, nav, op, addBot, run };
}

describe('BotBrain perception and combat', () => {
  it('engages an operator it can see: turns, reacts, shoots and does damage', () => {
    const w = world();
    // Bot at (33,24) faces north (yaw 0); operator stands in the open 10 m ahead.
    w.op.controller.teleport(33, 0.05, 14);
    const { brain } = w.addBot({ x: 33, z: 24, yaw: 0 });
    w.run(0.5);
    expect(brain.stateName).toBe('combat');
    w.run(6);
    expect(w.op.health.current).toBeLessThan(100);
  });

  it('does not react before its reaction time, so there is a window to shoot first', () => {
    const w = world();
    w.op.controller.teleport(33, 0.05, 14);
    w.addBot({ x: 33, z: 24, yaw: 0 });
    w.run(0.3); // < reaction time
    expect(w.op.health.current).toBe(100);
  });

  it('ignores an operator behind a wall', () => {
    const w = world();
    w.op.controller.teleport(33, 0.05, 5); // generator-side room, north of the warehouse wall
    const { brain } = w.addBot({ x: 33, z: 24, yaw: 0 });
    w.run(5);
    expect(brain.stateName).not.toBe('combat');
    expect(w.op.health.current).toBe(100);
  });

  it('does not see behind itself, but hears a shot and goes to investigate', () => {
    const w = world();
    // Bot faces south (yaw PI); operator is north of it in plain sight, but outside its FOV.
    w.op.controller.teleport(33, 0.05, 14);
    const { brain, bot } = w.addBot({ x: 33, z: 24, yaw: Math.PI }, 3);
    w.run(0.4);
    expect(brain.stateName).not.toBe('combat');
    // The operator fires a shot: the bot hears it and turns to search.
    w.sim.shotListener?.(w.op, { x: 33, y: 1.6, z: 14 });
    expect(brain.stateName).toBe('search');
    const startDist = Math.hypot(bot.controller.state.x - 33, bot.controller.state.z - 14);
    w.run(4);
    const endDist = Math.hypot(bot.controller.state.x - 33, bot.controller.state.z - 14);
    expect(endDist).toBeLessThan(startDist);
  });

  it('a dead operator is no longer a target', () => {
    const w = world();
    w.op.controller.teleport(33, 0.05, 14);
    const { brain } = w.addBot({ x: 33, z: 24, yaw: 0 });
    w.run(0.5);
    expect(brain.stateName).toBe('combat');
    w.op.alive = false;
    w.op.controller.setEnabled(false);
    w.run(4);
    expect(brain.stateName).not.toBe('combat');
  });
});

describe('BotBrain navigation', () => {
  it('patrol bots actually walk their route', () => {
    const w = world();
    w.op.controller.teleport(9, 0.05, 36.5);
    const { bot } = w.addBot({ x: 27, z: 22, route: ['wh_c3', 'wh_c1'] });
    const x0 = bot.controller.state.x;
    const z0 = bot.controller.state.z;
    w.run(6);
    const moved = Math.hypot(bot.controller.state.x - x0, bot.controller.state.z - z0);
    expect(moved).toBeGreaterThan(3);
  });

  it('hunters reach their destination along real paths (through doors, around cover)', () => {
    const w = world();
    w.op.controller.teleport(9, 0.05, 36.5);
    const { bot } = w.addBot({ x: 38, z: 33, mode: 'hunt', route: ['siteA'] });
    w.run(25);
    const site = MAP01_NAV_NODES.find((n) => n.id === 'siteA')!;
    expect(
      Math.hypot(bot.controller.state.x - site.x, bot.controller.state.z - site.z),
    ).toBeLessThan(4);
  });

  it('bots stay inside the map (never leave through walls)', () => {
    const w = world();
    w.op.controller.teleport(9, 0.05, 36.5);
    const { bot } = w.addBot({ x: 30, z: 24, mode: 'hunt', route: ['dock_e', 'siteB'] });
    w.run(20);
    const s = bot.controller.state;
    const { minX, maxX, minZ, maxZ } = MAP_01.bounds;
    expect(s.x).toBeGreaterThan(minX);
    expect(s.x).toBeLessThan(maxX);
    expect(s.z).toBeGreaterThan(minZ);
    expect(s.z).toBeLessThan(maxZ);
  });
});
