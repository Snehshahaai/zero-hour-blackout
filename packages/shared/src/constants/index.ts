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
