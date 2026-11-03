import { createMatchGame, type MatchGame, type MatchHud } from '@zhb/game-engine';
import { useEffect, useRef, useState } from 'react';
import { useControlMode } from '../hooks/useControlMode.ts';
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
  const { touch } = useControlMode();
  const initialTouch = useRef(touch);
  const [phase, setPhase] = useState<Phase>({
    kind: 'loading',
    fraction: 0,
    label: 'Joining match',
  });
  const [locked, setLocked] = useState(false);
  // The tap that pauses also produces a `click` on the overlay that appears under the finger; ignore
  // overlay clicks right after unlocking or the game would resume instantly.
  const unlockedAt = useRef(0);
  const onLock = (l: boolean) => {
    if (!l) unlockedAt.current = performance.now();
    setLocked(l);
  };
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
    createMatchGame(
      canvas,
      initialQuality.current,
      bridge,
      (fraction, label) => {
        if (!cancelled) setPhase({ kind: 'loading', fraction, label });
      },
      { touch: initialTouch.current },
    )
      .then((g) => {
        if (cancelled) return g.dispose();
        gameRef.current = g;
        unsubscribers.push(g.onLockChange(onLock), g.onHud(setHud));
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
          <p>Could not start the match: {phase.message}</p>
          <button className="btn" onClick={onLeave}>
            Leave
          </button>
        </div>
      )}
      {phase.kind === 'ready' && !locked && !hud?.result && (
        <div
          className="game-overlay"
          onClick={() => {
            if (performance.now() - unlockedAt.current > 500) gameRef.current?.requestLock();
          }}
        >
          <p className="eyebrow">MATCH IN PROGRESS</p>
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
                <kbd>W A S D</kbd> move · <kbd>Shift</kbd> sprint · <kbd>Ctrl</kbd> crouch ·{' '}
                <kbd>Space</kbd> jump
              </li>
              <li>
                <kbd>Mouse 1</kbd> fire · <kbd>R</kbd> reload · <kbd>E</kbd> hold to plant / defuse
                / cut power · <kbd>Tab</kbd> scores
              </li>
            </ul>
          )}
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
      {touch && phase.kind === 'ready' && locked && (
        <button
          className="touch-scores"
          aria-pressed={showScores}
          onClick={() => setShowScores((v) => !v)}
        >
          Scores
        </button>
      )}
      {dbg && (
        <pre className="debug" data-testid="match-debug">
          {dbg}
        </pre>
      )}
      {phase.kind === 'ready' && hud && (
        <>
          <MatchHudView hud={hud} />
          {(showScores || !locked) && !hud.result && <Scoreboard hud={hud} />}
        </>
      )}
    </div>
  );
}

function MatchHudView({ hud }: { hud: MatchHud }) {
  const { touch } = useControlMode();
  const hpPct = Math.round((hud.health / hud.maxHealth) * 100);
  return (
    <div className="hud" aria-live="off">
      <RoundBar hud={hud} />
      {hud.prompt && (
        <div className="prompt" role="status">
          {hud.prompt}
          {hud.progress > 0 && (
            <span className="prompt-bar">
              <span style={{ width: `${Math.round(hud.progress * 100)}%` }} />
            </span>
          )}
        </div>
      )}
      <ul className="teammates" aria-label="Teammates">
        {hud.teammates.map((t) => (
          <li key={t.name} className={t.alive ? undefined : 'is-dead'}>
            <span>{t.name}</span>
            <span className="hud-bar">
              <span style={{ width: `${t.alive ? t.health : 0}%` }} />
            </span>
          </li>
        ))}
      </ul>
      {hud.result && <MatchResult hud={hud} />}
      {hud.hitKind && (
        <div key={hud.hitSeq} className={`hitmarker hit-${hud.hitKind}`} aria-hidden="true" />
      )}
      {!hud.alive && (
        <div className="eliminated" role="status">
          {hud.lives.respawnIn > 0 ? 'DOWN' : 'ELIMINATED'}
          <small>
            {hud.lives.respawnIn > 0
              ? `Respawning in ${Math.ceil(hud.lives.respawnIn)}…`
              : hud.coop
                ? 'No respawns left this objective'
                : 'Eliminated until next round'}
          </small>
          {hud.spectating && (
            <small className="spectate-line">
              Watching {hud.spectating} · {touch ? 'tap Fire' : 'click'} to switch
            </small>
          )}
        </div>
      )}
      {hud.coop && (
        <div className="hud-lives" aria-label={`${hud.lives.left} respawns left`}>
          <span className="hud-label">RESPAWNS</span>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i < hud.lives.left ? 'pip is-on' : 'pip'} />
          ))}
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

