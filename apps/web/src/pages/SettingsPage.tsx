import type { GraphicsQuality } from '@zhb/shared';
import { useControlMode } from '../hooks/useControlMode.ts';
import { useGraphicsQuality } from '../hooks/useGraphicsQuality.ts';
import type { ControlPref } from '../services/controls.ts';

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
  const { pref, touch, setPref } = useControlMode();
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

      <h2 className="settings-sub">Controls</h2>
      <div role="radiogroup" aria-label="Controls" className="options">
        {(
          [
            [
              'auto',
              'Automatic',
              'Touch controls on phones and tablets, keyboard and mouse elsewhere',
            ],
            ['touch', 'Touch', 'On-screen joystick and buttons'],
            [
              'desktop',
              'Keyboard and mouse',
              'WASD, mouse look (needs a mouse that can be captured)',
            ],
          ] as [ControlPref, string, string][]
        ).map(([value, label, hint]) => (
          <button
            key={value}
            role="radio"
            aria-checked={pref === value}
            className="option"
            onClick={() => setPref(value)}
          >
            <span className="action-label">{label}</span>
            <span className="action-hint">{hint}</span>
          </button>
        ))}
      </div>
      <p className="note">Currently using: {touch ? 'touch controls' : 'keyboard and mouse'}.</p>
    </main>
  );
}
