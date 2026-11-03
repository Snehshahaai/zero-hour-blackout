/**
 * Multiplayer load test: N rooms x P bot players against a running server.
 *
 *   npm run loadtest -w @zhb/server -- --url ws://localhost:2567 --rooms 10 --players 4 --seconds 30
 *
 * Bots join, ready up, the host starts, then every bot sends validated 60 Hz inputs (walking,
 * sprinting, turning, firing) exactly like a real client. Server health comes from the server's
 * own /metrics endpoint, so the numbers describe the server, not this script.
 */
import { Client, type Room } from '@colyseus/sdk';
import { MATCH_ROOM_NAME, type InputMessage } from '@zhb/shared';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? def) : def;
}
const URL_WS = arg('url', 'ws://localhost:2567');
const URL_HTTP = URL_WS.replace(/^ws/, 'http');
const ROOMS = Number(arg('rooms', '5'));
const PLAYERS = Number(arg('players', '4'));
const SECONDS = Number(arg('seconds', '20'));
const MODE = arg('mode', 'competitive');
const FORMAT = PLAYERS >= 10 ? '5v5' : PLAYERS >= 4 ? '2v2' : '1v1';

interface Bot {
  room: Room;
  bytes: number;
  patches: number;
  seq: number;
  yaw: number;
  turnAt: number;
  fire: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, ms = 30000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
    await sleep(25);
  }
}

async function serverMetrics() {
  const res = await fetch(`${URL_HTTP}/metrics`, {
    headers: process.env.METRICS_TOKEN
      ? { authorization: `Bearer ${process.env.METRICS_TOKEN}` }
      : {},
  });
  return (await res.json()) as {
    rooms: number;
    clients: number;
    simStepMs: { count: number; p50: number; p95: number; p99: number; max: number };
    eventLoopLagMs: { mean: number; p99: number; max: number };
    memoryMB: { rss: number };
    counters: Record<string, number>;
  };
}

function wire(room: Room): Bot {
  const bot: Bot = {
    room,
    bytes: 0,
    patches: 0,
    seq: 0,
    yaw: Math.random() * 6.28,
    turnAt: 0,
    fire: false,
  };
  const ws = (room.connection as unknown as { transport: { ws: WebSocket } }).transport.ws;
  ws.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as ArrayBuffer | string;
    bot.bytes += typeof d === 'string' ? d.length : d.byteLength;
    bot.patches++;
  });
  room.onMessage('*', () => undefined);
  return bot;
}

async function buildRoom(index: number): Promise<Bot[]> {
  const bots: Bot[] = [];
  const host = await new Client(URL_WS).create(MATCH_ROOM_NAME, {
    playerName: `LT${index}-0`,
    format: FORMAT,
    mode: MODE,
    visibility: 'private',
  });
  bots.push(wire(host));
  const joins = Math.max(0, (MODE === 'cooperative' ? Math.min(PLAYERS, 4) : PLAYERS) - 1);
  for (let p = 1; p <= joins; p++) {
    const room = await new Client(URL_WS).joinById(host.roomId, { playerName: `LT${index}-${p}` });
    room.send('setReady', { ready: true });
    bots.push(wire(room));
  }
  await sleep(300);
  host.send('start', {});
  return bots;
}

function inputFor(bot: Bot, now: number): InputMessage {
  if (now > bot.turnAt) {
    bot.yaw += (Math.random() - 0.5) * 2.2;
    bot.turnAt = now + 800 + Math.random() * 1500;
    bot.fire = Math.random() < 0.3;
  }
  return {
    seq: bot.seq++,
    forward: Math.random() < 0.9 ? 1 : 0,
    right: Math.random() < 0.2 ? (Math.random() < 0.5 ? -1 : 1) : 0,
    jump: Math.random() < 0.01,
    sprint: Math.random() < 0.3,
    crouch: false,
    fire: bot.fire,
    reload: Math.random() < 0.005,
    interact: false,
    yaw: bot.yaw,
    pitch: 0,
    renderTime: 0,
  };
}

