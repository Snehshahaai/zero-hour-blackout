import { Client, type Room } from '@colyseus/sdk';
import { MATCH_ROOM_NAME, type LobbyError } from '@zhb/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from '../server.ts';

// Real server + real SDK clients over WebSocket on an ephemeral port.
const PORT = 24000 + Math.floor(Math.random() * 4000);
const server = createGameServer(
  { CLIENT_ORIGINS: ['http://localhost:5173'] },
  {
    roundRules: { freezeSeconds: 0.3, roundSeconds: 60, matchEndSeconds: 0.5 },
    coopRules: { briefingSeconds: 0.3, timeLimitSeconds: 1.5, resultSeconds: 0.4 },
    weather: 'rain',
    reconnectGraceSeconds: 1,
  },
);
const url = `ws://localhost:${PORT}`;
const open: Room[] = [];

const newClient = () => new Client(url);
const track = <T extends Room>(r: T): T => {
  open.push(r);
  return r;
};
const create = async (name: string, over: Record<string, unknown> = {}) =>
  track(await newClient().create(MATCH_ROOM_NAME, { playerName: name, ...over }));
const joinCode = async (code: string, name: string) =>
  track(await newClient().joinById(code, { playerName: name }));

async function until(cond: () => boolean, what: string, ms = 4000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}
interface PlayerView {
  id: string;
  name: string;
  team: string;
  ready: boolean;
  connected: boolean;
}
const players = (r: Room) => Object.values(r.state.players.toJSON() as Record<string, PlayerView>);
const playerOf = (r: Room, id: string): PlayerView => {
  const p = players(r).find((x) => x.id === id);
  if (!p) throw new Error(`player ${id} not in room`);
  return p;
};
const errorsOf = (r: Room): LobbyError[] => {
  const list: LobbyError[] = [];
  r.onMessage('error', (e: LobbyError) => list.push(e));
  return list;
};

beforeAll(async () => {
  await server.listen(PORT);
});
afterAll(async () => {
  for (const r of open) await r.leave().catch(() => undefined);
  await server.gracefullyShutdown(false);
});

