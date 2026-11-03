import { THREE_REVISION, isWebGL2Supported } from '@zhb/game-engine';
import { GAME_NAME } from '@zhb/shared';
import { NAV_ROUTES, type NavRoute, type Route } from '../hooks/useHashRoute.ts';
import type { ServerStatus } from '../services/serverStatus.ts';

const LABELS: Record<NavRoute, string> = {
  home: 'Home',
  play: 'Play',
  operations: 'Operations',
  loadout: 'Loadout',
  profile: 'Profile',
  settings: 'Settings',
};

const WEBGL2 = isWebGL2Supported();

interface Props {
  route: Route;
  onNavigate: (r: Route) => void;
  serverStatus: ServerStatus;
}

export function TopBar({ route, onNavigate, serverStatus }: Props) {
  return (
    <header className="topbar">
      <div className="brand" aria-label={GAME_NAME}>
        <span className="brand-main">ZERO HOUR</span>
        <span className="brand-sub">BLACKOUT</span>
      </div>
      <nav className="nav" aria-label="Main">
        {NAV_ROUTES.map((r) => (
          <button
            key={r}
            className="nav-item"
            aria-current={r === route ? 'page' : undefined}
            onClick={() => onNavigate(r)}
          >
            {LABELS[r]}
          </button>
        ))}
      </nav>
      <div className="status" role="status">
        <span className={`dot dot-${serverStatus}`} aria-hidden="true" />
        <span>SERVER {serverStatus.toUpperCase()}</span>
        <span className="status-sep" aria-hidden="true">
          |
        </span>
        <span title={`three r${THREE_REVISION}`}>WEBGL2 {WEBGL2 ? 'OK' : 'UNSUPPORTED'}</span>
      </div>
    </header>
  );
}
