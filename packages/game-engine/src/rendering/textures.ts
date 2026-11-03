import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

/** Small deterministic PRNG so textures look identical on every load. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return [c, ctx];
}

function toTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Speckled, stained concrete. `base` is a grey level 0-255. */
export function concreteTexture(base: number, seed: number): CanvasTexture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size);
  const r = rng(seed);
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    const v = base + (r() - 0.5) * 50;
    ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
    ctx.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2);
  }
  for (let i = 0; i < 14; i++) {
    const g = ctx.createRadialGradient(
      r() * size,
      r() * size,
      0,
      r() * size,
      r() * size,
      30 + r() * 50,
    );
    g.addColorStop(0, 'rgba(20,20,20,0.12)');
    g.addColorStop(1, 'rgba(20,20,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return toTexture(canvas);
}

/** Brushed/corrugated metal: vertical streaks plus ribs. */
export function metalTexture(base: number, seed: number): CanvasTexture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size);
  const r = rng(seed);
  ctx.fillStyle = `rgb(${base},${base + 4},${base + 8})`;
  ctx.fillRect(0, 0, size, size);
  for (let x = 0; x < size; x++) {
    const v = (r() - 0.5) * 36;
    ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(0,0,0,${-v / 255})`;
    ctx.fillRect(x, 0, 1, size);
  }
  for (let x = 0; x < size; x += 32) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x, 0, 2, size);
  }
  return toTexture(canvas);
}
