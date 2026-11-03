# ZERO HOUR: BLACKOUT

> Every second changes the battlefield.

Browser-based tactical multiplayer FPS. React + TypeScript + Vite, Three.js, Colyseus (authoritative server), Zod.

**Status: Phase 1 (project foundation) complete. There is no gameplay yet.** See [docs/CHECKLIST.md](docs/CHECKLIST.md).

## Requirements

Node.js >= 22.12, npm >= 10.

## Commands

```bash
npm install          # install all workspaces
npm run dev          # server (:2567) + web (:5173) together
npm run dev:web      # web only
npm run dev:server   # server only
npm run build        # typecheck + production build of the web app
npm run check        # typecheck + lint + tests + format check (run before committing)
```

Copy `.env.example` to `.env` to override server settings (`PORT`, `CLIENT_ORIGINS`). The web app reads `VITE_SERVER_URL` (default `http://localhost:2567`).

## Layout

| Path                   | Purpose                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `apps/web`             | React UI shell (menus, lobby, HUD). Never drives the simulation.  |
| `apps/server`          | Colyseus authoritative server (Node, TypeScript)                  |
| `packages/game-engine` | Game loop, rendering, physics, input, audio. No React dependency. |
| `packages/shared`      | Constants, types and Zod schemas shared by client and server      |
| `assets`, `docs`       | Source art/audio (empty so far) and documentation                 |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for decisions and trade-offs.
