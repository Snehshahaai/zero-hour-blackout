import { MAP_01, initPhysics } from '@zhb/game-engine/sim';
import type { InputMessage } from '@zhb/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchSim } from './MatchSim.ts';
import { PowerGrid, type PowerEvent } from './PowerGrid.ts';

beforeAll(async () => {
  await initPhysics();
});

let seq = 0;
const input = (over: Partial<InputMessage> = {}): InputMessage => ({
  seq: seq++,
  forward: 0,
  right: 0,
  jump: false,
  sprint: false,
  crouch: false,
  fire: false,
  reload: false,
  interact: false,
  yaw: 0,
  pitch: 0,
  renderTime: 0,
  ...over,
});

const FAST = { panelHoldSeconds: 0.4, outageSeconds: 1, cooldownSeconds: 1 };

function setup() {
  const events: PowerEvent[] = [];
  const sim = new MatchSim(MAP_01, () => undefined, null);
  const a = sim.addPlayer('A', 'Alice', 'attackers');
  const d = sim.addPlayer('D', 'Dave', 'defenders');
  const grid = new PowerGrid(sim, MAP_01, (e) => events.push(e), FAST);
  const run = (seconds: number, perTick?: () => void, active = true) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      perTick?.();
      sim.step();
      grid.step(active);
    }
  };
  const panel = MAP_01.panels.find((p) => p.id === 'P-warehouse')!;
  const stand = (p: typeof a, x: number, z: number) => p.controller.teleport(x, 0.05, z);
  const useAt = (p: typeof a, id: string, seconds: number) => {
    run(seconds, () => sim.queueInput(id, input({ interact: true })));
    void p;
  };
  return { sim, a, d, grid, events, run, panel, stand, useAt };
}

describe('PowerGrid panels', () => {
  it('holding E at a panel for the full time cuts that zone; releasing early does nothing', () => {
    const { a, panel, stand, run, sim, grid, events } = setup();
    stand(a, panel.pos[0], panel.pos[1]);
    run(0.1);
    run(0.25, () => sim.queueInput('A', input({ interact: true })));
    expect(grid.zones.get('warehouse')?.cut).toBe(false);
    expect(a.interactProgress).toBeGreaterThan(0.4);
    run(0.1, () => sim.queueInput('A', input({ interact: false })));
    expect(a.interactProgress).toBe(0);
    run(0.25, () => sim.queueInput('A', input({ interact: true })));
    expect(grid.zones.get('warehouse')?.cut).toBe(false); // progress restarted
    run(0.3, () => sim.queueInput('A', input({ interact: true })));
    expect(grid.zones.get('warehouse')?.cut).toBe(true);
    expect(events).toContainEqual({ type: 'power', event: 'cut', zone: 'warehouse', by: 'A' });
  });

  it('needs to be in reach, grounded, alive and in an active round', () => {
    const { a, panel, stand, run, sim, grid } = setup();
    stand(a, panel.pos[0] - 6, panel.pos[1] + 6); // out of reach
    run(0.1);
    run(1, () => sim.queueInput('A', input({ interact: true })));
    expect(grid.zones.get('warehouse')?.cut).toBe(false);

    stand(a, panel.pos[0], panel.pos[1]);
    run(0.1);
    run(1, () => sim.queueInput('A', input({ interact: true })), false); // freeze / round over
    expect(grid.zones.get('warehouse')?.cut).toBe(false);

    a.alive = false;
    a.controller.setEnabled(false);
    run(1, () => sim.queueInput('A', input({ interact: true })));
    expect(grid.zones.get('warehouse')?.cut).toBe(false);
  });

  it('only designated zones can be cut: generator room and dock have no panel', () => {
    const { grid } = setup();
    expect([...grid.zones.keys()].sort()).toEqual(['maintenance', 'security', 'warehouse']);
  });

  it('one outage at a time; backup power restores it; then a cooldown applies', () => {
    const { a, d, panel, stand, run, sim, grid, events } = setup();
    stand(a, panel.pos[0], panel.pos[1]);
    run(0.1);
    run(0.5, () => sim.queueInput('A', input({ interact: true })));
    expect(grid.zones.get('warehouse')?.cut).toBe(true);

    // While warehouse is cut, nobody can cut another zone.
    const other = MAP_01.panels.find((p) => p.id === 'P-maintenance')!;
    stand(d, other.pos[0], other.pos[1]);
    run(0.1);
    run(0.6, () => sim.queueInput('D', input({ interact: true })));
    expect(grid.zones.get('maintenance')?.cut).toBe(false);

    run(0.4, undefined); // outage (1 s) ends about now
    expect(grid.zones.get('warehouse')?.cut).toBe(false);
    expect(events).toContainEqual({ type: 'power', event: 'restored', zone: 'warehouse', by: '' });

    // Cooldown: same panel refuses immediately after restore...
    stand(a, panel.pos[0], panel.pos[1]);
    run(0.1);
    run(0.5, () => sim.queueInput('A', input({ interact: true })));
    expect(grid.zones.get('warehouse')?.cut).toBe(false);
    // ...but works once the cooldown has elapsed.
    run(0.5, undefined);
    run(0.5, () => sim.queueInput('A', input({ interact: true })));
    expect(grid.zones.get('warehouse')?.cut).toBe(true);
  });

  it('reset() (round start) restores everything and clears cooldowns', () => {
    const { a, panel, stand, run, sim, grid } = setup();
    stand(a, panel.pos[0], panel.pos[1]);
    run(0.1);
    run(0.5, () => sim.queueInput('A', input({ interact: true })));
    expect(grid.anyCut).toBe(true);
    grid.reset();
    expect(grid.anyCut).toBe(false);
    expect(grid.zones.get('warehouse')?.cooldown).toBe(0);
  });
});

