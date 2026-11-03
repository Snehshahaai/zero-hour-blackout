import {
  COOP_OBJECTIVES,
  POWER_RULES,
  ROUND_RULES,
  type BombState,
  type GraphicsQuality,
  type InputMessage,
  type MissionState,
  type RoundPhase,
  type Team,
  type Weather as WeatherKind,
} from '@zhb/shared';
import {
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  BoxGeometry,
  SphereGeometry,
} from 'three';
import { AudioEngine, type SoundName } from './audio/AudioEngine.ts';
import { HEARING_RANGE, StrideTracker, gaitFor, jitterPosition } from './audio/spatial.ts';
import { FirstPersonCamera } from './camera/FirstPersonCamera.ts';
import { MOVEMENT } from './entities/movement.ts';
import { PlayerController, type MoveInput } from './entities/PlayerController.ts';
import { InputManager } from './input/InputManager.ts';
import { TouchControls } from './input/TouchControls.ts';
import { Hitscan, viewDirection, type Point3 } from './physics/Hitscan.ts';
import { FIXED_DT, initPhysics, PhysicsWorld } from './physics/PhysicsWorld.ts';
import { Effects } from './rendering/Effects.ts';
import { GameRenderer } from './rendering/GameRenderer.ts';
import { ViewModel } from './rendering/ViewModel.ts';
import { GameLoop } from './systems/GameLoop.ts';
import { HX27 } from './weapons/WeaponDef.ts';
import { WeaponSim } from './weapons/WeaponSim.ts';
import { buildMap, type BuiltMap, type ProgressFn } from './world/buildMap.ts';
import { MAP_01 } from './world/map01.ts';
import { siteAt } from './world/objectives.ts';
import { isIndoor, surfaceAt, zoneAt } from './world/zones.ts';
import { Weather } from './rendering/Weather.ts';
import type { HitKind } from './Sandbox.ts';

// ---- Network contract (the web app adapts a Colyseus room to this; the engine has no Colyseus dep) ----

