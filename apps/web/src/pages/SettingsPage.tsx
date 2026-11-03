import type { GraphicsQuality } from '@zhb/shared';
import { useGraphicsQuality } from '../hooks/useGraphicsQuality.ts';

const OPTIONS: { value: GraphicsQuality; label: string; hint: string }[] = [
  { value: 'low', label: 'Low', hint: 'No shadows, 2 interior lights, 1x resolution' },
  {
    value: 'medium',
    label: 'Medium',
    hint: 'Soft shadows (1024), 4 interior lights, up to 1.5x resolution',
  },
  { value: 'high', label: 'High', hint: 'Shadows (2048), 8 interior lights, up to 2x resolution' },
];

export function SettingsPage() {
  const [quality, setQuality] = useGraphicsQuality();
  return (
    <main className="panel">
      <p className="eyebrow">SETTINGS</p>
      <h2>Graphics</h2>
      <div role="radiogroup" aria-label="Graphics quality" className="options">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={quality === o.value}
            className="option"
            onClick={() => setQuality(o.value)}
          >
            <span className="action-label">{o.label}</span>
            <span className="action-hint">{o.hint}</span>
          </button>
        ))}
      </div>
      <p className="note">Anti-aliasing is fixed when the game starts; reload to change it.</p>
    </main>
  );
}
