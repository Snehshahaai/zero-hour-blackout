import {
  FIXED_DT,
  HX27,
  Health,
  Hitscan,
  PhysicsWorld,
  PlayerController,
  WeaponSim,
  computeDamage,
  viewDirection,
  type Hittable,
  type MapDef,
  type Point3,
} from '@zhb/game-engine/sim';
import { MATCH_TICK_RATE, type InputMessage, type Team } from '@zhb/shared';

/** How far back a shot may be rewound (ms). Caps how much lag a shooter can "buy". */
const MAX_REWIND_MS = 250;
const HISTORY_TICKS = 30;
const TICK_MS = 1000 / MATCH_TICK_RATE;
const MAX_QUEUE = 8;
/** A held interact key expires if no fresh input arrives for this many ticks (200 ms). */
const INTERACT_STALE_TICKS = 12;
/** Max stored input credit: absorbs network bursts without allowing speed-hacking. */
const MAX_CREDIT = 4;

export type SimEvent =
  | {
      type: 'shot';
      shooter: string;
      from: Point3;
      to: Point3;
      hit: 'none' | 'world' | 'player';
      normal: Point3;
    }
  | {
      type: 'hit';
      shooter: string;
      victim: string;
      damage: number;
      headshot: boolean;
      killed: boolean;
    }
  | { type: 'kill'; killer: string; victim: string };

export interface SimPlayer {
  id: string;
  /** AI-controlled (cooperative missions). Bots go through the same movement/weapon code. */
  isBot: boolean;
  name: string;
  /** Fixed lobby team: scoring and friendly fire. */
  team: Team;
  /** Current side (attackers/defenders); swaps at halftime. Decides spawns and objectives. */
  side: Team;
  /** Holding the interact key (expires if the client stops sending inputs). */
  interact: boolean;
  /** Ticks since this player last supplied an input. */
  sinceInput: number;
  /** 0..1 progress of the plant/defuse this player is performing. */
  interactProgress: number;
  controller: PlayerController;
  weapon: WeaponSim;
  health: Health;
  alive: boolean;
  kills: number;
  deaths: number;
  ackSeq: number;
  yaw: number;
  pitch: number;
  respawnIn: number;
  /** Dead, but a respawn is already paid for and counting down. */
  pendingRespawn: boolean;
  /** Respawns this player may still use (per-player scope). */
  livesLeft: number;
  queue: InputMessage[];
  lastInput: InputMessage | null;
  /** Inputs this player may still consume: +1 per server tick, capped at MAX_CREDIT. */
  credit: number;
  prevFire: boolean;
  prevReload: boolean;
  hittable: Hittable;
}

type Positions = Map<string, Point3>;

/**
 * Authoritative match simulation. Pure game logic (no networking): the room feeds it
 * validated inputs and reads state/events back. One `step()` = one 1/60 s tick.
 */
export interface LifeRules {
  scope: 'none' | 'player' | 'team';
  count: number;
  /** Seconds between dying and coming back. */
  delay: number;
  /** Do AI players draw on the allowance too (competitive bots yes, co-op hostiles no)? */
  bots: boolean;
}

export class MatchSim {
  readonly players = new Map<string, SimPlayer>();
  tick = 0;
  private readonly physics: PhysicsWorld;
  private readonly hitscan: Hitscan;
  private readonly history: { tick: number; pos: Positions }[] = [];
  private readonly spawnCursor: Record<Team, number> = { attackers: 0, defenders: 0 };
  private nextNumericId = 1;
  private readonly byNumericId = new Map<number, SimPlayer>();

  /** Called whenever anyone fires (position of the shooter): bots use it to "hear". */
  shotListener: ((shooter: SimPlayer, from: Point3) => void) | null = null;

  /** While true, inputs are discarded (round freeze time). */
  frozen = false;

  /**
   * Respawn allowance. `player`: every player gets `count` respawns (reset each round).
   * `team`: one shared pool per team for the whole match. Bots only use it when `bots` is set.
   */
  lives: LifeRules = { scope: 'none', count: 0, delay: 3, bots: false };
  readonly teamLives: Record<Team, number> = { attackers: 0, defenders: 0 };

  setLives(rules: LifeRules): void {
    this.lives = rules;
    this.teamLives.attackers = this.teamLives.defenders = rules.scope === 'team' ? rules.count : 0;
    for (const p of this.players.values()) p.livesLeft = rules.scope === 'player' ? rules.count : 0;
  }

  /** Back to the full shared pool (co-op refills it at every objective). */
  refillTeamLives(): void {
    if (this.lives.scope === 'team')
      this.teamLives.attackers = this.teamLives.defenders = this.lives.count;
  }