export interface NetPlayer {
  id: string;
  name: string;
  team: Team;
  isBot: boolean;
  side: Team;
  interactProgress: number;
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

export interface RoundInfo {
  phase: RoundPhase;
  number: number;
  /** Seconds left in the phase (bomb fuse while planted). */
  timeLeft: number;
  scoreAttackers: number;
  scoreDefenders: number;
  swapped: boolean;
  bombState: BombState;
  bombSite: string;
  matchWinner: '' | Team;
}

export type NetRoundEvent =
  | { type: 'roundStart'; round: number }
  | {
      type: 'roundEnd';
      round: number;
      winnerTeam: Team;
      winnerSide: Team;
      reason: 'elimination' | 'time' | 'detonation' | 'defused';
    }
  | { type: 'halftime' }
  | { type: 'matchEnd'; winnerTeam: Team; reason: 'score' | 'forfeit' };

export interface NetBombEvent {
  event: 'planted' | 'defused' | 'exploded';
  site: string;
}

export interface MissionInfo {
  state: MissionState;
  objectiveIndex: number;
  label: string;
  /** 0..1 progress of a hold objective. */
  progress: number;
  timeLeft: number;
  hostiles: number;
}

export type NetMissionEvent =
  | { event: 'started' }
  | { event: 'objective'; index: number; label: string }
  | { event: 'complete' }
  | { event: 'failed'; reason: 'wiped' | 'time' };

export interface NetPowerState {
  cut: boolean;
  secondsLeft: number;
  cooldownLeft: number;
}
export interface NetPowerEvent {
  event: 'cut' | 'restored';
  zone: string;
  by: string;
}

export interface MatchSnapshot {
  tick: number;
  mode: 'competitive' | 'cooperative';
  mission: MissionInfo;
  power: Record<string, NetPowerState>;
  doors: Record<string, { closed: boolean }>;
  weather: WeatherKind;
  round: RoundInfo;
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
  onRound(cb: (e: NetRoundEvent) => void): () => void;
  onBomb(cb: (e: NetBombEvent) => void): () => void;
  onPower(cb: (e: NetPowerEvent) => void): () => void;
  onMission(cb: (e: NetMissionEvent) => void): () => void;
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
  myTeam: Team;
  mySide: Team;
  round: { phase: RoundPhase; number: number; timeLeft: number; mine: number; theirs: number };
  bomb: { planted: boolean; site: string };
  /** Context action available right now, e.g. "Hold E to plant". */
  prompt: string | null;
  /** 0..1 progress of the plant/defuse you are performing. */
  progress: number;
  teammates: { name: string; health: number; alive: boolean }[];
  /** Set once the match is decided. */
  result: { won: boolean; reason: string } | null;
  /** Present in cooperative missions. */
  coop: {
    state: MissionState;
    objective: string;
    index: number;
    total: number;
    progress: number;
    timeLeft: number;
    hostiles: number;
  } | null;
  weather: WeatherKind;
  /** Active outage, if any. */
  power: { label: string; secondsLeft: number } | null;
}

export interface MatchGame {
  readonly locked: boolean;
  requestLock(): void;
  /** Pause: release the mouse / hide the touch controls. */
  releaseLock(): void;
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
  tracker: StrideTracker;
  last: { x: number; y: number; z: number } | null;
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
  options: { touch?: boolean } = {},
): Promise<MatchGame> {
  await initPhysics();
  const gr = new GameRenderer(canvas, quality);
  let map: BuiltMap;
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

  const bodyGeo = new CapsuleGeometry(0.35, 1.1, 4, 12);
  const headGeo = new SphereGeometry(0.17, 12, 8);
  const gunGeo = new BoxGeometry(0.06, 0.08, 0.5);
  const remotes = new Map<string, Remote>();
  /** Bots are tinted hostile only in co-op; in competitive they are just opponents/teammates. */
  let coopMode = false;

  // ---- prediction state ----
  let seq = 0;
  let pending: InputMessage[] = [];
  const predicted = new Map<number, { x: number; y: number; z: number }>();
  let serverOffset: number | null = null; // serverTimeMs - performance.now()
  let wasAlive = true;
  let initialised = false;
  let reconcileCount = 0;
  let lastRound = -1;
  let roundPhase: RoundPhase = 'freeze';
  let bombTimeLeft = 0;
  let bombSite = '';
  const weather = new Weather(gr.scene);
  audio.setHrtf(quality !== 'low');
  let weatherKind: WeatherKind | null = null;
  let powerState: Record<string, NetPowerState> = {};
  let ambientScale = 1;
  let envClock = 0;
  const ownStride = new StrideTracker();
  let beepClock = 0;
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
    myTeam: 'attackers',
    mySide: 'attackers',
    round: { phase: 'freeze', number: 0, timeLeft: 0, mine: 0, theirs: 0 },
    bomb: { planted: false, site: '' },
    prompt: null,
    progress: 0,
    teammates: [],
    result: null,
    weather: 'clear',
    power: null,
    coop: null,
  };
  const snapshotHud = (): MatchHud => ({
    ...hud,
    scores: [...hud.scores],
    feed: [...hud.feed],
    teammates: [...hud.teammates],
    round: { ...hud.round },
    bomb: { ...hud.bomb },
    power: hud.power ? { ...hud.power } : null,
    coop: hud.coop ? { ...hud.coop } : null,
  });
  const emitHud = () => {
    const snap = snapshotHud();
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
    const mat = new MeshStandardMaterial({
      color: coopMode && p.isBot ? 0xb23a3a : TEAM_COLOR[p.team],
      roughness: 0.7,
    });
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
    return { tracker: new StrideTracker(), last: null, group, samples: [], alive: p.alive, mat };
  };

