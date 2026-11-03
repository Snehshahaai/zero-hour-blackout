# Architecture notes

## Decisions

- **npm workspaces** (no extra tool). `@zhb/shared` and `@zhb/game-engine` export their TypeScript _source_ (`exports: ./src/index.ts`); Vite and `tsx` compile them directly. No build step for internal packages yet.
- **Strict TypeScript 6.0.3** with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. TypeScript 7.0 is released, but `typescript-eslint` 8.72 only supports `<6.1`; revisit when it adds 7.x support.
- **Vite 8 + @vitejs/plugin-react 6**, React 19, Three.js r187.
- **Colyseus 0.18** (`defineServer` + `createRouter`). CORS is restricted to `CLIENT_ORIGINS`; Colyseus' default reflects any origin.
- **React is UI-only.** The simulation uses `GameLoop` (fixed timestep, render interpolation, stall cap) in `game-engine`, which will own the canvas.
- **Hash routing** for now (no router dependency).
- **Zod 4** schemas in `shared` are the single source of validation for client messages; the server must parse every client message.

## Known risks / open questions

- Production server build: it currently runs via `tsx`. Before Phase 9 add a bundling step (e.g. tsup/esbuild) so workspace TS packages are compiled.
- Colyseus state sync with Rapier prediction/reconciliation needs a prototype in Phase 5 before committing to a snapshot format.
- Rapier (WASM) is not installed yet; added in Phase 3.
- Safari support is unevaluated.
