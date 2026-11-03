import type { Vector3 } from 'three';
import { type PerspectiveCamera } from 'three';

/** Slow cinematic orbit used behind menus. Not a gameplay camera. */
export class OrbitFlyover {
  private angle = Math.PI * 0.8;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly center: Vector3,
    private readonly radius = 50,
    private readonly height = 20,
    private readonly speed = 0.04,
  ) {
    camera.fov = 45;
    camera.updateProjectionMatrix();
    this.update(0);
  }

  update(dt: number): void {
    this.angle += this.speed * dt;
    this.camera.position.set(
      this.center.x + Math.cos(this.angle) * this.radius,
      this.height,
      this.center.z + Math.sin(this.angle) * this.radius,
    );
    this.camera.lookAt(this.center);
  }
}
