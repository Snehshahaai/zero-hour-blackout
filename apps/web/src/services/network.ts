import { Client, type Room } from '@colyseus/sdk';
import {
  MATCH_ROOM_NAME,
  lobbyErrorSchema,
  lobbySnapshotSchema,
  type LobbyError,
  type LobbySnapshot,
  type GameMode,
  type MatchFormat,
  type RoomVisibility,
  type Team,
} from '@zhb/shared';
import type {
  MatchNet,
  MatchSnapshot,
  NetBombEvent,
  NetHit,
  NetKill,
  NetMissionEvent,
  NetPlayer,
  NetPowerEvent,
  NetPowerState,
  NetRoundEvent,
  NetShot,
  RoundInfo,
} from '@zhb/game-engine';
import { SERVER_HTTP_URL } from './serverStatus.ts';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';

export interface NetworkState {
  status: ConnectionStatus;
  /** Last connection-level problem (join refused, dropped for good). */
  error: string | null;
  lobby: LobbySnapshot | null;
  mySessionId: string | null;
  /** Last rule rejection from the server (e.g. "Teams must have the same number of players"). */
  notice: LobbyError | null;
}

const IDLE: NetworkState = {
  status: 'idle',
  error: null,
  lobby: null,
  mySessionId: null,
  notice: null,
};
const STORAGE_KEY = 'zhb.session';
/** Colyseus close code for a consented leave. */
const CONSENTED = 4000;

const wsUrl = SERVER_HTTP_URL.replace(/^http/, 'ws');

function readSaved(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeSaved(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, token);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: reconnect-after-refresh just won't work */
  }
}

/**
 * Turns Colyseus/matchmaker errors into messages a player can act on. Raw messages such as
 * `room "ABC123" is locked` or `Internal Server Error` are never shown.
 */
export function describe(e: unknown): string {
  const err = e as { code?: number; message?: string } | undefined;
  const code = err?.code;
  const msg = (typeof e === 'string' ? e : err?.message) ?? '';
  if (code === 522 && /not found/i.test(msg))
    return 'No room with that code. Check it and try again.';
  if (code === 522 || /locked/i.test(msg))
    return 'That room is full or its match has already started.';
  if (code === 4002 || /player name/i.test(msg))
    return 'That callsign is not allowed. Use 2-24 letters, numbers, spaces, _ . -';
  if (code === 503 || /busy|full/i.test(msg))
    return 'The server is busy right now. Please try again in a moment.';
  if (code === 429 || /too many/i.test(msg))
    return 'Too many connection attempts. Wait a few seconds and try again.';
  if (code === 400) return 'The server rejected that request. Reload the page and try again.';
  if (typeof code === 'number' && code >= 500) return 'The server had a problem. Please try again.';
  if (/failed to fetch|network|econnrefused|websocket|load failed/i.test(msg) || !msg) {
    return 'Could not reach the game server. Check your connection and try again.';
  }
  return 'Could not join. Please try again.';
}

/**
 * Owns the single lobby connection. The UI subscribes to immutable snapshots; it never
 * touches the Colyseus room. All game rules live on the server: this only sends intents.
 */
class Network {
  private state: NetworkState = IDLE;
  private readonly listeners = new Set<() => void>();
  private room: Room | null = null;
  private client = new Client(wsUrl);
  private leaving = false;

  getState = (): NetworkState => this.state;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<NetworkState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  async createRoom(
    playerName: string,
    format: MatchFormat,
    visibility: RoomVisibility = 'private',
    mode: GameMode = 'competitive',
  ): Promise<boolean> {
    return this.connect(() =>
      this.client.create(MATCH_ROOM_NAME, { playerName, format, visibility, mode }),
    );
  }

  async joinRoom(playerName: string, roomCode: string): Promise<boolean> {
    return this.connect(() => this.client.joinById(roomCode, { playerName }));
  }

  async quickPlay(playerName: string, format: MatchFormat): Promise<boolean> {
    return this.connect(() =>
      this.client.joinOrCreate(MATCH_ROOM_NAME, {
        playerName,
        format,
        visibility: 'public',
        mode: 'competitive',
      }),
    );
  }

  /** Called once at startup: resumes a lobby after a page refresh if the slot is still held. */
  async resume(): Promise<boolean> {
    const token = readSaved();
    if (!token || this.room) return false;
    this.set({ status: 'reconnecting', error: null });
    const ok = await this.tryReconnect(token, 1);
    if (!ok) this.set({ status: 'idle' });
    return ok;
  }

  async leave(): Promise<void> {
    const room = this.room;
    this.leaving = true;
    writeSaved(null);
    this.room = null;
    this.set({ ...IDLE });
    try {
      await room?.leave();
    } catch {
      /* already closed */
    }
    this.leaving = false;
  }

