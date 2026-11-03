/** Micro-benchmark: cost of one 60 Hz simulation tick vs. number of players (no networking). */
import { MAP_01, initPhysics } from '@zhb/game-engine/sim';
import type { InputMessage } from '@zhb/shared';
import { MatchSim } from '../src/sim/MatchSim.ts';

await initPhysics();
const TICKS = 1200;

function bench(players: number): { mean: number; p99: number; max: number } {
  const sim = new MatchSim(MAP_01, () => undefined, null);
  const ids: string[] = [];
  for (let i = 0; i < players; i++) {
    const id = `p${i}`;
    sim.addPlayer(id, id, i % 2 === 0 ? 'attackers' : 'defenders');
    ids.push(id);
  }
  const yaw = ids.map(() => Math.random() * 6.28);
  const times: number[] = [];
  let seq = 0;
  for (let t = 0; t < TICKS; t++) {
    for (let i = 0; i < ids.length; i++) {
      if (t % 45 === 0) yaw[i] = (yaw[i] ?? 0) + (Math.random() - 0.5) * 2;
      const m: InputMessage = {
        seq: seq++,
        forward: 1,
        right: 0,
        jump: false,
        sprint: i % 2 === 0,
        crouch: false,
        fire: t % 90 < 30,
        reload: false,
        interact: false,
        yaw: yaw[i] ?? 0,
        pitch: 0,
        renderTime: sim.timeMs,
      };
      sim.queueInput(ids[i] as string, m);
    }
    const t0 = performance.now();
    sim.step();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  sim.dispose();
  return { mean, p99: times[Math.floor(times.length * 0.99)] ?? 0, max: times.at(-1) ?? 0 };
}

console.log('players | mean ms | p99 ms | max ms | rooms per core at 60 Hz (mean)');
for (const n of [2, 4, 10, 20]) {
  const r = bench(n);
  console.log(
    `${String(n).padStart(7)} | ${r.mean.toFixed(3).padStart(7)} | ${r.p99.toFixed(3).padStart(6)} | ${r.max.toFixed(3).padStart(6)} | ${Math.floor(1000 / 60 / r.mean)}`,
  );
}
process.exit(0);
