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
    isBot: t.boolean().default(false),
    side: t.string().default('attackers'),
    interactProgress: t.float32().default(0),
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

export const ZonePowerSchema = schema(
  {
    cut: t.boolean().default(false),
    secondsLeft: t.float32().default(0),
    cooldownLeft: t.float32().default(0),
  },
  'ZonePower',
);
export const DoorSchema = schema({ closed: t.boolean().default(false) }, 'Door');

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
    roundPhase: t.string().default('freeze'),
    roundNumber: t.uint8().default(0),
    /** Seconds left in the current phase (bomb fuse while planted). */
    phaseTimeLeft: t.float32().default(0),
    /** Round wins per fixed lobby team. */
    scoreAttackers: t.uint8().default(0),
    scoreDefenders: t.uint8().default(0),
    /** True after halftime: lobby "attackers" now play the defender side and vice versa. */
    swapped: t.boolean().default(false),
    bombState: t.string().default('none'),
    bombSite: t.string().default(''),
    matchWinner: t.string().default(''),
    tick: t.uint32().default(0),
    timeMs: t.float64().default(0),
    sim: t.map(SimPlayerSchema),
    /** Per-zone power for the zones that have a panel. */
    power: t.map(ZonePowerSchema),
    doors: t.map(DoorSchema),
    weather: t.string().default('clear'),
    /** Cooperative mission state (unused in competitive matches). */
    missionState: t.string().default('briefing'),
    objectiveIndex: t.uint8().default(0),
    objectiveLabel: t.string().default(''),
    objectiveProgress: t.float32().default(0),
    missionTimeLeft: t.float32().default(0),
    hostilesAlive: t.uint8().default(0),
  },
  'LobbyState',
);
export type LobbyState = SchemaType<typeof LobbyState>;
