import { graphicsQualitySchema, type GraphicsQuality } from '@zhb/shared';
import { isCoarsePointer } from './controls.ts';

const KEY = 'zhb.graphicsQuality';
const listeners = new Set<() => void>();
let current: GraphicsQuality = read();

function read(): GraphicsQuality {
  try {
    const parsed = graphicsQualitySchema.safeParse(localStorage.getItem(KEY));
    if (parsed.success) return parsed.data;
  } catch {
    /* storage unavailable (private mode) */
  }
  // Phones and tablets have far less GPU headroom: start light, players can raise it in Settings.
  return isCoarsePointer() ? 'low' : 'medium';
}

export const graphicsSettings = {
  get: (): GraphicsQuality => current,
  set(q: GraphicsQuality): void {
    current = q;
    try {
      localStorage.setItem(KEY, q);
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
