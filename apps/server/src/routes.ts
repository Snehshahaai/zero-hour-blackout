import { createEndpoint, createRouter, matchMaker } from '@colyseus/core';
import { RateLimiter } from './rooms/lobbyRules.ts';
import { DEFAULT_LIMITS, clientErrorSchema, httpClientIp, type Limits } from './services/guards.ts';
import { metrics, snapshotMetrics, toPrometheus } from './services/metrics.ts';
import { GAME_NAME } from '@zhb/shared';

export function createRoutes(
  startedAt: number,
  metricsToken?: string,
  limits: Limits = DEFAULT_LIMITS,
) {
  const health = createEndpoint('/health', { method: 'GET' }, async () => ({
    status: 'ok' as const,
    game: GAME_NAME,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }));
  // Liveness vs readiness: both are cheap and unauthenticated; they expose no player data.
  const ready = createEndpoint('/ready', { method: 'GET' }, async () => ({ ready: true as const }));

  // Operational numbers. If METRICS_TOKEN is set, it must be sent as a bearer token.
  const metricsEndpoint = createEndpoint('/metrics', { method: 'GET' }, async (ctx) => {
    if (metricsToken) {
      const auth = ctx.headers?.get('authorization') ?? '';
      if (auth !== `Bearer ${metricsToken}`) {
        throw ctx.error('UNAUTHORIZED', { message: 'metrics token required' });
      }
    }
    const snap = snapshotMetrics({
      rooms: matchMaker.stats.local.roomCount,
      clients: matchMaker.stats.local.ccu,
    });
    if (new URL(ctx.request?.url ?? 'http://x/metrics?').searchParams.get('format') === 'prom') {
      return new Response(toPrometheus(snap), {
        headers: { 'content-type': 'text/plain; version=0.0.4' },
      });
    }
    return snap;
  });

  // Browser error reports (self-hosted error monitoring). Strictly validated, size-capped and
  // rate-limited; accepted reports are logged as one JSON line so any log pipeline can alert on them.
  const errorLimiter = new RateLimiter(20, 0.5);
  const clientErrors = createEndpoint(
    '/client-errors',
    { method: 'POST', body: clientErrorSchema },
    async (ctx) => {
      const length = Number(ctx.headers?.get('content-length') ?? '0');
      if (length > limits.maxErrorBodyBytes)
        throw ctx.error('PAYLOAD_TOO_LARGE', { message: 'report too large' });
      if (!errorLimiter.allow(httpClientIp(ctx.headers, limits.trustProxy))) {
        throw ctx.error('TOO_MANY_REQUESTS', { message: 'slow down' });
      }
      metrics.counters.clientErrorsReported++;
      // Newlines are escaped by JSON.stringify, so a report cannot forge extra log lines.
      console.error(
        JSON.stringify({ type: 'client_error', at: new Date().toISOString(), ...ctx.body }),
      );
      return { accepted: true as const };
    },
  );

  return createRouter({ health, ready, metrics: metricsEndpoint, clientErrors });
}