async function main() {
  console.log(
    `Load test: ${ROOMS} rooms x ${PLAYERS} players (${MODE}) for ${SECONDS}s against ${URL_WS}`,
  );
  const before = await serverMetrics();
  const t0 = Date.now();
  const rooms: Bot[][] = [];
  for (let i = 0; i < ROOMS; i++) {
    rooms.push(await buildRoom(i));
    if (i % 5 === 4) await sleep(50);
  }
  const all = rooms.flat();
  console.log(`connected ${all.length} clients in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  await until(
    () => rooms.every((r) => r[0] && (r[0].room.state as { phase: string }).phase === 'inMatch'),
    'all rooms in match',
    45000,
  ).catch((e) => console.log('WARNING', (e as Error).message));
  // Skip the 5 s freeze so bots are actually moving during measurement.
  await sleep(Number(arg('settle', '6')) * 1000);

  const mid = await serverMetrics();
  const samples: { p99: number; lag: number }[] = [];
  let sent = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    for (const bot of all) {
      bot.room.send('input', inputFor(bot, now));
      sent++;
    }
  }, 1000 / 60);
  const bytes0 = all.reduce((a, b) => a + b.bytes, 0);
  const sampleTimer = setInterval(async () => {
    const m = await serverMetrics().catch(() => null);
    if (m) samples.push({ p99: m.simStepMs.p99, lag: m.eventLoopLagMs.p99 });
  }, 2000);
  const tStart = Date.now();
  await sleep(SECONDS * 1000);
  clearInterval(timer);
  clearInterval(sampleTimer);
  const elapsed = (Date.now() - tStart) / 1000;
  const after = await serverMetrics();
  const bytes = all.reduce((a, b) => a + b.bytes, 0) - bytes0;

  const connected = all.filter((b) => b.room.connection.isOpen).length;
  const worstP99 = Math.max(0, ...samples.map((s) => s.p99));
  const worstLag = Math.max(0, ...samples.map((s) => s.lag));
  console.log('\n=== RESULT ===');
  console.log(`clients still connected : ${connected}/${all.length}`);
  console.log(
    `inputs sent             : ${(sent / elapsed).toFixed(0)}/s total (${(sent / elapsed / all.length).toFixed(1)}/s per client)`,
  );
  console.log(
    `server tick (1/60 s)    : p50 ${after.simStepMs.p50.toFixed(2)} ms  p95 ${after.simStepMs.p95.toFixed(2)} ms  p99 ${after.simStepMs.p99.toFixed(2)} ms  max ${after.simStepMs.max.toFixed(2)} ms  (budget 16.67 ms per ROOM; shown per tick of one room)`,
  );
  console.log(`worst sampled p99 / lag : ${worstP99.toFixed(2)} ms / ${worstLag.toFixed(2)} ms`);
  console.log(
    `event loop lag          : mean ${after.eventLoopLagMs.mean.toFixed(2)} ms  p99 ${after.eventLoopLagMs.p99.toFixed(2)} ms  max ${after.eventLoopLagMs.max.toFixed(2)} ms`,
  );
  console.log(
    `server memory (rss)     : ${mid.memoryMB.rss.toFixed(0)} -> ${after.memoryMB.rss.toFixed(0)} MB`,
  );
  console.log(
    `downstream per client   : ${(bytes / elapsed / all.length / 1024).toFixed(1)} KiB/s  (${(bytes / elapsed / 1024 / 1024).toFixed(2)} MiB/s total)`,
  );
  console.log(`server rooms/clients    : ${after.rooms} / ${after.clients}`);
  const budgetOk = after.simStepMs.p99 < 16.67 && connected === all.length;
  console.log(
    `\nverdict: ${budgetOk ? 'PASS (tick p99 inside one 60 Hz frame, no disconnects)' : 'CHECK (tick budget exceeded or clients dropped)'}`,
  );
  void before;
  for (const b of all) await b.room.leave().catch(() => undefined);
  process.exit(budgetOk ? 0 : 1);
}

main().catch((e) => {
  console.error('load test failed:', e);
  process.exit(2);
});
