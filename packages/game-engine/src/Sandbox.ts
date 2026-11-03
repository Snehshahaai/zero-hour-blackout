import type { GraphicsQuality } from '@zhb/shared';
import { AudioEngine } from './audio/AudioEngine.ts';
import { FirstPersonCamera } from './camera/FirstPersonCamera.ts';
import { MOVEMENT } from './entities/movement.ts';
import { PlayerController } from './entities/PlayerController.ts';
import { TargetDummy } from './entities/TargetDummy.ts';
import { InputManager } from './input/InputManager.ts';
import { TouchControls } from './input/TouchControls.ts';
import { Hitscan, viewDirection, type Point3 } from './physics/Hitscan.ts';
import { FIXED_DT, initPhysics, PhysicsWorld } from './physics/PhysicsWorld.ts';
import { Effects } from './rendering/Effects.ts';
import { GameRenderer } from './rendering/GameRenderer.ts';
import { ViewModel } from './rendering/ViewModel.ts';
import { GameLoop } from './systems/GameLoop.ts';
import { computeDamage } from './weapons/damage.ts';
import { Health } from './weapons/Health.ts';
import { HX27 } from './weapons/WeaponDef.ts';
import { WeaponSim } from './weapons/WeaponSim.ts';
import { buildMap, type ProgressFn } from './world/buildMap.ts';
import { MAP_01, SANDBOX_TARGETS } from './world/map01.ts';
import { CapsuleGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';

export interface SandboxDebug {
  fps: number;
  speed: number;
  grounded: boolean;
  crouching: boolean;
  sprinting: boolean;
  x: number;
  y: number;
  z: number;
  /** View angles in degrees (yaw 0 faces -Z; pitch positive looks up). */
  yawDeg: number;
  pitchDeg: number;
}

export type HitKind = 'hit' | 'headshot' | 'kill';

/** Everything the HUD needs. Emitted only when something changes (not per frame). */
export interface HudState {
  weaponName: string;
  ammo: number;
  reserve: number;
  reloading: boolean;
  health: number;
  maxHealth: number;
  /** Increments on every confirmed hit so the UI can animate a hit marker. */
  hitSeq: number;
  hitKind: HitKind | null;
}

export interface Sandbox {
  readonly locked: boolean;
  requestLock(): void;
  /** Pause: release the mouse / hide the touch controls. */
  releaseLock(): void;
  onLockChange(l: (locked: boolean) => void): () => void;
  /** Subscribes to HUD changes; the current state is delivered immediately. */
  onHud(l: (s: HudState) => void): () => void;
  setQuality(q: GraphicsQuality): void;
  /** Cheap snapshot for low-frequency UI readouts. */
  debug(): SandboxDebug;
  dispose(): void;
}

/** Mouse sensitivity in radians per pixel (~0.13 deg/px). */
const SENSITIVITY = 0.0022;
const DEV_SELF_DAMAGE = 10;

/**
 * Solo first-person sandbox on Map 01: renderer + physics + input + one rifle + practice
 * targets on a fixed-step loop. It exists to develop and tune the controller and weapon;
 * it is not a game mode.
 */
export async function createSandbox(
  canvas: HTMLCanvasElement,
  quality: GraphicsQuality,
  onProgress?: ProgressFn,
  options: { touch?: boolean } = {},
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
  const hitscan = new Hitscan(physics);
  const spawn = MAP_01.spawns.attackers[0] ?? [10, 10];
  const player = new PlayerController(physics, { x: spawn[0], y: 0.05, z: spawn[1] });
  const playerHealth = new Health(100);
  const weapon = new WeaponSim(HX27, (Math.random() * 0xffffffff) >>> 0);
  const fpCamera = new FirstPersonCamera(gr.camera);
  fpCamera.yaw = -Math.PI / 2; // face east, into the map
  gr.camera.fov = 75;
  gr.camera.updateProjectionMatrix();
  const pause = { fn: () => undefined as void };
  const touch =
    options.touch && canvas.parentElement
      ? new TouchControls(canvas.parentElement, () => pause.fn())
      : null;
  const input = new InputManager(canvas, touch);
  pause.fn = () => input.exitLock();
  const audio = new AudioEngine();
  const effects = new Effects(gr.scene);
  const viewModel = new ViewModel(gr.viewScene);
  gr.viewModelVisible = true;

  // Practice targets (collision + hitboxes in physics, simple meshes for display).
  const bodyGeo = new CapsuleGeometry(0.35, 1.1, 4, 12);
  const headGeo = new SphereGeometry(0.17, 12, 8);
  const targets = SANDBOX_TARGETS.map(([x, z], i) => {
    const dummy = new TargetDummy(i + 1, x, z, hitscan, physics);
    const mat = new MeshStandardMaterial({ color: 0xb04a2a, roughness: 0.7, emissive: 0x000000 });
    const group = new Group();
    const body = new Mesh(bodyGeo, mat);
    body.position.y = 0.55 + 0.35 + 0.05;
    const head = new Mesh(headGeo, mat);
    head.position.y = 1.8 - 0.17 - 0.02;
    group.add(body, head);
    group.position.set(x, 0, z);
    gr.scene.add(group);
    return { dummy, group, mat };
  });

  // Previous/current feet+eye for render interpolation between fixed ticks.
  const prev = { x: spawn[0], y: 0.05, z: spawn[1], eye: Number(MOVEMENT.standEye) };
  const curr = { ...prev };
  let fps = 60;
  let lookDx = 0;
  let lookDy = 0;

  // --- HUD plumbing -------------------------------------------------------------------
  const hudListeners = new Set<(s: HudState) => void>();
  const hud: HudState = {
    weaponName: HX27.name,
    ammo: weapon.ammo,
    reserve: weapon.reserve,
    reloading: false,
    health: playerHealth.current,
    maxHealth: playerHealth.max,
    hitSeq: 0,
    hitKind: null,
  };
  const emitHud = () => {
    const snapshot = { ...hud };
    for (const l of hudListeners) l(snapshot);
  };
  const syncHud = () => {
    if (
      hud.ammo !== weapon.ammo ||
      hud.reserve !== weapon.reserve ||
      hud.reloading !== weapon.reloading ||
      hud.health !== playerHealth.current
    ) {
      hud.ammo = weapon.ammo;
      hud.reserve = weapon.reserve;
      hud.reloading = weapon.reloading;
      hud.health = playerHealth.current;
      emitHud();
    }
  };

  // Reload sound cues fire once as the animation passes each point.
  const cues = { magOut: false, magIn: false, chamber: false };
  const resetCues = () => {
    cues.magOut = cues.magIn = cues.chamber = false;
  };

  const eyePosition = (): Point3 => ({
    x: curr.x,
    y: curr.y + curr.eye,
    z: curr.z,
  });

  const respawnPlayer = () => {
    player.teleport(spawn[0], 0.05, spawn[1]);
    playerHealth.reset();
    weapon.refill();
  };

  const handleShot = (e: Extract<ReturnType<WeaponSim['update']>[number], { type: 'fired' }>) => {
    const eye = eyePosition();
    const dir = viewDirection(
      fpCamera.yaw + e.recoil.yaw,
      fpCamera.pitch + e.recoil.pitch,
      e.offset.dx,
      e.offset.dy,
    );
    const hit = hitscan.cast(eye, dir, HX27.range, player.collider);

    // Muzzle position approximated from the view (right/down/forward of the eye).
    const yaw = fpCamera.yaw + e.recoil.yaw;
    const muzzle: Point3 = {
      x: eye.x + dir.x * 0.7 + Math.cos(yaw) * 0.17,
      y: eye.y + dir.y * 0.7 - 0.14,
      z: eye.z + dir.z * 0.7 - Math.sin(yaw) * 0.17,
    };
    const end: Point3 =
      hit.kind === 'miss'
        ? { x: eye.x + dir.x * 80, y: eye.y + dir.y * 80, z: eye.z + dir.z * 80 }
        : hit.point;
    effects.tracer(muzzle, end);

    viewModel.fire();
    audio.play('shot', 0.9);

    if (hit.kind === 'world') {
      effects.impact(hit.point, hit.normal, false);
      if (e.shotIndex % 2 === 0) audio.play('impact', 0.25);
    } else if (hit.kind === 'target') {
      const target = targets.find((t) => t.dummy.id === hit.target.id);
      if (!target) return;
      const damage = computeDamage(HX27, hit.distance, hit.headshot);
      const result = target.dummy.applyDamage(damage);
      effects.impact(hit.point, hit.normal, true);
      if (result.dealt > 0) {
        hud.hitSeq++;
        hud.hitKind = result.killed ? 'kill' : hit.headshot ? 'headshot' : 'hit';
        audio.play(result.killed ? 'kill' : hit.headshot ? 'headshot' : 'hit', 0.8);
        emitHud();
      }
    }
  };

  const loop = new GameLoop(
    {
      update: () => {
        const s = player.state;
        prev.x = curr.x;
        prev.y = curr.y;
        prev.z = curr.z;
        prev.eye = curr.eye;
        const active = input.locked;

        player.update(
          active
            ? {
                forward: (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0),
                right: (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0),
                jump: input.consumeJump(),
                sprint: input.isDown('ShiftLeft') || input.isDown('ShiftRight'),
                crouch: input.isDown('ControlLeft') || input.isDown('KeyC'),
                yaw: fpCamera.yaw,
              }
            : {
                forward: 0,
                right: 0,
                jump: false,
                sprint: false,
                crouch: false,
                yaw: fpCamera.yaw,
              },
        );
        if (s.y < -20) respawnPlayer(); // fell out of the world
        curr.x = s.x;
        curr.y = s.y;
        curr.z = s.z;
        curr.eye = s.eyeHeight;

        // Weapon. Sprinting blocks firing, as in most tactical shooters.
        const firing = active && input.isMouseDown(0) && !s.sprinting;
        const events = weapon.update(
          FIXED_DT,
          {
            trigger: firing,
            triggerPressed: active && input.consumeFirePressed() && !s.sprinting,
            reloadPressed: active && input.consumePressed('KeyR'),
          },
          { speed: Math.hypot(s.vx, s.vz), grounded: s.grounded, crouching: s.crouching },
        );
        for (const ev of events) {
          if (ev.type === 'fired') handleShot(ev);
          else if (ev.type === 'dry') audio.play('dry', 0.7);
          else if (ev.type === 'reloadStart') resetCues();
        }
        if (weapon.reloading) {
          const p = weapon.reloadProgress;
          if (!cues.magOut && p >= 0.22) {
            cues.magOut = true;
            audio.play('magOut', 0.7);
          }
          if (!cues.magIn && p >= 0.62) {
            cues.magIn = true;
            audio.play('magIn', 0.8);
          }
          if (!cues.chamber && p >= 0.85) {
            cues.chamber = true;
            audio.play('chamber', 0.7);
          }
        }

        // Dev-only: take damage to exercise the health HUD (no enemies exist yet).
        if (active && input.consumePressed('KeyH')) {
          playerHealth.takeDamage(DEV_SELF_DAMAGE);
          if (!playerHealth.alive) respawnPlayer();
        }

        for (const t of targets) t.dummy.update(FIXED_DT);
        syncHud();
      },
      render: (alpha, frameDt) => {
        const m = input.consumeMouse(frameDt);
        fpCamera.look(m.dx, m.dy, SENSITIVITY);
        lookDx = m.dx;
        lookDy = m.dy;
        const lerp = (a: number, b: number) => a + (b - a) * alpha;
        fpCamera.apply(
          lerp(prev.x, curr.x),
          lerp(prev.y, curr.y) + lerp(prev.eye, curr.eye),
          lerp(prev.z, curr.z),
          weapon.recoil,
        );

        const s = player.state;
        viewModel.update(frameDt, {
          speed: Math.hypot(s.vx, s.vz),
          sprinting: s.sprinting,
          grounded: s.grounded,
          reloadProgress: weapon.reloadProgress,
          reloading: weapon.reloading,
          lookDx,
          lookDy,
        });
        effects.update(frameDt);
        for (const t of targets) {
          t.group.visible = t.dummy.alive;
          const flash = Math.max(0, 1 - t.dummy.sinceHit / 0.12);
          t.mat.emissive.setRGB(flash * 0.9, flash * 0.1, flash * 0.05);
        }
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
    requestLock: () => {
      audio.unlock(); // needs a user gesture; the click that requests pointer lock is one
      input.requestLock();
    },
    releaseLock: () => input.exitLock(),
    onLockChange: (l) => input.onLockChange(l),
    onHud(l) {
      hudListeners.add(l);
      l({ ...hud });
      return () => hudListeners.delete(l);
    },
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
        yawDeg: (fpCamera.yaw * 180) / Math.PI,
        pitchDeg: (fpCamera.pitch * 180) / Math.PI,
      };
    },
    dispose() {
      loop.stop();
      input.dispose();
      touch?.dispose();
      audio.dispose();
      hudListeners.clear();
      for (const t of targets) {
        t.dummy.dispose();
        gr.scene.remove(t.group);
        t.mat.dispose();
      }
      bodyGeo.dispose();
      headGeo.dispose();
      effects.dispose();
      viewModel.dispose();
      physics.dispose();
      gr.scene.remove(map.root);
      map.dispose();
      gr.dispose();
    },
  };
}
