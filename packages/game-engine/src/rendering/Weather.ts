import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  FogExp2,
  LineBasicMaterial,
  LineSegments,
  type Scene,
} from 'three';
import type { Weather as WeatherKind } from '@zhb/shared';
import type { Point3 } from '../physics/Hitscan.ts';

const FOG_DENSITY: Record<WeatherKind, number> = { clear: 0.012, fog: 0.045, rain: 0.016 };
/** Fog weather is a pale haze (not just darker), so it is actually noticeable. */
const FOG_COLOR: Record<WeatherKind, number> = { clear: 0x080a0d, fog: 0x56606c, rain: 0x0c1015 };
const FALL_SPEED = 17;
const BOX = 26; // half-width of the rain volume around the camera
const HEIGHT = 16;

/**
 * Server-synchronised weather (cosmetic only, never gameplay-affecting): fog density and a
 * pooled rain streak field that follows the camera and only shows when you are outdoors.
 * Fog is capped so sightlines on this compact map are never meaningfully reduced.
 */
export class Weather {
  private kind: WeatherKind = 'clear';
  private readonly tmpColor = new Color();
  private lines: LineSegments | null = null;
  private pos: Float32Array = new Float32Array(0);
  private drops = 0;
  private readonly mat = new LineBasicMaterial({
    color: 0xb8c8e0,
    transparent: true,
    opacity: 0.32,
    blending: AdditiveBlending,
    depthWrite: false,
  });

  constructor(private readonly scene: Scene) {}

  /** `dropCount` comes from the graphics preset (0 disables the streaks). */
  set(kind: WeatherKind, dropCount: number): void {
    this.kind = kind;
    this.clearRain();
    if (kind === 'rain' && dropCount > 0) {
      this.drops = dropCount;
      this.pos = new Float32Array(dropCount * 6);
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(this.pos, 3));
      this.lines = new LineSegments(geo, this.mat);
      this.lines.frustumCulled = false;
      this.lines.visible = false;
      this.scene.add(this.lines);
      for (let i = 0; i < dropCount; i++) this.respawn(i, { x: 0, y: 0, z: 0 }, true);
    }
  }

  get weather(): WeatherKind {
    return this.kind;
  }

  update(dt: number, cam: Point3, outdoors: boolean): void {
    const fog = this.scene.fog;
    if (fog instanceof FogExp2) {
      const target = FOG_DENSITY[this.kind];
      const k = Math.min(1, dt * 0.8);
      fog.density += (target - fog.density) * k;
      fog.color.lerp(this.tmpColor.setHex(FOG_COLOR[this.kind]), k);
    }
    const lines = this.lines;
    if (!lines) return;
    lines.visible = outdoors;
    if (!outdoors) return;
    for (let i = 0; i < this.drops; i++) {
      const o = i * 6;
      const y = (this.pos[o + 1] as number) - FALL_SPEED * dt;
      if (
        y < cam.y - 2 ||
        Math.abs((this.pos[o] as number) - cam.x) > BOX ||
        Math.abs((this.pos[o + 2] as number) - cam.z) > BOX
      ) {
        this.respawn(i, cam, false);
        continue;
      }
      this.pos[o + 1] = y;
      this.pos[o + 4] = y + 0.55;
    }
    lines.geometry.getAttribute('position').needsUpdate = true;
  }

  private respawn(i: number, cam: Point3, anywhere: boolean): void {
    const o = i * 6;
    const x = cam.x + (Math.random() * 2 - 1) * BOX;
    const z = cam.z + (Math.random() * 2 - 1) * BOX;
    const y = cam.y + (anywhere ? Math.random() * HEIGHT : HEIGHT * (0.7 + Math.random() * 0.3));
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.pos[o + 3] = x;
    this.pos[o + 4] = y + 0.55;
    this.pos[o + 5] = z;
  }

  private clearRain(): void {
    if (!this.lines) return;
    this.scene.remove(this.lines);
    this.lines.geometry.dispose();
    this.lines = null;
  }

  dispose(): void {
    this.clearRain();
    this.mat.dispose();
  }
}