describe('MatchRoom (end-to-end)', () => {
  it('creates a room whose id is a 6-char code, joinable by that code, balanced teams', async () => {
    const host = await create('Alice', { format: '2v2' });
    expect(host.roomId).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    await until(() => host.state.roomCode === host.roomId, 'state sync');

    const bob = await joinCode(host.roomId, 'Bob');
    await until(() => players(host).length === 2, 'both players visible');
    const teams = players(host)
      .map((p) => p.team)
      .sort();
    expect(teams).toEqual(['attackers', 'defenders']);
    expect(host.state.hostId).toBe(host.sessionId);
    expect(bob.state.hostId).toBe(host.sessionId);
  });

  it('rejects unknown codes, invalid names, and joins to a full room', async () => {
    await expect(joinCode('ZZZZZZ', 'Nobody')).rejects.toBeDefined();
    await expect(create('<script>')).rejects.toBeDefined();
    const host = await create('Solo', { format: '1v1' });
    await joinCode(host.roomId, 'Second');
    await expect(joinCode(host.roomId, 'Third')).rejects.toBeDefined();
  });

  it('dedupes names and refuses a team switch into a full team', async () => {
    const host = await create('Same', { format: '1v1' });
    const other = await joinCode(host.roomId, 'same');
    await until(() => players(host).length === 2, 'joined');
    expect(
      players(host)
        .map((p) => p.name)
        .sort(),
    ).toEqual(['Same', 'same (2)']);
    const errs = errorsOf(other);
    const otherTeam = playerOf(host, other.sessionId).team;
    other.send('setTeam', { team: otherTeam === 'attackers' ? 'defenders' : 'attackers' });
    await until(() => errs.length === 1, 'team_full error');
    expect(errs[0]?.code).toBe('team_full');
  });

  it('non-host cannot start; malformed messages kick the sender and free the slot', async () => {
    const host = await create('Host', { format: '1v1' });
    const guest = await joinCode(host.roomId, 'Guest');
    await until(() => players(host).length === 2, 'joined');
    const errs = errorsOf(guest);
    guest.send('start', {});
    await until(() => errs.some((e) => e.code === 'not_host'), 'not_host error');
    expect(host.state.phase).toBe('lobby');

    // Colyseus disconnects clients that send payloads failing validation; we must not hold
    // their slot for the reconnect grace period.
    guest.send('setTeam', { team: 'spectators' });
    await until(() => players(host).length === 1, 'malformed sender removed');
    expect(host.state.hostId).toBe(host.sessionId);
  });

  it('full flow: ready up, host starts, countdown, match phase, room locked', async () => {
    const host = await create('Host', { format: '1v1' });
    const guest = await joinCode(host.roomId, 'Guest');
    await until(() => players(host).length === 2, 'joined');
    const hostErrs = errorsOf(host);

    host.send('start', {});
    await until(
      () => hostErrs.some((e) => e.code === 'not_ready'),
      'not_ready before guest readies',
    );

    guest.send('setReady', { ready: true });
    await until(() => playerOf(host, guest.sessionId).ready === true, 'guest ready');
    host.send('start', {});
    await until(() => host.state.phase === 'starting', 'starting');
    expect(host.state.countdown).toBeGreaterThan(0);
    await until(() => guest.state.phase === 'inMatch', 'inMatch', 6000);
    await expect(joinCode(host.roomId, 'Late')).rejects.toBeDefined();
  }, 15000);

  it('host leaving migrates host to the remaining player; empty room disposes', async () => {
    const host = await create('Host', { format: '1v1' });
    const guest = await joinCode(host.roomId, 'Guest');
    await until(() => players(host).length === 2, 'joined');
    await host.leave();
    await until(() => guest.state.hostId === guest.sessionId, 'host migrated');
    expect(players(guest)).toHaveLength(1);
    const code = guest.roomId;
    await guest.leave();
    await new Promise((r) => setTimeout(r, 300));
    await expect(joinCode(code, 'Ghost')).rejects.toBeDefined();
  });

  it('a dropped player keeps their slot and can reconnect with their token', async () => {
    const host = await create('Host', { format: '1v1' });
    const guest = await joinCode(host.roomId, 'Guest');
    await until(() => players(host).length === 2, 'joined');
    guest.send('setReady', { ready: true });
    await until(() => playerOf(host, guest.sessionId).ready === true, 'ready');

    const token = guest.reconnectionToken;
    const sessionId = guest.sessionId;
    // Close with a non-consented application code, as a network drop would look to the server.
    (guest.connection as unknown as { transport: { ws: WebSocket } }).transport.ws.close(3999);
    await until(() => playerOf(host, sessionId).connected === false, 'marked disconnected');
    expect(players(host)).toHaveLength(2); // slot is held

    const back = track(await newClient().reconnect(token));
    expect(back.sessionId).toBe(sessionId);
    await until(() => playerOf(host, sessionId).connected === true, 'reconnected');
    expect(playerOf(host, sessionId).ready).toBe(true); // state preserved
  });

  it('a disconnected player blocks match start until they return', async () => {
    const host = await create('Host', { format: '1v1' });
    const guest = await joinCode(host.roomId, 'Guest');
    await until(() => players(host).length === 2, 'joined');
    guest.send('setReady', { ready: true });
    await until(() => playerOf(host, guest.sessionId).ready === true, 'ready');
    const errs = errorsOf(host);
    (guest.connection as unknown as { transport: { ws: WebSocket } }).transport.ws.close(3999);
    await until(() => players(host).some((p) => !p.connected), 'disconnected');
    host.send('start', {});
    await until(() => errs.length > 0, 'start refused');
    expect(host.state.phase).toBe('lobby');
  });

  it('public quick play pairs matching format only and never joins private rooms', async () => {
    const priv = await create('Private', { format: '1v1', visibility: 'private' });
    const a = track(
      await newClient().joinOrCreate(MATCH_ROOM_NAME, {
        playerName: 'QA',
        format: '1v1',
        visibility: 'public',
      }),
    );
    expect(a.roomId).not.toBe(priv.roomId);
    const b = track(
      await newClient().joinOrCreate(MATCH_ROOM_NAME, {
        playerName: 'QB',
        format: '1v1',
        visibility: 'public',
      }),
    );
    expect(b.roomId).toBe(a.roomId);
    const c = track(
      await newClient().joinOrCreate(MATCH_ROOM_NAME, {
        playerName: 'QC',
        format: '2v2',
        visibility: 'public',
      }),
    );
    expect(c.roomId).not.toBe(a.roomId);
  });

  it('match: sim state replicates, inputs move the player and are acknowledged', async () => {
    const host = await create('Host', { format: '1v1' });
    const guest = await joinCode(host.roomId, 'Guest');
    await until(() => players(host).length === 2, 'joined');
    guest.send('setReady', { ready: true });
    await until(() => playerOf(host, guest.sessionId).ready, 'ready');
    host.send('start', {});
    await until(() => host.state.phase === 'inMatch', 'inMatch', 7000);
    await until(() => host.state.sim.size === 2 && host.state.tick > 5, 'sim state replicating');
    await until(() => host.state.roundPhase === 'live', 'round live');

    const mine = () => host.state.sim.get(host.sessionId);
    const startX = mine().x;
    const t0 = host.state.tick;
    // Host is on the attackers' side: spawn yaw faces +X (east). Walk 30 ticks.
    for (let i = 0; i < 30; i++) {
      host.send('input', {
        seq: i,
        forward: 1,
        right: 0,
        jump: false,
        sprint: false,
        crouch: false,
        fire: false,
        reload: false,
        interact: false,
        yaw: -Math.PI / 2,
        pitch: 0,
        renderTime: host.state.timeMs,
      });
      await new Promise((r) => setTimeout(r, 16));
    }
    await until(() => mine().ackSeq >= 25, 'inputs acknowledged');
    expect(mine().x).toBeGreaterThan(startX + 0.8);
    expect(host.state.tick).toBeGreaterThan(t0);
    // Environment state replicates: server-chosen weather, power zones and door states.
    expect(host.state.weather).toBe('rain');
    expect([...host.state.power.keys()].sort()).toEqual(['maintenance', 'security', 'warehouse']);
    expect(host.state.power.get('warehouse').cut).toBe(false);
    expect(host.state.doors.get('D-security-south').closed).toBe(false);
    // The other player is replicated too, with their own health/ammo.
    expect(host.state.sim.get(guest.sessionId).health).toBe(100);
  }, 20000);

  it('match: an input with an out-of-range field kicks the sender', async () => {
    const host = await create('Host', { format: '1v1' });
    const guest = await joinCode(host.roomId, 'Guest');
    await until(() => players(host).length === 2, 'joined');
    guest.send('setReady', { ready: true });
    await until(() => playerOf(host, guest.sessionId).ready, 'ready');
    host.send('start', {});
    await until(() => host.state.phase === 'inMatch' && host.state.sim.size === 2, 'match', 7000);
    guest.send('input', {
      seq: 0,
      forward: 50,
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
    });
    await until(() => players(host).length === 1, 'cheater removed');
  }, 20000);

  it('match lifecycle: forfeit ends the match, then everyone returns to an unlocked lobby', async () => {
    const host = await create('Host', { format: '1v1' });
    const guest = await joinCode(host.roomId, 'Guest');
    await until(() => players(host).length === 2, 'joined');
    guest.send('setReady', { ready: true });
    await until(() => playerOf(host, guest.sessionId).ready, 'ready');
    host.send('start', {});
    await until(
      () => host.state.phase === 'inMatch' && host.state.roundPhase === 'live',
      'live',
      7000,
    );

    await guest.leave();
    await until(() => host.state.roundPhase === 'matchEnd', 'match ended by forfeit');
    expect(host.state.matchWinner).toBe(playerOf(host, host.sessionId).team);
    await until(() => host.state.phase === 'lobby', 'back to lobby', 5000);
    expect(host.state.sim.size).toBe(0);
    expect(host.state.roundNumber).toBe(0);
    // Room accepts a new player again, so the lobby is usable for another match.
    const again = await joinCode(host.roomId, 'Newcomer');
    await until(() => players(host).length === 2, 'rejoined lobby');
    expect(again.state.phase).toBe('lobby');
  }, 20000);

  it('state JSON omits empty maps in the lobby (clients must default them)', async () => {
    const host = await create('Host', { format: '1v1' });
    await until(() => host.state.roomCode === host.roomId, 'state');
    const raw = host.state.toJSON() as Record<string, unknown>;
    // The web bridge defaults these; if Colyseus ever starts sending them, the defaults stay harmless.
    expect(raw.sim === undefined || Object.keys(raw.sim as object).length === 0).toBe(true);
    expect(raw.power === undefined || Object.keys(raw.power as object).length === 0).toBe(true);
    expect(raw.doors === undefined || Object.keys(raw.doors as object).length === 0).toBe(true);
  });

  it('cooperative: solo host starts a mission against server-run bots, fails on the clock, back to lobby', async () => {
    const host = await create('Solo', { mode: 'cooperative' });
    await until(() => host.state.roomCode === host.roomId, 'state');
    expect(host.state.mode).toBe('cooperative');
    const second = await joinCode(host.roomId, 'Buddy');
    await until(() => players(host).length === 2, 'two operators');
    expect(players(host).every((p) => p.team === 'attackers')).toBe(true); // one fixed team
    const errs = errorsOf(second);
    second.send('setTeam', { team: 'defenders' });
    await until(() => errs.some((e) => e.code === 'coop_team'), 'team switch refused');
    await second.leave();
    await until(() => players(host).length === 1, 'buddy left');

    host.send('start', {}); // a solo host needs nobody to be ready
    await until(() => host.state.phase === 'inMatch', 'inMatch', 7000);
    await until(() => host.state.sim.size >= 5, 'operator plus 4 hostiles replicated');
    const sim = Object.values(
      host.state.sim.toJSON() as Record<string, { isBot: boolean; team: string }>,
    );
    expect(sim.filter((p) => p.isBot)).toHaveLength(4);
    expect(sim.filter((p) => !p.isBot)).toHaveLength(1);
    expect(host.state.objectiveLabel).toBe('Eliminate the hostile patrols');
    await until(() => host.state.missionState === 'active', 'mission active');
    await until(() => host.state.missionState === 'failed', 'time limit fails the mission', 6000);
    await until(() => host.state.phase === 'lobby', 'returns to lobby', 6000);
    expect(host.state.sim.size).toBe(0);
  }, 25000);

  it('exposes /ready and /metrics (JSON and Prometheus) after a match has run', async () => {
    const ready = await fetch(`http://localhost:${PORT}/ready`);
    expect(ready.status).toBe(200);
    const m = (await (await fetch(`http://localhost:${PORT}/metrics`)).json()) as {
      simStepMs: { count: number; p99: number };
      counters: { roomsCreated: number; matchesStarted: number };
      rooms: number;
    };
    expect(m.counters.roomsCreated).toBeGreaterThan(0);
    expect(m.counters.matchesStarted).toBeGreaterThan(0);
    expect(m.simStepMs.count).toBeGreaterThan(0);
    const prom = await (await fetch(`http://localhost:${PORT}/metrics?format=prom`)).text();
    expect(prom).toContain('zhb_sim_step_ms_p99');
  });

  it('a room whose last player drops without leaving is disposed after the grace period (no zombie rooms)', async () => {
    const host = await create('Solo', { format: '1v1' });
    const code = host.roomId;
    await until(() => host.state.roomCode === code, 'state');
    (host.connection as unknown as { transport: { ws: WebSocket } }).transport.ws.close(3999);
    // Seat is held while the grace period runs, then the player is removed and the room must close.
    await new Promise((r) => setTimeout(r, 2500));
    await expect(joinCode(code, 'Late')).rejects.toBeDefined(); // the room no longer exists
  }, 15000);
});
