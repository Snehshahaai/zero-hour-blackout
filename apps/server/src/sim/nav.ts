export interface NavNode {
  id: string;
  x: number;
  z: number;
}

/**
 * Hand-placed waypoints for Map 01 (floor positions). Edges are NOT hand-authored: they are
 * derived from physics raycasts when the graph is built, so they can never disagree with the
 * actual collision geometry.
 */
export const MAP01_NAV_NODES: readonly NavNode[] = [
  // West corridor
  { id: 'wc_n', x: 11, z: 4.2 },
  { id: 'wc_m', x: 12.5, z: 19.5 },
  { id: 'wc_s', x: 12, z: 34.5 },
  { id: 'wc_spawn', x: 9, z: 36.5 },
  // Security office / north corridor
  { id: 'sec_w', x: 17, z: 4.2 },
  { id: 'sec_e', x: 25, z: 4.2 },
  { id: 'sec_s', x: 20.2, z: 8 },
  { id: 'cor', x: 30, z: 4.2 },
  { id: 'cor_s', x: 30, z: 8.5 },
  // Generator room (site A)
  { id: 'gen_in', x: 34, z: 4.2 },
  { id: 'gen_m', x: 34, z: 6.8 },
  { id: 'gen_s', x: 36, z: 8.8 },
  { id: 'siteA', x: 39, z: 8.2 },
  { id: 'gen_e', x: 42, z: 8.8 },
  // Warehouse
  { id: 'wh_w', x: 17, z: 19.5 },
  { id: 'wh_c1', x: 22, z: 19.5 },
  { id: 'wh_c2', x: 27, z: 22 },
  { id: 'wh_c3', x: 33, z: 26 },
  { id: 'wh_c4', x: 34, z: 16 },
  { id: 'wh_e', x: 43, z: 19.5 },
  { id: 'wh_n1', x: 20.2, z: 12 },
  { id: 'wh_n2', x: 30, z: 12 },
  { id: 'wh_n3', x: 39.2, z: 12 },
  { id: 'wh_s1', x: 21.5, z: 28 },
  { id: 'wh_s2', x: 30, z: 28.5 },
  // Loading dock (site B)
  { id: 'dock_w', x: 47, z: 19.5 },
  { id: 'siteB', x: 52, z: 20.5 },
  { id: 'dock_e', x: 57, z: 20 },
  { id: 'dock_n', x: 50, z: 16.5 },
  { id: 'dock_s', x: 53.5, z: 27 },
  // Maintenance
  { id: 'm_w', x: 17, z: 34.5 },
  { id: 'm_a', x: 21.5, z: 31.5 },
  { id: 'm_b', x: 30, z: 31.5 },
  { id: 'm_c', x: 38, z: 33 },
  { id: 'm_d', x: 44, z: 33 },
  { id: 'm_e', x: 52, z: 32 },
  { id: 'm_f', x: 56, z: 36.5 },
  { id: 'm_g', x: 28, z: 38 },
];

interface Edge {
  to: string;
  cost: number;
}

/** Waypoint graph with A* pathfinding. */
export class NavGraph {
  readonly byId = new Map<string, NavNode>();
  private readonly adj = new Map<string, Edge[]>();

  /** `clear(ax,az,bx,bz)` says whether a body can walk straight between two points. */
  constructor(
    readonly nodes: readonly NavNode[],
    readonly clear: (ax: number, az: number, bx: number, bz: number) => boolean,
    private readonly maxEdge = 16,
  ) {
    for (const n of nodes) this.byId.set(n.id, n);
    this.rebuild();
  }

  /**
   * (Re)computes every edge from the live collision world. Call after something that changes
   * walkability, e.g. an electronic door closing, so bots stop routing through it.
   */
  rebuild(): void {
    this.adj.clear();
    for (const n of this.nodes) this.adj.set(n.id, []);
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i] as NavNode;
        const b = this.nodes[j] as NavNode;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d > this.maxEdge || !this.clear(a.x, a.z, b.x, b.z)) continue;
        this.adj.get(a.id)?.push({ to: b.id, cost: d });
        this.adj.get(b.id)?.push({ to: a.id, cost: d });
      }
    }
  }

  neighbours(id: string): readonly Edge[] {
    return this.adj.get(id) ?? [];
  }

  /** Nearest node, preferring ones with a clear straight line from (x, z). */
  nearest(x: number, z: number): NavNode | null {
    let best: NavNode | null = null;
    let bestScore = Infinity;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - x, n.z - z);
      const score = this.clear(x, z, n.x, n.z) ? d : d + 1000;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }

  /** A* shortest path between nodes (inclusive), or null if unreachable. */
  path(fromId: string, toId: string): NavNode[] | null {
    const goal = this.byId.get(toId);
    if (!goal || !this.byId.has(fromId)) return null;
    const h = (id: string) => {
      const n = this.byId.get(id) as NavNode;
      return Math.hypot(n.x - goal.x, n.z - goal.z);
    };
    const g = new Map<string, number>([[fromId, 0]]);
    const came = new Map<string, string>();
    const open = new Map<string, number>([[fromId, h(fromId)]]);
    while (open.size > 0) {
      let cur = '';
      let curF = Infinity;
      for (const [id, f] of open) {
        if (f < curF) {
          curF = f;
          cur = id;
        }
      }
      if (cur === toId) {
        const out: NavNode[] = [];
        for (let at: string | undefined = cur; at !== undefined; at = came.get(at)) {
          out.push(this.byId.get(at) as NavNode);
        }
        return out.reverse();
      }
      open.delete(cur);
      for (const e of this.neighbours(cur)) {
        const tentative = (g.get(cur) ?? Infinity) + e.cost;
        if (tentative < (g.get(e.to) ?? Infinity)) {
          came.set(e.to, cur);
          g.set(e.to, tentative);
          open.set(e.to, tentative + h(e.to));
        }
      }
    }
    return null;
  }
}
