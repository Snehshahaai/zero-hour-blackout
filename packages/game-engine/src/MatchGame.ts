import type { GraphicsQuality, InputMessage, Team } from '@zhb/shared';
import {
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  BoxGeometry,
  SphereGeometry,
} from 'three';
import { AudioEngine } from './audio/AudioEngine.ts';
import { FirstPersonCamera } from './camera/FirstPersonCamera.ts';
import { MOVEMENT } from './entities/movement.ts';
import { PlayerController, type MoveInput } from './entities/PlayerController.ts';
import { InputManager } from './input/InputManager.ts';
import { Hitscan, viewDirection, type Point3 } from './physics/Hitscan.ts';
import { FIXED_DT, initPhysics, PhysicsWorld } from './physics/PhysicsWorld.ts';
import { Effects } from './rendering/Effects.ts';
import { GameRenderer } from './rendering/GameRenderer.ts';
import { ViewModel } from './rendering/ViewModel.ts';
import { GameLoop } from './systems/GameLoop.ts';
import { HX27 } from './weapons/WeaponDef.ts';
import { WeaponSim } from './weapons/WeaponSim.ts';
import { buildMap, type ProgressFn } from './world/buildMap.ts';
import { MAP_01 } from './world/map01.ts';
import type { HitKind } from './Sandbox.ts';

// ---- Network contract (the web app adapts a Colyseus room to this; the engine has no Colyseus dep) ----

export interface NetPlayer {
  id: string;
  name: string;
  team: Team;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  grounded: boolean;
  crouching: boolean;
  alive: boolean;
  health: number;
  ammo: number;
  reserve: number;
  reloading: boolean;
  kills: number;
  deaths: number;
  ackSeq: number;
}

export interface MatchSnapshot {
  tick: number;
  /** Server time in ms; remote players are interpolated against this clock. */
  timeMs: number;
  players: Record<string, NetPlayer>;
}

export interface NetShot {
  shooter: string;
  from: Point3;
  to: Point3;
  hit: 'none' | 'world' | 'player';
  normal: Point3;
}
export interface NetHit {
  shooter: string;
  victim: string;
  damage: number;
  headshot: boolean;
  killed: boolean;
}
export interface NetKill {
  killer: string;
  victim: string;
}

export interface MatchNet {
  mySessionId: string;
  sendInput(input: InputMessage): void;
  onSnapshot(cb: (s: MatchSnapshot) => void): () => void;
  onShot(cb: (e: NetShot) => void): () => void;
  onHit(cb: (e: NetHit) => void): () => void;
  onKill(cb: (e: NetKill) => void): () => void;
}

export interface ScoreRow {
  id: string;
  name: string;
  team: Team;
  kills: number;
  deaths: number;
  isMe: boolean;
}

export interface MatchHud {
  weaponName: string;
  ammo: number;
  reserve: number;
  reloading: boolean;
  health: number;
  maxHealth: number;
  alive: boolean;
  hitSeq: number;
  hitKind: HitKind | null;
  scores: ScoreRow[];
  feed: string[];
}

export interface MatchGame {
  readonly locked: boolean;
  requestLock(): void;
  onLockChange(l: (locked: boolean) => void): () => void;
  onHud(l: (s: MatchHud) => void): () => void;
  setQuality(q: GraphicsQuality): void;
  debug(): {
    fps: number;
    pending: number;
    remotes: number;
    x: number;
    y: number;
    z: number;
    errors: number;
  };
  dispose(): void;
}

