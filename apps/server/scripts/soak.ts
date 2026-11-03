/**
 * Multi-round soak: real server in-process, 2 humans (2v2 + bots fill) fire/move for many rounds.
 * Reports achieved sim tick rate, whether the round timer keeps counting, and memory across rounds.
 *   npx tsx scripts/soak.ts [seconds]
 */
import { Client } from '@colyseus/sdk';
import { MATCH_ROOM_NAME, type InputMessage } from '@zhb/shared';
import { createGameServer } from '../src/server.ts';

const PORT = 25000 + Math.floor(Math.random() * 3000);
const SECONDS = Number(process.argv[2] ?? 60);
const server = createGameServer(
  { CLIENT_ORIGINS: ['http://localhost:5173'] },
  {
    roundRules: { freezeSeconds: 1, roundSeconds: 6, roundEndSeconds: 1, roundsToWin: 99 },
    weather: 'clear',
  },
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
await server.listen(PORT);
const url = `ws://localhost:${PORT}`;
const host = await new Client(url).create(MATCH_ROOM_NAME, {
  playerName: 'Soaker',
  format: '2v2',
  mode: 'competitive',
  fillBots: true,
  botDifficulty: 'normal',
});
host.onMessage('*', () => undefined);
host.send('setReady', { ready: true });
await sleep(300);
host.send('start', {});
let seq = 0;
let yaw = 0;
const timer = setInterval(() => {
  yaw += 0.03;
  const m: InputMessage = {
    seq: seq++,
    forward: 1,
    right: 0,
    jump: false,
    sprint: false,
    crouch: false,
    fire: true,
    reload: false,
    interact: false,
    yaw,
    pitch: 0,
    renderTime: 0,
  };
  host.send('input', m);
}, 1000 / 60);
const st = () =>
  host.state as unknown as {
    tick: number;
    roundNumber: number;
    roundPhase: string;
    phaseTimeLeft: number;
  };
let lastTick = 0,
  lastT = Date.now();
let stalls = 0;
const t0 = Date.now();
while (Date.now() - t0 < SECONDS * 1000) {
  await sleep(5000);
  const now = Date.now();
  const s = st();
  const hz = ((s.tick - lastTick) / (now - lastT)) * 1000;
  const mem = (process.memoryUsage().rss / 1048576).toFixed(0);
  const m = (await (await fetch(`http://localhost:${PORT}/metrics`)).json()) as {
    simStepMs: { p99: number; max: number };
    eventLoopLagMs: { p99: number };
  };
  if (hz < 55) stalls++;
  console.log(
    `round ${s.roundNumber} ${s.roundPhase} t=${s.phaseTimeLeft} simHz=${hz.toFixed(1)} rss=${mem}MB stepP99=${m.simStepMs.p99.toFixed(2)} max=${m.simStepMs.max.toFixed(2)} lagP99=${m.eventLoopLagMs.p99.toFixed(2)}`,
  );
  lastTick = s.tick;
  lastT = now;
}
clearInterval(timer);
console.log(stalls ? `FAIL: ${stalls} slow windows` : 'PASS');
await host.leave().catch(() => undefined);
process.exit(stalls ? 1 : 0);
