import { FIXED_DT, siteAt, type MapDef } from '@zhb/game-engine/sim';
import { ROUND_RULES, type RoundPhase, type RoundRules, type Team } from '@zhb/shared';
import type { MatchSim, SimPlayer } from './MatchSim.ts';

export type RoundEvent =
  | { type: 'roundStart'; round: number }
  | {
      type: 'roundEnd';
      round: number;
      winnerTeam: Team;
      winnerSide: Team;
      reason: 'elimination' | 'time' | 'detonation' | 'defused';
      scores: Record<Team, number>;
    }
  | { type: 'bomb'; event: 'planted' | 'defused' | 'exploded'; site: string }
  | { type: 'halftime' }
  | {
      type: 'matchEnd';
      winnerTeam: Team;
      reason: 'score' | 'forfeit';
      scores: Record<Team, number>;
    }
  | { type: 'finished' };

const other = (t: Team): Team => (t === 'attackers' ? 'defenders' : 'attackers');

interface Interaction {
  playerId: string;
  site: string;
  progress: number;
}

/**
 * Competitive round/match rules, run server-side on top of a `MatchSim`.
 * Teams are fixed (lobby teams, used for score); *sides* (attackers/defenders) swap at halftime.
 */
export class RoundManager {
  phase: RoundPhase = 'freeze';
  round = 0;
  timeLeft = 0;
  /** Round wins per (fixed) team. */
  readonly scores: Record<Team, number> = { attackers: 0, defenders: 0 };
  swapped = false;
  bomb = { planted: false, site: '', timeLeft: 0 };
  matchWinner: Team | null = null;
  private interaction: Interaction | null = null;
  private finishedEmitted = false;
  private readonly rules: RoundRules;

  constructor(
    private readonly sim: MatchSim,
    private readonly map: MapDef,
    private readonly emit: (e: RoundEvent) => void,
    rules: Partial<RoundRules> = {},
  ) {
    this.rules = { ...ROUND_RULES, ...rules };
  }

  sideOf = (p: { team: Team }): Team => (this.swapped ? other(p.team) : p.team);
  private teamOfSide = (side: Team): Team => (this.swapped ? other(side) : side);

  start(): void {
    this.beginRound();
  }

