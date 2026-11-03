export const GAME_NAME = 'ZERO HOUR: BLACKOUT';
export const GAME_TAGLINE = 'Every second changes the battlefield.';

/** Default port of the Colyseus game server. */
export const DEFAULT_SERVER_PORT = 2567;

/** Authoritative server simulation rate (Hz). */
export const SERVER_TICK_RATE = 30;

/** Players per team supported by each match format. 5v5 is a future target. */
export const TEAM_SIZES = { '1v1': 1, '2v2': 2, '5v5': 5 } as const;

/** Formats playable today. */
export const ENABLED_MATCH_FORMATS = ['1v1', '2v2'] as const;

export const ROOM_CODE_LENGTH = 6;
/** Unambiguous alphabet (no 0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const MAX_PLAYER_NAME_LENGTH = 24;

/** Name of the Colyseus room type used for lobbies and matches. */
export const MATCH_ROOM_NAME = 'match';
/** Seconds a disconnected player's slot is held for reconnection. */
export const RECONNECT_GRACE_SECONDS = 30;
/** Seconds between "Start Match" and the match beginning. */
export const MATCH_START_COUNTDOWN_SECONDS = 3;

/** Competitive round rules (seconds unless noted). Overridable per match for tests. */
export const ROUND_RULES = {
  freezeSeconds: 5,
  roundSeconds: 100,
  plantSeconds: 3.5,
  defuseSeconds: 5,
  fuseSeconds: 35,
  roundEndSeconds: 5,
  matchEndSeconds: 12,
  /** First team to this many round wins takes the match. */
  roundsToWin: 4,
  /** Sides swap after this many rounds have been played. */
  swapAfterRounds: 3,
  /** A plant is allowed within (site radius + this) metres of the site centre. */
  plantRadiusBonus: 1,
  defuseRange: 2.5,
  /** 1v1 deathmatch: first to this many kills wins (0 = normal bomb rounds). */
  deathmatchKills: 0,
  /** Deathmatch time cap; the leader wins when it runs out. */
  deathmatchSeconds: 900,
} as const;
export type RoundRules = { -readonly [K in keyof typeof ROUND_RULES]: number };

/** Power-grid rules. Deliberately conservative so blackouts stay fair in competitive play. */
export const POWER_RULES = {
  /** Seconds a player must hold E at a panel. */
  panelHoldSeconds: 1.5,
  /** Backup power restores the zone automatically after this long. */
  outageSeconds: 20,
  /** After an outage ends, panels cannot be used again for this long. */
  cooldownSeconds: 30,
  /** Metres from a panel within which it can be used. */
  panelReach: 1.6,
  /** A door only closes when nobody is within this distance of it (nobody gets trapped/crushed). */
  doorClearance: 1.2,
} as const;
export type PowerRules = { -readonly [K in keyof typeof POWER_RULES]: number };

/** Cooperative mission "Secure the Facility" tuning. */
export const COOP_RULES = {
  /** Players per cooperative lobby. */
  maxOperators: 4,
  briefingSeconds: 4,
  timeLimitSeconds: 600,
  /** Seconds a site must be held (uncontested) to secure it. */
  holdSeconds: 6,
  /** A site counts as contested if a hostile is within (site radius + this). */
  contestBonus: 4,
  /** Operators hold within (site radius + this). */
  holdBonus: 1.5,
  resultSeconds: 8,
  wave1: 4,
  wave2: 2,
  wave3: 3,
} as const;
export type CoopRules = { -readonly [K in keyof typeof COOP_RULES]: number };
export const COOP_OBJECTIVES = [
  'Eliminate the hostile patrols',
  'Secure the generator room',
  'Secure the loading dock',
] as const;
