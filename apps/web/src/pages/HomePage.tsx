import { GAME_TAGLINE } from '@zhb/shared';
import type { Route } from '../hooks/useHashRoute.ts';

interface Props {
  onNavigate: (r: Route) => void;
}

const ENTRIES: { label: string; hint: string; tag: string; route: Route }[] = [
  {
    label: 'Play Online',
    hint: 'Competitive matchmaking',
    tag: 'Competitive · 1v1 / 2v2',
    route: 'play',
  },
  {
    label: 'Create Private Room',
    hint: 'Invite friends with a room code',
    tag: 'Competitive · 1v1 / 2v2',
    route: 'play',
  },
  {
    label: 'Join With Room Code',
    hint: 'Enter a 6-character code',
    tag: 'Any mode',
    route: 'play',
  },
  {
    label: 'Cooperative Operations',
    hint: 'Mission against AI hostiles',
    tag: 'Co-op · 1–4 operators',
    route: 'play',
  },
  {
    label: 'Solo Sandbox',
    hint: 'Movement and shooting range on Map 01',
    tag: 'Development build',
    route: 'sandbox',
  },
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
        {ENTRIES.map((a) => (
          <li key={a.label}>
            <button className="action action-live" onClick={() => onNavigate(a.route)}>
              <span className="action-label">{a.label}</span>
              <span className="action-hint">{a.hint}</span>
              <span className="action-phase">{a.tag}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
