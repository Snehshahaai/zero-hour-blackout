import { monitorEventLoopDelay } from 'node:perf_hooks';

/** Fixed-size ring of recent samples; percentiles are computed on demand. */
export class Histogram {
  private readonly buf: Float64Array;
  private n = 0;
  private i = 0;
  total = 0;
  sum = 0;
  max = 0;

  constructor(size = 4096) {
    this.buf = new Float64Array(size);
  }

  record(v: number): void {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.buf.length;
    this.n = Math.min(this.buf.length, this.n + 1);
    this.total++;
    this.sum += v;
    if (v > this.max) this.max = v;
  }

  percentile(p: number): number {
    if (this.n === 0) return 0;
    const sorted = Array.from(this.buf.subarray(0, this.n)).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
  }

  summary() {
    return {
      count: this.total,
      mean: this.total ? this.sum / this.total : 0,
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
      max: this.max,
    };
  }
}

const RESOLUTION_MS = 10;
const loopDelay = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
/** The histogram includes the timer resolution itself; report only the excess lag. */
const excess = (ns: number) => Math.max(0, ns / 1e6 - RESOLUTION_MS);
loopDelay.enable();

/** Process-wide counters and timings. Cheap enough to leave on in production. */
export const metrics = {
  startedAt: Date.now(),
  /** Wall time of one 60 Hz simulation tick (all rules, physics, bots, state copy), in ms. */
  simStepMs: new Histogram(),
  counters: {
    roomsCreated: 0,
    matchesStarted: 0,
    matchesFinished: 0,
    inputsAccepted: 0,
    clientErrorsReported: 0,
    upgradesRejected: 0,
  },
};

export function snapshotMetrics(extra: { rooms: number; clients: number }) {
  const mem = process.memoryUsage();
  return {
    uptimeSeconds: Math.round((Date.now() - metrics.startedAt) / 1000),
    rooms: extra.rooms,
    clients: extra.clients,
    simStepMs: metrics.simStepMs.summary(),
    eventLoopLagMs: {
      mean: excess(loopDelay.mean),
      p99: excess(loopDelay.percentile(99)),
      max: excess(loopDelay.max),
    },
    memoryMB: { rss: mem.rss / 1048576, heapUsed: mem.heapUsed / 1048576 },
    counters: { ...metrics.counters },
  };
}

/** Prometheus text exposition for the same data (for any scraper). */
export function toPrometheus(s: ReturnType<typeof snapshotMetrics>): string {
  const lines: string[] = [];
  const g = (name: string, v: number, help?: string) => {
    if (help) lines.push(`# HELP ${name} ${help}`);
    lines.push(`${name} ${Number.isFinite(v) ? v : 0}`);
  };
  g('zhb_uptime_seconds', s.uptimeSeconds, 'Process uptime');
  g('zhb_rooms', s.rooms, 'Open rooms');
  g('zhb_clients', s.clients, 'Connected clients');
  for (const k of ['p50', 'p95', 'p99', 'max'] as const) g(`zhb_sim_step_ms_${k}`, s.simStepMs[k]);
  g('zhb_event_loop_lag_ms_p99', s.eventLoopLagMs.p99);
  g('zhb_memory_rss_mb', s.memoryMB.rss);
  for (const [k, v] of Object.entries(s.counters))
    g(`zhb_${k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())}_total`, v);
  return lines.join('\n') + '\n';
}
