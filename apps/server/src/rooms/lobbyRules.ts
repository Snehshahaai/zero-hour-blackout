import { COOP_RULES, TEAM_SIZES, type GameMode, type MatchFormat, type Team } from '@zhb/shared';

/** The slice of a player the rules need; the Colyseus schema satisfies this structurally. */
export interface LobbyPlayerLike {
  id: string;
  name: string;
  /** `Team` values; typed as string because the Colyseus schema stores a plain string. */
  team: string;
  ready: boolean;
  connected: boolean;
  joinedAt: number;
}

export type RuleResult = { ok: true } | { ok: false; code: string; message: string };
const ok: RuleResult = { ok: true };
const fail = (code: string, message: string): RuleResult => ({ ok: false, code, message });

export const teamCapacity = (format: MatchFormat): number => TEAM_SIZES[format];
export const roomCapacity = (format: MatchFormat, mode: GameMode = 'competitive'): number =>
  mode === 'cooperative' ? COOP_RULES.maxOperators : TEAM_SIZES[format] * 2;

export function countTeam(players: Iterable<LobbyPlayerLike>, team: Team): number {
  let n = 0;
  for (const p of players) if (p.team === team) n++;
  return n;
}

/** Team a newly joining player is placed on: the emptier one (attackers on ties); null if full. */
export function pickTeamForJoin(
  players: Iterable<LobbyPlayerLike>,
  format: MatchFormat,
  mode: GameMode = 'competitive',
): Team | null {
  const list = [...players];
  // Cooperative: everyone is an operator on the one human team.
  if (mode === 'cooperative') return list.length < COOP_RULES.maxOperators ? 'attackers' : null;
  const cap = teamCapacity(format);
  const a = countTeam(list, 'attackers');
  const d = countTeam(list, 'defenders');
  const preferred: Team = d < a ? 'defenders' : 'attackers';
  const other: Team = preferred === 'attackers' ? 'defenders' : 'attackers';
  if (countTeam(list, preferred) < cap) return preferred;
  if (countTeam(list, other) < cap) return other;
  return null;
}

export function canSwitchTeam(
  players: Iterable<LobbyPlayerLike>,
  player: LobbyPlayerLike,
  to: Team,
  format: MatchFormat,
  mode: GameMode = 'competitive',
): RuleResult {
  if (mode === 'cooperative') return fail('coop_team', 'Teams are fixed in cooperative missions.');
  if (player.team === to) return ok;
  if (countTeam(players, to) >= teamCapacity(format))
    return fail('team_full', 'That team is full.');
  return ok;
}

/** Match can start when teams are non-empty and equal in size and everyone but the host is ready. */
export function canStart(
  players: Iterable<LobbyPlayerLike>,
  hostId: string,
  requesterId: string,
  mode: GameMode = 'competitive',
  fillBots = false,
): RuleResult {
  if (requesterId !== hostId) return fail('not_host', 'Only the host can start the match.');
  const all = [...players]; // callers may pass a one-shot iterator (e.g. a Map's values())
  const present = all.filter((p) => p.connected);
  if (mode === 'cooperative' || fillBots) {
    // Cooperative, or competitive against bots that fill the empty slots: no team-balance rule.
    if (present.length === 0) return fail('need_players', 'No operators present.');
    if (present.some((p) => p.id !== hostId && !p.ready))
      return fail('not_ready', 'Waiting for all operators to be ready.');
    if (present.length !== all.length)
      return fail('player_reconnecting', 'An operator is reconnecting.');
    return ok;
  }
  const a = countTeam(present, 'attackers');
  const d = countTeam(present, 'defenders');
  if (a === 0 || d === 0) return fail('need_both_teams', 'Both teams need at least one player.');
  if (a !== d) return fail('uneven_teams', 'Teams must have the same number of players.');
  if (present.some((p) => p.id !== hostId && !p.ready)) {
    return fail('not_ready', 'Waiting for all players to be ready.');
  }
  if (present.length !== all.length) {
    return fail('player_reconnecting', 'A player is reconnecting.');
  }
  return ok;
}

/** Oldest connected player becomes host when the host leaves. */
export function pickHost(players: Iterable<LobbyPlayerLike>): string | null {
  const connected = [...players].filter((p) => p.connected).sort((x, y) => x.joinedAt - y.joinedAt);
  return connected[0]?.id ?? null;
}

/** Makes `name` unique among `existing` (case-insensitive) by appending " (2)", " (3)"... */
export function uniqueName(name: string, existing: Iterable<string>): string {
  const taken = new Set([...existing].map((n) => n.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 100; i++) {
    const candidate = `${name} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${name} (${Date.now() % 1000})`;
}

/** Fixed-window-free token bucket: allows bursts, refills steadily. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; last: number }>();
  constructor(
    private readonly capacity = 12,
    private readonly refillPerSecond = 6,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, last: t };
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.last) / 1000) * this.refillPerSecond);
    b.last = t;
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  forget(key: string): void {
    this.buckets.delete(key);
  }
}
