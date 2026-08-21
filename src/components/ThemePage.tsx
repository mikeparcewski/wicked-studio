import { AppearanceSettings } from './AppearanceSettings.js';

/**
 * The dedicated Theme page (/theme) — a first-class home for the appearance
 * customization surface and brand-learn flow (DES-VISION-001 §3–§4), moved off
 * the system/settings page so theming gets the room it deserves.
 */
export function ThemePage(): React.ReactElement {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--ink-high)' }}>Theme</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--ink-muted)' }}>
          Appearance, accent, and brand identity — persisted per-install.
        </p>
      </div>
      <AppearanceSettings />
    </div>
  );
}
