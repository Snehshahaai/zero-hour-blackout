import {
  AdditiveBlending,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  BoxGeometry,
  type BufferGeometry,
  type Material,
  type Scene,
} from 'three';

export interface ViewModelContext {
  /** Horizontal speed, m/s. */
  speed: number;
  sprinting: boolean;
  grounded: boolean;
  /** 0..1 while reloading, otherwise 0. */
  reloadProgress: number;
  reloading: boolean;
  /** Mouse movement this frame in pixels. */
  lookDx: number;
  lookDy: number;
}

const REST = { x: 0.15, y: -0.15, z: -0.4 };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Radial glow used for muzzle flash. */
function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,245,200,1)');
    g.addColorStop(0.35, 'rgba(255,170,60,0.7)');
    g.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new CanvasTexture(c);
}

/**
 * Procedural first-person rifle with spring recoil, movement bob, look sway, sprint pose
 * and a scripted reload. Drawn in the renderer's overlay scene.
 */
export class ViewModel {
  private readonly root = new Group();
  private readonly mag: Mesh;
  private readonly flash = new Group();
  private readonly flashLight = new PointLight(0xffa850, 0, 3, 2);
  private readonly disposables: { dispose(): void }[] = [];
  // Recoil spring (position along +Z, pitch rotation)
  private kickZ = 0;
  private kickZv = 0;
  private kickRot = 0;
  private kickRotv = 0;
  private bobPhase = 0;
  private swayX = 0;
  private swayY = 0;
  private sprintBlend = 0;
  private flashLeft = 0;
  private time = 0;

  constructor(private readonly scene: Scene) {
    const metal = new MeshStandardMaterial({ color: 0x7d8792, metalness: 0.25, roughness: 0.5 });
    const polymer = new MeshStandardMaterial({ color: 0x454b53, metalness: 0.05, roughness: 0.75 });
    const accent = new MeshStandardMaterial({ color: 0x8a9470, metalness: 0.1, roughness: 0.7 });
    this.disposables.push(metal, polymer, accent);

    const box = (w: number, h: number, d: number, m: Material, x: number, y: number, z: number) => {
      const g = new BoxGeometry(w, h, d);
      this.disposables.push(g);
      const mesh = new Mesh(g, m);
      mesh.position.set(x, y, z);
      this.root.add(mesh);
      return mesh;
    };
    box(0.05, 0.075, 0.34, metal, 0, 0, 0); // receiver
    box(0.045, 0.06, 0.22, polymer, 0, -0.005, -0.27); // handguard
    box(0.04, 0.06, 0.2, accent, 0, -0.01, 0.26); // stock
    box(0.03, 0.05, 0.04, metal, 0, 0.06, -0.05); // rear sight
    box(0.012, 0.045, 0.012, metal, 0, 0.055, -0.36); // front sight
    box(0.028, 0.09, 0.04, polymer, 0, -0.08, 0.06).rotation.x = 0.35; // grip
    this.mag = box(0.032, 0.11, 0.055, accent, 0, -0.095, -0.07);
    this.mag.rotation.x = -0.12;
    const barrelGeo: BufferGeometry = new CylinderGeometry(0.011, 0.011, 0.3, 12);
    this.disposables.push(barrelGeo);
    const barrel = new Mesh(barrelGeo, metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.005, -0.5);
    this.root.add(barrel);

    // Muzzle flash: two crossed additive quads + a short-lived light.
    const tex = glowTexture();
    const flashMat = new MeshBasicMaterial({
      map: tex,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const quad = new PlaneGeometry(0.22, 0.22);
    this.disposables.push(tex, flashMat, quad);
    const a = new Mesh(quad, flashMat);
    const b = new Mesh(quad, flashMat);
    b.rotation.z = Math.PI / 2;
    const c = new Mesh(quad, flashMat);
    c.rotation.y = Math.PI / 2;
    this.flash.add(a, b, c, this.flashLight);
    this.flash.position.set(0, 0.005, -0.7);
    this.flash.visible = false;
    this.root.add(this.flash);

    this.root.scale.setScalar(0.85);
    this.root.position.set(REST.x, REST.y, REST.z);
    scene.add(this.root);
  }

  /** Call when a shot is fired. */
  fire(): void {
    this.kickZv += 0.9;
    this.kickRotv += 2.2;
    this.flashLeft = 0.04;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
    this.flashLight.intensity = 6;
  }

  update(dt: number, ctx: ViewModelContext): void {
    this.time += dt;

    // Damped springs for recoil.
    const k = 420;
    const damp = 30;
    this.kickZv += (-k * this.kickZ - damp * this.kickZv) * dt;
    this.kickZ += this.kickZv * dt;
    this.kickRotv += (-k * this.kickRot - damp * this.kickRotv) * dt;
    this.kickRot += this.kickRotv * dt;

    if (this.flashLeft > 0) {
      this.flashLeft -= dt;
      if (this.flashLeft <= 0) {
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      }
    }

    // Movement bob (kept subtle), scaled by speed and only on the ground.
    const moveFactor = ctx.grounded ? clamp(ctx.speed / 4, 0, 1.5) : 0;
    this.bobPhase += dt * (6 + ctx.speed * 0.9) * (moveFactor > 0 ? 1 : 0);
    const bobX = Math.sin(this.bobPhase) * 0.0045 * moveFactor;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * -0.004 * moveFactor;
    const breathe = Math.sin(this.time * 1.6) * 0.0013;

    // Look sway: the gun lags behind mouse movement, then settles.
    const targetX = clamp(-ctx.lookDx * 0.00045, -0.03, 0.03);
    const targetY = clamp(ctx.lookDy * 0.00045, -0.03, 0.03);
    const follow = 1 - Math.exp(-14 * dt);
    this.swayX += (targetX - this.swayX) * follow;
    this.swayY += (targetY - this.swayY) * follow;
    const settle = Math.exp(-7 * dt);
    this.swayX *= settle;
    this.swayY *= settle;

    // Sprint pose: lowered and canted.
    const sprintTarget = ctx.sprinting && !ctx.reloading ? 1 : 0;
    this.sprintBlend += (sprintTarget - this.sprintBlend) * (1 - Math.exp(-10 * dt));

    // Scripted reload.
    const p = ctx.reloading ? ctx.reloadProgress : 0;
    const bump = p < 0.15 ? smooth(p / 0.15) : p > 0.85 ? smooth((1 - p) / 0.15) : 1;
    let magDrop = 0;
    if (p > 0.2 && p <= 0.4) magDrop = ((p - 0.2) / 0.2) * 0.14;
    else if (p > 0.4 && p <= 0.55) magDrop = 0.14;
    else if (p > 0.55 && p <= 0.7) magDrop = (1 - (p - 0.55) / 0.15) * 0.14;
    this.mag.position.y = -0.095 - magDrop;
    this.mag.position.x = magDrop * 0.2;

    this.root.position.set(
      REST.x + bobX + this.swayX + this.sprintBlend * 0.05 + bump * -0.03 + breathe,
      REST.y + bobY + this.swayY - this.sprintBlend * 0.05 - bump * 0.07 + breathe,
      REST.z + this.kickZ * 0.05,
    );
    this.root.rotation.set(
      this.kickRot * 0.08 - this.sprintBlend * 0.35 - bump * 0.35 + this.swayY * 1.2,
      this.swayX * 1.5 + this.sprintBlend * 0.35,
      -bump * 0.55 - this.sprintBlend * 0.15,
    );
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const d of this.disposables) d.dispose();
  }
}
