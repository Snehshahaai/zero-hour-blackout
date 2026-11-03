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

## Not implemented yet

Everything else: weapons (P4), rooms/lobby/sync (P5), competitive rules (P6), power grid/audio (P7), co-op/AI (P8), deployment (P9). The home-screen buttons are intentionally disabled.

## Next: Phase 4 — Weapon system
