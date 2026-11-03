import { mulberry32, type MapDef } from '@zhb/game-engine/sim';
import type { Team } from '@zhb/shared';
import { BOT_TUNING, BotBrain, type BotDifficulty, type BotGoal } from './BotBrain.ts';
import type { MatchSim, SimPlayer } from './MatchSim.ts';
import { MAP01_NAV_NODES, NavGraph } from './nav.ts';
import type { RoundManager } from './RoundManager.ts';

type SiteId = 'A' | 'B';

/** Where bots stand guard around each site (nav node ids). */
const GUARD_ROUTES: Record<SiteId, string[]> = {
  A: ['siteA', 'gen_s', 'gen_e', 'wh_n3'],
  B: ['siteB', 'dock_w', 'dock_n', 'dock_e', 'dock_s'],
};

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India'];

/** Plant zone is `radius + 1`; stand 0.5 m inside it. Defuse range is 2.5 m; stand within 1.7 m. */
const PLANT_INSET = 0.5;
const DEFUSE_STAND = 1.7;

/**
 * AI players for the competitive mode. Each bot is an ordinary sim player driven by a `BotBrain`
 * (same movement/weapon rules as humans); this class only decides *what the round needs from
 * each bot*: attackers go and plant (then guard the bomb), defenders guard a site and, once the
 * bomb is down, rush it and defuse. Fighting always takes priority over objectives.
 */
export class CompetitiveBots {
  readonly nav: NavGraph;
  private readonly brains = new Map<string, BotBrain>();
  private readonly rand: () => number;
  private attackSite: SiteId = 'A';
  private readonly defendSites = new Map<string, SiteId>();
  private counter = 0;
  private doorSignature = '';

  constructor(
    private readonly sim: MatchSim,
    private readonly rounds: RoundManager,
    private readonly map: MapDef,
    private readonly difficulty: BotDifficulty,
    seed: number,
  ) {
    this.nav = new NavGraph(MAP01_NAV_NODES, (a, b, c, d) => sim.segmentClear(a, b, c, d));
    this.rand = mulberry32(seed);
    // Bots hear gunfire from the other team, like they would a real shot, and go to investigate.
    sim.shotListener = (shooter, from) => {
      for (const [id, brain] of this.brains) {
        const bot = sim.players.get(id);
        if (bot && bot.team !== shooter.team) brain.hear(from.x, from.z, 38);
      }
    };
  }

  get count(): number {
    return this.brains.size;
  }

  addBot(team: Team): SimPlayer {
    const n = ++this.counter;
    const id = `bot-${n}`;
    const bot = this.sim.addSpawnBot(id, `Bot ${NAMES[(n - 1) % NAMES.length]}`, team);
    this.brains.set(
      id,
      new BotBrain(
        { id, mode: 'patrol', route: ['wh_c2'], tuning: BOT_TUNING[this.difficulty] },
        this.sim,
        this.nav,
        n * 7919 + 13,
      ),
    );
    return bot;
  }

  /** New round: attackers pick a site; defenders spread across the two sites. */
  private readonly fallen = new Set<string>();

  onRoundStart(): void {
    this.fallen.clear();
    this.attackSite = this.rand() < 0.5 ? 'A' : 'B';
    let flip = this.rand() < 0.5;
    for (const id of this.brains.keys()) {
      this.defendSites.set(id, flip ? 'A' : 'B');
      flip = !flip;
    }
  }

  /**
   * Call once per tick *before* `sim.step()`. `doors` is any string that changes whenever a door
   * opens/closes, so routes through a shut door are recomputed.
   */
  step(doors = ''): void {
    const phase = this.rounds.phase;
    if (phase !== 'live' && phase !== 'planted') return;
    if (doors !== this.doorSignature) {
      this.doorSignature = doors;
      this.nav.rebuild();
      for (const b of this.brains.values()) b.setGoal(null); // forces a re-plan
    }
    for (const [id, brain] of this.brains) {
      const bot = this.sim.players.get(id);
      if (!bot?.alive) {
        this.fallen.add(id);
        continue;
      }
      if (this.fallen.delete(id)) brain.setGoal(null); // respawned: plan the route from the spawn
      brain.setGoal(this.goalFor(bot));
      brain.step();
    }
  }

  private goalFor(bot: SimPlayer): BotGoal {
    if (this.rounds.deathmatch) {
      // Deathmatch: hunt the nearest living enemy (bots "know" the general area, like a spotter
      // call-out); with nobody to chase, roam the whole map.
      const me = bot.controller.state;
      let best: SimPlayer | null = null;
      let bestD = Infinity;
      for (const p of this.sim.players.values()) {
        if (!p.alive || p.team === bot.team) continue;
        const d = Math.hypot(p.controller.state.x - me.x, p.controller.state.z - me.z);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      const brain = this.brains.get(bot.id);
      if (brain)
        brain.chase = best ? { x: best.controller.state.x, z: best.controller.state.z } : null;
      const target = best
        ? this.nav.nearest(best.controller.state.x, best.controller.state.z)
        : null;
      if (target) return { kind: 'route', nodes: [target.id], sprint: bestD > 15 };
      const loop = [...GUARD_ROUTES.A, ...GUARD_ROUTES.B];
      return { kind: 'route', nodes: bot.team === 'attackers' ? loop : loop.reverse() };
    }
    const bomb = this.rounds.bomb;
    if (bot.side === 'attackers') {
      if (!bomb.planted) return this.siteGoal('plant', this.attackSite);
      return { kind: 'route', nodes: GUARD_ROUTES[(bomb.site as SiteId) || this.attackSite] };
    }
    if (bomb.planted) return this.siteGoal('defuse', (bomb.site as SiteId) || 'A');
    return { kind: 'route', nodes: GUARD_ROUTES[this.defendSites.get(bot.id) ?? 'A'] };
  }

  private siteGoal(kind: 'plant' | 'defuse', id: SiteId): BotGoal {
    const o = this.map.objectives.find((x) => x.id === id) ?? this.map.objectives[0];
    if (!o) return { kind: 'route', nodes: GUARD_ROUTES.A };
    return {
      kind,
      node: `site${o.id}`,
      center: o.center,
      radius: kind === 'plant' ? o.radius + PLANT_INSET : DEFUSE_STAND,
    };
  }
}
