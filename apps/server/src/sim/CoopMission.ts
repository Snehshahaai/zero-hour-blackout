import { FIXED_DT, type MapDef } from '@zhb/game-engine/sim';
import { COOP_OBJECTIVES, COOP_RULES, type CoopRules, type MissionState } from '@zhb/shared';
import { BotBrain, type BotConfig } from './BotBrain.ts';
import type { MatchSim } from './MatchSim.ts';
import { MAP01_NAV_NODES, NavGraph } from './nav.ts';

export type MissionEvent =
  | { type: 'mission'; event: 'started' }
  | { type: 'mission'; event: 'objective'; index: number; label: string }
  | { type: 'mission'; event: 'complete' }
  | { type: 'mission'; event: 'failed'; reason: 'wiped' | 'time' }
  | { type: 'finished' };

/** Where each wave spawns (nav node ids) and how it behaves. */
const WAVES: {
  count: keyof CoopRules;
  mode: BotConfig['mode'];
  spawns: string[];
  routes: string[][];
}[] = [
  {
    count: 'wave1',
    mode: 'patrol',
    spawns: ['wh_c2', 'dock_w', 'm_c', 'wh_c3'],
    routes: [
      ['wh_c2', 'wh_c1', 'wh_n2', 'wh_c3'],
      ['dock_w', 'siteB', 'dock_n', 'dock_e'],
      ['m_c', 'm_b', 'm_d', 'm_e'],
      ['wh_c3', 'wh_s2', 'wh_c4', 'wh_e'],
    ],
  },
  // Reinforcements arrive at the objective they are meant to contest and then search around it.
  {
    count: 'wave2',
    mode: 'hunt',
    spawns: ['wh_e', 'dock_w'],
    routes: [
      ['siteA', 'gen_s', 'gen_e'],
      ['siteA', 'wh_n3', 'gen_s'],
    ],
  },
  {
    count: 'wave3',
    mode: 'hunt',
    spawns: ['m_a', 'm_b', 'wh_s2'],
    routes: [
      ['siteB', 'dock_s', 'dock_w'],
      ['siteB', 'dock_n', 'dock_e'],
      ['siteB', 'dock_w', 'dock_s'],
    ],
  },
];

const SITE_FOR_OBJECTIVE = ['', 'A', 'B'] as const;

/**
 * Cooperative mission "Secure the Facility", run server-side on top of a `MatchSim`.
 * 1) clear the patrols 2) hold the generator room (site A) 3) hold the loading dock (site B).
 * Securing a site needs an operator inside and no hostile close by; completing an objective is a
 * checkpoint that revives fallen operators. Failure: everyone down, or the clock runs out.
 */
export class CoopMission {
  state: MissionState = 'briefing';
  objective = 0;
  /** 0..1 progress of the current hold objective. */
  progress = 0;
  timeLeft: number;
  readonly nav: NavGraph;
  private readonly bots = new Map<string, BotBrain>();
  private botCounter = 0;
  private briefingLeft: number;
  private resultLeft = 0;
  private deadBotTimers = new Map<string, number>();
  private finishedEmitted = false;
  private readonly rules: CoopRules;

  constructor(
    private readonly sim: MatchSim,
    private readonly map: MapDef,
    private readonly emit: (e: MissionEvent) => void,
    rules: Partial<CoopRules> = {},
    private readonly seed = 1,
  ) {
    this.rules = { ...COOP_RULES, ...rules };
    this.timeLeft = this.rules.timeLimitSeconds;
    this.briefingLeft = this.rules.briefingSeconds;
    this.nav = new NavGraph(MAP01_NAV_NODES, (a, b, c, d) => sim.segmentClear(a, b, c, d));
    sim.shotListener = (shooter, from) => {
      if (shooter.isBot) return;
      for (const b of this.bots.values()) b.hear(from.x, from.z, 38);
    };
  }

  get label(): string {
    return COOP_OBJECTIVES[Math.min(this.objective, COOP_OBJECTIVES.length - 1)] ?? '';
  }

  get hostilesAlive(): number {
    let n = 0;
    for (const p of this.sim.players.values()) if (p.isBot && p.alive) n++;
    return n;
  }

  start(): void {
    this.sim.frozen = true;
    this.sim.resetRound((p) => p.side);
    this.spawnWave(0);
  }