  /** Lives a player can still draw on (their own, or their team's shared pool). */
  livesFor(p: SimPlayer): number {
    if (this.lives.scope === 'none' || (p.isBot && !this.lives.bots)) return 0;
    return this.lives.scope === 'team' ? this.teamLives[p.team] : p.livesLeft;
  }

  constructor(
    private readonly map: MapDef,
    private readonly emit: (e: SimEvent) => void,
    /** Seconds until a dead player respawns on their own; null = only at round start. */
    private readonly respawnSeconds: number | null = 3,
  ) {
    this.physics = PhysicsWorld.fromMap(map);
    this.hitscan = new Hitscan(this.physics);
  }

  get timeMs(): number {
    return this.tick * TICK_MS;
  }

  addPlayer(id: string, name: string, team: Team): SimPlayer {
    const spawn = this.nextSpawn(team);
    const controller = new PlayerController(this.physics, { x: spawn[0], y: 0.05, z: spawn[1] });
    const numericId = this.nextNumericId++;
    const hittable: Hittable = {
      id: numericId,
      get feetY() {
        return controller.state.y;
      },
      get height() {
        return controller.bodyHeight;
      },
    };
    this.hitscan.register(controller.collider, hittable);
    const player: SimPlayer = {
      id,
      isBot: false,
      name,
      team,
      side: team,
      interact: false,
      sinceInput: 0,
      interactProgress: 0,
      controller,
      weapon: new WeaponSim(HX27, (numericId * 2654435761) >>> 0),
      health: new Health(100),
      alive: true,
      kills: 0,
      deaths: 0,
      ackSeq: -1,
      yaw: team === 'attackers' ? -Math.PI / 2 : Math.PI / 2,
      pitch: 0,
      respawnIn: 0,
      pendingRespawn: false,
      livesLeft: this.lives.scope === 'player' ? this.lives.count : 0,
      queue: [],
      lastInput: null,
      credit: 0,
      prevFire: false,
      prevReload: false,
      hittable,
    };
    this.players.set(id, player);
    this.byNumericId.set(numericId, player);
    return player;
  }

  /** Adds an AI player at an explicit floor position. */
  addBot(id: string, name: string, team: Team, x: number, z: number, yaw = 0): SimPlayer {
    const p = this.addPlayer(id, name, team);
    p.isBot = true;
    p.controller.teleport(x, 0.05, z);
    p.yaw = yaw;
    return p;
  }

  /** Adds an AI player at its side's normal spawn (competitive bots; round start re-places everyone). */
  addSpawnBot(id: string, name: string, team: Team): SimPlayer {
    const p = this.addPlayer(id, name, team);
    p.isBot = true;
    return p;
  }

  /** Straight walkability between two floor points (used to build the nav graph). */
  segmentClear(ax: number, az: number, bx: number, bz: number): boolean {
    return this.physics.segmentClear(ax, az, bx, bz);
  }

