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

## In-match networking notes (Phase 5b)

- `@zhb/game-engine/sim` is the DOM-free entry the server imports; anything reachable from it must not touch Three.js or `window`.
- Model: client sends one input per fixed tick (seq, keys, view angles WITHOUT recoil, renderTime). Server applies inputs with a credit system (see `MatchSim.stepPlayer`), runs its own weapon sim (own recoil + seeded spread), resolves hits with lag compensation, replicates state; client reconciles by rewind/replay.
- A first version repeated the last input when the queue was empty; under bursty clients this made the server run ahead (22 corrections / 2.5 s). Not simulating starved players fixed it (0 corrections).
- Interpolation clock: `serverOffset = snapshot.timeMs - performance.now()` (smoothed); remote players render at `serverNow - 110 ms`; the same value is sent as `renderTime` so rewind matches what the shooter saw.
- Cheating surface still open: view angles are client-reported (aimbots), movement is validated only by running the same simulation (no speed hack, but teleports are impossible too because only inputs are accepted), no bandwidth/abuse limits beyond the input rate limiter.

## Competitive rules notes (Phase 6)

- Teams vs sides: `team` is fixed for the match (scoring, friendly fire); `side` (attackers/defenders) decides spawns and objectives and flips at halftime. Mixing these up is the main source of bugs here, so rule tests cover the swap explicitly.
- `RoundManager` owns phase/timer/score/bomb and drives `MatchSim` (`frozen`, `resetRound`, `alivePerSide`). The room only copies its state into the Colyseus schema and forwards its events (`round`, `bomb`) to clients.
- Round timing is server configuration (`MatchRoom.roundRules`, set by `createGameServer`), never taken from client options, so clients cannot shorten rounds.
- The client does not predict during freeze/round-end/death: it sends no inputs, the server doesn't simulate those players, so nothing diverges. It hard-resets prediction whenever the round number changes (survivors are teleported to spawns).
- Plant/defuse is deliberately a _hold_ interaction that doesn't lock movement, which avoids needing client-side prediction of an "interacting" state; revisit if it feels wrong in playtests.

## Environment & audio notes (Phase 7)

- Zones (`MapDef.zones`) are the single source for lighting groups, surfaces, indoor/outdoor and which areas can lose power; helpers live in `world/zones.ts` and are shared with the server through `@zhb/game-engine/sim`.
- Power/doors/weather are server state replicated through the schema; the client only mirrors them (light colour/intensity, door mesh + collider, fog/rain). Darkness is applied per _local player_ by scaling the global ambient light when they stand in a cut zone, because lights are shared across the scene.
- Bug class to remember: Colyseus `toJSON()` omits empty maps, so any new replicated map is `undefined` on the client until populated. The web bridge defaults them; the first browser run caught this, unit tests did not.
- A client that stops sending inputs must not keep holding keys: `MatchSim` expires `interact` after 12 ticks without input.
- Test hygiene: `pkill -f` matches the calling shell if the command text contains the pattern, and `npx` leaves a child process behind; kill test servers in their own call and verify the port is free, otherwise a stale server from an earlier phase answers.

## Cooperative & AI notes (Phase 8)

- Bots are not a special case of the simulation: they are `SimPlayer`s fed by `BotBrain` through `queueInput`, so any change to movement/weapons applies to them automatically and they cannot cheat (no extra speed, no perfect aim, no free vision).
- Nav edges come from `PhysicsWorld.segmentClear` (three parallel knee-height rays) at graph-build time, so hand-placed nodes are the only thing that can be wrong; the nav tests catch bad nodes (two were found: inside pipes and next to a crate).
- `MatchRoom` picks `RoundManager`+`PowerGrid` (competitive) or `CoopMission` (cooperative) at match start; both end by emitting `finished`, which resets the room to the lobby. Anything that emits from inside `stepSim` must stop the tick if the sim was torn down (a regression found by the lifecycle test).
- Replicated `sim` players now include bots (`isBot`); clients exclude them from the scoreboard/teammates and tint them hostile. Dead bots are removed from the sim after 3 s.

## Release engineering notes (Phase 9)

- The server ships as an esbuild bundle of our TypeScript + `@zhb/*` workspace packages; third-party packages stay external and are pinned in a generated `dist/package.json`. The build asserts the pinned copy satisfies the declared range (hoisting once picked a stale Rapier).
- `@zhb/game-engine` has three entry points: `.` (full engine, browser), `./sim` (DOM-free simulation shared with the server), `./detect` (capability checks, no heavy deps). It is `sideEffects: false` so Vite can code-split; the menu must never import the index at runtime.
- Room lifetime: Colyseus auto-disposes only when the last _client_ disconnects; rooms whose players all expire out of the reconnect grace are closed explicitly.
- Limits are configuration (`Limits` in `services/guards.ts`, env vars in `.env.example`), enforced server-side; tests pass tight limits to prove they bite.
- Close code 1006 covers both network drops and oversized-message kicks; they cannot be told apart server-side (documented in SECURITY.md).

## Mobile and bots notes (Phase 10)

- Touch is an input source, not a code path: `TouchControls` (DOM overlay) writes a `TouchState`; `InputManager` ORs it into `isDown/isMouseDown/consume*`, so `Sandbox`/`MatchGame` only changed to pass `{ touch }` and a pause callback. The stick maths and the key mapping live in `touchState.ts` and are unit-tested without a DOM.
- With touch controls, "locked" means "the player tapped to play" (no Pointer Lock). A tap that pauses also yields a `click` on the overlay that appears under the finger; the pages ignore overlay clicks for 500 ms after unlocking.
- `BotBrain` gained goals (`route`, `plant`, `defuse`) and difficulty tuning; `CompetitiveBots` maps round state to goals (it never touches rules: plant/defuse still go through `RoundManager`'s server validation like for humans). `NavGraph.rebuild()` recomputes edges from the live collision world; `PhysicsWorld.segmentClear` must ignore characters (a rebuild once cut every edge around bodies standing at spawn).
- Practice rooms (`fillBots`) are private by construction, start with a lone host, and add bots only to slots no human took.
