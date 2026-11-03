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

## Not implemented yet

Everything else: scene/renderer (P2), player controller + Rapier (P3), weapons (P4), rooms/lobby/sync (P5), competitive rules (P6), power grid/audio (P7), co-op/AI (P8), deployment (P9). The home-screen buttons are intentionally disabled.

## Next: Phase 2 — 3D environment
