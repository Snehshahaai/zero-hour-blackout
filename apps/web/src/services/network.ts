import { Client, type Room } from '@colyseus/sdk';
import {
  MATCH_ROOM_NAME,
  lobbyErrorSchema,
  lobbySnapshotSchema,
  type LobbyError,
  type LobbySnapshot,
  type MatchFormat,
  type RoomVisibility,
  type Team,
} from '@zhb/shared';
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

function describe(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string') return e;
  return 'Could not reach the game server.';
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
  ): Promise<boolean> {
    return this.connect(() =>
      this.client.create(MATCH_ROOM_NAME, { playerName, format, visibility, mode: 'competitive' }),
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
