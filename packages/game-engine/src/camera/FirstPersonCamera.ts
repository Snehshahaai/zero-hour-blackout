import type { PerspectiveCamera } from 'three';

const MAX_PITCH = (89 * Math.PI) / 180;

/** Yaw/pitch look + positioning. Look is applied per mouse event frame, never per physics tick. */
export class FirstPersonCamera {
  yaw = 0;
  pitch = 0;

  constructor(private readonly camera: PerspectiveCamera) {
    camera.rotation.order = 'YXZ';
  }

  /** `sensitivity` is radians per pixel. */
  look(dx: number, dy: number, sensitivity: number): void {
    this.yaw -= dx * sensitivity;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy * sensitivity));
  }

  /** `recoil` is a temporary view offset (weapon kick) layered on the player's own aim. */
  apply(x: number, y: number, z: number, recoil = { pitch: 0, yaw: 0 }): void {
    this.camera.position.set(x, y, z);
    this.camera.rotation.set(this.pitch + recoil.pitch, this.yaw + recoil.yaw, 0);
  }
}
