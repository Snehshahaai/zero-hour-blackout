# Development checklist

## Phase 1: Project foundation — DONE

- [x] Monorepo + workspaces
- [x] TypeScript strict, shared base config
- [x] Vite + React app shell (nav, home, server status)
- [x] Three.js wired into game-engine (revision + WebGL2 detection only)
- [x] Fixed-timestep `GameLoop` with tests
- [x] Shared constants and Zod schemas with tests
- [x] Colyseus server boots, `/health`, restricted CORS (no rooms registered yet)
- [x] ESLint, Prettier, Vitest, `npm run check`

## Phase 2: 3D environment — DONE (blockout quality)

- [x] `GameRenderer`: canvas ownership, resize (ResizeObserver), DPR cap, tone mapping, fog, shadows
- [x] Low/Medium/High presets, persisted in localStorage, live-switchable (AA needs reload)
- [x] Map 01 blockout from declarative `MapDef` (rooms, corridors, 2 objectives, spawns, props), with tests
- [x] Procedural concrete/metal textures with world-scaled UVs; shared geometry; instanced crates
- [x] Menu background (orbit fly-over, roofs cut away) + loading screen with progress
- [ ] Not done: no player camera yet (P3), no collision, spawns/sightlines not playtested, no Blender assets, no performance targets measured (verified only under software rendering)

## Phase 3: Player controller — DONE (sandbox)

- [x] Rapier (WASM) physics world with static colliders generated from `MapDef` (same data as rendering)
- [x] `PlayerController`: kinematic capsule, acceleration/deceleration, walk/sprint/crouch/jump, coyote time + jump buffer, autostep, ground detection, headroom check before standing
- [x] Simulation is DOM/render-free (usable by the server later) and tested in Node against the real Map 01 (wall, doorway, jump, crouch under a low ceiling)
- [x] Pointer-lock first-person camera; look applied per frame, movement on a fixed 60 Hz step with render interpolation
- [x] `#/sandbox` route (Home > Solo Sandbox) with click-to-play overlay and 4 Hz debug readout
- [x] Lighting rebalanced so interiors are readable on every quality preset
- [ ] Not done: weapon sway (Phase 4, needs a weapon), footsteps/audio, mouse-sensitivity and key-binding settings, gamepad, Safari/Firefox verification, measured performance (only checked under software rendering at 13-40 fps)
- Known: stance/jump constants in `MOVEMENT` are first-pass and need playtesting; concrete texture tiling is visible; metal looks flat without an environment map.

## Phase 4: Weapon system — DONE (single rifle, solo sandbox)

- [x] `WeaponSim`: fire rate (700 rpm), magazine/reserve ammo, reload (tactical, cannot fire mid-reload, auto-reload on dry fire), recoil pattern with recovery, movement/air/crouch spread + bloom, seeded deterministic shot offsets
- [x] `computeDamage` (range falloff + headshot x2), `Health`, `TargetDummy` (respawning practice targets)
- [x] `Hitscan` ray queries against map + targets, headshot zone, own-collider exclusion; walls block shots
- [x] First-person rifle view model (procedural): spring recoil, movement bob, look sway, sprint pose, scripted reload; muzzle flash; tracers; impact decals/sparks (pooled)
- [x] Synthesised audio (shot, dry, mag out/in, chamber, hit, headshot, kill, impact), no audio assets
- [x] HUD: health, ammo/reserve, weapon, reload/empty state, hit marker (hit / headshot / kill) driven by events, not per frame
- [x] 39 unit tests (weapon sim, damage, hitscan vs real Map 01); verified in a real browser: fire, reload, aimed body and head hits
- [ ] Not done: server-side hit validation and lag compensation (Phase 5), spatial/occluded audio (Phase 7), authored weapon model/animations (Blender), hit-location damage for limbs, bullet penetration, weapon switching/other weapon classes, ADS
- Known: all weapon numbers are first-pass. Time-to-kill: 4 body shots or 2 headshots (108 dmg) kill 100 HP; 2-shot headshot kills probably need tuning. `H` is a dev key that damages the player so the health HUD can be exercised (no enemies exist yet).

## Phase 5a: Rooms and lobby — DONE

