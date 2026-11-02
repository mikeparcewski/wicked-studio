import { BrandLearn } from '../BrandLearn.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useFirstRun } from '../../store/firstRun.js';

/**
 * Brand (DES-LEARN §3.4): learn studio's colours from the person's website, a brand PDF or an image, preview
 * them on the whole page, then apply. BrandLearn moved here unchanged in its wires; Settings → Theme keeps the
 * manual colour wheel, logo and site name, and links here. Applying a brand counts as using Learn (§3.0).
 */
export function BrandTab({ navigate, initialUrl }: { navigate: Navigate; initialUrl?: string }): React.ReactElement {
  return (
    <div data-testid="brand-tab" className="wk-learn-brand">
      <BrandLearn onApplied={() => void useFirstRun.getState().markLearnUsed()} {...(initialUrl !== undefined ? { initialUrl } : {})} />
      <p className="wk-learn-quiet" data-testid="brand-theme-link">
        Prefer to pick colours yourself? <a className="wk-link" href="/system?tab=theme" onClick={(e) => { e.preventDefault(); navigate('/system?tab=theme'); }}>Settings → Theme</a> has the manual colour wheel, logo and site name.
      </p>
    </div>
  );
}
