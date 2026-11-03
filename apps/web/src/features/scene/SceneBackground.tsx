import { createMapPreview, type MapPreview } from '@zhb/game-engine';
import { isWebGL2Supported } from '@zhb/game-engine/detect';
import { useEffect, useRef, useState } from 'react';
import { useGraphicsQuality } from '../../hooks/useGraphicsQuality.ts';

type Phase =
  | { kind: 'loading'; fraction: number; label: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

const SUPPORTED = isWebGL2Supported();

/**
 * Hosts the 3D menu background. React only mounts/unmounts the canvas and shows load state;
 * all rendering happens in the engine's own loop.
 */
export function SceneBackground({ active }: { active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<MapPreview | null>(null);
  const [quality] = useGraphicsQuality();
  const initialQuality = useRef(quality);
  const [phase, setPhase] = useState<Phase>(
    SUPPORTED
      ? { kind: 'loading', fraction: 0, label: 'Starting renderer' }
      : { kind: 'error', message: 'WebGL2 is not available in this browser.' },
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !SUPPORTED) return;
    // A fresh canvas per effect run: a disposed renderer force-loses its context, which would
    // otherwise kill the canvas reused by a StrictMode remount.
    const canvas = document.createElement('canvas');
    canvas.className = 'scene-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    let cancelled = false;
    createMapPreview(canvas, initialQuality.current, (fraction, label) => {
      if (!cancelled) setPhase({ kind: 'loading', fraction, label });
    })
      .then((p) => {
        if (cancelled) return p.dispose();
        previewRef.current = p;
        setPhase({ kind: 'ready' });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setPhase({
            kind: 'error',
            message: e instanceof Error ? e.message : 'Renderer failed to start',
          });
      });
    return () => {
      cancelled = true;
      previewRef.current?.dispose();
      previewRef.current = null;
      canvas.remove();
    };
  }, []);

  useEffect(() => previewRef.current?.setQuality(quality), [quality, phase.kind]);
  useEffect(() => previewRef.current?.setActive(active), [active, phase.kind]);

  return (
    <>
      <div ref={hostRef} className="scene-host" />
      {phase.kind === 'loading' && (
        <div
          className="loading"
          role="progressbar"
          aria-valuenow={Math.round(phase.fraction * 100)}
        >
          <span className="loading-label">{phase.label.toUpperCase()}</span>
          <span className="loading-bar">
            <span style={{ width: `${phase.fraction * 100}%` }} />
          </span>
        </div>
      )}
      {phase.kind === 'error' && (
        <div className="scene-error">3D background unavailable: {phase.message}</div>
      )}
    </>
  );
}