- [x] Colyseus `MatchRoom` with schema state; the 6-char room code _is_ the room id (`joinById`)
- [x] Create private room, join by code (and invite link `#/play/CODE`), public quick play (`filterBy` visibility/format/mode; never matches private rooms)
- [x] Server-authoritative lobby: team assignment (balanced), team switch, ready, host-only start with rules (both teams, equal sizes, all ready, nobody reconnecting), 3 s countdown, room lock, host migration, unique names
- [x] Zod validation of room options, join options and every client message; malformed message = kicked, slot freed immediately; per-client rate limiting
- [x] Disconnect handling: 30 s slot hold, `reconnect(token)`, retry/backoff in the client, resume after page refresh (sessionStorage token)
- [x] Lobby UI: Play page (callsign, format, quick play / create / join), Lobby page (teams, slots, ready, host, room code, copy code/link, loadout, countdown), error notices
- [x] 19 server tests (real server + real SDK clients) and rules unit tests; verified with two real browsers incl. mid-lobby refresh
- [ ] Not done (5b): in-match player sync, server-side movement/hit validation, prediction/interpolation. "Match started" currently only shows a message.
- [ ] Not done: selectable loadout (only HX-27 exists), friends list/notifications, kick/ban, spectators, team-switch swap requests, persistence/accounts, public room browser.

## Phase 5b: In-match synchronization — DONE (deathmatch-style, no round rules yet)

- [x] Server `MatchSim` (60 Hz): runs the same `PlayerController`/`WeaponSim`/`Hitscan` as the client; server decides movement, hits, damage, deaths, respawns (3 s), scores. No friendly fire.
- [x] Inputs (Zod-validated) are queued per player and consumed against a per-tick credit: bursts absorbed, idle = not simulated, speed capped at real time (flooding does nothing). Out-of-range fields kick the sender.
- [x] Lag compensation: shots are resolved against targets rewound to the shooter's render time, capped at 250 ms
- [x] State replication at 20 Hz (Colyseus schema): positions, velocity, health, ammo, reload, K/D, last-acked input
- [x] Client: prediction + reconciliation (rewind/replay only when error > 4 cm), 110 ms snapshot interpolation of remote players, server-driven HUD/hit markers/killfeed/scoreboard (Tab), tracers/impacts/sounds from server `shot` events
- [x] Reconnect during a match keeps the player's slot; 32 server tests (sim logic without network + real-server flows); verified with two real browsers (match entry, movement with 0 corrections, server-owned ammo/reload, remote player present)
- [ ] Not done: round/bomb/objective rules, team scoring and match end (Phase 6) — the match currently never ends
- [ ] Not done: positional audio (only distance-scaled volume), remote player animation/models (capsules), clock-sync refinement/ping display, bandwidth measurements, interest management, load test, server tick-rate degradation handling, anti-cheat beyond input validation (aim is client-reported; server adds its own recoil/spread)
- Known: each `PlayerController.update` steps the whole Rapier world, so server cost grows with player count x 60 Hz; fine for 1v1/2v2, must be measured/optimised before 5v5. Local physics has no other players, so bumping into one causes a (corrected) misprediction.

## Phase 6: Competitive gameplay — DONE (first version)

- [x] `RoundManager` (server, pure + tested): freeze (5 s, inputs ignored) -> live (100 s) -> planted (35 s fuse) -> round end (5 s); first to 4 round wins; sides swap after round 3; scores belong to the fixed lobby teams, not the sides
- [x] Win conditions: attackers eliminate defenders / bomb detonates; defenders eliminate attackers before a plant / time expires / bomb defused. After a plant, attackers dying does not end the round.
- [x] Bomb: attackers hold E inside a site zone (3.5 s, grounded, uninterrupted), defenders hold E within 2.5 m of the bomb (5 s); the server validates position, side, aliveness, key held and duration; progress resets if interrupted
- [x] No mid-round respawns: everyone respawns at the new side's spawns each round, full health/ammo
- [x] A team with no players left forfeits; after the match the room returns to an unlocked lobby with ready reset
- [x] HUD: round timer, score (you vs them), round number, side and objective hint, bomb status/site, interact prompt + progress bar, teammate health, kill/round feed, victory/defeat screen; 3D bomb model with LED + accelerating beeps, explosion sound
- [x] 85 tests (24 rule tests incl. plant/defuse/halftime/forfeit, 46 server incl. match lifecycle); browser-verified full 3-round match with side swap, scoring, results and return to lobby (using shortened round timers and timeouts)
- [ ] Not done: bomb carrier/pickup/drop (any attacker can plant in a site), defuse kits, economy/buy phase, overtime, bomb explosion damage/effects, per-round sound/UI polish, spectating dead teammates, objective/site visuals beyond the floor disc, balance tuning
- [ ] Not verified in a real browser: an actual plant/defuse by walking to a site (covered by rule tests only), the 100 s default timings, 2v2 matches
- Known: players stand still in round-end (client sends no input; server sees an empty queue). Map spawn/site balance is untested.

## Not implemented yet

Everything else: power grid/audio (P7), co-op/AI (P8), deployment (P9). The home-screen buttons are intentionally disabled.

## Next: Phase 7 — Signature mechanics (power grid, advanced sound, environment)
