import type { GraphicsQuality } from '@zhb/shared';

export interface QualitySettings {
  /** Upper bound for devicePixelRatio; the biggest GPU-cost lever on high-DPI screens. */
  maxPixelRatio: number;
  /** 0 disables shadow maps. */
  shadowMapSize: number;
  anisotropy: number;
  /** How many of the map's interior point lights are enabled. */
  maxPointLights: number;
  /** Only applied when the renderer is created (needs a new context to change). */
  antialias: boolean;
}

export const QUALITY_PRESETS: Record<GraphicsQuality, QualitySettings> = {
  low: { maxPixelRatio: 1, shadowMapSize: 0, anisotropy: 1, maxPointLights: 2, antialias: false },
  medium: {
    maxPixelRatio: 1.5,
    shadowMapSize: 1024,
    anisotropy: 4,
    maxPointLights: 4,
    antialias: true,
  },
  high: {
    maxPixelRatio: 2,
    shadowMapSize: 2048,
    anisotropy: 8,
    maxPointLights: 8,
    antialias: true,
  },
};
