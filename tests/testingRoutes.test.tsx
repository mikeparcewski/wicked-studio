import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRoute } from '../src/hooks/useRoute.js';
import { useTestingRedirect } from '../src/hooks/useLegacyRedirect.js';
import { TESTING_PAGES } from '../src/api/testing.js';

/**
 * The Testing routes (the testing wave; landing re-aimed by the testing-UX wave):
 *  - `/testing/:page` parses to the testing panel for each sub-page (campaigns / evals),
 *    with `/testing/campaigns/:id` carrying the campaign label;
 *  - the RETIRED flat campaign addresses `/campaigns` and `/campaigns/:id` (the campaign
 *    surface MOVED under Testing) parse to the SAME testing panel — kept routable, then
 *    REPLACED by `useTestingRedirect` with the `/testing/campaigns[...]` spelling, the id
 *    riding along so a bookmarked scoreboard lands on the same campaign;
 *  - a page-less `/testing` — the bare parent AND the RETIRED `/testing/harness` (the
 *    Harness folded into the Campaigns landing's creation verbs) — normalizes onto the
 *    Campaigns landing: campaigns IS /testing's home;
 *  - a valid new-spelling address never redirects.
 */

function routeAt(path: string) {
  window.history.replaceState(null, '', path);
  return renderHook(() => useRoute()).result;
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useRoute — /testing/:page', () => {
  it('parses every testing sub-page to the one testing panel', () => {
    for (const p of TESTING_PAGES) {
      const r = routeAt(`/testing/${p}`).current;
      expect(r.panel).toBe('testing');
      expect(r.testingPage).toBe(p);
      // No run-selected machinery ever fires against a testing address.
      expect(r.runId).toBeNull();
      expect(r.projectId).toBeNull();
    }
  });

  it('parses /testing/campaigns/:id with the campaign label, decoded', () => {
    const r = routeAt('/testing/campaigns/DES%20MERGE').current;
    expect(r.panel).toBe('testing');
    expect(r.testingPage).toBe('campaigns');
    expect(r.campaignId).toBe('DES MERGE');
  });

  it('a bare /testing parses with testingPage null (the redirect normalizes it onto the Campaigns landing)', () => {
    expect(routeAt('/testing').current).toMatchObject({ panel: 'testing', testingPage: null });
  });

  it('the RETIRED /testing/harness parses to the testing panel (a move, not a typo) — page null, redirect lands it', () => {
    expect(routeAt('/testing/harness').current).toMatchObject({ panel: 'testing', testingPage: null });
  });

  it('an unknown testing sub-page is a DEAD address — not-found, never a silent landing (review #4)', () => {
    expect(routeAt('/testing/bogus').current).toMatchObject({ panel: 'not-found' });
    expect(routeAt('/testing/harnes').current).toMatchObject({ panel: 'not-found' });
  });

  it('the retired flat /campaigns addresses fold into the testing panel, campaign id intact', () => {
    expect(routeAt('/campaigns').current).toMatchObject({
      panel: 'testing',
      testingPage: 'campaigns',
      campaignId: null,
    });
    expect(routeAt('/campaigns/c-42').current).toMatchObject({
      panel: 'testing',
      testingPage: 'campaigns',
      campaignId: 'c-42',
    });
  });

  it('every other route spells testingPage null without claiming the testing panel', () => {
    const r = routeAt('/work').current;
    expect(r.panel).toBe('work');
    expect(r.testingPage).toBeNull();
  });
});

describe('useTestingRedirect', () => {
  it('REPLACES a page-less testing address with the Campaigns landing', () => {
    const navigate = vi.fn();
    renderHook(() => useTestingRedirect('testing', null, '/testing', navigate));
    expect(navigate).toHaveBeenCalledWith('/testing/campaigns', { replace: true });
  });

  it('REPLACES the retired /testing/harness with the Campaigns landing (the folded-in Harness)', () => {
    const navigate = vi.fn();
    renderHook(() => useTestingRedirect('testing', null, '/testing/harness', navigate));
    expect(navigate).toHaveBeenCalledWith('/testing/campaigns', { replace: true });
  });

  it('REWRITES the retired flat campaign addresses onto /testing/campaigns, tail intact', () => {
    const navigate = vi.fn();
    renderHook(() => useTestingRedirect('testing', 'campaigns', '/campaigns', navigate));
    expect(navigate).toHaveBeenCalledWith('/testing/campaigns', { replace: true });

    navigate.mockClear();
    renderHook(() => useTestingRedirect('testing', 'campaigns', '/campaigns/c-42', navigate));
    expect(navigate).toHaveBeenCalledWith('/testing/campaigns/c-42', { replace: true });
  });

  it('leaves a valid new-spelling address alone, and every non-testing panel alone', () => {
    const navigate = vi.fn();
    renderHook(() => useTestingRedirect('testing', 'evals', '/testing/evals', navigate));
    renderHook(() => useTestingRedirect('testing', 'campaigns', '/testing/campaigns/c-42', navigate));
    renderHook(() => useTestingRedirect('steering', null, '/steering', navigate));
    expect(navigate).not.toHaveBeenCalled();
  });
});
