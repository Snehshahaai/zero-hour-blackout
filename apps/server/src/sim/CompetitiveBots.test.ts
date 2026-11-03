import { MAP_01, initPhysics } from '@zhb/game-engine/sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { CompetitiveBots } from './CompetitiveBots.ts';
import { MatchSim } from './MatchSim.ts';
import { RoundManager, type RoundEvent } from './RoundManager.ts';

beforeAll(async () => {
  await initPhysics();
});

const FAST = {
  freezeSeconds: 0.3,
  roundSeconds: 90,
  plantSeconds: 1,
  defuseSeconds: 1,
  fuseSeconds: 25,
  roundEndSeconds: 0.5,
  matchEndSeconds: 1,
  roundsToWin: 1,
  swapAfterRounds: 99,
};

function setup(opts: {
  humanTeam: 'attackers' | 'defenders';
  difficulty?: 'easy' | 'normal' | 'hard';
}) {
  const events: RoundEvent[] = [];
  const sim = new MatchSim(MAP_01, () => undefined, null);
  const human = sim.addPlayer('H', 'Human', opts.humanTeam);
  const holder: { bots?: CompetitiveBots } = {};
  const rounds = new RoundManager(
    sim,
    MAP_01,
    (e) => {
      events.push(e);
      if (e.type === 'roundStart') holder.bots?.onRoundStart();
    },
    FAST,
  );
  const bots = new CompetitiveBots(sim, rounds, MAP_01, opts.difficulty ?? 'normal', 11);
  holder.bots = bots;
  const botTeam = opts.humanTeam === 'attackers' ? 'defenders' : 'attackers';
  const bot = bots.addBot(botTeam);
  rounds.start();
  const run = (seconds: number, perTick?: () => void) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      perTick?.();
      bots.step();
      sim.step();
      rounds.step();
    }
  };
  /** Puts the idle human somewhere the bot is unlikely to see them (far west corridor). */
  const hide = () => human.controller.teleport(6, 0.05, 2);
  return { sim, human, bot, bots, rounds, events, run, hide };
}

describe('competitive bots: attacker bot', () => {
  it('walks to a site and plants the bomb on its own', () => {
    const t = setup({ humanTeam: 'defenders' });
    t.run(0.4);
    t.hide();
    t.run(45);
    expect(t.events.some((e) => e.type === 'bomb' && e.event === 'planted')).toBe(true);
    expect(
      t.rounds.bomb.planted || t.rounds.phase === 'roundEnd' || t.rounds.phase === 'matchEnd',
    ).toBe(true);
  });

  it('wins the match by detonation when the human does nothing (full round + match flow with a bot)', () => {
    const t = setup({ humanTeam: 'defenders' });
    t.run(0.4);
    t.hide();
    t.run(90);
    const end = t.events.find((e) => e.type === 'roundEnd');
    expect(end).toMatchObject({ winnerSide: 'attackers' });
    expect(t.events.find((e) => e.type === 'matchEnd')).toMatchObject({ winnerTeam: 'attackers' });
  });
});

describe('competitive bots: defender bot', () => {
  it('guards (does not plant, does not stand still) while nothing has happened', () => {
    const t = setup({ humanTeam: 'attackers' });
    t.run(0.4);
    t.hide();
    const x0 = t.bot.controller.state.x;
    const z0 = t.bot.controller.state.z;
    t.run(10);
    expect(
      Math.hypot(t.bot.controller.state.x - x0, t.bot.controller.state.z - z0),
    ).toBeGreaterThan(3);
    expect(t.rounds.bomb.planted).toBe(false);
  });

  it('rushes a planted bomb and defuses it, winning the round', () => {
    const t = setup({ humanTeam: 'attackers' });
    t.run(0.4);
    // The human plants at site A and then is removed from play (bots must do the rest).
    const a = MAP_01.objectives.find((o) => o.id === 'A')!;
    t.human.controller.teleport(a.center[0], 0.05, a.center[1]);
    t.run(0.1);
    t.run(1.4, () =>
      t.sim.queueInput('H', {
        seq: 0,
        forward: 0,
        right: 0,
        jump: false,
        sprint: false,
        crouch: false,
        fire: false,
        reload: false,
        interact: true,
        yaw: 0,
        pitch: 0,
        renderTime: 0,
      }),
    );
    expect(t.rounds.bomb.planted).toBe(true);
    t.human.alive = false;
    t.human.controller.setEnabled(false);
    t.run(40);
    expect(t.events.find((e) => e.type === 'roundEnd')).toMatchObject({
      winnerSide: 'defenders',
      reason: 'defused',
    });
  });
});

describe('competitive bots: fighting and difficulty', () => {
  /**
   * Seconds until an idle human, standing in plain view 11 m ahead of the bot (attackers face
   * east at the start of a round), first takes damage (99 = never within 10 s).
   */
  function timeToFirstHit(difficulty: 'easy' | 'normal' | 'hard'): number {
    const t = setup({ humanTeam: 'defenders', difficulty });
    for (let i = 0; i < 24; i++) {
      t.sim.step(); // go live without moving the bot, so it keeps its starting heading
      t.rounds.step();
    }
    t.bot.controller.teleport(26, 0.05, 26.5);
    t.human.controller.teleport(37, 0.05, 26.5);
    for (let i = 0; i < 60 * 10; i++) {
      t.bots.step();
      t.sim.step();
      t.rounds.step();
      if (t.human.health.current < 100) return i / 60;
    }
    return 99;
  }

  it('a bot that sees an enemy fights: the human takes damage within a few seconds', () => {
    expect(timeToFirstHit('normal')).toBeLessThan(5);
  });

  it('difficulty is real and ordered: easy reacts slowest, hard fastest', () => {
    const easy = timeToFirstHit('easy');
    const normal = timeToFirstHit('normal');
    const hard = timeToFirstHit('hard');
    expect(easy).toBeLessThan(99);
    expect(easy).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(hard);
  });

  it('a hidden human is not found through walls (no omniscience): no damage for 20 s', () => {
    const t = setup({ humanTeam: 'defenders' });
    t.run(0.4);
    t.human.controller.teleport(6, 0.05, 2); // far corner of the west corridor
    t.bot.controller.teleport(39, 0.05, 22);
    t.run(20);
    expect(t.human.health.current).toBe(100);
  });
});
