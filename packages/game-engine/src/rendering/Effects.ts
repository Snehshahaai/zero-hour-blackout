import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Scene,
} from 'three';
import type { Point3 } from '../physics/Hitscan.ts';

const DECAL_POOL = 48;
const TRACER_POOL = 12;
const SPARK_POOL = 10;

function radialTexture(inner: string, outer: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new CanvasTexture(c);
}

interface Timed {
  life: number;
  max: number;
}

/** Pooled bullet tracers, impact decals and hit sparks. No allocation during play. */
export class Effects {
  private readonly decals: Mesh[] = [];
  private nextDecal = 0;
  private readonly tracers: (Line & Timed)[] = [];
  private readonly sparks: (Sprite & Timed)[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private readonly tmp = new Vector3();

  constructor(private readonly scene: Scene) {
    const holeTex = radialTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)');
    const holeMat = new MeshBasicMaterial({
      map: holeTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    const holeGeo = new PlaneGeometry(0.14, 0.14);
    this.disposables.push(holeTex, holeMat, holeGeo);
    for (let i = 0; i < DECAL_POOL; i++) {
      const m = new Mesh(holeGeo, holeMat);
      m.visible = false;
      scene.add(m);
      this.decals.push(m);
    }

    const lineMat = new LineBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.8,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(lineMat);
    for (let i = 0; i < TRACER_POOL; i++) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(6, 3));
      this.disposables.push(g);
      const l = Object.assign(new Line(g, lineMat), { life: 0, max: 0.06 });
      l.visible = false;
      l.frustumCulled = false;
      scene.add(l);
      this.tracers.push(l);
    }

    const sparkTex = radialTexture('rgba(255,235,180,1)', 'rgba(255,140,40,0)');
    this.disposables.push(sparkTex);
    for (let i = 0; i < SPARK_POOL; i++) {
      const mat = new SpriteMaterial({
        map: sparkTex,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      });
      this.disposables.push(mat);
      const s = Object.assign(new Sprite(mat), { life: 0, max: 0.12 });
      s.visible = false;
      scene.add(s);
      this.sparks.push(s);
    }
  }

  tracer(from: Point3, to: Point3): void {
    const t = this.tracers.find((x) => !x.visible);
    if (!t) return;
    const pos = t.geometry.getAttribute('position');
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.life = t.max;
    t.visible = true;
  }

  /** `flesh` hits spark red-orange and leave no decal. */
  impact(point: Point3, normal: Point3, flesh: boolean): void {
    if (!flesh) {
      const d = this.decals[this.nextDecal];
      this.nextDecal = (this.nextDecal + 1) % DECAL_POOL;
      if (d) {
        d.position.set(
          point.x + normal.x * 0.01,
          point.y + normal.y * 0.01,
          point.z + normal.z * 0.01,
        );
        this.tmp.set(point.x + normal.x, point.y + normal.y, point.z + normal.z);
        d.lookAt(this.tmp);
        d.rotateZ(Math.random() * Math.PI);
        d.visible = true;
      }
    }
    const s = this.sparks.find((x) => !x.visible);
    if (s) {
      s.position.set(
        point.x + normal.x * 0.05,
        point.y + normal.y * 0.05,
        point.z + normal.z * 0.05,
      );
      s.material.color.setHex(flesh ? 0xff5030 : 0xffffff);
      s.life = s.max;
      s.scale.setScalar(0.3);
      s.visible = true;
    }
  }

  update(dt: number): void {
    for (const t of this.tracers) {
      if (!t.visible) continue;
      t.life -= dt;
      if (t.life <= 0) t.visible = false;
    }
    for (const s of this.sparks) {
      if (!s.visible) continue;
      s.life -= dt;
      if (s.life <= 0) s.visible = false;
      else s.scale.setScalar(0.1 + 0.25 * (s.life / s.max));
    }
  }

  dispose(): void {
    const all = [...this.decals, ...this.tracers, ...this.sparks];
    for (const o of all) this.scene.remove(o);
    for (const d of this.disposables) d.dispose();
  }
}
