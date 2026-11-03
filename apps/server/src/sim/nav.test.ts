import { MAP_01, PhysicsWorld, RAPIER, initPhysics } from '@zhb/game-engine/sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAP01_NAV_NODES, NavGraph } from './nav.ts';

let graph: NavGraph;
let physics: PhysicsWorld;

beforeAll(async () => {
  await initPhysics();
  physics = PhysicsWorld.fromMap(MAP_01);
  graph = new NavGraph(MAP01_NAV_NODES, (ax, az, bx, bz) => physics.segmentClear(ax, az, bx, bz));
});

describe('Map 01 navigation graph', () => {
  it('has unique ids and every node stands on free floor (a body fits there)', () => {
    const ids = new Set(MAP01_NAV_NODES.map((n) => n.id));
    expect(ids.size).toBe(MAP01_NAV_NODES.length);
    const blocked = MAP01_NAV_NODES.filter(
      (n) =>
        physics.world.intersectionWithShape(
          { x: n.x, y: 0.9, z: n.z },
          { x: 0, y: 0, z: 0, w: 1 },
          new RAPIER.Ball(0.4),
        ) !== null,
    ).map((n) => n.id);
    expect(blocked).toEqual([]);
  });

  it('is fully connected: every node can reach every other node', () => {
    const start = MAP01_NAV_NODES[0]!.id;
    const seen = new Set<string>([start]);
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      for (const e of graph.neighbours(id)) {
        if (!seen.has(e.to)) {
          seen.add(e.to);
          stack.push(e.to);
        }
      }
    }
    const missing = MAP01_NAV_NODES.filter((n) => !seen.has(n.id)).map((n) => n.id);
    expect(missing).toEqual([]);
  });

  it('finds sensible routes between the key areas', () => {
    const toA = graph.path('wc_spawn', 'siteA');
    const toB = graph.path('wc_spawn', 'siteB');
    expect(toA).not.toBeNull();
    expect(toB).not.toBeNull();
    // Path ends at the goal and each step is a real edge.
    for (const path of [toA!, toB!]) {
      for (let i = 1; i < path.length; i++) {
        const prev = path[i - 1]!;
        expect(graph.neighbours(prev.id).some((e) => e.to === path[i]!.id)).toBe(true);
      }
    }
    expect(toA!.at(-1)!.id).toBe('siteA');
    expect(graph.path('siteA', 'siteA')).toHaveLength(1);
    expect(graph.path('siteA', 'nope')).toBeNull();
  });

  it('paths are not wildly longer than the straight-line distance (no silly detours)', () => {
    const route = graph.path('wc_spawn', 'siteB')!;
    let len = 0;
    for (let i = 1; i < route.length; i++)
      len += Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.z - route[i - 1]!.z);
    const a = graph.byId.get('wc_spawn')!;
    const b = graph.byId.get('siteB')!;
    expect(len).toBeLessThan(Math.hypot(a.x - b.x, a.z - b.z) * 2.2);
  });
});

describe('walkability queries ignore characters but respect doors', () => {
  it('a player standing in a corridor does not make it look blocked', async () => {
    const { PlayerController } = await import('@zhb/game-engine/sim');
    const w = PhysicsWorld.fromMap(MAP_01);
    const before = w.segmentClear(26, 26.5, 37, 26.5);
    new PlayerController(w, { x: 31.5, y: 0.05, z: 26.5 });
    expect(w.segmentClear(26, 26.5, 37, 26.5)).toBe(before);
    expect(before).toBe(true);
    w.dispose();
  });

  it('a closed electronic door blocks the route, and opening it clears it', () => {
    const w = PhysicsWorld.fromMap(MAP_01);
    expect(w.segmentClear(20.2, 14, 20.2, 6)).toBe(true);
    w.setDoorClosed('D-security-south', true);
    expect(w.segmentClear(20.2, 14, 20.2, 6)).toBe(false);
    w.setDoorClosed('D-security-south', false);
    expect(w.segmentClear(20.2, 14, 20.2, 6)).toBe(true);
    w.dispose();
  });
});
