import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useRoute } from '../src/hooks/useRoute.js';
import { useLegacyRedirect } from '../src/hooks/useLegacyRedirect.js';
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
    expect(routeAt('/work').current.panel).toBe('work');
    expect(routeAt('/make').current.panel).toBe('make');
    expect(routeAt('/steering').current.panel).toBe('steering');
    expect(routeAt('/steering/security').current.panel).toBe('steering');
    expect(routeAt('/testing/harness').current.panel).toBe('testing');
    expect(routeAt('/runs/r-1').current).toMatchObject({ panel: 'runs', runId: 'r-1' });
    expect(routeAt('/runs/new').current).toMatchObject({ panel: 'runs', showLaunch: true });
  });

  it('the retired addresses still parse to their destinations (moves, not typos)', () => {
    expect(routeAt('/runs').current.panel).toBe('runs'); // → /work via useLegacyRedirect
    expect(routeAt('/wiki').current.panel).toBe('steering');
    expect(routeAt('/coverage').current.panel).toBe('system');
    expect(routeAt('/campaigns').current).toMatchObject({ panel: 'testing', testingPage: 'campaigns' });
    expect(routeAt('/testing').current).toMatchObject({ panel: 'testing', testingPage: null });
  });
});

describe('the not-found panel never redirects — the typed URL is preserved', () => {
  it('useLegacyRedirect leaves a not-found route alone', () => {
    const navigate = vi.fn();
    renderHook(() =>
      useLegacyRedirect(
        { panel: 'not-found', runId: null, projectId: null, mode: null, showLaunch: false, chatMode: false },
        navigate,
      ),
    );
    expect(navigate).not.toHaveBeenCalled();
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
      '/', '/work', '/steering', '/testing/harness',
    ]);
    // Real hrefs (middle-click / copy-link work) AND SPA navigation on click.
    expect(links[1]).toHaveAttribute('href', '/work');
    fireEvent.click(links[2]!);
    expect(navigate).toHaveBeenCalledWith('/steering');
  });
});
