import { TopBar } from './components/TopBar.tsx';
import { useHashRoute } from './hooks/useHashRoute.ts';
import { useServerStatus } from './hooks/useServerStatus.ts';
import { SceneBackground } from './features/scene/SceneBackground.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { ComingSoonPage } from './pages/PlaceholderPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

export function App() {
  const [route, navigate] = useHashRoute();
  const serverStatus = useServerStatus();
  return (
    <div className={`app${route === 'home' ? '' : ' app-dim'}`}>
      <SceneBackground active={route === 'home'} />
      <TopBar route={route} onNavigate={navigate} serverStatus={serverStatus} />
      {route === 'home' && <HomePage />}
      {route === 'play' && <ComingSoonPage title="Play" phase="Phase 5 · Multiplayer" />}
      {route === 'operations' && (
        <ComingSoonPage title="Operations" phase="Phase 8 · Cooperative" />
      )}
      {route === 'loadout' && <ComingSoonPage title="Loadout" phase="Phase 4 · Weapons" />}
      {route === 'profile' && <ComingSoonPage title="Profile" phase="Later · Accounts" />}
      {route === 'settings' && <SettingsPage />}
    </div>
  );
}
