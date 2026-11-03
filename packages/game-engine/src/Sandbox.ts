import type { GraphicsQuality } from '@zhb/shared';
import { FirstPersonCamera } from './camera/FirstPersonCamera.ts';
import { MOVEMENT } from './entities/movement.ts';
import { PlayerController } from './entities/PlayerController.ts';
import { InputManager } from './input/InputManager.ts';
import { FIXED_DT, initPhysics, PhysicsWorld } from './physics/PhysicsWorld.ts';
import { GameRenderer } from './rendering/GameRenderer.ts';
import { GameLoop } from './systems/GameLoop.ts';
import { buildMap, type ProgressFn } from './world/buildMap.ts';
import { MAP_01 } from './world/map01.ts';

export interface SandboxDebug {
  fps: number;
  speed: number;
  grounded: boolean;
  crouching: boolean;
  sprinting: boolean;
  x: number;
  y: number;
  z: number;
}

export interface Sandbox {
  readonly locked: boolean;
  requestLock(): void;
  onLockChange(l: (locked: boolean) => void): () => void;
  setQuality(q: GraphicsQuality): void;
  /** Cheap snapshot for low-frequency UI readouts. */
  debug(): SandboxDebug;
  dispose(): void;
}

/** Mouse sensitivity in radians per pixel (~0.13 deg/px). */
const SENSITIVITY = 0.0022;

/**
 * Solo first-person sandbox on Map 01: renderer + physics + input on a fixed-step loop.
 * Exists to develop and test the controller; not a game mode.
 */
export async function createSandbox(
  canvas: HTMLCanvasElement,
  quality: GraphicsQuality,
  onProgress?: ProgressFn,
): Promise<Sandbox> {
  await initPhysics();
  const gr = new GameRenderer(canvas, quality);
  let map;
  try {
    map = await buildMap(MAP_01, gr.quality, onProgress);
  } catch (e) {
    gr.dispose();
    throw e;
  }
  gr.scene.add(map.root);

  const physics = PhysicsWorld.fromMap(MAP_01);
  const spawn = MAP_01.spawns.attackers[0] ?? [10, 10];
  const player = new PlayerController(physics, { x: spawn[0], y: 0.05, z: spawn[1] });
  const fpCamera = new FirstPersonCamera(gr.camera);
  fpCamera.yaw = -Math.PI / 2; // face east, into the map
  gr.camera.fov = 75;
  gr.camera.updateProjectionMatrix();
  const input = new InputManager(canvas);

  // Previous/current feet+eye for render interpolation between fixed ticks.
  const prev = { x: spawn[0], y: 0.05, z: spawn[1], eye: Number(MOVEMENT.standEye) };
  const curr = { ...prev };
  let fps = 60;

  const loop = new GameLoop(
    {
      update: () => {
        const s = player.state;
        prev.x = curr.x;
        prev.y = curr.y;
        prev.z = curr.z;
        prev.eye = curr.eye;
        if (input.locked) {
          player.update({
            forward: (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0),
            right: (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0),
            jump: input.consumeJump(),
            sprint: input.isDown('ShiftLeft') || input.isDown('ShiftRight'),
            crouch: input.isDown('ControlLeft') || input.isDown('KeyC'),
            yaw: fpCamera.yaw,
          });
        } else {
          player.update({
            forward: 0,
            right: 0,
            jump: false,
            sprint: false,
            crouch: false,
            yaw: fpCamera.yaw,
          });
        }
        if (s.y < -20) player.teleport(spawn[0], 0.05, spawn[1]); // fell out of the world
        curr.x = s.x;
        curr.y = s.y;
        curr.z = s.z;
        curr.eye = s.eyeHeight;
      },
      render: (alpha, frameDt) => {
        const m = input.consumeMouse();
        fpCamera.look(m.dx, m.dy, SENSITIVITY);
        const lerp = (a: number, b: number) => a + (b - a) * alpha;
        fpCamera.apply(
          lerp(prev.x, curr.x),
          lerp(prev.y, curr.y) + lerp(prev.eye, curr.eye),
          lerp(prev.z, curr.z),
        );
        gr.render();
        if (frameDt > 0) fps += (1 / frameDt - fps) * 0.1;
      },
    },
    { tickRate: 1 / FIXED_DT },
  );
  loop.start();

  return {
    get locked() {
      return input.locked;
    },
    requestLock: () => input.requestLock(),
    onLockChange: (l) => input.onLockChange(l),
    setQuality(q) {
      gr.setQuality(q);
      map.setAnisotropy(gr.quality.anisotropy);
      map.setPointLightCount(gr.quality.maxPointLights);
    },
    debug() {
      const s = player.state;
      return {
        fps: Math.round(fps),
        speed: Math.hypot(s.vx, s.vz),
        grounded: s.grounded,
        crouching: s.crouching,
        sprinting: s.sprinting,
        x: s.x,
        y: s.y,
        z: s.z,
      };
    },
    dispose() {
      loop.stop();
      input.dispose();
      physics.dispose();
      gr.scene.remove(map.root);
      map.dispose();
      gr.dispose();
    },
  };
}
