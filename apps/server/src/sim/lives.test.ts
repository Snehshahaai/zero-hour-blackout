import { MAP_01, initPhysics } from '@zhb/game-engine/sim';
import type { InputMessage } from '@zhb/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchSim } from './MatchSim.ts';

beforeAll(async () => {
  await initPhysics();
});

const kill = (sim: MatchSim, killer: string, victim: string) =>
  (sim as unknown as { kill(a: unknown, b: unknown): void }).kill(
    sim.players.get(killer),
    sim.players.get(victim),
  );
const run = (sim: MatchSim, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) sim.step();
};

function make(scope: 'player' | 'team') {
  const sim = new MatchSim(MAP_01, () => undefined, null);
  sim.setLives({ scope, count: 3, delay: 3, bots: false });
  sim.addPlayer('A', 'Alice', 'attackers');
  sim.addPlayer('B', 'Bob', 'attackers');
  sim.addPlayer('D', 'Dave', 'defenders');
  return sim;
}

describe('respawn lives', () => {
  it('a player with lives comes back after the delay and spends one', () => {
    const sim = make('player');
    kill(sim, 'D', 'A');
    const a = sim.players.get('A');
    expect(a?.alive).toBe(false);
    expect(a?.pendingRespawn).toBe(true);
    expect(sim.livesFor(a as never)).toBe(2);
    run(sim, 2.5);
    expect(a?.alive).toBe(false);
    run(sim, 0.7);
    expect(a?.alive).toBe(true);
    expect(a?.health.current).toBe(100);
  });

  it('after 3 respawns the fourth death is final, and the side counts as eliminated', () => {
    const sim = make('player');
    const a = sim.players.get('A');
    const b = sim.players.get('B');
    for (let i = 0; i < 3; i++) {
      kill(sim, 'D', 'A');
      run(sim, 3.2);
      expect(a?.alive).toBe(true);
    }
    kill(sim, 'D', 'A');
    run(sim, 10);
    expect(a?.alive).toBe(false);
    expect(a?.pendingRespawn).toBe(false);
    expect(sim.alivePerSide().attackers).toBe(1); // Bob
    // Pending respawns still count as alive: the round must not end while one is on the way.
    kill(sim, 'D', 'B');
    expect(sim.alivePerSide().attackers).toBe(1);
    void b;
  });

  it('resetRound refills per-player lives', () => {
    const sim = make('player');
    kill(sim, 'D', 'A');
    run(sim, 4);
    sim.resetRound((p) => p.team);
    expect(sim.livesFor(sim.players.get('A') as never)).toBe(3);
  });

  it('team scope shares one pool across teammates', () => {
    const sim = make('team');
    kill(sim, 'D', 'A');
    kill(sim, 'D', 'B');
    expect(sim.teamLives.attackers).toBe(1);
    run(sim, 3.2);
    kill(sim, 'D', 'A');
    kill(sim, 'D', 'B');
    expect(sim.teamLives.attackers).toBe(0);
    run(sim, 3.2);
    kill(sim, 'D', 'A');
    expect(sim.players.get('A')?.pendingRespawn).toBe(false);
  });

  it('bots do not draw on the pool unless allowed', () => {
    const sim = make('team');
    const bot = sim.addBot('bot-1', 'Bot', 'defenders', 10, 10);
    kill(sim, 'A', 'bot-1');
    expect(bot.pendingRespawn).toBe(false);
    expect(sim.teamLives.defenders).toBe(3);
  });
});

describe('input queue overflow', () => {
  it('keeps a trigger pull even when its input is the one dropped', () => {
    const sim = make('player');
    const a = sim.players.get('A');
    const mk = (seq: number, fire: boolean): InputMessage => ({
      seq,
      forward: 0,
      right: 0,
      jump: false,
      sprint: false,
      crouch: false,
      fire,
      reload: false,
      interact: false,
      yaw: 0,
      pitch: 0,
      renderTime: 0,
    });
    sim.queueInput('A', mk(0, true));
    for (let i = 1; i <= 9; i++) sim.queueInput('A', mk(i, false));
    expect(a?.queue.length).toBe(8);
    expect(a?.queue[0]?.fire).toBe(true);
  });
});

describe('1v1 deathmatch', () => {
  it('respawns forever and the first to the kill target wins the match', async () => {
    const { RoundManager } = await import('./RoundManager.ts');
    const events: { type: string }[] = [];
    const sim = new MatchSim(MAP_01, () => undefined, null);
    sim.setLives({ scope: 'player', count: 255, delay: 0.1, bots: true });
    sim.addPlayer('A', 'Alice', 'attackers');
    sim.addPlayer('D', 'Dave', 'defenders');
    const rm = new RoundManager(sim, MAP_01, (e) => events.push(e), {
      freezeSeconds: 0.1,
      matchEndSeconds: 0.2,
      deathmatchKills: 5,
    });
    rm.start();
    run(sim, 0.3);
    for (let i = 0; i < 4; i++) {
      kill(sim, 'A', 'D');
      run(sim, 0.3);
      rm.step();
      expect(sim.players.get('D')?.alive).toBe(true); // always comes back
    }
    for (let i = 0; i < 20; i++) {
      sim.step();
      rm.step();
    }
    expect(rm.phase).toBe('live');
    expect(rm.scores.attackers).toBe(4);
    kill(sim, 'A', 'D');
    rm.step();
    expect(rm.phase).toBe('matchEnd');
    expect(rm.matchWinner).toBe('attackers');
    expect(events.some((e) => e.type === 'matchEnd')).toBe(true);
  });
});

describe('co-op pool', () => {
  it('refills the shared pool when asked (every objective)', () => {
    const sim = make('team');
    kill(sim, 'D', 'A');
    kill(sim, 'D', 'B');
    expect(sim.teamLives.attackers).toBe(1);
    sim.refillTeamLives();
    expect(sim.teamLives.attackers).toBe(3);
  });
});
