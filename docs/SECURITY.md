# Security notes

## Model

Browsers are untrusted. The server is authoritative for movement, combat, objectives, scoring, mission
state, power and weather; clients only send _intents_ (inputs, ready, team, start). Every message is
validated with Zod; a malformed message disconnects the sender.

## Enforced and tested (`apps/server/src/security.test.ts`, `lobbyRules`, `MatchSim` tests)

| Control                                                                                                                            | Where                                         |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Strict input schema (ranges, ints, booleans); invalid payload = kick                                                               | `inputMessageSchema`, Colyseus `validate`     |
| One input consumed per tick with bounded burst credit: flooding inputs cannot speed-hack                                           | `MatchSim.stepPlayer`                         |
| Held keys expire without fresh input                                                                                               | `MatchSim` (`INTERACT_STALE_TICKS`)           |
| WebSocket max message size (default 8 KiB)                                                                                         | `maxPayload`                                  |
| WebSocket Origin check (browsers from other sites are refused, 403)                                                                | `UpgradeGuard`                                |
| Per-IP connection budget (429 when exceeded)                                                                                       | `UpgradeGuard`, `UPGRADE_BURST`               |
| Per-client lobby message rate limit; separate budget for inputs                                                                    | `RateLimiter`                                 |
| Room cap (`MAX_ROOMS`) with a clear "server busy" error                                                                            | `MatchRoom.onCreate`                          |
| Zombie-room prevention: rooms close when their last player's seat expires                                                          | `MatchRoom.removePlayer`                      |
| Player names: letters/digits/space/`_.-` only, 2-24 chars (no bidi/control chars, no markup); names are only ever data, never keys | `playerNameSchema`                            |
| Prototype-pollution style payloads and junk message types do not crash or pollute                                                  | fuzz test                                     |
| CORS is an allow-list; untrusted `Origin` is never reflected                                                                       | `matchMaker.controller.getCorsHeaders`        |
| `/client-errors`: schema + length caps, body cap, rate limit, one-line JSON log (no log forging)                                   | `routes.ts`                                   |
| `/metrics` bearer token when `METRICS_TOKEN` is set                                                                                | `routes.ts`                                   |
| Static site CSP (`wasm-unsafe-eval`, no `unsafe-eval`, no framing/plugins), nosniff, referrer and permissions policy               | `apps/web/security-headers.ts`, `render.yaml` |
| Reconnection tokens are per-session and held only in `sessionStorage`                                                              | `network.ts`                                  |

## Known limitations (be honest with yourself before launch)

1. **No accounts or authentication.** Anyone can pick any callsign. There are no bans, reports or persistent
   identity. A public launch needs a decision on accounts (see "Open decisions").
2. **Aim is client-reported.** Movement and shooting are server-validated, but view angles come from the client,
   so aimbots/wallhack-style cheats are possible (the server sends all players' positions to everyone). Mitigations
   (visibility culling, server-side aim plausibility checks) are not implemented.
3. **Oversized-message abusers hold their seat for the reconnect grace period** (30 s): Colyseus reports that
   disconnect as 1006, the same as a network drop. They are rate limited and cannot grow the room.
4. **One address = one budget.** Players behind the same NAT share the per-IP connection budget (burst 60);
   raise `UPGRADE_BURST` for schools/events. Without `TRUST_PROXY` behind a proxy, all users look like one IP.
5. CSP `connect-src` allows any HTTPS/WSS host; tighten to the server origin after deploy.
6. **Dev-tooling advisories:** `npm audit` reports 11 moderate findings, all in `typescript-eslint` (build-time only).
   Production dependencies: 0 (`npm run audit` gates CI on high+).
7. No DoS protection beyond the above (use the host's network protections / a CDN in front of the static site).
8. Not independently penetration-tested. The tests above are developer tests, not a security audit.

## Open decisions

- Accounts: guest-only vs email/OAuth. Required for bans, stats, friends, and PostgreSQL profiles (the spec lists
  PostgreSQL; nothing persists yet, by design, until this is decided).
