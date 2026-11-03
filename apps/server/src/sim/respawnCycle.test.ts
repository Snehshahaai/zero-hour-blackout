import { MAP_01, initPhysics } from '@zhb/game-engine/sim';
import type { InputMessage } from '@zhb/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchSim } from './MatchSim.ts';

beforeAll(async () => {
  await initPhysics();
});

let seq = 0;
const input = (over: Partial<InputMessage> = {}): InputMessage => ({
  seq: seq++,
  forward: 1,
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

describe('repeated death and respawn', () => {
  it('the player still moves and is acknowledged after many deaths', () => {
    const sim = new MatchSim(MAP_01, () => undefined, null);
    sim.setLives({ scope: 'player', count: 255, delay: 0.2, bots: true });
    const a = sim.addPlayer('A', 'Alice', 'attackers');
    sim.addPlayer('D', 'Dave', 'defenders');
    const kill = (k: string, v: string) =>
      (sim as unknown as { kill(a: unknown, b: unknown): void }).kill(
        sim.players.get(k),
        sim.players.get(v),
      );
    for (let cycle = 0; cycle < 8; cycle++) {
      kill('D', 'A');
      for (let i = 0; i < 30; i++) sim.step(); // respawn delay 0.2 s
      expect(a.alive).toBe(true);
      const x0 = a.controller.state.x,
        z0 = a.controller.state.z;
      let last = -1;
      for (let i = 0; i < 90; i++) {
        const m = input();
        last = m.seq;
        sim.queueInput('A', m);
        sim.step();
      }
      expect(a.ackSeq, `cycle ${cycle} ack`).toBe(last);
      expect(
        Math.hypot(a.controller.state.x - x0, a.controller.state.z - z0),
        `cycle ${cycle} moved`,
      ).toBeGreaterThan(1);
    }
  });
});