  step(): void {
    const dt = FIXED_DT;
    switch (this.state) {
      case 'briefing':
        this.briefingLeft -= dt;
        if (this.briefingLeft <= 0) {
          this.state = 'active';
          this.sim.frozen = false;
          this.emit({ type: 'mission', event: 'started' });
          this.emit({ type: 'mission', event: 'objective', index: 0, label: this.label });
        }
        break;
      case 'active':
        this.stepActive(dt);
        break;
      case 'complete':
      case 'failed':
        this.resultLeft -= dt;
        if (this.resultLeft <= 0 && !this.finishedEmitted) {
          this.finishedEmitted = true;
          this.emit({ type: 'finished' });
        }
        break;
    }
    this.cleanupBots(dt);
  }

  private stepActive(dt: number): void {
    for (const b of this.bots.values()) b.step();

    this.timeLeft -= dt;
    if (this.operatorsAlive() === 0) return this.fail('wiped');
    if (this.timeLeft <= 0) return this.fail('time');

    if (this.objective === 0) {
      if (this.hostilesAlive === 0) this.completeObjective();
      return;
    }
    this.stepHold(dt);
  }

  /** Hold the current site: needs an operator inside and no hostile nearby (contested). */
  private stepHold(dt: number): void {
    const siteId = SITE_FOR_OBJECTIVE[this.objective];
    const site = this.map.objectives.find((o) => o.id === siteId);
    if (!site) return;
    let operatorIn = false;
    let contested = false;
    for (const p of this.sim.players.values()) {
      if (!p.alive) continue;
      const s = p.controller.state;
      const d = Math.hypot(s.x - site.center[0], s.z - site.center[1]);
      if (p.isBot) {
        if (d <= site.radius + this.rules.contestBonus) contested = true;
      } else if (d <= site.radius + this.rules.holdBonus) operatorIn = true;
    }
    if (operatorIn && !contested)
      this.progress = Math.min(1, this.progress + dt / this.rules.holdSeconds);
    else if (!operatorIn)
      this.progress = Math.max(0, this.progress - (dt / this.rules.holdSeconds) * 0.5);
    if (this.progress >= 1) this.completeObjective();
  }

  private completeObjective(): void {
    this.progress = 0;
    this.objective++;
    this.sim.refillTeamLives(); // 3 fresh respawns for the next objective
    // Checkpoint: fallen operators are brought back to the start.
    for (const p of this.sim.players.values()) {
      if (!p.isBot && !p.alive) this.sim.reviveAtSpawn(p.id);
    }
    if (this.objective >= COOP_OBJECTIVES.length) {
      this.state = 'complete';
      this.resultLeft = this.rules.resultSeconds;
      this.emit({ type: 'mission', event: 'complete' });
      return;
    }
    this.spawnWave(this.objective);
    this.emit({ type: 'mission', event: 'objective', index: this.objective, label: this.label });
  }

  private fail(reason: 'wiped' | 'time'): void {
    this.state = 'failed';
    this.resultLeft = this.rules.resultSeconds;
    this.emit({ type: 'mission', event: 'failed', reason });
  }

  private operatorsAlive(): number {
    let n = 0;
    for (const p of this.sim.players.values()) if (!p.isBot && (p.alive || p.pendingRespawn)) n++;
    return n;
  }

  private spawnWave(index: number): void {
    const wave = WAVES[index];
    if (!wave) return;
    const count = this.rules[wave.count];
    for (let i = 0; i < count; i++) {
      const spawnId = wave.spawns[i % wave.spawns.length] as string;
      const node = this.nav.byId.get(spawnId);
      if (!node) continue;
      const id = `bot-${++this.botCounter}`;
      const route = wave.routes[i % wave.routes.length] as string[];
      this.sim.addBot(
        id,
        `Hostile ${this.botCounter}`,
        'defenders',
        node.x,
        node.z,
        Math.PI * 0.5 * (i % 4),
      );
      this.bots.set(
        id,
        new BotBrain(
          { id, mode: wave.mode, route },
          this.sim,
          this.nav,
          this.seed * 1000 + this.botCounter,
        ),
      );
    }
  }

  /** Dead hostiles are removed a few seconds later so they stop costing physics and bandwidth. */
  private cleanupBots(dt: number): void {
    for (const [id, brain] of this.bots) {
      const p = this.sim.players.get(id);
      if (!p) {
        this.bots.delete(id);
        continue;
      }
      if (p.alive) continue;
      const t = (this.deadBotTimers.get(id) ?? 3) - dt;
      if (t <= 0) {
        this.sim.removePlayer(id);
        this.bots.delete(id);
        this.deadBotTimers.delete(id);
      } else this.deadBotTimers.set(id, t);
      void brain;
    }
  }
}
