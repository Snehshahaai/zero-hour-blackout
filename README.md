# ZERO HOUR: BLACKOUT

> Every second changes the battlefield.

Browser-based tactical multiplayer FPS. React + TypeScript + Vite, Three.js, Colyseus (authoritative server), Zod.

**Status: feature-complete first version with release tooling, touch controls for phones/tablets, and Practice vs Bot (a full competitive match against AI). Not yet deployed or tested on real GPUs/other browsers; see [docs/CHECKLIST.md](docs/CHECKLIST.md) for exactly what is and is not done.**

## Requirements

Node.js >= 22.12, npm >= 10.

## Commands

```bash
npm install          # install all workspaces
npm run dev          # server (:2567) + web (:5173) together
npm run dev:web      # web only
npm run dev:server   # server only
npm run build        # production build of the web app and the server bundle
npm run loadtest     # multiplayer load test against a running server (see docs/PERFORMANCE.md)
npm run audit        # fails on high-severity production dependency advisories
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

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for decisions and trade-offs,
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for deploying and operating it, [docs/SECURITY.md](docs/SECURITY.md) for the
security model and its known gaps, and [docs/PERFORMANCE.md](docs/PERFORMANCE.md) for measured performance.
