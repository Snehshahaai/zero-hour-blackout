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

const RESPAWN_SECONDS = 3;
/** How far back a shot may be rewound (ms). Caps how much lag a shooter can "buy". */
const MAX_REWIND_MS = 250;
const HISTORY_TICKS = 30;
const TICK_MS = 1000 / MATCH_TICK_RATE;
const MAX_QUEUE = 8;
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
  name: string;
  team: Team;
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
export class MatchSim {
  readonly players = new Map<string, SimPlayer>();
  tick = 0;
  private readonly physics: PhysicsWorld;
  private readonly hitscan: Hitscan;
  private readonly history: { tick: number; pos: Positions }[] = [];
  private readonly spawnCursor: Record<Team, number> = { attackers: 0, defenders: 0 };
  private nextNumericId = 1;
  private readonly byNumericId = new Map<number, SimPlayer>();

  constructor(
    private readonly map: MapDef,
    private readonly emit: (e: SimEvent) => void,
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
      name,
      team,
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
    if (p.queue.length > MAX_QUEUE) p.queue.shift();
  }

  step(): void {
    this.tick++;
    for (const p of this.players.values()) {
      if (!p.alive) {
        p.respawnIn -= FIXED_DT;
        if (p.respawnIn <= 0) this.respawn(p);
        continue;
      }
      this.stepPlayer(p);
    }
    this.recordHistory();
  }

  /**
   * Consumes queued inputs against the player's credit. Credit refills at exactly one input
   * per tick, so bursts after network jitter are absorbed, yet long-run speed can never exceed
   * real time (flooding inputs does nothing). With nothing queued the player is simply not
   * simulated that tick, so the server never runs ahead of what the client actually did.
   */
  private stepPlayer(p: SimPlayer): void {
    p.credit = Math.min(MAX_CREDIT, p.credit + 1);
    while (p.credit >= 1 && p.queue.length > 0) {
      const input = p.queue.shift() as InputMessage;
      p.credit -= 1;
      p.ackSeq = input.seq;
      p.lastInput = input;
      this.applyInput(p, input);
      if (!p.alive) break;
    }
  }

  private applyInput(p: SimPlayer, input: InputMessage): void {
    p.yaw = input.yaw;
    p.pitch = input.pitch;

    const c = p.controller;
    c.update({
      forward: input.forward,
      right: input.right,
      jump: input.jump,
      sprint: input.sprint,
      crouch: input.crouch,
      yaw: input.yaw,
    });
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
    victim.respawnIn = RESPAWN_SECONDS;
    victim.queue.length = 0;
    victim.controller.setEnabled(false);
    this.emit({ type: 'kill', killer: killer.id, victim: victim.id });
  }

  private respawn(p: SimPlayer): void {
    const spawn = this.nextSpawn(p.team);
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
    p.lastInput = null;
    p.prevFire = false;
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

  dispose(): void {
    this.physics.dispose();
  }
}
