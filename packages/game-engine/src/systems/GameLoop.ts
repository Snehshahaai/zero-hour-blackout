export interface GameLoopCallbacks {
  /** Fixed-timestep simulation step. `dt` is always `1 / tickRate` seconds. */
  update(dt: number): void;
  /** Called once per rendered frame. `alpha` in [0,1) is the interpolation factor between ticks. */
  render(alpha: number, frameDt: number): void;
}

export interface GameLoopOptions {
  tickRate?: number;
  /** Caps catch-up work after a stall (e.g. background tab) to avoid a spiral of death. */
  maxStepsPerFrame?: number;
}

/**
 * Dedicated fixed-timestep game loop. Runs outside React: simulation and rendering
 * must never be driven by component state.
 */
export class GameLoop {
  private readonly step: number;
  private readonly maxSteps: number;
  private accumulator = 0;
  private last = 0;
  private rafId: number | null = null;

  constructor(
    private readonly callbacks: GameLoopCallbacks,
    options: GameLoopOptions = {},
  ) {
    this.step = 1 / (options.tickRate ?? 60);
    this.maxSteps = options.maxStepsPerFrame ?? 5;
  }

  get running(): boolean {
    return this.rafId !== null;
  }

  start(): void {
    if (this.running) return;
    this.last = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  /** Advances the loop by `frameDt` seconds. Exposed so it can be tested deterministically. */
  advance(frameDt: number): void {
    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSteps) {
      this.callbacks.update(this.step);
      this.accumulator -= this.step;
      steps++;
    }
    if (steps === this.maxSteps) this.accumulator = 0;
    this.callbacks.render(this.accumulator / this.step, frameDt);
  }

  private readonly frame = (now: number): void => {
    const frameDt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.advance(frameDt);
    if (this.rafId !== null) this.rafId = requestAnimationFrame(this.frame);
  };
}
