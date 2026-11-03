/** Keyboard + mouse + pointer lock. Holds raw state only; gameplay interprets it. */
export class InputManager {
  private readonly down = new Set<string>();
  private mouseDx = 0;
  private mouseDy = 0;
  private jumpQueued = false;
  private lockListeners = new Set<(locked: boolean) => void>();

  constructor(private readonly element: HTMLElement) {
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.handleLockChange);
    window.addEventListener('blur', this.releaseAll);
  }

  get locked(): boolean {
    return document.pointerLockElement === this.element;
  }

  requestLock(): void {
    // Promise-returning in modern browsers; a refused request (e.g. user pressed Esc just before)
    // is harmless, so swallow it.
    void Promise.resolve(this.element.requestPointerLock()).catch(() => undefined);
  }

  exitLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  onLockChange(listener: (locked: boolean) => void): () => void {
    this.lockListeners.add(listener);
    return () => this.lockListeners.delete(listener);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** Returns accumulated mouse movement since the last call. */
  consumeMouse(): { dx: number; dy: number } {
    const r = { dx: this.mouseDx, dy: this.mouseDy };
    this.mouseDx = this.mouseDy = 0;
    return r;
  }

  /** True once per Space press (edge), for buffered jumping. */
  consumeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.handleLockChange);
    window.removeEventListener('blur', this.releaseAll);
    this.exitLock();
    this.lockListeners.clear();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.locked) return;
    // Don't let the browser scroll/zoom/etc. while playing.
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    if (e.code === 'Space') this.jumpQueued = true;
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    this.mouseDx += e.movementX;
    this.mouseDy += e.movementY;
  };

  private readonly handleLockChange = (): void => {
    if (!this.locked) this.releaseAll();
    for (const l of this.lockListeners) l(this.locked);
  };

  private readonly releaseAll = (): void => {
    this.down.clear();
    this.jumpQueued = false;
    this.mouseDx = this.mouseDy = 0;
  };
}
