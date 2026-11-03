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

## Not implemented yet

Everything else: rooms/lobby/sync (P5), competitive rules (P6), power grid/audio (P7), co-op/AI (P8), deployment (P9). The home-screen buttons are intentionally disabled.

## Next: Phase 5 — Multiplayer
