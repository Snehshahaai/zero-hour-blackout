import { useSyncExternalStore } from 'react';
import { graphicsSettings } from '../services/settings.ts';

export function useGraphicsQuality() {
  const quality = useSyncExternalStore(graphicsSettings.subscribe, graphicsSettings.get);
  return [quality, graphicsSettings.set] as const;
}
