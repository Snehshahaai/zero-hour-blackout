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

/** Options a client sends when creating a private room. Validated server-side. */
export const createRoomOptionsSchema = z.object({
  playerName: playerNameSchema,
  mode: gameModeSchema.default('competitive'),
  format: matchFormatSchema.default('1v1'),
});
export type CreateRoomOptions = z.infer<typeof createRoomOptionsSchema>;

export const joinRoomOptionsSchema = z.object({
  playerName: playerNameSchema,
  roomCode: roomCodeSchema,
});
export type JoinRoomOptions = z.infer<typeof joinRoomOptionsSchema>;
