/** Micro-benchmark: server cost per tick of a practice match (bots deciding and shooting). */
import { MAP_01, initPhysics } from '@zhb/game-engine/sim';
import { CompetitiveBots } from '../src/sim/CompetitiveBots.ts';
import { MatchSim } from '../src/sim/MatchSim.ts';
import { RoundManager } from '../src/sim/RoundManager.ts';

await initPhysics();
console.log('layout                     | mean ms | p99 ms | max ms | rooms per core (mean)');
for (const [label, humans, bots] of [
  ['1 human + 1 bot  (1v1)', 1, 1],
  ['0 humans + 4 bots (2v2)', 0, 4],
  ['1 human + 9 bots  (5v5)', 1, 9],
] as const) {
  const sim = new MatchSim(MAP_01, () => undefined, null);
  for (let i = 0; i < humans; i++) sim.addPlayer(`h${i}`, 'H', 'attackers');
  const holder: { b?: CompetitiveBots } = {};
  const rounds = new RoundManager(
    sim,
    MAP_01,
    (e) => e.type === 'roundStart' && holder.b?.onRoundStart(),
    { freezeSeconds: 0.2, roundSeconds: 600, roundsToWin: 99, swapAfterRounds: 99 },
  );
  const cb = new CompetitiveBots(sim, rounds, MAP_01, 'normal', 5);
  holder.b = cb;
  for (let i = 0; i < bots; i++) cb.addBot((humans + i) % 2 === 0 ? 'attackers' : 'defenders');
  rounds.start();
  const times: number[] = [];
  for (let t = 0; t < 3600; t++) {
    const t0 = performance.now();
    cb.step();
    sim.step();
    rounds.step();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(
    `${label.padEnd(26)} | ${mean.toFixed(3).padStart(7)} | ${(times[Math.floor(times.length * 0.99)] ?? 0).toFixed(3).padStart(6)} | ${(times.at(-1) ?? 0).toFixed(3).padStart(6)} | ${Math.floor(1000 / 60 / mean)}`,
  );
}
process.exit(0);
