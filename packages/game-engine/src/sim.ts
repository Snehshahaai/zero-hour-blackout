/**
 * DOM-free simulation entry point shared by the browser and the authoritative server:
 * physics, character movement, weapons, hit detection and map data. Nothing here may
 * import Three.js, React or touch `window`/`document`.
 */
export * from './physics/index.ts';
export * from './entities/movement.ts';
export * from './entities/PlayerController.ts';
export * from './weapons/index.ts';
export * from './world/MapData.ts';
export * from './world/map01.ts';
export * from './world/objectives.ts';
export * from './world/zones.ts';