const PHASE_LABEL: Record<MatchHud['round']['phase'], string> = {
  freeze: 'GET READY',
  live: 'LIVE',
  planted: 'BOMB PLANTED',
  roundEnd: 'ROUND OVER',
  matchEnd: 'MATCH OVER',
};

function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function MissionBar({ hud }: { hud: MatchHud }) {
  const c = hud.coop;
  if (!c) return null;
  const briefing = c.state === 'briefing';
  return (
    <div className="roundbar" role="status">
      <div className="roundbar-score">
        <span className="score-theirs" title="Hostiles remaining">
          {c.hostiles}
        </span>
        <span className="roundbar-clock">{clock(c.timeLeft)}</span>
      </div>
      <div className="roundbar-phase">
        {briefing ? 'BRIEFING · GET READY' : `OBJECTIVE ${c.index + 1}/${c.total}`}
      </div>
      <div className="mission-objective">{c.objective}</div>
      {c.index > 0 && c.state === 'active' && (
        <span className="prompt-bar mission-bar">
          <span style={{ width: `${Math.round(c.progress * 100)}%` }} />
        </span>
      )}
      <div className="roundbar-meta">
        {c.index === 0
          ? 'HOSTILES REMAINING (LEFT)'
          : 'STAY IN THE ZONE · KEEP IT CLEAR OF HOSTILES'}
      </div>
    </div>
  );
}

function RoundBar({ hud }: { hud: MatchHud }) {
  if (hud.coop) return <MissionBar hud={hud} />;
  const { round, mySide, bomb } = hud;
  return (
    <div className="roundbar" role="status">
      <div className="roundbar-score">
        <span className="score-mine">{round.mine}</span>
        <span className="roundbar-clock">{clock(round.timeLeft)}</span>
        <span className="score-theirs">{round.theirs}</span>
      </div>
      <div className={`roundbar-phase${bomb.planted ? ' is-bomb' : ''}`}>
        {PHASE_LABEL[round.phase]}
        {bomb.planted && ` · SITE ${bomb.site}`}
      </div>
      {hud.power && (
        <div className="roundbar-power" role="status">
          POWER CUT · {hud.power.label.toUpperCase()} · {Math.ceil(hud.power.secondsLeft)}s
          <small>Emergency lighting · backup power restoring</small>
        </div>
      )}
      <div className="roundbar-meta">
        {round.deathmatch > 0
          ? `DEATHMATCH · FIRST TO ${round.deathmatch} KILLS`
          : `ROUND ${round.number} · YOU ARE ${mySide.toUpperCase()} · ${
              mySide === 'attackers' ? 'PLANT THE BOMB' : 'STOP THE PLANT'
            }`}
        {hud.weather !== 'clear' && ` · ${hud.weather.toUpperCase()}`}
      </div>
    </div>
  );
}

function MatchResult({ hud }: { hud: MatchHud }) {
  const result = hud.result;
  if (!result) return null;
  return (
    <div className="result" role="alertdialog" aria-label="Match result">
      <p className="eyebrow">{hud.coop ? 'MISSION' : 'MATCH COMPLETE'}</p>
      <h2 className={result.won ? 'is-win' : 'is-loss'}>
        {hud.coop ? (result.won ? 'Complete' : 'Failed') : result.won ? 'Victory' : 'Defeat'}
      </h2>
      {!hud.coop && (
        <p className="result-score">
          {hud.round.mine} – {hud.round.theirs}
        </p>
      )}
      <p className="note">Returning to the lobby…</p>
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
