import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { parseRoute, RETIRED_ADDRESSES, useRoute } from '../src/hooks/useRoute.js';
import { ROUTE_SHAPES } from '../src/palette/routeTargets.js';
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
 *  - the steering / settings / testing normalizers (wiki/policies,
 *    coverage/domain, flat campaigns) keep their redirects;
 *  - X1 (operator ruling 2026-10-09, "we should just remove these"): the S15c / S16a
 *    MOVED addresses no longer redirect — each parses to not-found.
 */

/** The X1 list as ruled (COVERAGE-EXCEPTIONS X1), spelled out so the table below cannot shrink. */
const X1_RULED = [
  '/projects', '/chats', '/work', '/work?filter=active', '/execute', '/vibe', '/demo', '/make', '/runs',
  '/runs/r1', '/runs/r1/timeline', '/p/kes', '/p/kes/chronicle',
  '/p/kes/build', '/p/kes/build/new', '/p/kes/build/r1',
  '/p/kes/document', '/p/kes/document/d1', '/p/kes/video', '/p/kes/video/r1',
  '/chat/c1', '/chat/new', '/p/kes/chat', '/p/kes/chat/r1', '/p/kes/campaigns',
];

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
    expect(routeAt('/everything').current.panel).toBe('everything');
    expect(routeAt('/steering').current.panel).toBe('steering');
    expect(routeAt('/steering/security').current.panel).toBe('steering');
    expect(routeAt('/skills').current.panel).toBe('skills');
    expect(routeAt('/testing/harness').current.panel).toBe('testing');
    expect(routeAt('/runs/new').current).toMatchObject({ panel: 'runs', showLaunch: true });
    expect(routeAt('/runs/r-1/events').current).toMatchObject({ panel: 'run-events', artifactId: 'r-1' });
    expect(routeAt('/runs/r-1/files').current).toMatchObject({ panel: 'run-files', artifactId: 'r-1' });
    expect(routeAt('/projects/kes').current).toMatchObject({ panel: 'project-detail', projectId: 'kes' });
    expect(routeAt('/testing/campaigns').current).toMatchObject({ panel: 'testing', testingPage: 'campaigns' });
    // Every shape the router serves (the palette's route table) still parses to its panel.
    for (const shape of ROUTE_SHAPES) expect(shape.is(parseRoute(shape.example)), `${shape.id} ← ${shape.example}`).toBe(true);
  });

  it('the steering / settings / testing normalizers still parse to their destinations', () => {
    expect(routeAt('/wiki').current.panel).toBe('steering');
    expect(routeAt('/coverage').current.panel).toBe('system');
    expect(routeAt('/campaigns').current).toMatchObject({ panel: 'testing', testingPage: 'campaigns' });
    expect(routeAt('/testing').current).toMatchObject({ panel: 'testing', testingPage: null });
  });
});

describe('X1 — the moved addresses are retired: each parses to not-found', () => {
  it('every address in the RETIRED_ADDRESSES table is not-found', () => {
    for (const a of RETIRED_ADDRESSES) {
      const path = a.replace(/:id/g, 'x1');
      expect(parseRoute(path).panel, path).toBe('not-found');
    }
  });

  it('the table covers every address the operator ruled on', () => {
    const shapes = RETIRED_ADDRESSES.map((a) => new RegExp(`^${a.replace(/:id/g, '[^/]+')}$`));
    for (const a of X1_RULED) {
      const path = a.split('?')[0]!;
      expect(shapes.some((re) => re.test(path)), a).toBe(true);
      expect(routeAt(a).current.panel, a).toBe('not-found');
    }
  });

  it('a typo near a retired address is not-found too', () => {
    for (const typo of ['/runs/r1/zzz', '/runs//x', '/p/kes/bogus', '/p', '/chat']) {
      expect(parseRoute(typo).panel, typo).toBe('not-found');
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
