import type { Navigate } from '../hooks/useRoute.js';

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
  { label: 'Work', path: '/work' },
  { label: 'Steering', path: '/steering' },
  { label: 'Testing', path: '/testing/campaigns' },
];

export function NotFoundPage({ pathname, navigate }: {
  /** The address as typed — echoed verbatim so the user sees what missed. */
  pathname: string;
  navigate: Navigate;
}): React.ReactElement {
  return (
    <div data-testid="not-found" className="flex max-w-xl flex-col gap-3 p-8">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)', margin: 0 }}>
        Page not found
      </h2>
      <p className="text-xs" style={{ color: 'var(--ink-muted)', margin: 0 }}>
        Nothing lives at{' '}
        <code
          data-testid="not-found-path"
          className="rounded px-1 py-0.5 font-mono text-[11px]"
          style={{ background: 'var(--surface-raised)', color: 'var(--ink-high)' }}
        >
          {pathname}
        </code>
        . The address may be mistyped, or the page it named may have moved.
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
            className="rounded px-2.5 py-1 text-[11px] font-semibold"
            style={{
              color: 'var(--ink-high)',
              border: '1px solid var(--surface-raised)',
              background: 'var(--surface-rail)',
              textDecoration: 'none',
            }}
          >
            {l.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
