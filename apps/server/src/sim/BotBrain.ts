import type { BotDifficulty, InputMessage, Team } from '@zhb/shared';
import { mulberry32 } from '@zhb/game-engine/sim';
import type { MatchSim, SimPlayer } from './MatchSim.ts';
import type { NavGraph, NavNode } from './nav.ts';

const SIGHT_RANGE = 42;
/** Half field-of-view (radians). Bots do not see behind them. */
const HALF_FOV = (75 * Math.PI) / 180;
const LOSE_TARGET_TICKS = 100;
const ARRIVE = 0.9;

/** Difficulty knobs. Bots never get extra speed, vision or perfect aim: only slower or sharper. */
export interface BotTuning {
  /** Ticks between first sight and first shot (60 per second). */
  reaction: number;
  /** Aim error half-angle in radians, re-rolled every half second. */
  aimError: number;
  /** Max view turn per tick, radians. */
  turnRate: number;
  /** Multiplier on the pause between bursts (bigger = fires less often). */
  pauseScale: number;
}

export type { BotDifficulty };

export const BOT_TUNING: Record<BotDifficulty, BotTuning> = {
  easy: { reaction: 50, aimError: 0.075, turnRate: 0.05, pauseScale: 1.7 },
  normal: { reaction: 26, aimError: 0.035, turnRate: 0.075, pauseScale: 1 },
  hard: { reaction: 14, aimError: 0.018, turnRate: 0.1, pauseScale: 0.7 },
};

/**
 * What a bot is trying to do when it is not fighting. `route` walks/guards a loop of nav nodes;
 * `plant`/`defuse` go to a site and hold the interact key once close enough (the round rules
 * decide whether it actually works).
 */
export type BotGoal =
  | { kind: 'route'; nodes: string[]; sprint?: boolean }
  | { kind: 'plant'; node: string; center: readonly [number, number]; radius: number }
  | { kind: 'defuse'; node: string; center: readonly [number, number]; radius: number };

export type BotMode = 'patrol' | 'hunt';
type BotState = 'move' | 'combat' | 'search';

export interface BotConfig {
  id: string;
  mode: BotMode;
  /** Patrol loop (node ids) or, for hunters, [destination, ...nearby nodes to search]. */
  route: string[];
  tuning?: Partial<BotTuning>;
}

interface Memory {
  x: number;
  z: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

/**
 * Drives one bot by producing the same `InputMessage` a human client would send, so bots obey
 * identical movement, weapon, recoil and damage rules. Perception is honest: line of sight,
 * field of view and range; sound (shots, sprinting) only gives a rough area to investigate.
 */
export class BotBrain {
  private state: BotState = 'move';
  private path: NavNode[] = [];
  private routeIdx = 0;
  private targetId: string | null = null;
  private memory: Memory | null = null;
  private seenTicks = 0;
  private loseTicks = 0;
  private fireLeft = 0;
  private pauseLeft = 0;
  private strafeDir = 1;
  private strafeTicks = 0;
  private aimYaw: number;
  private aimPitch = 0;
  private errYaw = 0;
  private errPitch = 0;
  private errTicks = 0;
  private seq = 0;
  private stuckX = 0;
  private stuckZ = 0;
  private stuckTicks = 0;
  private reloadPulse = false;
  private readonly rand: () => number;
  private readonly tune: BotTuning;
  private goal: BotGoal | null = null;
  private goalKey = '';
  private interactNow = false;
  /** Deathmatch: where the enemy is right now (not part of the goal, so it never forces a re-plan). */
  chase: { x: number; z: number } | null = null;

  constructor(
    readonly config: BotConfig,
    private readonly sim: MatchSim,
    private readonly nav: NavGraph,
    seed: number,
  ) {
    this.rand = mulberry32(seed);
    this.tune = { ...BOT_TUNING.normal, ...config.tuning };
    this.aimYaw = sim.players.get(config.id)?.yaw ?? 0;
  }

  get stateName(): BotState {
    return this.state;
  }

  /** Sets what the bot does when not fighting. Re-setting the same goal is free. */
  setGoal(goal: BotGoal | null): void {
    const key = JSON.stringify(goal);
    if (key === this.goalKey) return;
    this.goalKey = key;
    this.goal = goal;
    this.path = [];
    this.routeIdx = 0;
  }

  /** Something audible happened near the bot at (x, z): go and look. */
  hear(x: number, z: number, range: number): void {
    const me = this.sim.players.get(this.config.id);
    if (!me?.alive || this.state === 'combat') return;
    const s = me.controller.state;
    if (Math.hypot(s.x - x, s.z - z) > range) return;
    // Imprecise: the bot only learns roughly where it came from.
    this.memory = { x: x + (this.rand() - 0.5) * 6, z: z + (this.rand() - 0.5) * 6 };
    this.state = 'search';
    this.path = [];
  }

