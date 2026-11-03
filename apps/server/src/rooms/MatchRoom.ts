import { randomInt } from 'node:crypto';
import { CloseCode, matchMaker, Room, ServerError, validate, type Client } from '@colyseus/core';
import {
  MATCH_START_COUNTDOWN_SECONDS,
  MATCH_TICK_RATE,
  RECONNECT_GRACE_SECONDS,
  inputMessageSchema,
  type CoopRules,
  type PowerRules,
  type RoundRules,
  type Weather,
  type Team,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  createRoomOptionsSchema,
  lobbyMessageSchemas,
  playerJoinOptionsSchema,
  type BotDifficulty,
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
  teamCapacity,
  uniqueName,
} from './lobbyRules.ts';
import { MAP_01, initPhysics } from '@zhb/game-engine/sim';
import { metrics } from '../services/metrics.ts';
import { MatchSim, type SimEvent } from '../sim/MatchSim.ts';
import { CompetitiveBots } from '../sim/CompetitiveBots.ts';
import { CoopMission, type MissionEvent } from '../sim/CoopMission.ts';
import { PowerGrid, type PowerEvent } from '../sim/PowerGrid.ts';
import { RoundManager, type RoundEvent } from '../sim/RoundManager.ts';
import {
  DoorSchema,
  LobbyState,
  PlayerSchema,
  SimPlayerSchema,
  ZonePowerSchema,
} from './schema.ts';

interface Metadata {
  roomCode: string;
  visibility: RoomVisibility;
  format: MatchFormat;
  mode: GameMode;
}