  /** Adapter the in-match game uses to talk to the room. Null when not in a room. */
  matchBridge(): MatchNet | null {
    const room = this.room;
    if (!room) return null;
    const snapshot = (): MatchSnapshot => {
      const raw = room.state.toJSON() as {
        tick: number;
        timeMs: number;
        sim: Record<string, NetPlayer>;
        roundPhase: RoundInfo['phase'];
        roundNumber: number;
        phaseTimeLeft: number;
        scoreAttackers: number;
        scoreDefenders: number;
        swapped: boolean;
        bombState: RoundInfo['bombState'];
        bombSite: string;
        matchWinner: RoundInfo['matchWinner'];
        power: Record<string, NetPowerState>;
        doors: Record<string, { closed: boolean }>;
        weather: MatchSnapshot['weather'];
        mode: MatchSnapshot['mode'];
        missionState: MatchSnapshot['mission']['state'];
        objectiveIndex: number;
        objectiveLabel: string;
        objectiveProgress: number;
        missionTimeLeft: number;
        hostilesAlive: number;
      };
      return {
        tick: raw.tick,
        timeMs: raw.timeMs,
        // toJSON() omits empty maps, so these are undefined until the server has filled them.
        players: raw.sim ?? {},
        power: raw.power ?? {},
        doors: raw.doors ?? {},
        weather: raw.weather ?? 'clear',
        mode: raw.mode ?? 'competitive',
        mission: {
          state: raw.missionState ?? 'briefing',
          objectiveIndex: raw.objectiveIndex ?? 0,
          label: raw.objectiveLabel ?? '',
          progress: raw.objectiveProgress ?? 0,
          timeLeft: raw.missionTimeLeft ?? 0,
          hostiles: raw.hostilesAlive ?? 0,
        },
        round: {
          phase: raw.roundPhase,
          number: raw.roundNumber,
          timeLeft: raw.phaseTimeLeft,
          scoreAttackers: raw.scoreAttackers,
          scoreDefenders: raw.scoreDefenders,
          swapped: raw.swapped,
          bombState: raw.bombState,
          bombSite: raw.bombSite,
          matchWinner: raw.matchWinner,
        },
      };
    };
    const sub = <T>(type: string, cb: (e: T) => void) => room.onMessage(type, cb);
    return {
      mySessionId: room.sessionId,
      sendInput: (input) => room.send('input', input),
      onSnapshot: (cb) => {
        // Fire once per distinct server tick, not on every unrelated state change.
        let lastTick = -1;
        const handler = () => {
          const snap = snapshot();
          if (snap.tick === lastTick) return;
          lastTick = snap.tick;
          cb(snap);
        };
        room.onStateChange(handler);
        return () => room.onStateChange.remove(handler);
      },
      onShot: (cb) => sub<NetShot>('shot', cb),
      onHit: (cb) => sub<NetHit>('hit', cb),
      onKill: (cb) => sub<NetKill>('kill', cb),
      onRound: (cb) => sub<NetRoundEvent>('round', cb),
      onBomb: (cb) => sub<NetBombEvent>('bomb', cb),
      onPower: (cb) => sub<NetPowerEvent>('power', cb),
      onMission: (cb) => sub<NetMissionEvent>('mission', cb),
    };
  }

  setTeam(team: Team): void {
    this.room?.send('setTeam', { team });
  }
  setReady(ready: boolean): void {
    this.room?.send('setReady', { ready });
  }
  start(): void {
    this.room?.send('start', {});
  }
  clearNotice(): void {
    if (this.state.notice) this.set({ notice: null });
  }
  clearError(): void {
    if (this.state.error) this.set({ error: null });
  }

  private async connect(join: () => Promise<Room>): Promise<boolean> {
    if (this.room) await this.leave();
    this.set({ status: 'connecting', error: null, notice: null });
    try {
      this.attach(await join());
      return true;
    } catch (e) {
      this.set({ status: 'idle', error: describe(e) });
      return false;
    }
  }

  private attach(room: Room): void {
    this.room = room;
    writeSaved(room.reconnectionToken);
    this.set({ status: 'connected', mySessionId: room.sessionId, error: null });
    this.sync(room);

    room.onStateChange(() => this.sync(room));
    room.onMessage('error', (raw: unknown) => {
      const parsed = lobbyErrorSchema.safeParse(raw);
      if (parsed.success) this.set({ notice: parsed.data });
    });
    room.onLeave((code: number) => {
      if (this.room !== room || this.leaving) return;
      this.room = null;
      if (code === CONSENTED) {
        writeSaved(null);
        this.set({ ...IDLE });
        return;
      }
      void this.recover(room.reconnectionToken);
    });
  }

  private sync(room: Room): void {
    const raw = room.state.toJSON() as Record<string, unknown>;
    if (!raw.roomCode) return; // initial state has not arrived yet
    const parsed = lobbySnapshotSchema.safeParse(raw);
    if (parsed.success) this.set({ lobby: parsed.data });
    else
      console.warn(
        '[network] ignoring invalid lobby snapshot',
        JSON.stringify(parsed.error.issues),
      );
  }

  /** Unexpected disconnect: retry with backoff inside the server's grace period. */
  private async recover(token: string): Promise<void> {
    this.set({ status: 'reconnecting' });
    const ok = await this.tryReconnect(token, 5);
    if (!ok) {
      writeSaved(null);
      this.set({ ...IDLE, error: 'Connection lost. The server did not accept the reconnection.' });
    }
  }

  private async tryReconnect(token: string, attempts: number): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      try {
        this.attach(await this.client.reconnect(token));
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
    return false;
  }
}

export const network = new Network();