  /** Can `viewerId` see the chest of `targetId` (nothing solid in between)? */
  canSee(viewerId: string, targetId: string): boolean {
    const viewer = this.players.get(viewerId);
    const target = this.players.get(targetId);
    if (!viewer || !target || !viewer.alive || !target.alive) return false;
    const v = viewer.controller.state;
    const t = target.controller.state;
    const from: Point3 = { x: v.x, y: v.y + v.eyeHeight, z: v.z };
    const to: Point3 = { x: t.x, y: t.y + 1.1, z: t.z };
    const dist = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    if (dist < 1e-3) return true;
    const dir = { x: (to.x - from.x) / dist, y: (to.y - from.y) / dist, z: (to.z - from.z) / dist };
    const hit = this.hitscan.cast(from, dir, dist + 0.6, viewer.controller.collider);
    return hit.kind === 'target' && hit.target.id === target.hittable.id;
  }

  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    this.hitscan.unregister(p.controller.collider);
    p.controller.setEnabled(false);
    this.byNumericId.delete(p.hittable.id);
    this.players.delete(id);
  }

  /** Inputs beyond the queue cap are dropped (oldest first); at most one is consumed per tick. */
  queueInput(id: string, input: InputMessage): void {
    const p = this.players.get(id);
    if (!p) return;
    p.queue.push(input);
    if (p.queue.length > MAX_QUEUE) {
      // Never lose a one-shot action (trigger pull, jump, reload) with the dropped input.
      const dropped = p.queue.shift() as InputMessage;
      const next = p.queue[0];
      if (next && (dropped.fire || dropped.jump || dropped.reload)) {
        p.queue[0] = {
          ...next,
          fire: next.fire || dropped.fire,
          jump: next.jump || dropped.jump,
          reload: next.reload || dropped.reload,
        };
      }
    }
  }

  step(): void {
    this.tick++;
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (p.pendingRespawn) {
          p.respawnIn -= FIXED_DT;
          if (p.respawnIn <= 0) this.respawn(p);
        }
        continue;
      }
      this.stepPlayer(p);
    }
    this.physics.refreshQueries(); // one world step for every player moved this tick
    this.recordHistory();
  }

  /**
   * Consumes queued inputs against the player's credit. Credit refills at exactly one input
   * per tick, so bursts after network jitter are absorbed, yet long-run speed can never exceed
   * real time (flooding inputs does nothing). With nothing queued the player is simply not
   * simulated that tick, so the server never runs ahead of what the client actually did.
   */
  private stepPlayer(p: SimPlayer): void {
    if (this.frozen) {
      p.queue.length = 0;
      p.credit = 0;
      p.interact = false;
      return;
    }
    p.credit = Math.min(MAX_CREDIT, p.credit + 1);
    let consumed = 0;
    while (p.credit >= 1 && p.queue.length > 0) {
      consumed++;
      const input = p.queue.shift() as InputMessage;
      p.credit -= 1;
      p.ackSeq = input.seq;
      p.lastInput = input;
      this.applyInput(p, input);
      if (!p.alive) break;
    }
    p.sinceInput = consumed > 0 ? 0 : p.sinceInput + 1;
    // A client that went silent (lag spike, disconnect) must not keep "holding" a key forever.
    if (p.sinceInput > INTERACT_STALE_TICKS) p.interact = false;
  }

  private applyInput(p: SimPlayer, input: InputMessage): void {
    p.yaw = input.yaw;
    p.pitch = input.pitch;
    p.interact = input.interact;

    const c = p.controller;
    // Many players share one physics world: step it once per tick (in `step()`), not per player.
    c.update(
      {
        forward: input.forward,
        right: input.right,
        jump: input.jump,
        sprint: input.sprint,
        crouch: input.crouch,
        yaw: input.yaw,
      },
      false,
    );
    const s = c.state;
    const events = p.weapon.update(
      FIXED_DT,
      {
        trigger: input.fire && !s.sprinting,
        triggerPressed: input.fire && !p.prevFire && !s.sprinting,
        reloadPressed: input.reload && !p.prevReload,
      },
      { speed: Math.hypot(s.vx, s.vz), grounded: s.grounded, crouching: s.crouching },
    );
    p.prevFire = input.fire;
    p.prevReload = input.reload;
    for (const e of events) if (e.type === 'fired') this.resolveShot(p, e, input);
  }

  private resolveShot(
    shooter: SimPlayer,
    e: Extract<ReturnType<WeaponSim['update']>[number], { type: 'fired' }>,
    input: InputMessage,
  ): void {
    const s = shooter.controller.state;
    const eye: Point3 = { x: s.x, y: s.y + s.eyeHeight, z: s.z };
    const dir = viewDirection(
      input.yaw + e.recoil.yaw,
      input.pitch + e.recoil.pitch,
      e.offset.dx,
      e.offset.dy,
    );

    this.shotListener?.(shooter, eye);
    const restore = this.rewindOthers(shooter, input.renderTime);
    const hit = this.hitscan.cast(eye, dir, HX27.range, shooter.controller.collider);
    restore();

    if (hit.kind === 'miss') {
      this.emit({
        type: 'shot',
        shooter: shooter.id,
        from: eye,
        to: { x: eye.x + dir.x * 80, y: eye.y + dir.y * 80, z: eye.z + dir.z * 80 },
        hit: 'none',
        normal: { x: 0, y: 0, z: 0 },
      });
      return;
    }
    this.emit({
      type: 'shot',
      shooter: shooter.id,
      from: eye,
      to: hit.point,
      hit: hit.kind === 'target' ? 'player' : 'world',
      normal: hit.normal,
    });
    if (hit.kind !== 'target') return;

    const victim = this.byNumericId.get(hit.target.id);
    if (!victim || !victim.alive || victim.team === shooter.team) return; // no friendly fire
    const damage = computeDamage(HX27, hit.distance, hit.headshot);
    const r = victim.health.takeDamage(damage);
    if (r.dealt <= 0) return;
    this.emit({
      type: 'hit',
      shooter: shooter.id,
      victim: victim.id,
      damage: r.dealt,
      headshot: hit.headshot,
      killed: r.killed,
    });
    if (r.killed) this.kill(shooter, victim);
  }

  private kill(killer: SimPlayer, victim: SimPlayer): void {
    victim.alive = false;
    victim.deaths++;
    killer.kills++;
    victim.pendingRespawn = false;
    victim.respawnIn = 0;
    if (this.respawnSeconds !== null) {
      victim.pendingRespawn = true;
      victim.respawnIn = this.respawnSeconds;
    } else if (this.livesFor(victim) > 0) {
      if (this.lives.scope === 'team') this.teamLives[victim.team]--;
      else victim.livesLeft--;
      victim.pendingRespawn = true;
      victim.respawnIn = this.lives.delay;
    }
    victim.interact = false;
    victim.interactProgress = 0;
    victim.queue.length = 0;
    victim.controller.setEnabled(false);
    this.emit({ type: 'kill', killer: killer.id, victim: victim.id });
  }

  /** Brings a fallen (human) player back at their side's spawn with full health (mission checkpoint). */
  reviveAtSpawn(id: string): void {
    const p = this.players.get(id);
    if (p && !p.alive) this.respawn(p);
  }

  private respawn(p: SimPlayer): void {
    const spawn = this.nextSpawn(p.side);
    p.controller.setEnabled(true);
    p.controller.setState({
      x: spawn[0],
      y: 0.05,
      z: spawn[1],
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: false,
      crouching: false,
    });
    p.health.reset();
    p.weapon.refill();
    p.alive = true;
    p.pendingRespawn = false;
    p.respawnIn = 0;
    p.lastInput = null;
    p.prevFire = false;
    p.queue.length = 0;
    p.interact = false;
    p.interactProgress = 0;
    p.yaw = p.side === 'attackers' ? -Math.PI / 2 : Math.PI / 2;
    p.pitch = 0;
  }

  /** Start of a round: everyone (dead or alive) respawns at their current side's spawns. */
  resetRound(sideOf: (p: SimPlayer) => Team): void {
    this.spawnCursor.attackers = 0;
    this.spawnCursor.defenders = 0;
    for (const p of this.players.values()) {
      p.side = sideOf(p);
      if (this.lives.scope === 'player') p.livesLeft = this.lives.count;
      this.respawn(p);
    }
  }

  alivePerSide(): Record<Team, number> {
    const n: Record<Team, number> = { attackers: 0, defenders: 0 };
    for (const p of this.players.values()) if (p.alive || p.pendingRespawn) n[p.side]++;
    return n;
  }

  playersPerTeam(): Record<Team, number> {
    const n: Record<Team, number> = { attackers: 0, defenders: 0 };
    for (const p of this.players.values()) n[p.team]++;
    return n;
  }

  private nextSpawn(team: Team): readonly [number, number] {
    const list = this.map.spawns[team];
    const i = this.spawnCursor[team]++ % Math.max(1, list.length);
    return list[i] ?? [10, 10];
  }

  private recordHistory(): void {
    const pos: Positions = new Map();
    for (const p of this.players.values()) {
      if (p.alive)
        pos.set(p.id, {
          x: p.controller.state.x,
          y: p.controller.state.y,
          z: p.controller.state.z,
        });
    }
    this.history.push({ tick: this.tick, pos });
    if (this.history.length > HISTORY_TICKS) this.history.shift();
  }

  /**
   * Lag compensation: puts every other living player where the shooter saw them (clamped to
   * `MAX_REWIND_MS`), and returns a function that puts them back.
   */
  private rewindOthers(shooter: SimPlayer, renderTime: number): () => void {
    const now = this.timeMs;
    const t = Math.min(now, Math.max(now - MAX_REWIND_MS, renderTime));
    const wantTick = Math.round(t / TICK_MS);
    const entry = this.history.find((h) => h.tick === wantTick);
    if (!entry || wantTick >= this.tick) return () => undefined;

    const moved: SimPlayer[] = [];
    for (const p of this.players.values()) {
      if (p === shooter || !p.alive) continue;
      const old = entry.pos.get(p.id);
      if (!old) continue;
      p.controller.moveBodyTo(old.x, old.y, old.z);
      moved.push(p);
    }
    this.physics.refreshQueries();
    return () => {
      for (const p of moved) p.controller.restoreBody();
      this.physics.refreshQueries();
    };
  }

  /** Electronic doors are solid while closed (also blocks shots). */
  setDoorClosed(id: string, closed: boolean): void {
    this.physics.setDoorClosed(id, closed);
  }

  /** True if any living player is within `radius` metres (xz) of the point. */
  anyoneNear(x: number, z: number, radius: number): boolean {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const s = p.controller.state;
      if (Math.hypot(s.x - x, s.z - z) <= radius) return true;
    }
    return false;
  }

  dispose(): void {
    this.physics.dispose();
  }
}