  /** Queues this tick's input into the sim. */
  step(): void {
    const me = this.sim.players.get(this.config.id);
    if (!me || !me.alive) return;
    const s = me.controller.state;

    const target = this.perceive(me);
    let fire = false;
    let wishX = 0;
    let wishZ = 0;
    let sprint = false;
    this.interactNow = false;

    if (target) {
      if (this.state !== 'combat') {
        this.state = 'combat';
        this.seenTicks = 0;
        this.fireLeft = 0;
        this.pauseLeft = 0;
      }
      this.seenTicks++;
      this.loseTicks = 0;
      const t = target.controller.state;
      this.targetId = target.id;
      this.memory = { x: t.x, z: t.z };
      const dist = Math.hypot(t.x - s.x, t.z - s.z);
      const eyeY = s.y + s.eyeHeight;
      const wantYaw = Math.atan2(-(t.x - s.x), -(t.z - s.z));
      const wantPitch = Math.atan2(t.y + 1.1 - eyeY, Math.max(0.1, dist));
      this.refreshAimError();
      this.turnTo(wantYaw + this.errYaw, wantPitch + this.errPitch);
      const onTarget =
        Math.abs(wrap(wantYaw + this.errYaw - this.aimYaw)) < 0.07 &&
        Math.abs(wantPitch + this.errPitch - this.aimPitch) < 0.09;

      if (this.seenTicks > this.tune.reaction) {
        if (this.fireLeft > 0) {
          // Hold still while shooting: moving makes the weapon much less accurate.
          this.fireLeft--;
          fire = onTarget;
          if (this.fireLeft === 0) {
            this.pauseLeft = Math.round((22 + Math.floor(this.rand() * 26)) * this.tune.pauseScale);
          }
        } else if (this.pauseLeft > 0) {
          this.pauseLeft--;
          if (this.pauseLeft === 0) this.fireLeft = 14 + Math.floor(this.rand() * 22);
          // Between bursts: strafe, or close in if far away.
          if (--this.strafeTicks <= 0) {
            this.strafeDir = this.rand() < 0.5 ? -1 : 1;
            this.strafeTicks = 25 + Math.floor(this.rand() * 25);
          }
          const rx = Math.cos(this.aimYaw);
          const rz = -Math.sin(this.aimYaw);
          wishX = rx * this.strafeDir;
          wishZ = rz * this.strafeDir;
          if (dist > 22) {
            wishX += -Math.sin(this.aimYaw);
            wishZ += -Math.cos(this.aimYaw);
          }
        } else {
          this.fireLeft = 14 + Math.floor(this.rand() * 22);
        }
      }
    } else {
      if (this.state === 'combat') {
        this.loseTicks++;
        if (this.loseTicks > LOSE_TARGET_TICKS) {
          this.state = 'search';
          this.targetId = null;
          this.path = [];
        } else {
          // Keep aiming at where the target was last seen.
          if (this.memory) {
            const wantYaw = Math.atan2(-(this.memory.x - s.x), -(this.memory.z - s.z));
            this.turnTo(wantYaw, 0);
          }
        }
      }
      if (this.state !== 'combat') {
        const move = this.navigate(me);
        wishX = move.x;
        wishZ = move.z;
        sprint = move.sprint;
        if (wishX !== 0 || wishZ !== 0) {
          this.turnTo(Math.atan2(-wishX, -wishZ), 0);
        }
      }
    }

    // Reload in lulls, never while firing.
    const lowAmmo = me.weapon.ammo <= 2 && !me.weapon.reloading && this.fireLeft === 0;
    const reload = lowAmmo && !this.reloadPulse;
    this.reloadPulse = lowAmmo;

    // World direction -> forward/right relative to where the bot is looking.
    const fx = -Math.sin(this.aimYaw);
    const fz = -Math.cos(this.aimYaw);
    const rx = Math.cos(this.aimYaw);
    const rz = -Math.sin(this.aimYaw);
    const len = Math.hypot(wishX, wishZ) || 1;
    const fwd = (wishX * fx + wishZ * fz) / len;
    const rgt = (wishX * rx + wishZ * rz) / len;
    const q = (v: number) => (v > 0.4 ? 1 : v < -0.4 ? -1 : 0);
    const moving = wishX !== 0 || wishZ !== 0;

    this.detectStuck(me);
    const msg: InputMessage = {
      seq: this.seq++,
      forward: moving ? q(fwd) : 0,
      right: moving ? q(rgt) : 0,
      jump: false,
      sprint: sprint && this.state !== 'combat',
      crouch: false,
      fire,
      reload,
      // Never interact while fighting: shooting at an enemy interrupts a plant/defuse, as for humans.
      interact: this.interactNow && this.state !== 'combat',
      yaw: this.aimYaw,
      pitch: this.aimPitch,
      renderTime: this.sim.timeMs,
    };
    this.sim.queueInput(this.config.id, msg);
  }

  // ---- perception ------------------------------------------------------------------

