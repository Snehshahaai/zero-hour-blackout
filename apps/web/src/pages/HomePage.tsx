import { GAME_TAGLINE } from '@zhb/shared';
import type { Route } from '../hooks/useHashRoute.ts';

interface Action {
  label: string;
  hint: string;
  phase: string;
}

interface Props {
  onNavigate: (r: Route) => void;
}

// Disabled until the corresponding phase lands. Nothing here pretends to work.
const ACTIONS: Action[] = [
  { label: 'Play Online', hint: 'Competitive matchmaking', phase: 'Phase 5' },
  { label: 'Create Private Room', hint: 'Invite friends with a room code', phase: 'Phase 5' },
  { label: 'Join With Room Code', hint: 'Enter a 6-character code', phase: 'Phase 5' },
  { label: 'Cooperative Operations', hint: 'PvE missions against AI', phase: 'Phase 8' },
];

export function HomePage({ onNavigate }: Props) {
  return (
    <main className="home">
      <section className="hero">
        <p className="eyebrow">TACTICAL FIRST-PERSON SHOOTER</p>
        <h1>
          ZERO HOUR<span>BLACKOUT</span>
        </h1>
        <p className="tagline">{GAME_TAGLINE}</p>
      </section>
      <ul className="actions">
        <li>
          <button className="action action-live" onClick={() => onNavigate('sandbox')}>
            <span className="action-label">Solo Sandbox</span>
            <span className="action-hint">Movement test on Map 01 (no enemies)</span>
            <span className="action-phase">Development build</span>
          </button>
        </li>
        {ACTIONS.map((a) => (
          <li key={a.label}>
            <button className="action" disabled aria-disabled="true">
              <span className="action-label">{a.label}</span>
              <span className="action-hint">{a.hint}</span>
              <span className="action-phase">Unavailable · {a.phase}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
