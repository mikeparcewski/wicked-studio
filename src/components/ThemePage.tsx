import { AppearanceSettings } from './AppearanceSettings.js';
import { BrandLearn } from './BrandLearn.js';
import { PageFrame } from './ui/PageFrame.js';

/**
 * The dedicated Theme page (/theme) — a first-class home for the appearance
 * customization surface (DES-VISION-001 §3), moved off the system/settings
 * page so theming gets the room it deserves.
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
export function ThemePage(): React.ReactElement {
  return (
    <PageFrame width="narrow" title="Theme" intro="Choose the colors and branding for your workspace.">
      <div className="wk-pg-set-content">
      <AppearanceSettings />
      <BrandLearn />
      </div>
    </PageFrame>
  );
}
