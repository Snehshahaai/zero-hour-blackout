import { randomInt } from 'node:crypto';
import { CloseCode, matchMaker, Room, ServerError, validate, type Client } from '@colyseus/core';
import {
  MATCH_START_COUNTDOWN_SECONDS,
  RECONNECT_GRACE_SECONDS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  createRoomOptionsSchema,
  lobbyMessageSchemas,
  playerJoinOptionsSchema,
  type GameMode,
  type MatchFormat,
  type RoomVisibility,
} from '@zhb/shared';
import {
  canStart,
  canSwitchTeam,
  pickHost,
  pickTeamForJoin,
  RateLimiter,
  roomCapacity,
  uniqueName,
} from './lobbyRules.ts';
import { LobbyState, PlayerSchema } from './schema.ts';

interface Metadata {
  roomCode: string;
  visibility: RoomVisibility;
  format: MatchFormat;
  mode: GameMode;
}

function randomCode(): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++)
    s += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return s;
}

/**
 * Lobby (and, in 5b/6, match) room. The server owns all lobby state: clients only send
 * validated intents (`setTeam`, `setReady`, `start`) and the server decides what happens.
 * The room id *is* the shareable 6-character room code.
 */
export class MatchRoom extends Room<{ state: LobbyState; metadata: Metadata }> {
  override state = new LobbyState();
  private readonly limiter = new RateLimiter();
  private joinCounter = 0;
  private countdownTimer: { clear(): void } | null = null;

  override async onCreate(options: unknown): Promise<void> {
    // Options are validated again here even though onAuth validated the creator's name:
    // format/mode/visibility decide capacity and matchmaking.
    const parsed = createRoomOptionsSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(4000, 'Invalid room options');
    const { format, mode, visibility } = parsed.data;

    let code = randomCode();
    for (let i = 0; i < 20 && (await matchMaker.getRoomById(code)); i++) code = randomCode();
    if (await matchMaker.getRoomById(code))
      throw new ServerError(4001, 'Could not allocate a room code');
    this.roomId = code;

    this.maxClients = roomCapacity(format);
    this.state.roomCode = code;
    this.state.format = format;
    this.state.mode = mode;
    this.state.visibility = visibility;
    this.metadata = { roomCode: code, visibility, format, mode };
  }

  override onAuth(_client: Client, options: unknown): { playerName: string } {
    const parsed = playerJoinOptionsSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(4002, 'Invalid player name');
    return parsed.data;
  }

  override onJoin(client: Client, _options: unknown, auth?: { playerName: string }): void {
    if (this.state.phase !== 'lobby') throw new ServerError(4003, 'Match already started');
    const format = this.state.format as MatchFormat;
    const team = pickTeamForJoin(this.state.players.values(), format);
    if (!team) throw new ServerError(4004, 'Room is full');

    const names = [...this.state.players.values()].map((p) => p.name);
    const player = new PlayerSchema();
    player.id = client.sessionId;
    player.name = uniqueName(auth?.playerName ?? 'Operator', names);
    player.team = team;
    player.joinedAt = ++this.joinCounter;
    this.state.players.set(client.sessionId, player);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    // A clean leave, or a kick for a protocol violation (malformed message), frees the slot
    // immediately. Only genuine connection drops get the reconnection grace period.
    const dropped = code !== CloseCode.CONSENTED && code !== CloseCode.WITH_ERROR;

    if (dropped && this.state.phase !== 'inMatch') {
      player.connected = false;
      this.cancelCountdown(); // a missing player invalidates a pending start
      try {
        const rejoined = await this.allowReconnection(client, RECONNECT_GRACE_SECONDS);
        player.connected = true;
        this.limiter.forget(client.sessionId);
        void rejoined;
        return;
      } catch {
        // grace period elapsed (or room closing): fall through and remove
      }
    }
    this.removePlayer(client.sessionId);
  }

  override onDispose(): void {
    this.countdownTimer?.clear();
  }

  override messages = {
    setTeam: validate(lobbyMessageSchemas.setTeam, (client, msg) => {
      if (!this.guard(client)) return;
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase !== 'lobby') return;
      const result = canSwitchTeam(
        this.state.players.values(),
        player,
        msg.team,
        this.state.format as MatchFormat,
      );
      if (!result.ok) return this.reject(client, result.code, result.message);
      player.team = msg.team;
      player.ready = false; // changing sides un-readies, so nobody is readied into a surprise
    }),

    setReady: validate(lobbyMessageSchemas.setReady, (client, msg) => {
      if (!this.guard(client)) return;
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase !== 'lobby') return;
      player.ready = msg.ready;
    }),

    start: validate(lobbyMessageSchemas.start, (client) => {
      if (!this.guard(client)) return;
      if (this.state.phase !== 'lobby') return;
      const result = canStart(this.state.players.values(), this.state.hostId, client.sessionId);
      if (!result.ok) return this.reject(client, result.code, result.message);
      this.beginCountdown();
    }),
  };

  /** Rate limit + membership check shared by every message handler. */
  private guard(client: Client): boolean {
    if (!this.state.players.has(client.sessionId)) return false;
    if (!this.limiter.allow(client.sessionId)) {
      this.reject(client, 'rate_limited', 'Slow down.');
      return false;
    }
    return true;
  }

  private reject(client: Client, code: string, message: string): void {
    client.send('error', { code, message });
  }

  private removePlayer(id: string): void {
    this.state.players.delete(id);
    this.limiter.forget(id);
    this.cancelCountdown();
    if (this.state.hostId === id) {
      this.state.hostId = pickHost(this.state.players.values()) ?? '';
    }
  }

  private beginCountdown(): void {
    this.state.phase = 'starting';
    this.state.countdown = MATCH_START_COUNTDOWN_SECONDS;
    void this.lock();
    this.countdownTimer = this.clock.setInterval(() => {
      this.state.countdown = Math.max(0, this.state.countdown - 1);
      if (this.state.countdown === 0) {
        this.countdownTimer?.clear();
        this.countdownTimer = null;
        this.state.phase = 'inMatch';
      }
    }, 1000);
  }

  private cancelCountdown(): void {
    if (this.state.phase !== 'starting') return;
    this.countdownTimer?.clear();
    this.countdownTimer = null;
    this.state.phase = 'lobby';
    this.state.countdown = 0;
    for (const p of this.state.players.values()) p.ready = false;
    void this.unlock();
  }
}
