import { TouchState, stickAxes } from './touchState.ts';

const STICK_RADIUS = 58;
const COLOR = 'rgba(232, 165, 38,';

type Style = Partial<CSSStyleDeclaration>;
function el(tag: string, style: Style, parent?: HTMLElement): HTMLElement {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  parent?.appendChild(e);
  return e;
}

/**
 * On-screen controls for phones and tablets: a floating move stick (left), drag-to-look (right),
 * and buttons for fire, jump, crouch, reload, interact and pause. Everything is written into a
 * `TouchState` that the game loop reads, so no gameplay code knows touch exists.
 * Built with Pointer Events + pointer capture so several fingers work at once.
 */
export class TouchControls {
  readonly state = new TouchState();
  private readonly root: HTMLElement;
  private readonly cleanup: (() => void)[] = [];
  private readonly rotateHint: HTMLElement;

  constructor(
    host: HTMLElement,
    private readonly onMenu: () => void,
  ) {
    this.root = el(
      'div',
      {
        position: 'absolute',
        inset: '0',
        zIndex: '4',
        touchAction: 'none',
        userSelect: 'none',
        pointerEvents: 'none',
        display: 'none',
      },
      host,
    );
    this.root.setAttribute('data-testid', 'touch-controls');
    this.root.style.setProperty('-webkit-user-select', 'none');
    this.root.style.setProperty('-webkit-touch-callout', 'none');
    const block = (e: Event) => e.preventDefault();
    this.root.addEventListener('contextmenu', block);
    this.cleanup.push(() => this.root.removeEventListener('contextmenu', block));

    this.buildLookZone();
    this.buildStick();
    this.buildButtons();
    this.rotateHint = this.buildRotateHint(host);
    this.updateOrientation();
    window.addEventListener('resize', this.updateOrientation);
    this.cleanup.push(() => window.removeEventListener('resize', this.updateOrientation));
  }

