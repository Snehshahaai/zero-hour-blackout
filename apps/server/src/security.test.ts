import { Client, type Room } from '@colyseus/sdk';
import { MATCH_ROOM_NAME } from '@zhb/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Draining rooms and fuzzing take real time; the default 5 s is too tight and cascades into later tests.
vi.setConfig({ testTimeout: 30000 });
import WebSocket from 'ws';
import { createGameServer } from './server.ts';

const PORT = 28000 + Math.floor(Math.random() * 1500);
const ORIGIN = 'http://localhost:5173';
const EVIL = 'http://evil.example';
const TOKEN = 'metrics-token-123';
const server = createGameServer(
  { CLIENT_ORIGINS: [ORIGIN] },
  {
    metricsToken: TOKEN,
    reconnectGraceSeconds: 1,
    limits: {
      maxRooms: 3,
      upgradeBurst: 400,
      upgradeRefillPerSecond: 0.1,
      maxPayloadBytes: 2048,
      maxErrorBodyBytes: 600,
    },
  },
);
const base = `http://localhost:${PORT}`;
const url = `ws://localhost:${PORT}`;
const open: Room[] = [];

const create = async (name: string, over: Record<string, unknown> = {}) => {
  const r = await new Client(url).create(MATCH_ROOM_NAME, {
    playerName: name,
    format: '1v1',
    ...over,
  });
  open.push(r);
  return r;
};
const alive = async () => (await fetch(`${base}/health`)).status === 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits until every room has closed, so the room cap doesn't leak between tests. */
async function drained(): Promise<void> {
  let last: { rooms: number; clients: number } = { rooms: -1, clients: -1 };
  for (let i = 0; i < 100; i++) {
    const res = await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${TOKEN}` } });
    last = (await res.json()) as { rooms: number; clients: number };
    if (last.rooms === 0) return;
    await sleep(50);
  }
  throw new Error(`rooms did not drain: ${JSON.stringify(last)}`);
}

/** Status of a raw WebSocket upgrade attempt (or 101 if it was accepted for handshake). */
function upgradeStatus(origin?: string): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(
      `${url}/nope/nope?sessionId=x`,
      origin ? { headers: { Origin: origin } } : {},
    );
    ws.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
    ws.on('open', () => {
      resolve(101);
      ws.terminate();
    });
    ws.on('error', () => resolve(0));
  });
}

beforeAll(async () => {
  await server.listen(PORT);
});
afterAll(async () => {
  for (const r of open) await r.leave().catch(() => undefined);
  await server.gracefullyShutdown(false);
});

describe('room cap (resource exhaustion)', () => {
  it('refuses to create rooms beyond the configured maximum with a clear message, and recovers', async () => {
    const rooms = [await create('Alpha'), await create('Bravo'), await create('Charlie')];
    const refused = await create('Delta').then(
      () => null,
      (e: Error) => e,
    );
    expect(refused).not.toBeNull();
    expect(refused?.message).toMatch(/busy/i); // not a bare "Internal Server Error"
    await rooms[0]?.leave();
    await sleep(300);
    const again = await create('Echo'); // space again
    expect(again.roomId).toBeTruthy();
    for (const r of [again, ...rooms.slice(1)]) await r.leave();
    await drained();
  });
});

describe('hostile input', () => {
  it('accepts awkward-but-legal names and rejects control/oversized ones', async () => {
    await drained();
    const proto = await create('__proto__');
    const ctor = await create('constructor');
    await sleep(200);
    expect(await alive()).toBe(true);
    await proto.leave();
    await ctor.leave();
    await sleep(300);
    await expect(create('a‮b')).rejects.toBeDefined(); // bidi override
    await expect(create('x'.repeat(25))).rejects.toBeDefined();
    await expect(create('')).rejects.toBeDefined();
    await expect(create('<img src=x onerror=1>')).rejects.toBeDefined();
  });

  it('survives an oversized WebSocket message: the sender is dropped, the server and room live on', async () => {
    const host = await create('Host');
    const guest = await new Client(url).joinById(host.roomId, { playerName: 'Guest' });
    open.push(guest);
    await sleep(200);
    let guestClosed = false;
    guest.onLeave(() => (guestClosed = true));
    guest.send('input', { pad: 'x'.repeat(200_000) });
    for (let i = 0; i < 40 && !guestClosed; i++) await sleep(50);
    expect(guestClosed).toBe(true);
    expect(await alive()).toBe(true);
    expect(host.connection.isOpen).toBe(true);
    await host.leave();
    await drained();
  });

  it('survives a fuzz barrage of malformed messages without crashing or hurting other players', async () => {
    await drained();
    const host = await create('Host');
    await sleep(100);
    const junk: unknown[] = [
      null,
      undefined,
      0,
      -1,
      1e308,
      NaN,
      'str',
      '',
      [],
      [1, 2, 3],
      {},
      { seq: 'x' },
      { __proto__: { polluted: true } },
      { constructor: { prototype: { polluted: true } } },
      { team: { $ne: 1 } },
      { ready: [true] },
      { seq: Number.POSITIVE_INFINITY, forward: 9, yaw: Infinity },
      Array.from({ length: 50 }, (_, i) => i),
    ];
    const types = [
      'input',
      'setTeam',
      'setReady',
      'start',
      '__proto__',
      'constructor',
      'toString',
      '',
      '🙂',
    ];
    for (const type of types) {
      for (const payload of junk) {
        const victim = await new Client(url)
          .joinById(host.roomId, { playerName: 'Fuzz' })
          .catch(() => null);
        if (!victim) continue; // 1v1 room may be full while a previous victim is still leaving
        open.push(victim);
        try {
          victim.send(type, payload as never);
        } catch {
          /* client-side encoding refused it: fine */
        }
        await sleep(15);
        await victim.leave().catch(() => undefined);
        await sleep(15);
      }
    }
    expect(await alive()).toBe(true);
    expect(host.connection.isOpen).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    await host.leave();
    await drained();
    const fresh = await create('AfterFuzz');
    expect(fresh.roomId).toBeTruthy();
    await fresh.leave();
  }, 120000);
});

describe('HTTP surface', () => {
  it('does not reflect an untrusted Origin in CORS headers', async () => {
    const evil = await fetch(`${base}/health`, { headers: { Origin: EVIL } });
    expect(evil.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const good = await fetch(`${base}/health`, { headers: { Origin: ORIGIN } });
    expect(good.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('protects /metrics with the bearer token when one is configured', async () => {
    expect((await fetch(`${base}/metrics`)).status).toBe(401);
    expect(
      (await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer wrong-token-999' } }))
        .status,
    ).toBe(401);
    const ok = await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(ok.status).toBe(200);
  });

  it('/client-errors validates, caps size, logs one JSON line, and rate-limits', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const post = (body: unknown, extra: Record<string, string> = {}) =>
      fetch(`${base}/client-errors`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, ...extra },
        body: JSON.stringify(body),
      });

    const good = await post({ message: 'boom\nFAKE LOG LINE', stack: 'at x', kind: 'error' });
    expect(good.status).toBe(200);
    const logged = spy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('client_error'));
    expect(logged).toBeDefined();
    expect(logged).not.toContain('\n'); // newline in the report cannot forge a second log line
    expect(JSON.parse(logged as string).message).toBe('boom\nFAKE LOG LINE');

    expect((await post({ message: 'x'.repeat(5000) })).status).toBeGreaterThanOrEqual(400); // too long
    expect((await post({ nope: true })).status).toBeGreaterThanOrEqual(400); // wrong shape
    expect((await post({ message: 'x'.repeat(100), stack: 'y'.repeat(3900) })).status).toBe(413); // body cap (600 B)

    let limited = 0;
    for (let i = 0; i < 40; i++) if ((await post({ message: `m${i}` })).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
    spy.mockRestore();
  });
});

describe('WebSocket upgrade guard (run last: it uses up the per-IP budget)', () => {
  it('rejects browsers from other origins, and floods from one address', async () => {
    expect(await upgradeStatus(EVIL)).toBe(403);
    expect(await upgradeStatus(ORIGIN)).not.toBe(403); // passes the guard (later fails for the fake seat)
    let tooMany = 0;
    for (let i = 0; i < 700; i++) if ((await upgradeStatus(ORIGIN)) === 429) tooMany++;
    expect(tooMany).toBeGreaterThan(0);
    expect(await alive()).toBe(true);
  });
});
