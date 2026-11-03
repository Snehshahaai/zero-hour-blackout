import { createMatchGame, type MatchGame, type MatchHud } from '@zhb/game-engine';
import { useEffect, useRef, useState } from 'react';
import { useGraphicsQuality } from '../hooks/useGraphicsQuality.ts';
import { network } from '../services/network.ts';

type Phase =
  | { kind: 'loading'; fraction: number; label: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export function MatchPage({ onLeave }: { onLeave: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<MatchGame | null>(null);
  const [quality] = useGraphicsQuality();
  const initialQuality = useRef(quality);
  const [phase, setPhase] = useState<Phase>({
    kind: 'loading',
    fraction: 0,
    label: 'Joining match',
  });
  const [locked, setLocked] = useState(false);
  const [hud, setHud] = useState<MatchHud | null>(null);
  const [showScores, setShowScores] = useState(false);
  const [dbg, setDbg] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    const bridge = network.matchBridge();
    if (!host) return;
    if (!bridge) {
      setPhase({ kind: 'error', message: 'Not connected to a match.' });
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    host.appendChild(canvas);
    let cancelled = false;
    const unsubscribers: (() => void)[] = [];
    createMatchGame(canvas, initialQuality.current, bridge, (fraction, label) => {
      if (!cancelled) setPhase({ kind: 'loading', fraction, label });
    })
      .then((g) => {
        if (cancelled) return g.dispose();
        gameRef.current = g;
        unsubscribers.push(g.onLockChange(setLocked), g.onHud(setHud));
        setPhase({ kind: 'ready' });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to start' });
      });
    return () => {
      cancelled = true;
      unsubscribers.forEach((u) => u());
      gameRef.current?.dispose();
      gameRef.current = null;
      canvas.remove();
    };
  }, []);

  useEffect(() => gameRef.current?.setQuality(quality), [quality, phase.kind]);

  // Dev readout, polled at 4 Hz (React is never in the frame path).
  useEffect(() => {
    if (phase.kind !== 'ready') return;
    const id = setInterval(() => {
      const d = gameRef.current?.debug();
      if (d)
        setDbg(
          `${d.fps} fps  remotes ${d.remotes}  pending ${d.pending}  corrections ${d.errors}\nx ${d.x.toFixed(1)}  y ${d.y.toFixed(1)}  z ${d.z.toFixed(1)}`,
        );
    }, 250);
    return () => clearInterval(id);
  }, [phase.kind]);

  // Hold Tab for the scoreboard.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        setShowScores(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Tab' && setShowScores(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  return (
    <div className="game">
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
          <p>Could not start the match: {phase.message}</p>
          <button className="btn" onClick={onLeave}>
            Leave
          </button>
        </div>
      )}
      {phase.kind === 'ready' && !locked && (
        <div className="game-overlay" onClick={() => gameRef.current?.requestLock()}>
          <p className="eyebrow">MATCH IN PROGRESS</p>
          <h2>Click to play</h2>
          <ul className="keys">
            <li>
              <kbd>W A S D</kbd> move · <kbd>Shift</kbd> sprint · <kbd>Ctrl</kbd> crouch ·{' '}
              <kbd>Space</kbd> jump
            </li>
            <li>
              <kbd>Mouse 1</kbd> fire · <kbd>R</kbd> reload · <kbd>Tab</kbd> scores
            </li>
          </ul>
          <button
            className="btn"
            onClick={(e) => {
              e.stopPropagation();
              onLeave();
            }}
          >
            Leave match
          </button>
        </div>
      )}
      {phase.kind === 'ready' && locked && hud?.alive && (
        <div className="crosshair" aria-hidden="true" />
      )}
      {dbg && (
        <pre className="debug" data-testid="match-debug">
          {dbg}
        </pre>
      )}
      {phase.kind === 'ready' && hud && (
        <>
          <MatchHudView hud={hud} />
          {(showScores || !locked) && <Scoreboard hud={hud} />}
        </>
      )}
    </div>
  );
}

function MatchHudView({ hud }: { hud: MatchHud }) {
  const hpPct = Math.round((hud.health / hud.maxHealth) * 100);
  return (
    <div className="hud" aria-live="off">
      {hud.hitKind && (
        <div key={hud.hitSeq} className={`hitmarker hit-${hud.hitKind}`} aria-hidden="true" />
      )}
      {!hud.alive && (
        <div className="eliminated" role="status">
          ELIMINATED
          <small>Respawning…</small>
        </div>
      )}
      <ul className="killfeed">
        {hud.feed.map((f, i) => (
          <li key={`${i}-${f}`}>{f}</li>
        ))}
      </ul>
      <div className="hud-health">
        <span className="hud-label">HEALTH</span>
        <span className={`hud-big${hpPct <= 30 ? ' is-low' : ''}`}>{hud.health}</span>
        <span className="hud-bar">
          <span style={{ width: `${hpPct}%` }} />
        </span>
      </div>
      <div className="hud-ammo">
        <span className="hud-label">{hud.weaponName}</span>
        <span className={`hud-big${hud.ammo <= 6 ? ' is-low' : ''}`}>
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

function Scoreboard({ hud }: { hud: MatchHud }) {
  return (
    <table className="scoreboard">
      <thead>
        <tr>
          <th>Operator</th>
          <th>Team</th>
          <th>K</th>
          <th>D</th>
        </tr>
      </thead>
      <tbody>
        {hud.scores.map((s) => (
          <tr key={s.id} className={s.isMe ? 'is-me' : undefined}>
            <td>{s.name}</td>
            <td className={`team-tag team-${s.team}`}>{s.team}</td>
            <td>{s.kills}</td>
            <td>{s.deaths}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