  /** Shown only while actually playing (hidden behind the "tap to play" overlay). */
  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
    if (!visible) this.state.reset();
    this.updateOrientation();
  }

  dispose(): void {
    for (const c of this.cleanup) c();
    this.root.remove();
    this.rotateHint.remove();
    window.removeEventListener('resize', this.updateOrientation);
  }

  // ---- look: drag anywhere on the right side --------------------------------------------

  private buildLookZone(): void {
    const zone = el(
      'div',
      {
        position: 'absolute',
        top: '0',
        right: '0',
        bottom: '0',
        left: '42%',
        pointerEvents: 'auto',
      },
      this.root,
    );
    let id: number | null = null;
    let lx = 0;
    let ly = 0;
    const down = (e: PointerEvent) => {
      if (id !== null) return;
      id = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
      zone.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      this.state.addLook(e.clientX - lx, e.clientY - ly);
      lx = e.clientX;
      ly = e.clientY;
      e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === id) id = null;
    };
    zone.addEventListener('pointerdown', down);
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
  }

  // ---- move: floating stick on the left ---------------------------------------------------

  private buildStick(): void {
    const zone = el(
      'div',
      {
        position: 'absolute',
        top: '25%',
        left: '0',
        bottom: '0',
        width: '42%',
        pointerEvents: 'auto',
      },
      this.root,
    );
    const base = el(
      'div',
      {
        position: 'absolute',
        width: `${STICK_RADIUS * 2}px`,
        height: `${STICK_RADIUS * 2}px`,
        borderRadius: '50%',
        border: `2px solid ${COLOR} 0.55)`,
        background: `${COLOR} 0.10)`,
        display: 'none',
        pointerEvents: 'none',
      },
      zone,
    );
    const thumb = el(
      'div',
      {
        position: 'absolute',
        left: `${STICK_RADIUS - 24}px`,
        top: `${STICK_RADIUS - 24}px`,
        width: '48px',
        height: '48px',
        borderRadius: '50%',
        background: `${COLOR} 0.55)`,
      },
      base,
    );
    let id: number | null = null;
    let cx = 0;
    let cy = 0;
    const set = (e: PointerEvent) => {
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, STICK_RADIUS / len);
      thumb.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      this.state.setStick(stickAxes(dx, dy, STICK_RADIUS));
    };
    const down = (e: PointerEvent) => {
      if (id !== null) return;
      id = e.pointerId;
      const r = zone.getBoundingClientRect();
      cx = e.clientX;
      cy = e.clientY;
      base.style.left = `${cx - r.left - STICK_RADIUS}px`;
      base.style.top = `${cy - r.top - STICK_RADIUS}px`;
      base.style.display = 'block';
      zone.setPointerCapture(e.pointerId);
      set(e);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId === id) {
        set(e);
        e.preventDefault();
      }
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      base.style.display = 'none';
      thumb.style.transform = 'translate(0, 0)';
      this.state.setStick({ x: 0, y: 0, magnitude: 0 });
    };
    zone.addEventListener('pointerdown', down);
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
  }

  // ---- buttons --------------------------------------------------------------------------

  private button(
    label: string,
    pos: Style,
    size: number,
    handlers: { down?: () => void; up?: () => void },
    testId: string,
  ): HTMLElement {
    const b = el(
      'div',
      {
        position: 'absolute',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        border: `2px solid ${COLOR} 0.7)`,
        background: `${COLOR} 0.16)`,
        color: 'rgba(255,255,255,0.92)',
        font: '600 12px system-ui, sans-serif',
        letterSpacing: '0.08em',
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'auto',
        textTransform: 'uppercase',
        ...pos,
      },
      this.root,
    );
    b.textContent = label;
    b.setAttribute('data-testid', testId);
    let id: number | null = null;
    const down = (e: PointerEvent) => {
      if (id !== null) return;
      id = e.pointerId;
      b.setPointerCapture(e.pointerId);
      b.style.background = `${COLOR} 0.45)`;
      handlers.down?.();
      e.preventDefault();
      e.stopPropagation();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      b.style.background = `${COLOR} 0.16)`;
      handlers.up?.();
      e.stopPropagation();
    };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    return b;
  }

  private buildButtons(): void {
    const s = this.state;
    this.button(
      'Fire',
      { right: '28px', bottom: '34px' },
      92,
      { down: () => s.latchFire(), up: () => (s.fire = false) },
      'touch-fire',
    );
    this.button(
      'Jump',
      { right: '138px', bottom: '28px' },
      64,
      { down: () => s.pressJump() },
      'touch-jump',
    );
    this.button(
      'Use',
      { right: '150px', bottom: '104px' },
      64,
      { down: () => (s.interact = true), up: () => (s.interact = false) },
      'touch-use',
    );
    this.button(
      'Reload',
      { right: '30px', bottom: '142px' },
      58,
      { down: () => s.pressReload() },
      'touch-reload',
    );
    // Crouch is a toggle on touch (holding a button while also holding the stick and aiming is too much).
    const crouch = this.button(
      'Crouch',
      { right: '98px', bottom: '176px' },
      54,
      {},
      'touch-crouch',
    );
    crouch.addEventListener('pointerdown', () => {
      s.crouch = !s.crouch;
      crouch.style.borderColor = s.crouch ? 'rgba(95,184,120,0.95)' : `${COLOR} 0.7)`;
      crouch.style.background = s.crouch ? 'rgba(95,184,120,0.35)' : `${COLOR} 0.16)`;
    });
    this.button(
      '| |',
      { left: '12px', top: '10px' },
      44,
      { down: () => this.onMenu() },
      'touch-menu',
    );
  }

  // ---- portrait warning -----------------------------------------------------------------

  private buildRotateHint(host: HTMLElement): HTMLElement {
    const hint = el(
      'div',
      {
        position: 'absolute',
        inset: '0',
        zIndex: '6',
        display: 'none',
        placeContent: 'center',
        textAlign: 'center',
        background: 'rgba(11,13,15,0.92)',
        color: '#d8dde2',
        font: '600 15px system-ui, sans-serif',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        padding: '24px',
        pointerEvents: 'auto',
      },
      host,
    );
    hint.textContent = 'Rotate your device to landscape to play';
    hint.setAttribute('data-testid', 'rotate-hint');
    return hint;
  }

  private readonly updateOrientation = (): void => {
    const portrait = window.innerHeight > window.innerWidth;
    this.rotateHint.style.display =
      portrait && this.root.style.display !== 'none' ? 'grid' : 'none';
  };
}
