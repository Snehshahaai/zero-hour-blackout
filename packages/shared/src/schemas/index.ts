import { z } from 'zod';
import {
  ENABLED_MATCH_FORMATS,
  MAX_PLAYER_NAME_LENGTH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from '../constants/index.ts';

export const teamSchema = z.enum(['attackers', 'defenders']);
export const gameModeSchema = z.enum(['competitive', 'cooperative']);
export const matchFormatSchema = z.enum(ENABLED_MATCH_FORMATS);
export const graphicsQualitySchema = z.enum(['low', 'medium', 'high']);

export const playerNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(MAX_PLAYER_NAME_LENGTH)
  .regex(/^[\p{L}\p{N} _.-]+$/u, 'Letters, numbers, spaces, _ . - only');

const roomCodePattern = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
/** Normalises to upper case before validating, so user input like "abc234" works. */
export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(roomCodePattern, 'Invalid room code');

export const roomVisibilitySchema = z.enum(['public', 'private']);
export const botDifficultySchema = z.enum(['easy', 'normal', 'hard']);
export const lobbyPhaseSchema = z.enum(['lobby', 'starting', 'inMatch']);

/** Options a client sends when creating (or quick-joining) a room. Validated server-side. */
export const createRoomOptionsSchema = z.object({
  playerName: playerNameSchema,
  mode: gameModeSchema.default('competitive'),
  format: matchFormatSchema.default('1v1'),
  visibility: roomVisibilitySchema.default('private'),
  /** Competitive only: AI players fill every empty slot (e.g. 1v1 against a bot). */
  fillBots: z.boolean().default(false),
  botDifficulty: botDifficultySchema.default('normal'),
});
export type CreateRoomOptions = z.infer<typeof createRoomOptionsSchema>;

export const joinRoomOptionsSchema = z.object({
  playerName: playerNameSchema,
  roomCode: roomCodeSchema,
});
export type JoinRoomOptions = z.infer<typeof joinRoomOptionsSchema>;

/** Options sent when joining an existing room by id (the room code). */
export const playerJoinOptionsSchema = z.object({ playerName: playerNameSchema });
export type PlayerJoinOptions = z.infer<typeof playerJoinOptionsSchema>;

/** Client -> server lobby messages. The server parses every one of these. */
export const lobbyMessageSchemas = {
  setTeam: z.object({ team: teamSchema }),
  setReady: z.object({ ready: z.boolean() }),
  start: z.object({}),
} as const;

/** Server -> client error payload (message type `error`). */
export const lobbyErrorSchema = z.object({ code: z.string(), message: z.string() });
export type LobbyError = z.infer<typeof lobbyErrorSchema>;

/** Plain, validated view of the room state used by the UI. */
export const lobbyPlayerSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  team: teamSchema,
  ready: z.boolean(),
  connected: z.boolean(),
  joinedAt: z.number(),
});
export const lobbySnapshotSchema = z.object({
  roomCode: z.string(),
  mode: gameModeSchema,
  format: matchFormatSchema,
  visibility: roomVisibilitySchema,
  fillBots: z.boolean().default(false),
  botDifficulty: botDifficultySchema.default('normal'),
  hostId: z.string(),
  phase: lobbyPhaseSchema,
  countdown: z.number(),
  players: z.record(z.string(), lobbyPlayerSnapshotSchema),
});
export type LobbyPlayerSnapshot = z.infer<typeof lobbyPlayerSnapshotSchema>;
export type LobbySnapshot = z.infer<typeof lobbySnapshotSchema>;

/** Per-tick player input (client -> server, ~60 Hz). Every field is validated server-side. */
export const inputMessageSchema = z.object({
  seq: z.number().int().min(0),
  forward: z.number().int().min(-1).max(1),
  right: z.number().int().min(-1).max(1),
  jump: z.boolean(),
  sprint: z.boolean(),
  crouch: z.boolean(),
  fire: z.boolean(),
  reload: z.boolean(),
  /** Hold to plant (attackers at a site) or defuse (defenders at the bomb). */
  interact: z.boolean(),
  /** View angles in radians, WITHOUT weapon recoil (the server adds its own). */
  yaw: z.number(),
  pitch: z.number().min(-1.6).max(1.6),
  /** Server time (ms) of the world state the shooter was looking at; used for lag compensation. */
  renderTime: z.number(),
});
export type InputMessage = z.infer<typeof inputMessageSchema>;

export const MATCH_TICK_RATE = 60;