describe('electronic door', () => {
  const secPanel = () => MAP_01.panels.find((p) => p.id === 'P-security')!;
  const walkNorth = (ctx: ReturnType<typeof setup>, seconds: number) =>
    ctx.run(seconds, () => ctx.sim.queueInput('D', input({ forward: 1, yaw: 0 })));

  function cutSecurity(ctx: ReturnType<typeof setup>) {
    ctx.stand(ctx.a, secPanel().pos[0], secPanel().pos[1]);
    ctx.run(0.1);
    ctx.run(0.5, () => ctx.sim.queueInput('A', input({ interact: true })));
    expect(ctx.grid.zones.get('security')?.cut).toBe(true);
  }

  it('is open when powered (Dave can walk through) and closed during the outage (he cannot)', () => {
    const open = setup();
    open.stand(open.d, 20.2, 14);
    open.run(0.3);
    walkNorth(open, 1.2); // ~4.8 m north: from z=14 to z<10 through the doorway
    expect(open.d.controller.state.z).toBeLessThan(9.5);

    const closed = setup();
    cutSecurity(closed);
    closed.run(0.1); // door closes (nobody near it)
    expect(closed.grid.doorsClosed.get('D-security-south')).toBe(true);
    closed.stand(closed.d, 20.2, 14);
    closed.run(0.3);
    walkNorth(closed, 0.9); // outage still on
    expect(closed.d.controller.state.z).toBeGreaterThan(10.2);
  });

  it('never closes on someone standing in the doorway; closes once they leave', () => {
    const ctx = setup();
    ctx.stand(ctx.d, 20.2, 10); // standing in the doorway
    ctx.run(0.2);
    cutSecurity(ctx);
    ctx.run(0.2);
    expect(ctx.grid.zones.get('security')?.cut).toBe(true);
    expect(ctx.grid.doorsClosed.get('D-security-south')).toBe(false); // waits for clearance
    ctx.stand(ctx.d, 20.2, 16);
    ctx.run(0.1);
    expect(ctx.grid.doorsClosed.get('D-security-south')).toBe(true);
  });

  it('reopens when power returns', () => {
    const ctx = setup();
    cutSecurity(ctx);
    ctx.run(0.2);
    expect(ctx.grid.doorsClosed.get('D-security-south')).toBe(true);
    ctx.run(1.2);
    expect(ctx.grid.doorsClosed.get('D-security-south')).toBe(false);
  });
});
