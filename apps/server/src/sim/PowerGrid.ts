import { FIXED_DT, type MapDef } from '@zhb/game-engine/sim';
import { POWER_RULES, type PowerRules } from '@zhb/shared';
import type { MatchSim, SimPlayer } from './MatchSim.ts';

export type PowerEvent =
  | { type: 'power'; event: 'cut' | 'restored'; zone: string; by: string }
  | { type: 'door'; id: string; closed: boolean };

export interface ZonePower {
  cut: boolean;
  /** Seconds of outage remaining while cut. */
  left: number;
  /** Seconds until the panel can be used again. */
  cooldown: number;
}

/**
 * Server-authoritative power grid. Fairness rules (all enforced here, none client-side):
 * - only the designated panel zones can be cut (never a bomb site),
 * - one outage at a time, auto-restored by backup power after a fixed time,
 * - a cooldown after each outage,
 * - doors fail closed but never while anyone is standing near them,
 * - everything resets at round start and is announced to all players.
 */
export class PowerGrid {
  readonly zones = new Map<string, ZonePower>();
  readonly doorsClosed = new Map<string, boolean>();
  private hold: { playerId: string; panelId: string; progress: number } | null = null;
  private readonly rules: PowerRules;

  constructor(
    private readonly sim: MatchSim,
    private readonly map: MapDef,
    private readonly emit: (e: PowerEvent) => void,
    rules: Partial<PowerRules> = {},
  ) {
    this.rules = { ...POWER_RULES, ...rules };
    for (const p of map.panels) this.zones.set(p.zone, { cut: false, left: 0, cooldown: 0 });
    for (const d of map.doors) this.doorsClosed.set(d.id, false);
  }

  get anyCut(): boolean {
    for (const z of this.zones.values()) if (z.cut) return true;
    return false;
  }

  /** Round start: everything back to normal. */
  reset(): void {
    this.hold = null;
    for (const [zone, z] of this.zones) {
      if (z.cut) this.emit({ type: 'power', event: 'restored', zone, by: '' });
      z.cut = false;
      z.left = 0;
      z.cooldown = 0;
    }
    for (const id of this.doorsClosed.keys()) this.setDoor(id, false);
  }

  /** `active` is true only while a round is being played (live or planted). */
  step(active: boolean): void {
    const dt = FIXED_DT;
    for (const [zone, z] of this.zones) {
      if (z.cut) {
        z.left -= dt;
        if (z.left <= 0) {
          z.cut = false;
          z.left = 0;
          z.cooldown = this.rules.cooldownSeconds;
          this.emit({ type: 'power', event: 'restored', zone, by: '' });
        }
      } else if (z.cooldown > 0) {
        z.cooldown = Math.max(0, z.cooldown - dt);
      }
    }
    this.stepDoors();

    if (!active) {
      this.clearHold();
      return;
    }
    this.stepHold(dt);
  }

  /** Drop an in-progress hold and zero that player's progress bar. */
  private clearHold(): void {
    if (!this.hold) return;
    const p = this.sim.players.get(this.hold.playerId);
    if (p) p.interactProgress = 0;
    this.hold = null;
  }

  private stepDoors(): void {
    for (const d of this.map.doors) {
      const wantClosed = this.zones.get(d.zone)?.cut ?? false;
      if (this.doorsClosed.get(d.id) === wantClosed) continue;
      if (wantClosed) {
        // Never close on top of someone: wait until the doorway is clear.
        const cx = d.box.pos[0] + d.box.size[0] / 2;
        const cz = d.box.pos[2] + d.box.size[2] / 2;
        const reach = this.rules.doorClearance + Math.max(d.box.size[0], d.box.size[2]) / 2;
        if (this.sim.anyoneNear(cx, cz, reach)) continue;
      }
      this.setDoor(d.id, wantClosed);
    }
  }

  private setDoor(id: string, closed: boolean): void {
    if (this.doorsClosed.get(id) === closed) return;
    this.doorsClosed.set(id, closed);
    this.sim.setDoorClosed(id, closed);
    this.emit({ type: 'door', id, closed });
  }

  private stepHold(dt: number): void {
    const candidate = this.pick();
    if (!candidate) {
      this.clearHold();
      return;
    }
    if (
      !this.hold ||
      this.hold.playerId !== candidate.player.id ||
      this.hold.panelId !== candidate.panelId
    ) {
      this.hold = { playerId: candidate.player.id, panelId: candidate.panelId, progress: 0 };
    }
    this.hold.progress += dt / this.rules.panelHoldSeconds;
    candidate.player.interactProgress = Math.min(1, this.hold.progress);
    if (this.hold.progress < 1) return;

    const zone = this.zones.get(candidate.zone);
    this.hold = null;
    candidate.player.interactProgress = 0;
    if (!zone) return;
    zone.cut = true;
    zone.left = this.rules.outageSeconds;
    this.emit({ type: 'power', event: 'cut', zone: candidate.zone, by: candidate.player.id });
  }

  /** Usable panel for a player: alive, grounded, holding E, in reach, zone ready, no other outage. */
  private pick(): { player: SimPlayer; panelId: string; zone: string } | null {
    if (this.anyCut) return null;
    let first: { player: SimPlayer; panelId: string; zone: string } | null = null;
    for (const p of this.sim.players.values()) {
      if (!p.alive || !p.interact || !p.controller.state.grounded) continue;
      const s = p.controller.state;
      for (const panel of this.map.panels) {
        const z = this.zones.get(panel.zone);
        if (!z || z.cut || z.cooldown > 0) continue;
        if (Math.hypot(s.x - panel.pos[0], s.z - panel.pos[1]) > this.rules.panelReach) continue;
        const found = { player: p, panelId: panel.id, zone: panel.zone };
        if (this.hold?.playerId === p.id && this.hold.panelId === panel.id) return found;
        first ??= found;
      }
    }
    return first;
  }
}
