import { createSandbox, type HudState, type Sandbox, type SandboxDebug } from '@zhb/game-engine';
import { useEffect, useRef, useState } from 'react';
import { useControlMode } from '../hooks/useControlMode.ts';
import { useGraphicsQuality } from '../hooks/useGraphicsQuality.ts';

type Phase =
  | { kind: 'loading'; fraction: number; label: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export function SandboxPage({ onExit }: { onExit: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sandboxRef = useRef<Sandbox | null>(null);
  const [quality] = useGraphicsQuality();
  const initialQuality = useRef(quality);
  const { touch } = useControlMode();
  const initialTouch = useRef(touch);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading', fraction: 0, label: 'Starting' });
  const [locked, setLocked] = useState(false);
  // The tap that pauses also produces a `click` on the overlay that appears under the finger; ignore
  // overlay clicks right after unlocking or the game would resume instantly.
  const unlockedAt = useRef(0);
  const onLock = (l: boolean) => {
    if (!l) unlockedAt.current = performance.now();
    setLocked(l);
  };
  const [dbg, setDbg] = useState<SandboxDebug | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Fresh canvas per effect run (see SceneBackground for why).
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    host.appendChild(canvas);
    let cancelled = false;
    const unsubscribers: (() => void)[] = [];
    createSandbox(
      canvas,
      initialQuality.current,
      (fraction, label) => {
        if (!cancelled) setPhase({ kind: 'loading', fraction, label });
      },
      { touch: initialTouch.current },
    )
      .then((sb) => {
        if (cancelled) return sb.dispose();
        sandboxRef.current = sb;
        unsubscribers.push(sb.onLockChange(onLock), sb.onHud(setHud));
        setPhase({ kind: 'ready' });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to start' });
      });
    return () => {
      cancelled = true;
      unsubscribers.forEach((u) => u());
      sandboxRef.current?.dispose();
      sandboxRef.current = null;
      canvas.remove();
    };
  }, []);

  useEffect(() => sandboxRef.current?.setQuality(quality), [quality, phase.kind]);

  // Debug readout polled at 4 Hz: React never sits in the per-frame path.
  useEffect(() => {
    if (phase.kind !== 'ready') return;
    const id = setInterval(() => setDbg(sandboxRef.current?.debug() ?? null), 250);
    return () => clearInterval(id);
  }, [phase.kind]);

  return (
    <div className={`game${touch ? ' touch' : ''}`}>
      <div ref={hostRef} className="game-host" />
      {phase.kind === 'loading' && (
        <div
          className="loading"
          role="progressbar"
          aria-valuenow={Math.round(phase.fraction * 100)}
        >
          <span className="loading-label">{phase.label.toUpperCase()}</span>
          <span className="loading-bar">
            <span style={{ width: `${phase.fraction * 100}%` }} />
          </span>
        </div>
      )}
      {phase.kind === 'error' && (
        <div className="game-overlay">
          <p>Could not start the sandbox: {phase.message}</p>
          <button className="btn" onClick={onExit}>
            Back
          </button>
        </div>
      )}
      {phase.kind === 'ready' && !locked && (
        <div
          className="game-overlay"
          onClick={() => {
            if (performance.now() - unlockedAt.current > 500) sandboxRef.current?.requestLock();
          }}
        >
          <p className="eyebrow">SOLO SANDBOX · MAP 01</p>
          <h2>{touch ? 'Tap to play' : 'Click to play'}</h2>
          {touch ? (
            <ul className="keys">
              <li>Left thumb: move (push fully forward to sprint)</li>
              <li>Right thumb: drag to look · buttons: Fire, Jump, Crouch, Reload, Use</li>
              <li>Use = hold to plant / defuse / cut power · ❙❙ pauses</li>
            </ul>
          ) : (
            <ul className="keys">
              <li>
                <kbd>W A S D</kbd> move
              </li>
              <li>
                <kbd>Shift</kbd> sprint
              </li>
              <li>
                <kbd>Ctrl</kbd> / <kbd>C</kbd> crouch
              </li>
              <li>
                <kbd>Space</kbd> jump
              </li>
              <li>
                <kbd>Mouse 1</kbd> fire (hold for auto)
              </li>
              <li>
                <kbd>R</kbd> reload
              </li>
              <li>
                <kbd>H</kbd> dev: take 10 damage
              </li>
              <li>
                <kbd>Esc</kbd> release mouse
              </li>
            </ul>
          )}
          <button
            className="btn"
            onClick={(e) => {
              e.stopPropagation();
              onExit();
            }}
          >
            Exit to menu
          </button>
        </div>
      )}
      {phase.kind === 'ready' && locked && <div className="crosshair" aria-hidden="true" />}
      {phase.kind === 'ready' && hud && <Hud hud={hud} />}
      {dbg && (
        <pre className="debug" data-testid="debug">
          {`${dbg.fps} fps  speed ${dbg.speed.toFixed(1)} m/s\n${dbg.sprinting ? 'sprint ' : ''}${dbg.crouching ? 'crouch ' : ''}${dbg.grounded ? 'ground' : 'air'}\nx ${dbg.x.toFixed(1)}  y ${dbg.y.toFixed(1)}  z ${dbg.z.toFixed(1)}\nyaw ${dbg.yawDeg.toFixed(0)}  pitch ${dbg.pitchDeg.toFixed(0)}`}
        </pre>
      )}
    </div>
  );
}

function Hud({ hud }: { hud: HudState }) {
  const low = hud.ammo <= 6;
  const hpPct = Math.round((hud.health / hud.maxHealth) * 100);
  return (
    <div className="hud" aria-live="off">
      {hud.hitKind && (
        <div key={hud.hitSeq} className={`hitmarker hit-${hud.hitKind}`} aria-hidden="true" />
      )}
      <div className="hud-health">
        <span className="hud-label">HEALTH</span>
        <span className={`hud-big${hpPct <= 30 ? ' is-low' : ''}`}>{hud.health}</span>
        <span className="hud-bar">
          <span style={{ width: `${hpPct}%` }} />
        </span>
      </div>
      <div className="hud-ammo">
        <span className="hud-label">{hud.weaponName}</span>
        <span className={`hud-big${low ? ' is-low' : ''}`}>
          {hud.reloading ? '--' : String(hud.ammo).padStart(2, '0')}
          <small> / {hud.reserve}</small>
        </span>
        <span className="hud-status">
          {hud.reloading ? 'RELOADING' : hud.ammo === 0 ? 'EMPTY · PRESS R' : 'FULL AUTO'}
        </span>
      </div>
    </div>
  );
}
