/**
 * Tiny, dependency-free capability checks. Kept out of the engine index so the menu can use them
 * without downloading Three.js or the physics engine.
 */
export function isWebGL2Supported(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

export function isAudioSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.AudioContext === 'function';
}

export function isPointerLockSupported(): boolean {
  return typeof document !== 'undefined' && 'pointerLockElement' in document;
}

export interface BrowserSupport {
  ok: boolean;
  /** Human-readable problems, empty when `ok`. */
  problems: string[];
}

/** What the game needs from the browser; shown to the player if something is missing. */
export function checkBrowserSupport(): BrowserSupport {
  const problems: string[] = [];
  if (!isWebGL2Supported()) problems.push('WebGL2 (3D graphics) is not available.');
  if (!isAudioSupported()) problems.push('Web Audio is not available.');
  if (!isPointerLockSupported()) problems.push('Mouse capture (Pointer Lock) is not available.');
  if (typeof WebAssembly === 'undefined') problems.push('WebAssembly is not available.');
  return { ok: problems.length === 0, problems };
}
