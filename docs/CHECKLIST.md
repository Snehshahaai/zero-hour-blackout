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

## Not implemented yet

Everything else: player controller + Rapier (P3), weapons (P4), rooms/lobby/sync (P5), competitive rules (P6), power grid/audio (P7), co-op/AI (P8), deployment (P9). The home-screen buttons are intentionally disabled.

## Next: Phase 3 — Player controller
