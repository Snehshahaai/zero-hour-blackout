import { network } from './services/network.ts';
import { TopBar } from './components/TopBar.tsx';
import { useEffect } from 'react';
import { useHashRoute } from './hooks/useHashRoute.ts';
import { useNetwork } from './hooks/useNetwork.ts';
import { useServerStatus } from './hooks/useServerStatus.ts';
import { SceneBackground } from './features/scene/SceneBackground.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { ComingSoonPage } from './pages/PlaceholderPage.tsx';
import { LobbyPage } from './pages/LobbyPage.tsx';
import { MatchPage } from './pages/MatchPage.tsx';
import { PlayPage } from './pages/PlayPage.tsx';
import { SandboxPage } from './pages/SandboxPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

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

  if (route === 'sandbox') return <SandboxPage onExit={() => navigate('home')} />;
  // Once the server starts the match, the lobby screen is replaced by the game itself.
  if (route === 'lobby' && net.lobby?.phase === 'inMatch') {
    return (
      <MatchPage
        onLeave={() => {
          void network.leave().then(() => navigate('play'));
        }}
      />
    );
  }
  return (
    <div className={`app${route === 'home' ? '' : ' app-dim'}`}>
      <SceneBackground active={route === 'home'} />
      <TopBar route={route} onNavigate={navigate} serverStatus={serverStatus} />
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
