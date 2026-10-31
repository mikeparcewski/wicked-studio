import { AppearanceSettings } from './AppearanceSettings.js';

/**
 * The Theme tab of the Settings page (`SettingsPage`, `/system?tab=theme`; `/theme` redirects there) —
 * the appearance customization surface (DES-VISION-001 §3). Its frame and title are the page's.
 *
 * Two sections, two authorities:
 *   - AppearanceSettings: the manual accent/logo/theme controls (untouched —
 *     crew-persisted, the appearance store's wires).
 *   - A link to Learn → Brand (program DES-LEARN §3.4), where "Learn from a
 *     brand" (BrandLearn, on the theme.requested + interactive#181 readback
 *     wires) now lives.
 */
export function ThemeSettings({ navigate }: { navigate?: (path: string) => void } = {}): React.ReactElement {
  return (
    <div className="wk-pg-set-content">
      <AppearanceSettings />
      {/* DES-LEARN §3.4: learning colours from a brand moved to Learn → Brand; the manual controls stay here. */}
      <p className="wk-field-note" data-testid="theme-brand-link">
        Want studio in your brand’s colours? <a className="wk-link" href="/learn?tab=brand" data-testid="theme-learn-brand"
          onClick={(e) => { if (navigate !== undefined) { e.preventDefault(); navigate('/learn?tab=brand'); } }}>Learn → Brand</a> reads them from your website, a PDF or an image.
      </p>
    </div>
  );
}
