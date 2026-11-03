/** Pure helpers behind the spatial audio. No Web Audio here, so they are unit-testable. */

/** Accumulates travelled distance and reports how many footsteps that produced. */
export class StrideTracker {
  private acc = 0;

  advance(distance: number, stride: number): number {
    this.acc += distance;
    let steps = 0;
    while (this.acc >= stride) {
      this.acc -= stride;
      steps++;
    }
    return steps;
  }

  reset(): void {
    this.acc = 0;
  }
}

export interface Gait {
  /** Metres per footstep. */
  stride: number;
  /** Loudness multiplier. */
  gain: number;
}

/**
 * Gait from horizontal speed (m/s). Crouch-walking and standing still make no step noise,
 * which keeps sneaking meaningful and stops sound from betraying every position.
 */
export function gaitFor(speed: number, crouching: boolean): Gait | null {
  if (crouching || speed < 2.6) return null;
  if (speed > 5) return { stride: 2.9, gain: 1 };
  return { stride: 2.2, gain: 0.65 };
}

/** Same curve as a Web Audio `PannerNode` with `distanceModel: 'inverse'` (for tests/tuning). */
export function distanceGain(distance: number, ref = 3, rolloff = 1.4, max = 80): number {
  const d = Math.min(Math.max(distance, ref), max);
  return ref / (ref + rolloff * (d - ref));
}

export const HEARING_RANGE = {
  /** Footsteps are inaudible beyond this (m). */
  footsteps: 26,
};

/** Wall occlusion: muffled and quieter. */
export function occlusionFilter(occluded: boolean): { gain: number; cutoffHz: number } {
  return occluded ? { gain: 0.55, cutoffHz: 650 } : { gain: 1, cutoffHz: 20000 };
}

/** Reverb send level: more tail indoors, almost none in the open. */
export function reverbWet(indoor: boolean): number {
  return indoor ? 0.4 : 0.08;
}

/** Random offset so a sound's apparent position is never pixel-accurate (no exact radar by ear). */
export function jitterPosition(
  pos: { x: number; y: number; z: number },
  amount: number,
  rand: () => number = Math.random,
): { x: number; y: number; z: number } {
  return {
    x: pos.x + (rand() - 0.5) * 2 * amount,
    y: pos.y,
    z: pos.z + (rand() - 0.5) * 2 * amount,
  };
}
