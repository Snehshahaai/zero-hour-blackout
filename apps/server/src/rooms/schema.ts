import { schema, t, type SchemaType } from '@colyseus/schema';

export const PlayerSchema = schema(
  {
    id: t.string().default(''),
    name: t.string().default(''),
    team: t.string().default('attackers'),
    ready: t.boolean().default(false),
    connected: t.boolean().default(true),
    joinedAt: t.uint32().default(0),
  },
  'Player',
);
export type PlayerSchema = SchemaType<typeof PlayerSchema>;

export const LobbyState = schema(
  {
    roomCode: t.string().default(''),
    mode: t.string().default('competitive'),
    format: t.string().default('1v1'),
    visibility: t.string().default('private'),
    hostId: t.string().default(''),
    phase: t.string().default('lobby'),
    /** Seconds left while phase is "starting". */
    countdown: t.uint8().default(0),
    players: t.map(PlayerSchema),
  },
  'LobbyState',
);
export type LobbyState = SchemaType<typeof LobbyState>;
