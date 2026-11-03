# Performance

All numbers below are measured on the development machine, with the load generator on the **same** machine
(so they understate server capacity). No real-GPU frame rates were measured: development was headless with
software rendering.

## Server (production bundle, `npm run loadtest`)

| Load                       | Clients still connected | Tick p50 / p99 / max  | Event-loop lag p99 | RSS     | Downstream per client |
| -------------------------- | ----------------------- | --------------------- | ------------------ | ------- | --------------------- |
| 5 rooms x 4 (20 clients)   | 20/20                   | 0.43 / 1.50 / 10.6 ms | ~2 ms              | ~240 MB | 4.0 KiB/s             |
| 25 rooms x 4 (100 clients) | 100/100                 | 0.31 / 1.11 / 12.3 ms | 5.6 ms             | 354 MB  | 3.9 KiB/s             |
| 40 rooms x 4 (160 clients) | 160/160                 | 0.26 / 1.48 / 15.7 ms | 10.4 ms            | 265 MB  | 3.7 KiB/s             |

"Tick" is one 1/60 s simulation step of one room (budget 16.7 ms). Each client sends ~62 inputs/s.
Rough capacity: one Node process sustains ~40-60 busy 2v2 rooms (160-240 players) before event-loop lag
nears a frame; add rooms per process only after re-measuring on the target hardware.

### Simulation cost vs players per room (`apps/server/scripts/simbench.ts`, no networking)

| Players  | mean tick    | p99 tick | rooms per core (at mean) |
| -------- | ------------ | -------- | ------------------------ |
| 2        | 0.25-0.37 ms | ~1.0 ms  | ~45-68                   |
| 4        | 0.21-0.31 ms | ~0.7 ms  | ~54-79                   |
| 10 (5v5) | 0.7-1.4 ms   | 2-3 ms   | ~12-24                   |
| 20       | ~2.0 ms      | 5-9 ms   | ~8                       |

Results vary run to run (random walkers collide differently). Cost grows faster than linearly with players
because of player-vs-player collision queries and per-shot lag-compensation rewinds.
One optimisation was applied: the physics world is stepped once per tick, not once per player.

### Practice matches against bots (`apps/server/scripts/botbench.ts`, simulation only)

| Layout                 | mean tick | p99 tick | rooms per core (mean) |
| ---------------------- | --------- | -------- | --------------------- |
| 1 human + 1 bot (1v1)  | 0.07 ms   | 0.38 ms  | ~250                  |
| 4 bots (2v2)           | 0.13 ms   | 0.75 ms  | ~130                  |
| 1 human + 9 bots (5v5) | 0.20 ms   | 0.96 ms  | ~84                   |

Excludes network encoding. Bot cost is dominated by line-of-sight raycasts (each bot checks each enemy each tick).

## Network

~4 KiB/s per client downstream at 20 Hz state updates for 2v2 (schema deltas); upstream is ~60 small
inputs/s (~150 B each, ~9 KiB/s). Bandwidth was not the bottleneck at any tested load.

## Web app payload

|                                            | Before                          | After                                                                               |
| ------------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------- |
| Entry chunk (menu, lobby)                  | 5.4 MB (1.98 MB gzip), one file | **500 KB (154 KB gzip)**                                                            |
| 3D menu background (three.js)              | included                        | separate lazy chunk, 560 KB (140 KB gzip)                                           |
| Physics + simulation (Rapier WASM inlined) | included                        | separate lazy chunk, 4.3 MB (1.68 MB gzip), **only fetched when a game page opens** |

Verified in a browser: the menu requests the entry and background chunks only; the physics chunk loads when the
sandbox/match opens. The physics WASM is embedded as base64 by the `-compat` build (about 33% larger than a
raw `.wasm` asset); switching to the non-compat build with a separate `.wasm` file would cut the game chunk
by ~1 MB gzip and is a worthwhile follow-up.

## Not measured (do these before launch)

- Client frame rate and frame-time on real GPUs (integrated and discrete), per graphics preset; memory over a long session.
- Firefox, Safari, Edge, macOS, and mid-range laptops. Safari support is untested.
- Server behaviour over real internet latency/jitter/packet loss (the load test runs on loopback).
- Soak test (hours) for memory growth; 5v5 rooms through the network (5v5 is not enabled in the lobby yet).
