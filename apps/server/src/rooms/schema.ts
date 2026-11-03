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

/** Replicated in-match state for one player (the server's authoritative simulation result). */
export const SimPlayerSchema = schema(
  {
    id: t.string().default(''),
    name: t.string().default(''),
    team: t.string().default('attackers'),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    vx: t.float32().default(0),
    vy: t.float32().default(0),
    vz: t.float32().default(0),
    yaw: t.float32().default(0),
    pitch: t.float32().default(0),
    grounded: t.boolean().default(true),
    crouching: t.boolean().default(false),
    alive: t.boolean().default(true),
    health: t.uint8().default(100),
    ammo: t.uint8().default(30),
    reserve: t.uint8().default(120),
    reloading: t.boolean().default(false),
    kills: t.uint16().default(0),
    deaths: t.uint16().default(0),
    /** Last input sequence the server has applied (for client reconciliation). */
    ackSeq: t.int32().default(-1),
  },
  'SimPlayer',
);
export type SimPlayerSchema = SchemaType<typeof SimPlayerSchema>;

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
    /** Server simulation tick (60 Hz) and its time in ms: clients interpolate against this. */
    tick: t.uint32().default(0),
    timeMs: t.float64().default(0),
    sim: t.map(SimPlayerSchema),
  },
  'LobbyState',
);
export type LobbyState = SchemaType<typeof LobbyState>;
