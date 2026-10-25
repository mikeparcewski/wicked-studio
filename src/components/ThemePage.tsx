import { AppearanceSettings } from './AppearanceSettings.js';
import { BrandLearn } from './BrandLearn.js';

/**
 * The Theme tab of the Settings page (`SettingsPage`, `/system?tab=theme`; `/theme` redirects there) —
 * the appearance customization surface (DES-VISION-001 §3). Its frame and title are the page's.
 *
 * Two sections, two authorities:
 *   - AppearanceSettings: the manual accent/logo/theme controls (untouched —
 *     crew-persisted, the appearance store's wires).
 *   - BrandLearn: "Learn from a brand" — retracted by studio#73 because its
 *     old loop rode invented routes, back now on the REAL wires
 *     (theme.requested over POST /api/events + the interactive#181 readback
 *     GET /d/:docId/api/theme/learned). It renders inert: no learn-related
 *     request leaves the page until the user acts.
 */
export function ThemeSettings(): React.ReactElement {
  return (
    <div className="wk-pg-set-content">
      <AppearanceSettings />
      <BrandLearn />
    </div>
  );
}
