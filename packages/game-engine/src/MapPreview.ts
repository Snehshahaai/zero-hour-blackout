import { Vector3 } from 'three';
import type { GraphicsQuality } from '@zhb/shared';
import { OrbitFlyover } from './camera/OrbitFlyover.ts';
import { GameRenderer } from './rendering/GameRenderer.ts';
import { GameLoop } from './systems/GameLoop.ts';
import { buildMap, type BuiltMap, type ProgressFn } from './world/buildMap.ts';
import { MAP_01 } from './world/map01.ts';

export interface MapPreview {
  setQuality(q: GraphicsQuality): void;
  /** Pause/resume rendering (e.g. when the menu background is not visible). */
  setActive(active: boolean): void;
  dispose(): void;
}

/** Menu-background scene: Map 01 seen from a slow orbit with the roofs cut away. */
export async function createMapPreview(
  canvas: HTMLCanvasElement,
  quality: GraphicsQuality,
  onProgress?: ProgressFn,
): Promise<MapPreview> {
  const gr = new GameRenderer(canvas, quality);
  let map: BuiltMap;
  try {
    map = await buildMap(MAP_01, gr.quality, onProgress);
  } catch (e) {
    gr.dispose();
    throw e;
  }
  gr.scene.add(map.root);
  map.roofs.forEach((r) => (r.visible = false));

  const { bounds } = MAP_01;
  const center = new Vector3((bounds.minX + bounds.maxX) / 2, 1, (bounds.minZ + bounds.maxZ) / 2);
  const flyover = new OrbitFlyover(gr.camera, center);
  const loop = new GameLoop({
    update: (dt) => flyover.update(dt),
    render: () => gr.render(),
  });
  loop.start();

  return {
    setQuality(q) {
      gr.setQuality(q);
      map.setAnisotropy(gr.quality.anisotropy);
      map.setPointLightCount(gr.quality.maxPointLights);
    },
    setActive(active) {
      if (active) loop.start();
      else loop.stop();
    },
    dispose() {
      loop.stop();
      gr.scene.remove(map.root);
      map.dispose();
      gr.dispose();
    },
  };
}
