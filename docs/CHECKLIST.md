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

## Phase 7: Signature mechanics — DONE (first version)

- [x] **Power grid** (server-authoritative, `PowerGrid`): 3 panels (warehouse, security office, maintenance) cut a zone's power; hold E 1.5 s. Fairness rules: only these zones (never a bomb site), one outage at a time, auto backup restore after 20 s, 30 s cooldown, resets every round, announced to everyone (feed + sound + HUD banner with countdown), emergency red lighting (ambient floor 30%, never black)
- [x] **Electronic door**: security-office south shutter fails closed during that zone's outage; it never closes while anyone is near it, and the office has two other exits. Collision is replicated and applied in both server and client physics
- [x] **Spatial audio**: HRTF/equal-power panning (Low uses equal-power), distance attenuation, wall occlusion (low-pass + gain via a raycast), indoor/outdoor reverb, ambience beds (room hum / wind / rain), listener follows the camera
- [x] **Footsteps**: per-surface sounds (concrete / metal / asphalt) from zone data; stride-based; crouch-walking is silent; remote steps are positional, occluded, range-limited (26 m) and position-jittered so sound never gives an exact location
- [x] **Weather** (server-chosen per match, replicated, cosmetic only): clear / fog / rain; fog = pale haze with density cap, rain = pooled streaks around the camera (700 / 1600 by quality, none on Low) shown only outdoors, rain ambience
- [x] 104 tests: map zone/panel/door validity (panels never overlap a plant zone), 8 power-grid tests (hold, reach, one-at-a-time, restore, cooldown, reset, door blocks movement / waits for clearance / reopens), stale-input expiry, audio helper tests, replicated environment state over a real server
- [x] Browser-verified: 2-player match with forced rain (HUD shows RAIN, 0 prediction corrections, no page errors); rendered checks of rain, fog, blackout lighting and the closed shutter
- [ ] Not done: a separate secondary objective (e.g. intel/escort) — the power grid is the only secondary mechanic; destructible objects; weather-dependent audio occlusion; per-zone darkness seen from outside (darkness applies to the player standing inside the cut zone; lights in the zone do dim for everyone); gameplay effect of weather (intentionally none)
- [ ] Not verified: audio _quality/mix_ (headless browsers can't be listened to — only that the paths run without errors), a real player cutting power by walking to a panel in a browser (covered by server tests), HRTF cost on low-end CPUs
- Known: sounds are synthesised placeholders; mix levels are first-pass and need ears. A held interact key now expires after 200 ms without input (found while testing: an idle client otherwise kept "holding" E forever).

## Phase 8: Cooperative mode — DONE (one small mission)

- [x] Cooperative lobby: one fixed "Operators" team of 1-4 players (no team switching, no balance rule; a solo host can start)
- [x] **AI bots** run server-side as ordinary sim players: a `BotBrain` produces the same `InputMessage` a human client sends, so bots obey identical movement, weapon, recoil, spread and damage rules
- [x] Perception is honest: range, 150-degree field of view, line of sight (raycast to the chest); sound (shots within 38 m) only gives a rough, jittered area to investigate; ~0.43 s reaction time; ~2 degree aiming error; bursts, strafing, reloading in lulls
- [x] Navigation: 38 hand-placed waypoints, edges derived from physics raycasts (can never disagree with collision), A* pathfinding, stuck detection/re-plan; tests prove all nodes are on free floor, the graph is fully connected, paths have no silly detours, and bots reach sites through doors
- [x] Mission "Secure the Facility" (`CoopMission`): clear 4 patrolling hostiles -> hold the generator room (+2 reinforcements) -> hold the loading dock (+3 reinforcements). A hold needs an operator in the zone and no hostile close by (contested), progress decays when abandoned. Objectives are checkpoints that revive fallen operators. Fail: all operators down, or the 10-minute clock
- [x] Client: hostile bots drawn in red, objective/hostiles/timer HUD, hold-progress bar, teammate health, mission result screen, feed messages; room returns to the lobby after the result
- [x] 130 tests; browser-verified with two operators on a real server: lobby, mission start, HUD, 4 bots + teammate replicated, hostiles actually damaged a player, mission failed on the clock, back to the lobby, no page errors
- [ ] Not done: more missions (recover data, protect an objective, escape), difficulty levels, bot cover usage/grenades/flanking, bots using doors/power-grid, revive-by-teammate, mission persistence/progression/rewards, AI using sound occlusion beyond line-of-sight, 4-player load test
- [ ] Not verified: a human clearing all hostiles and securing both sites in a real browser (the logic is covered by `CoopMission` tests; walking it under software rendering was impractical), balance/difficulty tuning, bot performance with many players
- Known: bots only see through open doors; the single mission is short and its difficulty is untuned. Bot pathing assumes doors stay open (the power-grid door is not active in co-op).

## Phase 9: Public release preparation — PARTIAL (everything that can be verified without your accounts/hardware)

Done and verified:

- [x] **Production server build**: esbuild bundle (92 KB) + generated `dist/package.json` pinning the _tested_ dependency versions; verified running from an empty directory with only production deps (44 MB), and load-tested in that form. The build now refuses to ship a dependency copy that doesn't satisfy the declared range (caught a real bug: it had pinned the wrong, hoisted Rapier 0.12 instead of the tested 0.21).
- [x] **Observability**: `/health`, `/ready`, `/metrics` (JSON + Prometheus, optional bearer token): sim tick p50/p95/p99/max, event-loop lag, memory, counters; self-hosted browser error reporting (`/client-errors`) + React error boundary; JSON log lines; process-level safety nets
- [x] **Load testing**: `npm run loadtest` (N rooms x P bots at 60 Hz) and `simbench`; results in `docs/PERFORMANCE.md` (160 clients / 40 rooms: tick p99 1.5 ms, 0 disconnects)
- [x] **Security hardening + 12 tests**: WebSocket Origin check, per-IP connection budget, max message size, room cap, fuzzing of every message type, hostile names, oversized payloads, CORS non-reflection, metrics token, error-endpoint abuse limits; CSP and security headers verified in a real browser; player-facing error messages
- [x] **Bugs found by this work and fixed**: zombie rooms that never closed after all players dropped (would have exhausted the room cap); `onCreate` errors surfacing as "Internal Server Error"; wrong Rapier version in the prod manifest; a raw `room is locked` message shown to players
- [x] **Client payload**: entry chunk 5.4 MB -> 500 KB (154 KB gzip); physics/3D lazy-loaded (verified in a browser); browser-capability check with a clear warning
- [x] CI workflow (check, audit, build, production-bundle smoke + short load test), `Dockerfile`, `render.yaml`, `.env.example`, docs: DEPLOYMENT, SECURITY, PERFORMANCE
- [x] 145 tests

NOT done (needs you, or is a bigger decision):

- [ ] **Actual deployment** (needs a hosting account; `render.yaml`/`Dockerfile` are untested against Render/Docker — no daemon here)
- [ ] **PostgreSQL / accounts / persistence / friends / profile** — deliberately not built: it needs a product decision (guest vs accounts). See docs/SECURITY.md "Open decisions"
- [ ] **Real-GPU frame-rate targets**, long-session memory, mid-range hardware
- [ ] **Browser compatibility beyond Chromium** (Firefox, Safari, Edge, macOS) — only Chromium is installed here
- [ ] Horizontal scaling (single instance only), soak test, internet-latency testing
- [ ] Anti-cheat beyond server authority (aim/ESP), moderation tools, bans
- [ ] Legal/licensing review of the (all-procedural, original) assets; privacy policy; analytics consent

## Phase 10: Mobile/tablet controls and competitive bots — DONE (verified in emulation, not on real devices)

**Practice vs Bot (full competitive mode against AI)**

- [x] Rooms can `fillBots`: AI fills every empty slot, so 1v1 vs a bot is the basic case (2v2 with bots, or friends + bots, also work). Solo host starts alone; no team-balance rule; practice rooms are always private.
- [x] Bots play the _whole_ mode: attackers walk to a site and plant, then guard it; defenders guard a site, rush a planted bomb and defuse; they fight whenever they see an enemy (line of sight + field of view + reaction time + aim error), hear gunfire, and re-plan routes when a door closes. Sides swap at halftime and the bots follow their current side.
- [x] Difficulty Easy / Normal / Hard changes reaction time, aim error, turn speed and burst pauses only (measured time-to-first-hit 2.3 s / 0.5 s / 0.3 s); bots never get extra vision, speed or perfect aim
- [x] Server cost is small: ~0.07 ms/tick for a 1v1 practice room, ~0.2 ms for 5v5 with 9 bots (simulation only)
- [x] Tests: 7 `CompetitiveBots` tests (plant, defuse, detonation-win, guard, fight, difficulty order, no seeing through walls), lobby rules, and 3 live-room tests (1v1 vs bot starts and the bot moves; 2v2 with a friend fills only empty slots; bot attacker plants through the real room)

**Touch controls (phones and tablets)**

- [x] On-screen controls: floating move stick (push fully forward to sprint; firing cancels the sprint), drag-to-look, Fire / Jump / Crouch (toggle) / Reload / Use buttons, pause button, Scores button; portrait warning ("rotate to landscape"); best-effort fullscreen + landscape lock
- [x] Works in sandbox, competitive, practice and co-op (same input layer: game code unchanged). Multi-touch via Pointer Events.
- [x] Automatic (coarse-pointer) or manual choice in Settings > Controls; touch devices default to the Low graphics preset; pinch/double-tap zoom disabled; touch HUD layout (thumbs own the bottom corners)
- [x] Layout checked on emulated iPhone and iPad in both orientations (no horizontal overflow); tablet-portrait overflow and phone margins fixed
- [x] Browser-verified with real multi-touch events (Chromium device emulation): moving, stopping, looking, firing while holding the stick, pausing, a full Practice vs Bot match played by touch only
- [ ] NOT verified on real phones/tablets: iOS Safari (no fullscreen on iPhone, audio unlock quirks), Android Chrome, real GPU performance and thermals, touch ergonomics/button sizes, aim-assist (none: touch aim is harder than a mouse; use Easy bots or co-op)
- [ ] Not done: configurable button layout/sensitivity, gamepad support, haptics, a lighter weapon/viewmodel for small screens

Bugs found and fixed while building this:

- Bots could not move in a live room: rebuilding the nav graph raycast through _player capsules_ and cut every edge around the spawn (unit tests never rebuilt with characters present). Walkability now ignores characters.
- Pausing on touch resumed instantly: the tap's `click` hit the overlay that appeared under the finger (now ignored for 500 ms)
- A fully pushed stick sprinted, and sprint blocks firing, so players could not shoot while "running": firing now cancels sprint on touch

## Next steps (suggested order)

1. Deploy to a staging environment (see docs/DEPLOYMENT.md) and play real matches with friends.
2. Decide on accounts, then add PostgreSQL profiles/stats.
3. Measure on real GPUs/browsers; fix what that finds; set frame-rate targets.
4. Replace procedural placeholders with authored assets (Blender), tune weapons/map balance with playtests.

## Phase 10.1 — Lag, fire reliability, respawns, spectating

- [x] Server sim follows the wall clock (catch-up up to 12 ticks) so round timers keep counting on a starved host
- [x] Queue overflow keeps fire/jump/reload edges; fire taps shorter than one tick/frame are latched (desktop + touch)
- [x] Positional-audio voice cap (10); client auto-lowers graphics quality when FPS stays < 28
- [x] 1v1 = deathmatch to 40 kills, unlimited respawns (3 s). "Practice vs Bot" is 1 vs AI deathmatch only; 2v2 = no respawns (down until next round)
- [x] Co-op: every operator has their own 3 respawns, refilled at every objective
- [x] Dead players spectate a living teammate; Fire (click / tap) cycles; HUD shows respawn timer and pips
- [ ] Spectator camera and touch cycling not yet verified on real devices; Render Free CPU headroom still unmeasured