  private perceive(me: SimPlayer): SimPlayer | null {
    const s = me.controller.state;
    let best: SimPlayer | null = null;
    let bestDist = Infinity;
    for (const p of this.sim.players.values()) {
      if (!p.alive || p.team === me.team) continue;
      const t = p.controller.state;
      const dx = t.x - s.x;
      const dz = t.z - s.z;
      const dist = Math.hypot(dx, dz);
      if (dist > SIGHT_RANGE) continue;
      // Already fighting this target: no FOV check (it is tracked), but LOS is still required.
      const tracked = this.state === 'combat' && this.targetId === p.id;
      if (!tracked) {
        const bearing = Math.atan2(-dx, -dz);
        if (Math.abs(wrap(bearing - this.aimYaw)) > HALF_FOV) continue;
      }
      if (dist < bestDist && this.sim.canSee(me.id, p.id)) {
        best = p;
        bestDist = dist;
      }
    }
    return best;
  }

  private refreshAimError(): void {
    if (this.errTicks-- > 0) return;
    this.errTicks = 30;
    this.errYaw = (this.rand() * 2 - 1) * this.tune.aimError;
    this.errPitch = (this.rand() * 2 - 1) * this.tune.aimError * 0.7;
  }

  private turnTo(yaw: number, pitch: number): void {
    this.aimYaw += clamp(wrap(yaw - this.aimYaw), this.tune.turnRate);
    this.aimPitch += clamp(pitch - this.aimPitch, this.tune.turnRate);
  }

  // ---- navigation ------------------------------------------------------------------

  private navigate(me: SimPlayer): { x: number; z: number; sprint: boolean } {
    const s = me.controller.state;
    if (this.chase && this.state === 'search') {
      // Deathmatch hunters know where the enemy is: no wandering off to investigate noises.
      this.state = 'move';
      this.memory = null;
      this.path = [];
    }
    if (this.state === 'search' && this.memory && this.path.length === 0) {
      const goal = this.nav.nearest(this.memory.x, this.memory.z);
      const start = this.nav.nearest(s.x, s.z);
      if (goal && start) this.path = this.nav.path(start.id, goal.id) ?? [];
      if (this.path.length === 0) {
        this.state = 'move';
        this.memory = null;
      }
    }
    const goal = this.goal;
    if (this.state === 'move' && goal && goal.kind !== 'route') {
      // Objective: walk to the site, then stand still holding the interact key.
      const dist = Math.hypot(s.x - goal.center[0], s.z - goal.center[1]);
      if (dist <= goal.radius) {
        this.interactNow = true;
        this.path = [];
        return { x: 0, z: 0, sprint: false };
      }
      if (this.path.length === 0) {
        const start = this.nav.nearest(s.x, s.z);
        this.path = (start && this.nav.path(start.id, goal.node)) || [];
        if (this.path.length === 0) {
          // No graph route (or already at the last node): walk straight at the site.
          return { x: goal.center[0] - s.x, z: goal.center[1] - s.z, sprint: false };
        }
      }
    } else if (this.state === 'move' && this.path.length === 0) {
      const route = goal?.kind === 'route' ? goal.nodes : this.config.route;
      const id = route[this.routeIdx % route.length];
      const start = this.nav.nearest(s.x, s.z);
      if (id && start) {
        const p = this.nav.path(start.id, id);
        this.path = p ?? [];
        // Hunters go to their destination once, then wander the nearby nodes.
        if (this.config.mode === 'patrol' || this.routeIdx > 0 || goal?.kind === 'route')
          this.routeIdx++;
        else this.routeIdx = 1;
        if (route.length === 1) this.routeIdx = 0;
      }
    }

    const next = this.path[0];
    if (!next) {
      // Hunting with no usable graph route (or already at the last node): close in directly.
      const c = this.chase;
      if (c && Math.hypot(c.x - s.x, c.z - s.z) > 3)
        return { x: c.x - s.x, z: c.z - s.z, sprint: Math.hypot(c.x - s.x, c.z - s.z) > 15 };
      return { x: 0, z: 0, sprint: false };
    }
    const dx = next.x - s.x;
    const dz = next.z - s.z;
    if (Math.hypot(dx, dz) < ARRIVE) {
      this.path.shift();
      if (this.path.length === 0 && this.state === 'search') {
        // Reached the investigation point: look around briefly by resuming the route.
        this.state = 'move';
        this.memory = null;
      }
      return { x: 0, z: 0, sprint: false };
    }
    const sprintGoal = goal?.kind === 'route' ? goal.sprint === true : goal !== null;
    return {
      x: dx,
      z: dz,
      sprint: (this.config.mode === 'hunt' || sprintGoal) && Math.hypot(dx, dz) > 6,
    };
  }

  private detectStuck(me: SimPlayer): void {
    const s = me.controller.state;
    if (Math.hypot(s.x - this.stuckX, s.z - this.stuckZ) > 0.25) {
      this.stuckX = s.x;
      this.stuckZ = s.z;
      this.stuckTicks = 0;
      return;
    }
    if (this.state !== 'combat' && this.path.length > 0 && ++this.stuckTicks > 90) {
      this.stuckTicks = 0;
      this.path = []; // re-plan from where we actually are
    }
  }
}

export type { Team };
