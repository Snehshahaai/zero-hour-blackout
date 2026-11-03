import { SERVER_HTTP_URL } from './serverStatus.ts';

export type ErrorKind = 'error' | 'unhandledrejection' | 'react';

export interface Report {
  message: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  build?: string;
  kind: ErrorKind;
}

// Mirrors the server's schema limits (apps/server/src/services/guards.ts): anything longer is cut.
const LIMITS = { message: 500, stack: 4000, url: 300, userAgent: 300, build: 60 };
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Browser noise that is not a bug in the game. */
const IGNORED = [/ResizeObserver loop/i, /Script error\.?$/i, /extension:\/\//i, /AbortError/i];

export function buildReport(kind: ErrorKind, err: unknown, env: Partial<Report> = {}): Report {
  const e = err as { message?: unknown; stack?: unknown } | null | undefined;
  const message =
    typeof err === 'string' ? err : typeof e?.message === 'string' ? e.message : String(err);
  const report: Report = { kind, message: trunc(message || 'unknown error', LIMITS.message) };
  if (typeof e?.stack === 'string') report.stack = trunc(e.stack, LIMITS.stack);
  if (env.url) report.url = trunc(env.url, LIMITS.url);
  if (env.userAgent) report.userAgent = trunc(env.userAgent, LIMITS.userAgent);
  if (env.build) report.build = trunc(env.build, LIMITS.build);
  return report;
}

/** Caps and de-duplicates reports so a render loop cannot flood the server. */
export class ReportThrottle {
  private readonly seen = new Set<string>();
  constructor(private readonly max = 10) {}

  allow(r: Report): boolean {
    if (IGNORED.some((re) => re.test(r.message))) return false;
    const key = `${r.kind}|${r.message}|${(r.stack ?? '').split('\n')[1] ?? ''}`;
    if (this.seen.has(key) || this.seen.size >= this.max) return false;
    this.seen.add(key);
    return true;
  }
}

const throttle = new ReportThrottle();

export function reportError(kind: ErrorKind, err: unknown): void {
  try {
    const report = buildReport(kind, err, {
      url: window.location.href.split('#')[0] ?? '',
      userAgent: navigator.userAgent,
      build: import.meta.env.MODE,
    });
    if (!throttle.allow(report)) return;
    void fetch(`${SERVER_HTTP_URL}/client-errors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* reporting must never throw */
  }
}

export function installErrorReporting(): void {
  window.addEventListener('error', (e) => reportError('error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => reportError('unhandledrejection', e.reason));
}
