/** Keyboard + mouse + pointer lock. Holds raw state only; gameplay interprets it. */
export class InputManager {
  private readonly down = new Set<string>();
  private mouseDx = 0;
  private mouseDy = 0;
  private jumpQueued = false;
  private readonly buttons = new Set<number>();
  private readonly pressed = new Set<string>();
  private firePressed = false;
  private lockListeners = new Set<(locked: boolean) => void>();

  constructor(private readonly element: HTMLElement) {
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
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

  isMouseDown(button: number): boolean {
    return this.buttons.has(button);
  }

  /** True once per primary-button press (edge). */
  consumeFirePressed(): boolean {
    const f = this.firePressed;
    this.firePressed = false;
    return f;
  }

  /** True once per key press (edge) for `code`. */
  consumePressed(code: string): boolean {
    return this.pressed.delete(code);
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
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
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
    this.pressed.add(e.code);
    if (e.code === 'Space') this.jumpQueued = true;
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.locked) return;
    this.buttons.add(e.button);
    if (e.button === 0) this.firePressed = true;
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    this.buttons.delete(e.button);
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
    this.buttons.clear();
    this.pressed.clear();
    this.firePressed = false;
    this.jumpQueued = false;
    this.mouseDx = this.mouseDy = 0;
  };
}
