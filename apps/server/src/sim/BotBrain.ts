import type { InputMessage, Team } from '@zhb/shared';
import { mulberry32 } from '@zhb/game-engine/sim';
import type { MatchSim, SimPlayer } from './MatchSim.ts';
import type { NavGraph, NavNode } from './nav.ts';

const SIGHT_RANGE = 42;
/** Half field-of-view (radians). Bots do not see behind them. */
const HALF_FOV = (75 * Math.PI) / 180;
const REACTION_TICKS = 26; // ~0.43 s from first sight to first shot
const LOSE_TARGET_TICKS = 100;
const TURN_RATE = 0.075; // rad per tick (~4.5 rad/s)
const AIM_ERROR = 0.035; // rad (~2 deg) of per-half-second aiming error
const ARRIVE = 0.9;

export type BotMode = 'patrol' | 'hunt';
type BotState = 'move' | 'combat' | 'search';

export interface BotConfig {
  id: string;
  mode: BotMode;
  /** Patrol loop (node ids) or, for hunters, [destination, ...nearby nodes to search]. */
  route: string[];
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

  constructor(
    readonly config: BotConfig,
    private readonly sim: MatchSim,
    private readonly nav: NavGraph,
    seed: number,
  ) {
    this.rand = mulberry32(seed);
    this.aimYaw = sim.players.get(config.id)?.yaw ?? 0;
  }

  get stateName(): BotState {
    return this.state;
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

      if (this.seenTicks > REACTION_TICKS) {
        if (this.fireLeft > 0) {
          // Hold still while shooting: moving makes the weapon much less accurate.
          this.fireLeft--;
          fire = onTarget;
          if (this.fireLeft === 0) this.pauseLeft = 22 + Math.floor(this.rand() * 26);
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
      interact: false,
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
    this.errYaw = (this.rand() * 2 - 1) * AIM_ERROR;
    this.errPitch = (this.rand() * 2 - 1) * AIM_ERROR * 0.7;
  }

  private turnTo(yaw: number, pitch: number): void {
    this.aimYaw += clamp(wrap(yaw - this.aimYaw), TURN_RATE);
    this.aimPitch += clamp(pitch - this.aimPitch, TURN_RATE);
  }

  // ---- navigation ------------------------------------------------------------------

  private navigate(me: SimPlayer): { x: number; z: number; sprint: boolean } {
    const s = me.controller.state;
    if (this.state === 'search' && this.memory && this.path.length === 0) {
      const goal = this.nav.nearest(this.memory.x, this.memory.z);
      const start = this.nav.nearest(s.x, s.z);
      if (goal && start) this.path = this.nav.path(start.id, goal.id) ?? [];
      if (this.path.length === 0) {
        this.state = 'move';
        this.memory = null;
      }
    }
    if (this.state === 'move' && this.path.length === 0) {
      const route = this.config.route;
      const id = route[this.routeIdx % route.length];
      const start = this.nav.nearest(s.x, s.z);
      if (id && start) {
        const p = this.nav.path(start.id, id);
        this.path = p ?? [];
        // Hunters go to their destination once, then wander the nearby nodes.
        if (this.config.mode === 'patrol' || this.routeIdx > 0) this.routeIdx++;
        else this.routeIdx = 1;
        if (route.length === 1) this.routeIdx = 0;
      }
    }

    const next = this.path[0];
    if (!next) return { x: 0, z: 0, sprint: false };
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
    return { x: dx, z: dz, sprint: this.config.mode === 'hunt' && Math.hypot(dx, dz) > 6 };
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