  // ---- snapshots ----
  const offSnapshot = net.onSnapshot((snap) => {
    coopMode = snap.mode === 'cooperative';
    const sample = snap.timeMs - performance.now();
    serverOffset = serverOffset === null ? sample : serverOffset + (sample - serverOffset) * 0.1;

    for (const p of Object.values(snap.players)) {
      latestNames.set(p.id, p.name);
      if (p.id === net.mySessionId) {
        reconcile(p, snap.round.number);
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

    applyEnvironment(snap);
    const me = snap.players[net.mySessionId];
    const ri = snap.round;
    const coop = snap.mode === 'cooperative';
    roundPhase = coop ? (snap.mission.state === 'active' ? 'live' : 'freeze') : ri.phase;
    bombSite = ri.bombState === 'planted' ? ri.bombSite : '';
    bombTimeLeft = ri.bombState === 'planted' ? ri.timeLeft : 0;
    if (me) {
      hud.myTeam = me.team;
      hud.mySide = me.side;
      const mine = me.team === 'attackers' ? ri.scoreAttackers : ri.scoreDefenders;
      const theirs = me.team === 'attackers' ? ri.scoreDefenders : ri.scoreAttackers;
      hud.round = { phase: ri.phase, number: ri.number, timeLeft: ri.timeLeft, mine, theirs };
      hud.bomb = { planted: ri.bombState === 'planted', site: ri.bombSite };
      hud.progress = me.interactProgress;
      hud.result = coop
        ? snap.mission.state === 'complete' || snap.mission.state === 'failed'
          ? { won: snap.mission.state === 'complete', reason: 'Mission' }
          : null
        : ri.matchWinner
          ? {
              won: ri.matchWinner === me.team,
              reason: ri.phase === 'matchEnd' ? 'Match complete' : '',
            }
          : null;
      hud.coop = coop
        ? {
            state: snap.mission.state,
            objective: snap.mission.label,
            index: snap.mission.objectiveIndex,
            total: COOP_OBJECTIVES.length,
            progress: snap.mission.progress,
            timeLeft: snap.mission.timeLeft,
            hostiles: snap.mission.hostiles,
          }
        : null;
      hud.teammates = Object.values(snap.players)
        .filter((p) => (coopMode ? !p.isBot : true) && p.team === me.team && p.id !== me.id)
        .map((p) => ({ name: p.name, health: p.health, alive: p.alive }));
      hud.prompt = coop ? null : computePrompt(me, ri);
      hud.weather = snap.weather;
      hud.ammo = me.ammo;
      hud.reserve = me.reserve;
      hud.reloading = me.reloading;
      hud.health = me.health;
      hud.alive = me.alive;
    }
    hud.scores = Object.values(snap.players)
      .filter((p) => (coopMode ? !p.isBot : true))
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

  function reconcile(me: NetPlayer, roundNumber: number): void {
    const roundChanged = roundNumber !== lastRound;
    lastRound = roundNumber;
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
    if (!initialised || (me.alive && !wasAlive) || roundChanged) {
      const first = !initialised;
      initialised = true;
      wasAlive = me.alive;
      pending = [];
      predicted.clear();
      player.setState(serverState);
      weapon.refill();
      Object.assign(curr, { x: me.x, y: me.y, z: me.z, eye: player.state.eyeHeight });
      Object.assign(prev, curr);
      if (first || roundChanged) {
        fpCamera.yaw = me.yaw; // face the way the server spawned us
        fpCamera.pitch = 0;
      }
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

  /** Mirrors server-owned power, door and weather state into lights, collision and effects. */
  function applyEnvironment(snap: MatchSnapshot): void {
    for (const [zone, st] of Object.entries(snap.power ?? {})) {
      const was = powerState[zone]?.cut ?? false;
      if (st.cut !== was) map.setZoneCut(zone, st.cut);
    }
    powerState = snap.power ?? {};
    const cutZone = Object.entries(powerState).find(([, v]) => v.cut);
    hud.power = cutZone
      ? {
          label: MAP_01.zones.find((z) => z.id === cutZone[0])?.label ?? cutZone[0],
          secondsLeft: cutZone[1].secondsLeft,
        }
      : null;
    for (const [id, d] of Object.entries(snap.doors ?? {})) {
      physics.setDoorClosed(id, d.closed);
      map.setDoorClosed(id, d.closed);
    }
    if (weatherKind !== snap.weather) {
      weatherKind = snap.weather;
      weather.set(snap.weather, gr.quality.rainDrops);
    }
  }

  function panelPrompt(): string | null {
    const s = player.state;
    if (Object.values(powerState).some((z) => z.cut)) return null;
    for (const panel of MAP_01.panels) {
      const z = powerState[panel.zone];
      if (!z || z.cooldownLeft > 0) continue;
      if (Math.hypot(s.x - panel.pos[0], s.z - panel.pos[1]) > POWER_RULES.panelReach) continue;
      const label = MAP_01.zones.find((q) => q.id === panel.zone)?.label ?? panel.zone;
      return `Hold E to cut power: ${label}`;
    }
    return null;
  }

  function computePrompt(me: NetPlayer, ri: RoundInfo): string | null {
    if (!me.alive || (ri.phase !== 'live' && ri.phase !== 'planted')) return null;
    const s = player.state;
    if (ri.bombState === 'planted') {
      if (me.side !== 'defenders') return panelPrompt();
      const o = MAP_01.objectives.find((x) => x.id === ri.bombSite);
      if (o && Math.hypot(s.x - o.center[0], s.z - o.center[1]) <= ROUND_RULES.defuseRange)
        return 'Hold E to defuse';
      return panelPrompt();
    }
    if (me.side === 'attackers') {
      const site = siteAt(MAP_01, s.x, s.z, ROUND_RULES.plantRadiusBonus);
      if (site) return `Hold E to plant at site ${site.id}`;
    }
    return panelPrompt();
  }

  const pushFeed = (line: string) => {
    hud.feed = [...hud.feed, line].slice(-5);
    emitHud();
    setTimeout(() => {
      hud.feed = hud.feed.slice(1);
      emitHud();
    }, 6000);
  };

  // ---- server events ----
  const offShot = net.onShot((e) => {
    if (e.shooter !== net.mySessionId) {
      effects.tracer(e.from, e.to);
      if (e.hit !== 'none') effects.impact(e.to, e.normal, e.hit === 'player');
      audio.playAt('shot', e.from, {
        gain: 1,
        occluded: isOccluded(e.from),
        indoor: isIndoor(MAP_01, curr.x, curr.z),
      });
    }
  });
  const offHit = net.onHit((e) => {
    hud.hitSeq++;
    hud.hitKind = e.killed ? 'kill' : e.headshot ? 'headshot' : 'hit';
    audio.play(e.killed ? 'kill' : e.headshot ? 'headshot' : 'hit', 0.8);
    emitHud();
  });
  const offKill = net.onKill((e) => pushFeed(`${nameOf(e.killer)}  ▸  ${nameOf(e.victim)}`));
  const offRound = net.onRound((e) => {
    if (e.type === 'roundEnd') {
      const mine = e.winnerTeam === hud.myTeam;
      const why = {
        elimination: 'by elimination',
        time: 'as time ran out',
        detonation: 'with a detonation',
        defused: 'by defusing the bomb',
      }[e.reason];
      pushFeed(`${mine ? 'Your team' : 'Enemy team'} won the round ${why}`);
    } else if (e.type === 'halftime') pushFeed('Sides have swapped');
  });
  const offMission = net.onMission((e) => {
    if (e.event === 'objective') pushFeed(`Objective: ${e.label}`);
    else if (e.event === 'complete') pushFeed('Mission complete');
    else if (e.event === 'failed')
      pushFeed(
        e.reason === 'time' ? 'Mission failed: out of time' : 'Mission failed: all operators down',
      );
  });
  const offBomb = net.onBomb((e) => {
    if (e.event === 'exploded') audio.play('explosion', 1);
    pushFeed(
      e.event === 'planted'
        ? `Bomb planted at site ${e.site}`
        : e.event === 'defused'
          ? `Bomb defused at site ${e.site}`
          : `Bomb detonated at site ${e.site}`,
    );
  });

  // ---- bomb model + countdown beeps ----
  let bombMesh: Group | null = null;
  let bombLed: MeshStandardMaterial | null = null;
  const bombGeo = new BoxGeometry(0.34, 0.14, 0.22);
  const ledGeo = new SphereGeometry(0.035, 8, 6);
  function removeBomb(): void {
    if (bombMesh) gr.scene.remove(bombMesh);
    bombMesh = null;
    bombLed?.dispose();
    bombLed = null;
  }
  function updateBomb(dt: number): void {
    const o = bombSite ? MAP_01.objectives.find((x) => x.id === bombSite) : undefined;
    if (!o) {
      if (bombMesh) removeBomb();
      return;
    }
    if (!bombMesh) {
      bombMesh = new Group();
      const body = new Mesh(bombGeo, new MeshStandardMaterial({ color: 0x3b4048, roughness: 0.6 }));
      bombLed = new MeshStandardMaterial({
        color: 0x300000,
        emissive: 0xff2010,
        emissiveIntensity: 0,
      });
      const led = new Mesh(ledGeo, bombLed);
      led.position.set(0.1, 0.1, 0);
      bombMesh.add(body, led);
      bombMesh.position.set(o.center[0], 0.08, o.center[1]);
      gr.scene.add(bombMesh);
    }
    // Beeps get faster as the fuse burns down.
    const interval = Math.max(0.1, Math.min(1, bombTimeLeft / ROUND_RULES.fuseSeconds));
    beepClock += dt;
    if (beepClock >= interval) {
      beepClock = 0;
      audio.play('beep', 0.5);
      if (bombLed) bombLed.emissiveIntensity = 4;
    } else if (bombLed) {
      bombLed.emissiveIntensity = Math.max(0, bombLed.emissiveIntensity - dt * 18);
    }
  }

  /** Is a wall/door between the listener's head and `src`? (One ray: basic occlusion.) */
  function isOccluded(src: Point3): boolean {
    const e = { x: curr.x, y: curr.y + curr.eye, z: curr.z };
    const dx = src.x - e.x;
    const dy = src.y - e.y;
    const dz = src.z - e.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.5) return false;
    const hit = hitscan.cast(
      e,
      { x: dx / dist, y: dy / dist, z: dz / dist },
      dist - 0.25,
      player.collider,
    );
    return hit.kind === 'world';
  }

  const offPower = net.onPower((e) => {
    const label = MAP_01.zones.find((z) => z.id === e.zone)?.label ?? e.zone;
    if (e.event === 'cut') {
      audio.play('powerDown', 0.7);
      pushFeed(`Power cut: ${label}${e.by ? ` (${nameOf(e.by)})` : ''}`);
    } else {
      audio.play('powerUp', 0.6);
      pushFeed(`Backup power restored: ${label}`);
    }
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
        const canAct = hud.alive && (roundPhase === 'live' || roundPhase === 'planted');
        const active = input.locked && initialised && canAct;
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
            interact: input.isDown('KeyE'),
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
        // Own footsteps: quiet, non-positional, surface-dependent. Crouching is silent.
        const step = Math.hypot(s.x - prev.x, s.z - prev.z);
        const gait = s.grounded ? gaitFor(step * 60, s.crouching) : null;
        if (gait) {
          const n = ownStride.advance(step, gait.stride);
          if (n > 0) {
            const surface = surfaceAt(MAP_01, s.x, s.z);
            const sound: SoundName =
              surface === 'metal'
                ? 'stepMetal'
                : surface === 'asphalt'
                  ? 'stepAsphalt'
                  : 'stepConcrete';
            audio.play(sound, 0.28 * gait.gain);
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

          // Remote footsteps: derived from observed motion, positional, occluded by walls, with
          // position jitter so sound alone never reveals an exact location. Crouch-walking is silent.
          const p = r.group.position;
          if (r.last && frameDt > 0) {
            const dist = Math.hypot(p.x - r.last.x, p.z - r.last.z);
            const rising = Math.abs(p.y - r.last.y) / frameDt > 1.2; // jumping/falling
            const gait = rising ? null : gaitFor(dist / frameDt, b.crouching);
            if (gait && dist < 1) {
              const n = r.tracker.advance(dist, gait.stride);
              const listenDist = Math.hypot(p.x - curr.x, p.z - curr.z);
              if (n > 0 && listenDist < HEARING_RANGE.footsteps) {
                const src = { x: p.x, y: p.y + 0.1, z: p.z };
                const surface = surfaceAt(MAP_01, p.x, p.z);
                const sound: SoundName =
                  surface === 'metal'
                    ? 'stepMetal'
                    : surface === 'asphalt'
                      ? 'stepAsphalt'
                      : 'stepConcrete';
                audio.playAt(sound, jitterPosition(src, 1.4), {
                  gain: gait.gain,
                  occluded: isOccluded(src),
                  indoor: isIndoor(MAP_01, curr.x, curr.z),
                });
              }
            }
          }
          r.last = { x: p.x, y: p.y, z: p.z };
        }

        // Listener pose, ambience bed, local blackout darkness, weather.
        const camEye = { x: curr.x, y: curr.y + curr.eye, z: curr.z };
        audio.setListener(
          camEye.x,
          camEye.y,
          camEye.z,
          fpCamera.yaw + weapon.recoil.yaw,
          fpCamera.pitch + weapon.recoil.pitch,
        );
        const here = zoneAt(MAP_01, curr.x, curr.z);
        const hereCut = here ? (powerState[here.id]?.cut ?? false) : false;
        envClock += frameDt;
        if (envClock > 0.25) {
          envClock = 0;
          audio.setEnvironment({
            indoor: here?.indoor ?? false,
            rain: weatherKind === 'rain',
            powerCut: hereCut,
          });
        }
        // Emergency lighting keeps a visibility floor (never black) so a cut is fair, not a trap.
        const targetAmbient = hereCut ? 0.3 : 1;
        ambientScale += (targetAmbient - ambientScale) * Math.min(1, frameDt * 6);
        gr.setAmbientScale(ambientScale);
        weather.update(frameDt, camEye, !(here?.indoor ?? false));
        updateBomb(frameDt);
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
    releaseLock: () => input.exitLock(),
    onLockChange: (l) => input.onLockChange(l),
    onHud(l) {
      listeners.add(l);
      l(snapshotHud());
      return () => listeners.delete(l);
    },
    setQuality(q) {
      gr.setQuality(q);
      audio.setHrtf(q !== 'low');
      if (weatherKind) weather.set(weatherKind, gr.quality.rainDrops);
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
      offRound();
      offBomb();
      offMission();
      offPower();
      weather.dispose();
      removeBomb();
      input.dispose();
      touch?.dispose();
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
      bombGeo.dispose();
      ledGeo.dispose();
      effects.dispose();
      viewModel.dispose();
      physics.dispose();
      gr.scene.remove(map.root);
      map.dispose();
      gr.dispose();
    },
  };
}
