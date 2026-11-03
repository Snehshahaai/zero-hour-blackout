import type { TouchControls } from './TouchControls.ts';

/**
 * Keyboard + mouse + pointer lock, plus optional touch controls. Holds raw state only; gameplay
 * interprets it. With touch controls attached, "locked" means the player has tapped to play.
 */
export class InputManager {
  private touchActive = false;
  private readonly down = new Set<string>();
  private mouseDx = 0;
  private mouseDy = 0;
  private jumpQueued = false;
  private readonly buttons = new Set<number>();
  private readonly pressed = new Set<string>();
  private firePressed = false;
  private lockListeners = new Set<(locked: boolean) => void>();

  constructor(
    private readonly element: HTMLElement,
    private readonly touch: TouchControls | null = null,
  ) {
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.handleLockChange);
    window.addEventListener('blur', this.releaseAll);
  }

  get locked(): boolean {
    return this.touch ? this.touchActive : document.pointerLockElement === this.element;
  }

  requestLock(): void {
    if (this.touch) {
      // Called from a tap, so fullscreen/orientation requests are allowed. Both are best-effort:
      // iPhone Safari supports neither, and the game works without them.
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
      void (screen.orientation as { lock?: (o: string) => Promise<void> } | undefined)
        ?.lock?.('landscape')
        .catch(() => undefined);
      this.setTouchActive(true);
      return;
    }
    // Promise-returning in modern browsers; a refused request (e.g. user pressed Esc just before)
    // is harmless, so swallow it.
    void Promise.resolve(this.element.requestPointerLock()).catch(() => undefined);
  }

  exitLock(): void {
    if (this.touch) {
      this.setTouchActive(false);
      return;
    }
    if (this.locked) document.exitPointerLock();
  }

  private setTouchActive(active: boolean): void {
    if (this.touchActive === active) return;
    this.touchActive = active;
    this.touch?.setVisible(active);
    if (!active) this.releaseAll();
    for (const l of this.lockListeners) l(active);
  }

  onLockChange(listener: (locked: boolean) => void): () => void {
    this.lockListeners.add(listener);
    return () => this.lockListeners.delete(listener);
  }

  isDown(code: string): boolean {
    return this.down.has(code) || (this.touch?.state.isDown(code) ?? false);
  }

  /** Returns accumulated mouse movement since the last call. */
  consumeMouse(dt?: number): { dx: number; dy: number } {
    const t = this.touch?.state.consumeLook(dt) ?? { dx: 0, dy: 0 };
    const r = { dx: this.mouseDx + t.dx, dy: this.mouseDy + t.dy };
    this.mouseDx = this.mouseDy = 0;
    return r;
  }

  isMouseDown(button: number): boolean {
    return this.buttons.has(button) || (button === 0 && (this.touch?.state.fire ?? false));
  }

  /** True once per primary-button press (edge). */
  consumeFirePressed(): boolean {
    const touchEdge = this.touch?.state.consumeFireLatch() ?? false; // a press, not a held button
    const f = this.firePressed || touchEdge;
    this.firePressed = false;
    return f;
  }

  /** True once per key press (edge) for `code`. */
  consumePressed(code: string): boolean {
    if (code === 'KeyR' && this.touch?.state.consumeReload()) return true;
    return this.pressed.delete(code);
  }

  /** True once per Space press (edge), for buffered jumping. */
  consumeJump(): boolean {
    const j = this.jumpQueued || (this.touch?.state.consumeJump() ?? false);
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
