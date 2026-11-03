import { describe, expect, it } from 'vitest';
import {
  canStart,
  canSwitchTeam,
  pickHost,
  pickTeamForJoin,
  RateLimiter,
  roomCapacity,
  uniqueName,
  type LobbyPlayerLike,
} from './lobbyRules.ts';

let seq = 0;
const P = (
  team: LobbyPlayerLike['team'],
  over: Partial<LobbyPlayerLike> = {},
): LobbyPlayerLike => ({
  id: `p${++seq}`,
  name: `P${seq}`,
  team,
  ready: false,
  connected: true,
  joinedAt: seq,
  ...over,
});

describe('team assignment', () => {
  it('balances teams and attackers get the tie', () => {
    expect(pickTeamForJoin([], '2v2')).toBe('attackers');
    expect(pickTeamForJoin([P('attackers')], '2v2')).toBe('defenders');
    expect(pickTeamForJoin([P('attackers'), P('defenders')], '2v2')).toBe('attackers');
  });
  it('fills the other team when one is full and returns null when the room is full', () => {
    expect(pickTeamForJoin([P('attackers'), P('attackers')], '2v2')).toBe('defenders');
    expect(pickTeamForJoin([P('attackers'), P('defenders')], '1v1')).toBeNull();
  });
  it('team switch is refused when the target team is full', () => {
    const me = P('attackers');
    const players = [me, P('defenders')];
    expect(canSwitchTeam(players, me, 'defenders', '1v1')).toMatchObject({
      ok: false,
      code: 'team_full',
    });
    expect(canSwitchTeam([me], me, 'defenders', '1v1')).toEqual({ ok: true });
  });
});

describe('start conditions', () => {
  it('only the host can start', () => {
    const host = P('attackers');
    const other = P('defenders', { ready: true });
    expect(canStart([host, other], host.id, other.id)).toMatchObject({ code: 'not_host' });
    expect(canStart([host, other], host.id, host.id)).toEqual({ ok: true });
  });
  it('needs both teams, equal sizes and every non-host ready', () => {
    const host = P('attackers');
    expect(canStart([host], host.id, host.id)).toMatchObject({ code: 'need_both_teams' });
    const d1 = P('defenders', { ready: true });
    const a2 = P('attackers', { ready: true });
    expect(canStart([host, a2, d1], host.id, host.id)).toMatchObject({ code: 'uneven_teams' });
    const d2 = P('defenders', { ready: false });
    expect(canStart([host, a2, d1, d2], host.id, host.id)).toMatchObject({ code: 'not_ready' });
  });
  it('refuses to start while someone is reconnecting', () => {
    const host = P('attackers');
    const away = P('defenders', { ready: true, connected: false });
    const d = P('defenders', { ready: true });
    expect(canStart([host, d, away], host.id, host.id)).toMatchObject({ ok: false });
  });
});

describe('one-shot iterators (Colyseus MapSchema.values())', () => {
  it('rules give the same answer for an iterator as for an array', () => {
    const host = P('attackers');
    const guest = P('defenders', { ready: true });
    const players = new Map([host, guest].map((p) => [p.id, p]));
    expect(canStart(players.values(), host.id, host.id)).toEqual({ ok: true });
    guest.ready = false;
    expect(canStart(players.values(), host.id, host.id)).toMatchObject({ code: 'not_ready' });
    expect(pickTeamForJoin(players.values(), '2v2')).toBe('attackers');
    expect(pickHost(players.values())).toBe(host.id);
  });
});

describe('host, names, rate limiting', () => {
  it('oldest connected player becomes host', () => {
    const a = P('attackers', { connected: false });
    const b = P('defenders');
    const c = P('attackers');
    expect(pickHost([a, b, c])).toBe(b.id);
    expect(pickHost([a])).toBeNull();
  });
  it('makes names unique case-insensitively', () => {
    expect(uniqueName('Ghost', ['ghost'])).toBe('Ghost (2)');
    expect(uniqueName('Ghost', ['ghost', 'Ghost (2)'])).toBe('Ghost (3)');
    expect(uniqueName('Ghost', ['Other'])).toBe('Ghost');
  });
  it('rate limiter allows a burst, blocks floods, and refills', () => {
    let t = 0;
    const rl = new RateLimiter(5, 5, () => t);
    for (let i = 0; i < 5; i++) expect(rl.allow('a')).toBe(true);
    expect(rl.allow('a')).toBe(false);
    expect(rl.allow('b')).toBe(true); // other clients unaffected
    t += 1000;
    expect(rl.allow('a')).toBe(true);
  });
});

describe('cooperative lobby rules', () => {
  it('everyone joins the single operators team, up to four', () => {
    const four = [P('attackers'), P('attackers'), P('attackers')];
    expect(pickTeamForJoin([], '1v1', 'cooperative')).toBe('attackers');
    expect(pickTeamForJoin(four, '1v1', 'cooperative')).toBe('attackers');
    expect(pickTeamForJoin([...four, P('attackers')], '1v1', 'cooperative')).toBeNull();
    expect(roomCapacity('1v1', 'cooperative')).toBe(4);
    expect(roomCapacity('2v2', 'competitive')).toBe(4);
    expect(roomCapacity('1v1', 'competitive')).toBe(2);
  });

  it('team switching is disabled', () => {
    const me = P('attackers');
    expect(canSwitchTeam([me], me, 'defenders', '1v1', 'cooperative')).toMatchObject({
      code: 'coop_team',
    });
  });

  it('a solo host can start; otherwise everyone else must be ready; no team-balance rule', () => {
    const host = P('attackers');
    expect(canStart([host], host.id, host.id, 'cooperative')).toEqual({ ok: true });
    const a = P('attackers', { ready: false });
    expect(canStart([host, a], host.id, host.id, 'cooperative')).toMatchObject({
      code: 'not_ready',
    });
    a.ready = true;
    expect(canStart([host, a], host.id, host.id, 'cooperative')).toEqual({ ok: true });
    expect(canStart([host, a], host.id, a.id, 'cooperative')).toMatchObject({ code: 'not_host' });
    const away = P('attackers', { ready: true, connected: false });
    expect(canStart([host, a, away], host.id, host.id, 'cooperative')).toMatchObject({ ok: false });
  });
});
