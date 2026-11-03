import { REVISION } from 'three';

/** Three.js revision bundled with the engine (useful for diagnostics / bug reports). */
export const THREE_REVISION = REVISION;

/** Returns true when the browser can create a WebGL2 context. */
export function isWebGL2Supported(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}
