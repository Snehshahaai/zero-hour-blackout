import { z } from 'zod';
import { RateLimiter } from '../rooms/lobbyRules.ts';

export interface Limits {
  /** Hard cap on simultaneous rooms in this process. */
  maxRooms: number;
  /** Per-IP WebSocket upgrade budget: burst size and sustained rate per second. */
  upgradeBurst: number;
  upgradeRefillPerSecond: number;
  /** Largest WebSocket message accepted (bytes). Real inputs are ~150 B. */
  maxPayloadBytes: number;
  /** Largest accepted HTTP body for /client-errors (bytes). */
  maxErrorBodyBytes: number;
  /** Believe X-Forwarded-For (only enable behind a proxy you control). */
  trustProxy: boolean;
}

export const DEFAULT_LIMITS: Limits = {
  maxRooms: 200,
  upgradeBurst: 60,
  upgradeRefillPerSecond: 2,
  maxPayloadBytes: 8192,
  maxErrorBodyBytes: 8192,
  trustProxy: false,
};

export type GuardVerdict = { ok: true } | { ok: false; status: number; message: string };

/**
 * Decides whether a WebSocket upgrade may proceed. Browsers always send `Origin`, so a page on
 * another site cannot open a socket to us; non-browser tools omit it, which is why the matchmaking
 * seat reservation (not this check) is the real access control. The per-IP budget slows floods.
 */
export class UpgradeGuard {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly allowedOrigins: readonly string[],
    limits: Pick<Limits, 'upgradeBurst' | 'upgradeRefillPerSecond'>,
    now?: () => number,
  ) {
    this.limiter = new RateLimiter(limits.upgradeBurst, limits.upgradeRefillPerSecond, now);
  }

  check(origin: string | null | undefined, ip: string | undefined): GuardVerdict {
    if (origin && !this.allowedOrigins.includes(origin)) {
      return { ok: false, status: 403, message: 'origin not allowed' };
    }
    if (!this.limiter.allow(ip ?? 'unknown')) {
      return { ok: false, status: 429, message: 'too many connections' };
    }
    return { ok: true };
  }
}

/** Shape of a browser error report. Every field is length-capped: never trust the client. */
export const clientErrorSchema = z.object({
  message: z.string().max(500),
  stack: z.string().max(4000).optional(),
  url: z.string().max(300).optional(),
  userAgent: z.string().max(300).optional(),
  build: z.string().max(60).optional(),
  kind: z.enum(['error', 'unhandledrejection', 'react']).default('error'),
});
export type ClientErrorReport = z.infer<typeof clientErrorSchema>;

/** Client IP for HTTP routes: only trusts X-Forwarded-For when configured to. */
export function httpClientIp(headers: Headers | undefined, trustProxy: boolean): string {
  if (!trustProxy) return 'shared';
  const xff = headers?.get('x-forwarded-for');
  return xff?.split(',')[0]?.trim() || 'shared';
}
