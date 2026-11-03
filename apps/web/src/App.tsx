import { network } from './services/network.ts';
import { checkBrowserSupport } from '@zhb/game-engine/detect';
import { TopBar } from './components/TopBar.tsx';
import { Suspense, lazy, useEffect } from 'react';
import { useHashRoute } from './hooks/useHashRoute.ts';
import { useNetwork } from './hooks/useNetwork.ts';
import { useServerStatus } from './hooks/useServerStatus.ts';
import { HomePage } from './pages/HomePage.tsx';
import { ComingSoonPage } from './pages/PlaceholderPage.tsx';
import { LobbyPage } from './pages/LobbyPage.tsx';
import { PlayPage } from './pages/PlayPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

// The 3D engine (Three.js + physics WASM) is several MB: only download it when it is needed.
const SceneBackground = lazy(() =>
  import('./features/scene/SceneBackground.tsx').then((m) => ({ default: m.SceneBackground })),
);
const MatchPage = lazy(() =>
  import('./pages/MatchPage.tsx').then((m) => ({ default: m.MatchPage })),
);
const SandboxPage = lazy(() =>
  import('./pages/SandboxPage.tsx').then((m) => ({ default: m.SandboxPage })),
);

function GameLoading() {
  return (
    <div className="loading" role="status">
      <span className="loading-label">LOADING GAME ENGINE</span>
    </div>
  );
}

const SUPPORT = checkBrowserSupport();

export function App() {
  const [route, navigate] = useHashRoute();
  const serverStatus = useServerStatus();
  const net = useNetwork();
  const inLobby = net.lobby !== null;

  // Resume a held lobby slot after a page refresh.
  useEffect(() => {
    void network.resume();
  }, []);

  // Entering a lobby opens it; losing it (kick, disconnect for good) leaves the lobby screen.
  useEffect(() => {
    if (inLobby && route !== 'lobby' && route !== 'sandbox') navigate('lobby');
    if (!inLobby && net.status === 'idle' && route === 'lobby') navigate('play');
  }, [inLobby, net.status, route, navigate]);

  if (route === 'sandbox') {
    return (
      <Suspense fallback={<GameLoading />}>
        <SandboxPage onExit={() => navigate('home')} />
      </Suspense>
    );
  }
  // Once the server starts the match, the lobby screen is replaced by the game itself.
  if (route === 'lobby' && net.lobby?.phase === 'inMatch') {
    return (
      <Suspense fallback={<GameLoading />}>
        <MatchPage
          onLeave={() => {
            void network.leave().then(() => navigate('play'));
          }}
        />
      </Suspense>
    );
  }
  return (
    <div className={`app${route === 'home' ? '' : ' app-dim'}`}>
      <Suspense fallback={null}>
        <SceneBackground active={route === 'home'} />
      </Suspense>
      <TopBar route={route} onNavigate={navigate} serverStatus={serverStatus} />
      {!SUPPORT.ok && (
        <p className="banner banner-warn support-warning" role="alert">
          Your browser cannot run the game: {SUPPORT.problems.join(' ')} Please use a current
          Chrome, Edge or Firefox.
        </p>
      )}
      {route === 'home' && <HomePage onNavigate={navigate} />}
      {route === 'play' && <PlayPage />}
      {route === 'lobby' && <LobbyPage onLeft={() => navigate('play')} />}
      {route === 'operations' && (
        <ComingSoonPage title="Operations" phase="Phase 8 · Cooperative" />
      )}
      {route === 'loadout' && <ComingSoonPage title="Loadout" phase="Phase 4 · Weapons" />}
      {route === 'profile' && <ComingSoonPage title="Profile" phase="Later · Accounts" />}
      {route === 'settings' && <SettingsPage />}
    </div>
  );
}