  step(): void {
    const dt = FIXED_DT;
    switch (this.phase) {
      case 'freeze':
        if (this.checkForfeit()) return;
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) {
          this.phase = 'live';
          this.timeLeft = this.rules.roundSeconds;
          this.sim.frozen = false;
        }
        break;
      case 'live':
      case 'planted':
        if (this.checkForfeit()) return;
        this.stepLive(dt);
        break;
      case 'roundEnd':
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) {
          if (this.matchWinner) this.beginMatchEnd('score');
          else this.beginRound();
        }
        break;
      case 'matchEnd':
        this.timeLeft -= dt;
        if (this.timeLeft <= 0 && !this.finishedEmitted) {
          this.finishedEmitted = true;
          this.emit({ type: 'finished' });
        }
        break;
    }
  }

  // ---- round lifecycle -------------------------------------------------------------

  private beginRound(): void {
    this.round++;
    this.phase = 'freeze';
    this.timeLeft = this.rules.freezeSeconds;
    this.bomb = { planted: false, site: '', timeLeft: 0 };
    this.interaction = null;
    this.sim.resetRound(this.sideOf);
    this.sim.frozen = true;
    this.emit({ type: 'roundStart', round: this.round });
  }

  private endRound(
    winnerSide: Team,
    reason: Extract<RoundEvent, { type: 'roundEnd' }>['reason'],
  ): void {
    const winnerTeam = this.teamOfSide(winnerSide);
    this.scores[winnerTeam]++;
    this.phase = 'roundEnd';
    this.timeLeft = this.rules.roundEndSeconds;
    this.interaction = null;
    for (const p of this.sim.players.values()) p.interactProgress = 0;
    this.emit({
      type: 'roundEnd',
      round: this.round,
      winnerTeam,
      winnerSide,
      reason,
      scores: { ...this.scores },
    });
    if (this.scores[winnerTeam] >= this.rules.roundsToWin) {
      this.matchWinner = winnerTeam;
    } else if (this.round === this.rules.swapAfterRounds) {
      this.swapped = !this.swapped;
      this.emit({ type: 'halftime' });
    }
  }

  private beginMatchEnd(reason: 'score' | 'forfeit'): void {
    this.phase = 'matchEnd';
    this.timeLeft = this.rules.matchEndSeconds;
    this.sim.frozen = true;
    this.interaction = null;
    const winnerTeam = this.matchWinner as Team;
    this.emit({ type: 'matchEnd', winnerTeam, reason, scores: { ...this.scores } });
  }

  /** A team with nobody left in the match forfeits it. */
  private checkForfeit(): boolean {
    const n = this.sim.playersPerTeam();
    if (n.attackers > 0 && n.defenders > 0) return false;
    if (n.attackers === 0 && n.defenders === 0) return false;
    this.matchWinner = n.attackers > 0 ? 'attackers' : 'defenders';
    this.beginMatchEnd('forfeit');
    return true;
  }

  // ---- live round ------------------------------------------------------------------

  private stepLive(dt: number): void {
    const alive = this.sim.alivePerSide();
    this.stepInteraction(dt);
    if (this.phase === 'roundEnd') return; // a defuse just ended the round

    if (this.bomb.planted) {
      if (alive.defenders === 0) return this.endRound('attackers', 'elimination');
      this.bomb.timeLeft -= dt;
      this.timeLeft = this.bomb.timeLeft;
      if (this.bomb.timeLeft <= 0) {
        this.emit({ type: 'bomb', event: 'exploded', site: this.bomb.site });
        return this.endRound('attackers', 'detonation');
      }
      return;
    }
    if (alive.defenders === 0) return this.endRound('attackers', 'elimination');
    if (alive.attackers === 0) return this.endRound('defenders', 'elimination');
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) this.endRound('defenders', 'time');
  }

  /** Server-side validation of plant/defuse: position, held key, uninterrupted for the full time. */
  private stepInteraction(dt: number): void {
    const players = [...this.sim.players.values()];
    for (const p of players) if (!this.isInteracting(p)) p.interactProgress = 0;

    const wantSide: Team = this.bomb.planted ? 'defenders' : 'attackers';
    const candidate = this.pickInteractor(players, wantSide);
    if (!candidate) {
      this.interaction = null;
      return;
    }
    if (!this.interaction || this.interaction.playerId !== candidate.player.id) {
      this.interaction = { playerId: candidate.player.id, site: candidate.site, progress: 0 };
    }
    const total = this.bomb.planted ? this.rules.defuseSeconds : this.rules.plantSeconds;
    this.interaction.progress += dt / total;
    candidate.player.interactProgress = Math.min(1, this.interaction.progress);
    if (this.interaction.progress < 1) return;

    const site = this.interaction.site;
    this.interaction = null;
    candidate.player.interactProgress = 0;
    if (this.bomb.planted) {
      this.emit({ type: 'bomb', event: 'defused', site });
      this.endRound('defenders', 'defused');
    } else {
      this.bomb = { planted: true, site, timeLeft: this.rules.fuseSeconds };
      this.phase = 'planted';
      this.timeLeft = this.rules.fuseSeconds;
      this.emit({ type: 'bomb', event: 'planted', site });
    }
  }

  private isInteracting(p: SimPlayer): boolean {
    return this.interaction?.playerId === p.id;
  }

  /** The player currently allowed to interact: sticks with the one already in progress. */
  private pickInteractor(
    players: SimPlayer[],
    side: Team,
  ): { player: SimPlayer; site: string } | null {
    let first: { player: SimPlayer; site: string } | null = null;
    for (const p of players) {
      if (!p.alive || p.side !== side || !p.interact) continue;
      const s = p.controller.state;
      if (!s.grounded) continue;
      let site: string | null = null;
      if (this.bomb.planted) {
        const o = this.map.objectives.find((x) => x.id === this.bomb.site);
        if (o && Math.hypot(s.x - o.center[0], s.z - o.center[1]) <= this.rules.defuseRange)
          site = o.id;
      } else {
        site = siteAt(this.map, s.x, s.z, this.rules.plantRadiusBonus)?.id ?? null;
      }
      if (!site) continue;
      const found = { player: p, site };
      if (this.interaction?.playerId === p.id && this.interaction.site === site) return found;
      first ??= found;
    }
    return first;
  }
}