/** Weather is cosmetic only; chosen by the server so every player in the match sees the same. */
function pickWeather(): Weather {
  const r = randomInt(100);
  return r < 45 ? 'clear' : r < 70 ? 'fog' : 'rain';
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
/** Most ticks one timer callback may run to catch up after a stall (~0.2 s of game time). */
const MAX_CATCHUP_TICKS = 12;

export class MatchRoom extends Room<{ state: LobbyState; metadata: Metadata }> {
  override state = new LobbyState();
  private readonly limiter = new RateLimiter();
  /** Inputs arrive at ~60 Hz per client, so they get their own, much larger budget. */
  private readonly inputLimiter = new RateLimiter(120, 140);
  /** Server-side round timing; set by `createGameServer` (tests use short rounds). Never client-controlled. */
  static roundRules: Partial<RoundRules> = {};
  static deathmatchKills = 40;
  static coopLives = 3;
  static respawnDelay = 3;
  static powerRules: Partial<PowerRules> = {};
  static coopRules: Partial<CoopRules> = {};
  /** Process-wide cap on simultaneous rooms (configured by `createGameServer`). */
  static maxRooms = Infinity;
  /** How long a dropped player's seat is held for reconnection. */
  static reconnectGraceSeconds: number = RECONNECT_GRACE_SECONDS;
  /** Forces the weather (tests/ops). Unset = random per match, decided by the server. */
  static weatherOverride: Weather | null = null;
  private sim: MatchSim | null = null;
  private rounds: RoundManager | null = null;
  private power: PowerGrid | null = null;
  private coop: CoopMission | null = null;
  private bots: CompetitiveBots | null = null;
  private joinCounter = 0;
  private countdownTimer: { clear(): void } | null = null;

  override async onCreate(options: unknown): Promise<void> {
    // Options are validated again here even though onAuth validated the creator's name:
    // format/mode/visibility decide capacity and matchmaking.
    if (matchMaker.stats.local.roomCount >= MatchRoom.maxRooms) {
      throw new ServerError(503, 'Server is busy, try again shortly');
    }
    const parsed = createRoomOptionsSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(400, 'Invalid room options');
    const { mode, fillBots, botDifficulty } = parsed.data;
    // Playing against AI is always a 1v1 deathmatch to 40 kills, whatever format was asked for.
    const format = fillBots && mode === 'competitive' ? '1v1' : parsed.data.format;
    // Rooms with bots are always private: they are practice rooms, never matched into public play.
    const visibility = fillBots && mode === 'competitive' ? 'private' : parsed.data.visibility;

    let code = randomCode();
    for (let i = 0; i < 20 && (await matchMaker.getRoomById(code)); i++) code = randomCode();
    if (await matchMaker.getRoomById(code))
      throw new ServerError(503, 'Could not allocate a room code');
    this.roomId = code;
    metrics.counters.roomsCreated++;

    this.maxClients = roomCapacity(format, mode);
    this.state.roomCode = code;
    this.state.format = format;
    this.state.mode = mode;
    this.state.visibility = visibility;
    this.state.fillBots = fillBots && mode === 'competitive';
    this.state.botDifficulty = botDifficulty;
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
    const team = pickTeamForJoin(this.state.players.values(), format, this.state.mode as GameMode);
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
    // NOTE: an oversized-message disconnect surfaces as 1006, indistinguishable from a real network
    // drop, so such a client does hold its seat for the grace period (bounded; see docs/SECURITY.md).
    const dropped = code !== CloseCode.CONSENTED && code !== CloseCode.WITH_ERROR;

    if (dropped) {
      player.connected = false;
      const simPlayer = this.sim?.players.get(client.sessionId);
      if (simPlayer) simPlayer.queue.length = 0;
      this.cancelCountdown(); // a missing player invalidates a pending start
      try {
        const rejoined = await this.allowReconnection(client, MatchRoom.reconnectGraceSeconds);
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
    this.sim?.dispose();
    this.sim = null;
    this.rounds = null;
    this.power = null;
    this.coop = null;
    this.bots = null;
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
        this.state.mode as GameMode,
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

    input: validate(inputMessageSchema, (client, msg) => {
      if (!this.sim || !this.inputLimiter.allow(client.sessionId)) return;
      metrics.counters.inputsAccepted++;
      this.sim.queueInput(client.sessionId, msg);
    }),

    start: validate(lobbyMessageSchemas.start, (client) => {
      if (!this.guard(client)) return;
      if (this.state.phase !== 'lobby') return;
      const result = canStart(
        this.state.players.values(),
        this.state.hostId,
        client.sessionId,
        this.state.mode as GameMode,
        this.state.fillBots,
      );
      if (!result.ok) return this.reject(client, result.code, result.message);
      this.beginCountdown();
    }),
  };

  /** Starts the authoritative simulation for everyone currently in the lobby. */
  private async startMatch(): Promise<void> {
    await initPhysics();
    if (this.sim || this.state.phase !== 'inMatch') return;
    const sim = new MatchSim(MAP_01, (e) => this.onSimEvent(e), null); // dead stay dead until next round
    for (const p of this.state.players.values()) {
      sim.addPlayer(p.id, p.name, p.team as Team);
      this.state.sim.set(p.id, new SimPlayerSchema());
    }
    // Respawns: co-op gives every operator their own 3 per objective; 1v1 deathmatch always respawns;
    // 2v2 rounds have none (you stay down until the next round, spectating a teammate).
    const deathmatch = this.state.mode === 'competitive' && this.state.format === '1v1';
    if (this.state.mode === 'cooperative')
      sim.setLives({
        scope: 'player',
        count: MatchRoom.coopLives,
        delay: MatchRoom.respawnDelay,
        bots: false,
      });
    else if (deathmatch)
      sim.setLives({ scope: 'player', count: 255, delay: MatchRoom.respawnDelay, bots: true });
    this.state.deathmatchKills = deathmatch ? MatchRoom.deathmatchKills : 0;
    this.sim = sim;
    metrics.counters.matchesStarted++;
    this.state.weather = MatchRoom.weatherOverride ?? pickWeather();
    if (this.state.mode === 'cooperative') {
      this.coop = new CoopMission(sim, MAP_01, (e) => this.onMissionEvent(e), MatchRoom.coopRules);
      this.coop.start();
    } else {
      this.power = new PowerGrid(sim, MAP_01, (e) => this.onPowerEvent(e), MatchRoom.powerRules);
      for (const panel of MAP_01.panels) this.state.power.set(panel.zone, new ZonePowerSchema());
      for (const door of MAP_01.doors) this.state.doors.set(door.id, new DoorSchema());
      this.rounds = new RoundManager(sim, MAP_01, (e) => this.onRoundEvent(e), {
        ...(this.state.deathmatchKills ? { deathmatchKills: this.state.deathmatchKills } : {}),
        ...MatchRoom.roundRules,
      });
      if (this.state.fillBots) this.addBotsToEmptySlots(sim, this.rounds);
      this.rounds.start();
    }
    this.patchRate = 50; // 20 Hz state broadcast; the sim itself ticks at 60 Hz
    this.simClock = performance.now();
    this.setSimulationInterval(() => this.catchUp(), 1000 / MATCH_TICK_RATE);
  }

  /** Practice rooms: AI players take every slot no human filled, on both teams. */
  private addBotsToEmptySlots(sim: MatchSim, rounds: RoundManager): void {
    const bots = new CompetitiveBots(
      sim,
      rounds,
      MAP_01,
      this.state.botDifficulty as BotDifficulty,
      Date.now() & 0x7fffffff,
    );
    const size = teamCapacity(this.state.format as MatchFormat);
    for (const team of ['attackers', 'defenders'] as const) {
      let humans = 0;
      for (const p of this.state.players.values()) if (p.team === team) humans++;
      for (let i = humans; i < size; i++) bots.addBot(team);
    }
    this.bots = bots;
  }

  private simClock = 0;

  /**
   * Keeps game time on the wall clock. On a starved host (free-tier CPU) timer callbacks arrive
   * late; stepping once per callback would stretch every round timer. Instead run the ticks that
   * are due, capped so a long stall cannot snowball into a death spiral.
   */
  private catchUp(): void {
    const step = 1000 / MATCH_TICK_RATE;
    const now = performance.now();
    let due = Math.floor((now - this.simClock) / step);
    if (due > MAX_CATCHUP_TICKS) {
      this.simClock = now - step * MAX_CATCHUP_TICKS; // forget the unrecoverable backlog
      due = MAX_CATCHUP_TICKS;
    }
    for (let i = 0; i < Math.max(1, due); i++) {
      if (!this.sim) return;
      this.stepSim();
    }
    this.simClock += step * Math.max(1, due);
  }

  private stepSim(): void {
    const sim = this.sim;
    if (!sim) return;
    const t0 = performance.now();
    try {
      this.stepSimInner(sim);
    } finally {
      metrics.simStepMs.record(performance.now() - t0);
    }
  }

  private stepSimInner(sim: MatchSim): void {
    // Bots queue their inputs first, exactly like clients do between ticks. The door signature
    // makes them re-plan their routes when an electronic door opens or closes.
    this.bots?.step(this.power ? [...this.power.doorsClosed.values()].join() : '');
    sim.step();
    this.rounds?.step();
    if (this.sim !== sim) return; // the round manager ended the match and reset the room
    const m = this.coop;
    if (m) {
      m.step();
      if (this.sim !== sim) return; // the mission just finished and reset the room
      this.state.missionState = m.state;
      this.state.objectiveIndex = m.objective;
      this.state.objectiveLabel = m.label;
      this.state.objectiveProgress = Math.round(m.progress * 100) / 100;
      this.state.missionTimeLeft = Math.max(0, Math.round(m.timeLeft));
      this.state.hostilesAlive = m.hostilesAlive;
    }
    // Bots come and go during a mission: keep the replicated player map in step with the sim.
    for (const id of [...this.state.sim.keys()])
      if (!sim.players.has(id)) this.state.sim.delete(id);
    for (const id of sim.players.keys()) {
      if (!this.state.sim.has(id)) this.state.sim.set(id, new SimPlayerSchema());
    }
    const r = this.rounds;
    if (this.power && r) {
      this.power.step(r.phase === 'live' || r.phase === 'planted');
      for (const [zone, z] of this.power.zones) {
        const view = this.state.power.get(zone);
        if (!view) continue;
        view.cut = z.cut;
        view.secondsLeft = Math.round(z.left * 10) / 10;
        view.cooldownLeft = Math.round(z.cooldown * 10) / 10;
      }
      for (const [id, closed] of this.power.doorsClosed) {
        const view = this.state.doors.get(id);
        if (view) view.closed = closed;
      }
    }
    if (r) {
      this.state.roundPhase = r.phase;
      this.state.roundNumber = r.round;
      this.state.phaseTimeLeft = Math.max(0, Math.round(r.timeLeft * 10) / 10);
      this.state.scoreAttackers = r.scores.attackers;
      this.state.scoreDefenders = r.scores.defenders;
      this.state.swapped = r.swapped;
      this.state.bombState = r.bomb.planted ? 'planted' : 'none';
      this.state.bombSite = r.bomb.site;
      this.state.matchWinner = r.matchWinner ?? '';
    }
    this.state.tick = sim.tick;
    this.state.timeMs = sim.timeMs;
    for (const sp of sim.players.values()) {
      const view = this.state.sim.get(sp.id);
      if (!view) continue;
      const st = sp.controller.state;
      view.id = sp.id;
      view.name = sp.name;
      view.team = sp.team;
      view.isBot = sp.isBot;
      view.side = sp.side;
      view.interactProgress = Math.round(sp.interactProgress * 100) / 100;
      view.x = st.x;
      view.y = st.y;
      view.z = st.z;
      view.vx = st.vx;
      view.vy = st.vy;
      view.vz = st.vz;
      view.yaw = sp.yaw;
      view.pitch = sp.pitch;
      view.grounded = st.grounded;
      view.crouching = st.crouching;
      view.alive = sp.alive;
      view.health = sp.health.current;
      view.ammo = sp.weapon.ammo;
      view.reserve = sp.weapon.reserve;
      view.reloading = sp.weapon.reloading;
      view.kills = sp.kills;
      view.deaths = sp.deaths;
      view.ackSeq = sp.ackSeq;
      view.livesLeft = sim.livesFor(sp);
      view.respawnIn = sp.pendingRespawn ? Math.round(sp.respawnIn * 10) / 10 : 0;
    }
  }

  private onRoundEvent(e: RoundEvent): void {
    if (e.type === 'finished') {
      this.resetToLobby();
      return;
    }
    if (e.type === 'roundStart') {
      this.power?.reset();
      this.bots?.onRoundStart();
    }
    this.broadcast(e.type === 'bomb' ? 'bomb' : 'round', e);
  }

  private onMissionEvent(e: MissionEvent): void {
    if (e.type === 'finished') {
      this.resetToLobby();
      return;
    }
    this.broadcast('mission', e);
  }

  private onPowerEvent(e: PowerEvent): void {
    if (e.type === 'power') this.broadcast('power', e);
  }

  /** Match is over: tear down the simulation and return everyone to the lobby, unready. */
  private resetToLobby(): void {
    metrics.counters.matchesFinished++;
    this.sim?.dispose();
    this.sim = null;
    this.rounds = null;
    this.power = null;
    this.coop = null;
    this.bots = null;
    this.state.missionState = 'briefing';
    this.state.objectiveIndex = 0;
    this.state.objectiveLabel = '';
    this.state.objectiveProgress = 0;
    this.state.missionTimeLeft = 0;
    this.state.hostilesAlive = 0;
    this.state.sim.clear();
    this.state.power.clear();
    this.state.doors.clear();
    this.state.weather = 'clear';
    this.state.deathmatchKills = 0;
    for (const p of this.state.players.values()) p.ready = false;
    this.state.phase = 'lobby';
    this.state.countdown = 0;
    this.state.roundPhase = 'freeze';
    this.state.roundNumber = 0;
    this.state.scoreAttackers = 0;
    this.state.scoreDefenders = 0;
    this.state.swapped = false;
    this.state.bombState = 'none';
    this.state.bombSite = '';
    this.state.matchWinner = '';
    void this.unlock();
  }

  private onSimEvent(e: SimEvent): void {
    if (e.type === 'shot') this.broadcast('shot', e);
    else if (e.type === 'kill') this.broadcast('kill', e);
    else {
      // Damage feedback goes to the shooter only.
      const shooter = this.clients.find((c) => c.sessionId === e.shooter);
      shooter?.send('hit', e);
    }
  }

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
    this.state.sim.delete(id);
    this.sim?.removePlayer(id);
    this.limiter.forget(id);
    this.inputLimiter.forget(id);
    this.cancelCountdown();
    if (this.state.hostId === id) {
      this.state.hostId = pickHost(this.state.players.values()) ?? '';
    }
    // Everyone is gone (e.g. all tabs closed and the reconnect grace expired). Colyseus only
    // auto-disposes when the last *client* disconnects, which has already happened by now, so
    // without this the room would sit empty forever and eat into the room cap.
    if (this.state.players.size === 0) {
      this.clock.setTimeout(() => {
        if (this.state.players.size === 0) void this.disconnect().catch(() => undefined);
      }, 0);
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
        void this.startMatch();
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
