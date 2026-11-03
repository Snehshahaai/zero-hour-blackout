import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import type { GraphicsQuality } from '@zhb/shared';
import { QUALITY_PRESETS, type QualitySettings } from './quality.ts';

/**
 * Owns the canvas, WebGL renderer, scene, camera and global lighting.
 * It is independent from React and from any particular map or game mode.
 */
export class GameRenderer {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(70, 1, 0.1, 400);
  /** Second pass for the first-person weapon: drawn after a depth clear so it never clips into walls. */
  readonly viewScene = new Scene();
  readonly viewCamera = new PerspectiveCamera(58, 1, 0.01, 10);
  viewModelVisible = false;
  readonly renderer: WebGLRenderer;
  readonly sun: DirectionalLight;
  private settings: QualitySettings;
  private readonly observer: ResizeObserver;
  private width = 0;
  private height = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    quality: GraphicsQuality,
  ) {
    this.settings = QUALITY_PRESETS[quality];
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: this.settings.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.scene.background = new Color(0x080a0d);
    this.scene.fog = new FogExp2(0x080a0d, 0.012);

    this.scene.add(new HemisphereLight(0x8aa0c0, 0x30302c, 1.1));
    this.viewScene.add(new HemisphereLight(0xa8b8d0, 0x302c28, 1.6));
    const keyLight = new DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(0.4, 1, 0.6);
    this.viewScene.add(keyLight);

    // Cold moonlight key light; its shadow frustum covers the whole (compact) map.
    this.sun = new DirectionalLight(0x9db4d8, 1.4);
    this.sun.position.set(20, 50, -10);
    this.sun.target.position.set(32, 0, 20);
    const sc = this.sun.shadow.camera;
    sc.left = -45;
    sc.right = 45;
    sc.top = 35;
    sc.bottom = -35;
    sc.near = 1;
    sc.far = 120;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.setQuality(quality);
    this.resize();
  }

  get quality(): QualitySettings {
    return this.settings;
  }

  setQuality(q: GraphicsQuality): void {
    this.settings = { ...QUALITY_PRESETS[q], antialias: this.settings.antialias };
    const shadows = this.settings.shadowMapSize > 0;
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(this.settings.shadowMapSize, this.settings.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.maxPixelRatio));
    this.resize(true);
  }

  /** Re-reads the canvas CSS size. Called automatically via ResizeObserver. */
  resize(force = false): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    if (!force && w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
  }

  render(): void {
    const r = this.renderer;
    r.autoClear = false;
    r.clear();
    r.render(this.scene, this.camera);
    if (this.viewModelVisible) {
      r.clearDepth();
      r.render(this.viewScene, this.viewCamera);
    }
  }

  dispose(): void {
    this.observer.disconnect();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
