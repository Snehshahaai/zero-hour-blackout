export type ControlPref = 'auto' | 'touch' | 'desktop';

const KEY = 'zhb.controls';
const listeners = new Set<() => void>();
let current: ControlPref = read();

function read(): ControlPref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'auto' || v === 'touch' || v === 'desktop') return v;
  } catch {
    /* storage unavailable */
  }
  return 'auto';
}

/** True on phones/tablets where the primary pointer is a finger. */
export function isCoarsePointer(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export const controlSettings = {
  get: (): ControlPref => current,
  set(p: ControlPref): void {
    current = p;
    try {
      localStorage.setItem(KEY, p);
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

export function resolveTouch(pref: ControlPref): boolean {
  return pref === 'touch' || (pref === 'auto' && isCoarsePointer());
}