const SENSITIVITY = 0.0022;
/** Remote players are drawn this far in the past so there are always two snapshots to blend. */
const INTERP_DELAY_MS = 110;
/** Predicted-vs-server position error (m) above which the client rewinds and replays. */
const RECONCILE_THRESHOLD = 0.04;
const TEAM_COLOR: Record<Team, number> = { attackers: 0xd9952a, defenders: 0x3f86b8 };

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  crouching: boolean;
}
interface Remote {
  group: Group;
  samples: Sample[];
  alive: boolean;
  mat: MeshStandardMaterial;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function lerpAngle(a: number, b: number, k: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

/**
 * Networked first-person match client. The local player is predicted (same `PlayerController`
 * as the server) and reconciled against authoritative snapshots; other players are
 * interpolated. Hits, damage, health and ammo all come from the server.
 */
export async function createMatchGame(
  canvas: HTMLCanvasElement,
  quality: GraphicsQuality,
  net: MatchNet,
  onProgress?: ProgressFn,
): Promise<MatchGame> {
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

  // Local physics only knows the map (not other players); the server corrects the difference.
  const physics = PhysicsWorld.fromMap(MAP_01);
  const hitscan = new Hitscan(physics);
  const spawn = MAP_01.spawns.attackers[0] ?? [10, 10];
  const player = new PlayerController(physics, { x: spawn[0], y: 0.05, z: spawn[1] });
  const weapon = new WeaponSim(HX27, (Math.random() * 0xffffffff) >>> 0);
  const fpCamera = new FirstPersonCamera(gr.camera);
  gr.camera.fov = 75;
  gr.camera.updateProjectionMatrix();
  const input = new InputManager(canvas);
  const audio = new AudioEngine();
  const effects = new Effects(gr.scene);
  const viewModel = new ViewModel(gr.viewScene);
  gr.viewModelVisible = true;

  const bodyGeo = new CapsuleGeometry(0.35, 1.1, 4, 12);
  const headGeo = new SphereGeometry(0.17, 12, 8);
  const gunGeo = new BoxGeometry(0.06, 0.08, 0.5);
  const remotes = new Map<string, Remote>();

  // ---- prediction state ----
  let seq = 0;
  let pending: InputMessage[] = [];
  const predicted = new Map<number, { x: number; y: number; z: number }>();
  let serverOffset: number | null = null; // serverTimeMs - performance.now()
  let wasAlive = true;
  let initialised = false;
  let reconcileCount = 0;
  let fps = 60;
  const prev = { x: spawn[0], y: 0.05, z: spawn[1], eye: Number(MOVEMENT.standEye) };
  const curr = { ...prev };
  let lookDx = 0;
  let lookDy = 0;

  // ---- HUD ----
  const listeners = new Set<(s: MatchHud) => void>();
  const hud: MatchHud = {
    weaponName: HX27.name,
    ammo: HX27.magSize,
    reserve: HX27.reserveMax,
    reloading: false,
    health: 100,
    maxHealth: 100,
    alive: true,
    hitSeq: 0,
    hitKind: null,
    scores: [],
    feed: [],
  };
  const emitHud = () => {
    const snap = { ...hud, scores: [...hud.scores], feed: [...hud.feed] };
    for (const l of listeners) l(snap);
  };

  const nameOf = (id: string) => remotes.get(id)?.group.name ?? latestNames.get(id) ?? '???';
  const latestNames = new Map<string, string>();
  const serverNow = () => (serverOffset === null ? 0 : performance.now() + serverOffset);

  const toMove = (m: InputMessage): MoveInput => ({
    forward: m.forward,
    right: m.right,
    jump: m.jump,
    sprint: m.sprint,
    crouch: m.crouch,
    yaw: m.yaw,
  });

  const makeRemote = (p: NetPlayer): Remote => {
    const mat = new MeshStandardMaterial({ color: TEAM_COLOR[p.team], roughness: 0.7 });
    const group = new Group();
    group.name = p.name;
    const body = new Mesh(bodyGeo, mat);
    body.position.y = 0.95;
    const head = new Mesh(headGeo, mat);
    head.position.y = 1.62;
    const gun = new Mesh(gunGeo, new MeshStandardMaterial({ color: 0x20242a }));
    gun.position.set(0.22, 1.1, -0.35);
    group.add(body, head, gun);
    group.visible = false;
    gr.scene.add(group);
    return { group, samples: [], alive: p.alive, mat };
  };

  // ---- snapshots ----
  const offSnapshot = net.onSnapshot((snap) => {
    const sample = snap.timeMs - performance.now();
    serverOffset = serverOffset === null ? sample : serverOffset + (sample - serverOffset) * 0.1;

    for (const p of Object.values(snap.players)) {
      latestNames.set(p.id, p.name);
      if (p.id === net.mySessionId) {
        reconcile(p);
        continue;
      }
      let r = remotes.get(p.id);
      if (!r) {
        r = makeRemote(p);
        remotes.set(p.id, r);
      }
      r.alive = p.alive;
      r.samples.push({
        t: snap.timeMs,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        crouching: p.crouching,
      });
      if (r.samples.length > 30) r.samples.shift();
    }
    for (const [id, r] of remotes) {
      if (snap.players[id]) continue;
      gr.scene.remove(r.group);
      r.mat.dispose();
      remotes.delete(id);
    }

    const me = snap.players[net.mySessionId];
    if (me) {
      hud.ammo = me.ammo;
      hud.reserve = me.reserve;
      hud.reloading = me.reloading;
      hud.health = me.health;
      hud.alive = me.alive;
    }
    hud.scores = Object.values(snap.players)
      .map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        kills: p.kills,
        deaths: p.deaths,
        isMe: p.id === net.mySessionId,
      }))
      .sort((a, b) => b.kills - a.kills);
    emitHud();
  });

  function reconcile(me: NetPlayer): void {
    const serverState = {
      x: me.x,
      y: me.y,
      z: me.z,
      vx: me.vx,
      vy: me.vy,
      vz: me.vz,
      grounded: me.grounded,
      crouching: me.crouching,
    };
    // First snapshot, or just respawned: take the server's word, drop all prediction.
    if (!initialised || (me.alive && !wasAlive)) {
      const first = !initialised;
      initialised = true;
      wasAlive = me.alive;
      pending = [];
      predicted.clear();
      player.setState(serverState);
      weapon.refill();
      Object.assign(curr, { x: me.x, y: me.y, z: me.z, eye: player.state.eyeHeight });
      Object.assign(prev, curr);
      if (first) fpCamera.yaw = me.yaw; // face the way the server spawned us
      return;
    }
    wasAlive = me.alive;
    if (!me.alive) return;

    const ack = me.ackSeq;
    pending = pending.filter((m) => m.seq > ack);
    const guess = predicted.get(ack);
    for (const k of predicted.keys()) if (k < ack) predicted.delete(k);
    if (ack < 0 || !guess) return;

    const err = Math.hypot(guess.x - me.x, guess.y - me.y, guess.z - me.z);
    if (err < RECONCILE_THRESHOLD) return;

    // Misprediction: rewind to the server's state at `ack` and replay everything unacknowledged.
    reconcileCount++;
    player.setState(serverState);
    predicted.clear();
    for (const m of pending) {
      player.update(toMove(m));
      predicted.set(m.seq, { x: player.state.x, y: player.state.y, z: player.state.z });
    }
    const s = player.state;
    Object.assign(curr, { x: s.x, y: s.y, z: s.z, eye: s.eyeHeight });
    Object.assign(prev, curr);
  }

  // ---- server events ----
  const offShot = net.onShot((e) => {
    if (e.shooter !== net.mySessionId) {
      effects.tracer(e.from, e.to);
      if (e.hit !== 'none') effects.impact(e.to, e.normal, e.hit === 'player');
      const d = Math.hypot(e.from.x - curr.x, e.from.y - curr.y, e.from.z - curr.z);
      audio.play('shot', Math.max(0.08, 0.7 * (1 - d / 70)));
    }
  });
  const offHit = net.onHit((e) => {
    hud.hitSeq++;
    hud.hitKind = e.killed ? 'kill' : e.headshot ? 'headshot' : 'hit';
    audio.play(e.killed ? 'kill' : e.headshot ? 'headshot' : 'hit', 0.8);
    emitHud();
  });
  const offKill = net.onKill((e) => {
    hud.feed = [...hud.feed, `${nameOf(e.killer)}  ▸  ${nameOf(e.victim)}`].slice(-4);
    emitHud();
    setTimeout(() => {
      hud.feed = hud.feed.slice(1);
      emitHud();
    }, 6000);
  });

  const cues = { magOut: false, magIn: false, chamber: false };
  const eye = (): Point3 => ({ x: curr.x, y: curr.y + curr.eye, z: curr.z });

  const loop = new GameLoop(
    {
      update: () => {
        const s = player.state;
        prev.x = curr.x;
        prev.y = curr.y;
        prev.z = curr.z;
        prev.eye = curr.eye;
        const active = input.locked && initialised && hud.alive;
        const rt = serverOffset === null ? 0 : serverNow() - INTERP_DELAY_MS;

        if (active) {
          const msg: InputMessage = {
            seq: seq++,
            forward: (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0),
            right: (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0),
            jump: input.consumeJump(),
            sprint: input.isDown('ShiftLeft') || input.isDown('ShiftRight'),
            crouch: input.isDown('ControlLeft') || input.isDown('KeyC'),
            fire: input.isMouseDown(0),
            reload: input.consumePressed('KeyR'),
            yaw: fpCamera.yaw,
            pitch: fpCamera.pitch,
            renderTime: rt,
          };
          player.update(toMove(msg));
          pending.push(msg);
          if (pending.length > 120) pending.shift();
          predicted.set(msg.seq, { x: s.x, y: s.y, z: s.z });
          net.sendInput(msg);

          // Local weapon sim: feel (recoil, flash, sound) only. The server decides hits.
          const events = weapon.update(
            FIXED_DT,
            {
              trigger: msg.fire && !s.sprinting,
              triggerPressed: false,
              reloadPressed: msg.reload,
            },
            { speed: Math.hypot(s.vx, s.vz), grounded: s.grounded, crouching: s.crouching },
          );
          for (const ev of events) {
            if (ev.type === 'fired') {
              const dir = viewDirection(
                fpCamera.yaw + ev.recoil.yaw,
                fpCamera.pitch + ev.recoil.pitch,
                ev.offset.dx,
                ev.offset.dy,
              );
              const e0 = eye();
              const hit = hitscan.cast(e0, dir, HX27.range, player.collider);
              const end: Point3 =
                hit.kind === 'miss'
                  ? { x: e0.x + dir.x * 80, y: e0.y + dir.y * 80, z: e0.z + dir.z * 80 }
                  : hit.point;
              const yaw = fpCamera.yaw + ev.recoil.yaw;
              effects.tracer(
                {
                  x: e0.x + dir.x * 0.7 + Math.cos(yaw) * 0.17,
                  y: e0.y + dir.y * 0.7 - 0.14,
                  z: e0.z + dir.z * 0.7 - Math.sin(yaw) * 0.17,
                },
                end,
              );
              if (hit.kind === 'world') effects.impact(hit.point, hit.normal, false);
              viewModel.fire();
              audio.play('shot', 0.9);
            } else if (ev.type === 'dry') audio.play('dry', 0.7);
            else if (ev.type === 'reloadStart') cues.magOut = cues.magIn = cues.chamber = false;
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
        }
        curr.x = s.x;
        curr.y = s.y;
        curr.z = s.z;
        curr.eye = s.eyeHeight;
      },
      render: (alpha, frameDt) => {
        const m = input.consumeMouse();
        if (hud.alive) fpCamera.look(m.dx, m.dy, SENSITIVITY);
        lookDx = m.dx;
        lookDy = m.dy;
        fpCamera.apply(
          lerp(prev.x, curr.x, alpha),
          lerp(prev.y, curr.y, alpha) + lerp(prev.eye, curr.eye, alpha),
          lerp(prev.z, curr.z, alpha),
          weapon.recoil,
        );
        viewModel.setVisible(hud.alive);
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

        // Interpolate remote players between the two snapshots around (now - delay).
        const renderT = serverNow() - INTERP_DELAY_MS;
        for (const r of remotes.values()) {
          r.group.visible = r.alive && r.samples.length > 0;
          if (!r.group.visible) continue;
          const sm = r.samples;
          let i = sm.length - 1;
          while (i > 0 && (sm[i - 1] as Sample).t > renderT) i--;
          const b = sm[i] as Sample;
          const a = sm[Math.max(0, i - 1)] as Sample;
          const k = b.t === a.t ? 1 : Math.min(1, Math.max(0, (renderT - a.t) / (b.t - a.t)));
          r.group.position.set(lerp(a.x, b.x, k), lerp(a.y, b.y, k), lerp(a.z, b.z, k));
          r.group.rotation.y = lerpAngle(a.yaw, b.yaw, k);
          r.group.scale.y = b.crouching ? 0.72 : 1;
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
      audio.unlock();
      input.requestLock();
    },
    onLockChange: (l) => input.onLockChange(l),
    onHud(l) {
      listeners.add(l);
      l({ ...hud, scores: [...hud.scores], feed: [...hud.feed] });
      return () => listeners.delete(l);
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
        pending: pending.length,
        remotes: remotes.size,
        x: s.x,
        y: s.y,
        z: s.z,
        errors: reconcileCount,
      };
    },
    dispose() {
      loop.stop();
      offSnapshot();
      offShot();
      offHit();
      offKill();
      input.dispose();
      audio.dispose();
      listeners.clear();
      for (const r of remotes.values()) {
        gr.scene.remove(r.group);
        r.mat.dispose();
      }
      remotes.clear();
      bodyGeo.dispose();
      headGeo.dispose();
      gunGeo.dispose();
      effects.dispose();
      viewModel.dispose();
      physics.dispose();
      gr.scene.remove(map.root);
      map.dispose();
      gr.dispose();
    },
  };
}
