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

## Rendering notes (Phase 2)

- Map geometry is data (`world/MapData.ts`) so the same definition can later feed Rapier colliders and server-side validation.
- One canvas per renderer lifetime: `GameRenderer.dispose()` force-loses the WebGL context, so React must never reuse a canvas across mounts (StrictMode bug found and fixed in `SceneBackground`).
- Interior lighting is a handful of non-shadowed point lights toggled by quality; the power-grid mechanic (Phase 7) will drive these.

## Movement & physics notes (Phase 3)

- Character movement is our own model (linear accel/decel, gravity, jump) with Rapier's `KinematicCharacterController` doing collision, autostep and ground detection. Rapier's dynamic solver is not used for the player, so movement is deterministic enough for client-side prediction later.
- `MOVEMENT` constants live in `entities/movement.ts` so the server can run the identical step for reconciliation (Phase 5). The server will need `PhysicsWorld` + `PlayerController`; both are free of DOM/Three.js imports.
- Game time slows rather than spiralling when the frame rate falls below ~12 fps (`GameLoop` caps catch-up at 5 steps).
- Colliders include roofs and glass. Crouch resizes the capsule in place with feet fixed; standing requires a shape-intersection headroom test.

## Weapons & combat notes (Phase 4)

- `WeaponSim`, `Health`, `computeDamage`, `Hitscan` and `TargetDummy` have no Three.js/DOM dependency: the server will run them as the authority. Clients will run the same `WeaponSim` for prediction and only show effects; hit results and damage come from the server in Phase 5.
- Shot spread uses a seeded PRNG (`shotCounter`, per-player seed) so the server can reproduce the client's shot offsets for validation.
- Rapier 0.21 refreshes its query pipeline only on `world.step()`; use `PhysicsWorld.refreshQueries()` after creating/enabling/disabling colliders that rays must see immediately. (`@types/three` pulls in an unrelated old rapier 0.12 for its own typings; ignore it.)
- The weapon view model is drawn in a second render pass with a separate camera after a depth clear, so it never clips into walls and has its own FOV.
- Effects (tracers, decals, sparks) are pooled; nothing is allocated per shot.
- Testing note: under headless pointer lock, Playwright mouse moves don't produce `movementX`, and click/lock can inject stray movement; browser tests aim by dispatching synthetic `mousemove` events and read yaw/pitch from the debug overlay.

## Lobby / networking notes (Phase 5a)

- The room code is the Colyseus `roomId` (set in `onCreate`, checked for uniqueness), so joining by code is a plain `joinById`; there is no separate code registry to keep in sync.
- Public quick play uses `defineRoom(...).filterBy(['visibility','format','mode'])`; private rooms carry `visibility: private` and are never matched.
- Lobby rules are pure functions (`rooms/lobbyRules.ts`) so they are unit-tested without a server. They must tolerate one-shot iterators because Colyseus `MapSchema.values()` is one; a bug there was found by the end-to-end test, not the unit tests.
- Colyseus kicks a client whose message fails validation (`WITH_ERROR`). The room treats that like a leave (no reconnect grace); only real connection drops get the 30 s hold.
- The SDK does not auto-reconnect on every close code. The web client stores `room.reconnectionToken` in sessionStorage and retries `client.reconnect()` with backoff; `network.resume()` runs at startup for page refreshes.
- The UI never reads the Colyseus room: `services/network.ts` publishes validated immutable snapshots (`lobbySnapshotSchema`) consumed via `useSyncExternalStore`.
- Test gotcha: Playwright `button:has-text("Join")` matches any button containing that substring ("Join an open 1v1 lobby...") — use exact role/name selectors.
