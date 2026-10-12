import type { Navigate } from '../hooks/useRoute.js';
import { PageFrame } from './ui/PageFrame.js';

/**
 * The honest dead-address view (usability review #4). Before this, an unknown
 * route silently normalized onto a nearby default — garbage → `/work`,
 * `/steering/zzz` → the steering landing, a typo'd testing page → Harness —
 * so a mistyped bookmark LOOKED like a working page with the wrong content.
 *
 * The contract: PRESERVE the typed URL (no redirect fires for this panel; the
 * address stays in the bar and is echoed on the page), say plainly that no
 * page lives there, and offer the four ways out as real links.
 */

const LINKS: { label: string; path: string }[] = [
  { label: 'Home', path: '/' },
  { label: 'Everything', path: '/everything' },
  { label: 'Steering', path: '/steering' },
  { label: 'Evals', path: '/testing/evals' },
];

export function NotFoundPage({ pathname, navigate }: {
  /** The address as typed — echoed verbatim so the user sees what missed. */
  pathname: string;
  navigate: Navigate;
}): React.ReactElement {
  return (
    <PageFrame data-testid="not-found" title="Page not found" intro="The address may be mistyped, or the page may have moved.">
      <p className="wk-pg-set-path">
        Nothing lives at{' '}
        <span
          data-testid="not-found-path"
        >
          {pathname}
        </span>.
      </p>
      <nav aria-label="Places to go instead" className="flex flex-wrap items-center gap-2">
        {LINKS.map((l) => (
          <a
            key={l.path}
            data-testid="not-found-link"
            data-path={l.path}
            href={l.path}
            onClick={(e) => {
              e.preventDefault();
              navigate(l.path);
            }}
            className={l.path === '/' ? 'wk-btn wk-btn--primary' : 'wk-btn wk-btn--secondary'}
          >
            {l.label}
          </a>
        ))}
      </nav>
    </PageFrame>
  );
}
