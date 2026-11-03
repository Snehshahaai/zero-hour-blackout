import { useSyncExternalStore } from 'react';
import { controlSettings, resolveTouch } from '../services/controls.ts';

/** The saved preference, and whether touch controls are in effect right now. */
export function useControlMode() {
  const pref = useSyncExternalStore(controlSettings.subscribe, controlSettings.get);
  return { pref, touch: resolveTouch(pref), setPref: controlSettings.set };
}
