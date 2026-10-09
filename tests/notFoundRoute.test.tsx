import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { parseRoute, useRoute } from '../src/hooks/useRoute.js';
import { movedAddress } from '../src/hooks/useMovedRoutes.js';
import { NotFoundPage } from '../src/components/NotFoundPage.js';

/**
 * Usability review #4 (live-verified): unknown routes silently normalized onto
 * a nearby default — garbage → `/work`, `/steering/zzz` → the landing, a
 * typo'd testing page → Harness — so a mistyped bookmark LOOKED like a working
 * page with the wrong content. The contract now:
 *
 *  - an address matching NO page parses to the `not-found` panel;
 *  - NO redirect fires for it (the typed URL is preserved);
 *  - the view echoes the address and links Home / Work / Steering / Testing;
 *  - the RETIRED addresses (wiki/rules/policies, coverage/domain, flat
 *    campaigns, the bare /runs listing) KEEP their redirects — those are
 *    moves with a known destination, not typos.
 */

function routeAt(path: string) {
  window.history.replaceState(null, '', path);
  return renderHook(() => useRoute()).result;
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('useRoute — dead addresses parse to the not-found panel', () => {
  it('a garbage top-level route is not-found — never the runs panel (which redirected to /work)', () => {
    expect(routeAt('/zzzgarbage').current.panel).toBe('not-found');
    expect(routeAt('/definitely-not-a-page').current.panel).toBe('not-found');
  });

  it('a garbage route with a second segment is not-found — never a fabricated run id', () => {
    const r = routeAt('/garbage/xyz').current;
    expect(r.panel).toBe('not-found');
    expect(r.runId).toBeNull();
  });

  it('typo’d steering and testing SUB-routes are not-found', () => {
    expect(routeAt('/steering/zzz').current.panel).toBe('not-found');
    expect(routeAt('/testing/harnes').current.panel).toBe('not-found');
    expect(routeAt('/testing/evalss').current.panel).toBe('not-found');
  });

  it('every real page still parses to itself', () => {
    expect(routeAt('/').current.panel).toBe('home');
    expect(routeAt('/work').current.panel).toBe('everything'); // moved onto /everything (S15c)
    expect(routeAt('/execute').current.panel).toBe('everything'); // moved (S15c)
    expect(routeAt('/vibe').current.panel).toBe('everything'); // moved (S15c)
    expect(routeAt('/demo').current.panel).toBe('everything'); // moved (S15c)
    expect(routeAt('/everything').current.panel).toBe('everything');
    expect(routeAt('/steering').current.panel).toBe('steering');
    expect(routeAt('/steering/security').current.panel).toBe('steering');
    expect(routeAt('/skills').current.panel).toBe('skills');
    expect(routeAt('/testing/harness').current.panel).toBe('testing');
    // S16a-2d: /runs/:id moved — it parses straight to the run's session thread.
    expect(routeAt('/runs/r-1').current).toMatchObject({ panel: 'session', artifactId: 'run:r-1' });
    expect(routeAt('/runs/new').current).toMatchObject({ panel: 'runs', showLaunch: true });
  });

  it('the retired addresses still parse to their destinations (moves, not typos)', () => {
    expect(routeAt('/runs').current.panel).toBe('everything'); // → /everything?tab=sessions via useMovedRoutes (S15c)
    expect(routeAt('/make').current.panel).toBe('everything'); // → /everything?tab=sessions via useMovedRoutes
    expect(routeAt('/wiki').current.panel).toBe('steering');
    expect(routeAt('/coverage').current.panel).toBe('system');
    expect(routeAt('/campaigns').current).toMatchObject({ panel: 'testing', testingPage: 'campaigns' });
    expect(routeAt('/testing').current).toMatchObject({ panel: 'testing', testingPage: null });
  });
});

describe('the not-found panel never redirects — the typed URL is preserved', () => {
  it('a typo is never a move: /runs/r1/zzz and /p/kes/bogus parse to not-found and move nowhere', () => {
    // S16a-2d: the legacy run filing (useLegacyRedirect) is gone; moves are the useMovedRoutes table.
    for (const typo of ['/runs/r1/zzz', '/runs//x', '/p/kes/bogus']) {
      expect(parseRoute(typo).panel, typo).toBe('not-found');
      expect(movedAddress(typo, ''), typo).toBeNull();
    }
  });
});

describe('NotFoundPage — the honest dead-address view', () => {
  it('echoes the typed address verbatim and says nothing lives there', () => {
    render(<NotFoundPage pathname="/steering/zzz" navigate={() => {}} />);
    expect(screen.getByTestId('not-found')).toHaveTextContent('Page not found');
    expect(screen.getByTestId('not-found-path')).toHaveTextContent('/steering/zzz');
  });

  it('offers Home / Work / Steering / Testing as real links that navigate', () => {
    const navigate = vi.fn();
    render(<NotFoundPage pathname="/zzz" navigate={navigate} />);
    const links = screen.getAllByTestId('not-found-link');
    expect(links.map((l) => l.getAttribute('data-path'))).toEqual([
      '/', '/everything', '/steering', '/testing/campaigns',
    ]);
    // Real hrefs (middle-click / copy-link work) AND SPA navigation on click.
    expect(links[1]).toHaveAttribute('href', '/everything');
    fireEvent.click(links[2]!);
    expect(navigate).toHaveBeenCalledWith('/steering');
  });
});
