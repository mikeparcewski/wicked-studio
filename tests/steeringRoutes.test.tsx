import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRoute } from '../src/hooks/useRoute.js';
import { useSteeringRedirect } from '../src/hooks/useLegacyRedirect.js';
import { STEERING_TYPES } from '../src/api/steering.js';

/**
 * The Steering routes (the STEERING program):
 *  - `/steering/:type` parses to the steering panel for each of the seven types;
 *  - the RETIRED addresses `/wiki` (the old Architecture Wiki page) and `/rules` (the old
 *    RuleManager) parse to the steering panel with a null type — kept routable, then REPLACED
 *    by `useSteeringRedirect` with the Architecture page's real URL, so bookmarks land on the
 *    surface that replaced both;
 *  - a bare or typo'd `/steering` address normalizes the same way;
 *  - a VALID type never redirects.
 */

function routeAt(path: string) {
  window.history.replaceState(null, '', path);
  return renderHook(() => useRoute()).result;
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useRoute — /steering/:type', () => {
  it('parses every steering type to the one steering panel', () => {
    for (const t of STEERING_TYPES) {
      const r = routeAt(`/steering/${t}`).current;
      expect(r.panel).toBe('steering');
      expect(r.steeringType).toBe(t);
      // No run-selected machinery ever fires against a steering address.
      expect(r.runId).toBeNull();
      expect(r.projectId).toBeNull();
    }
  });

  it('a bare or unknown-type /steering parses with steeringType null (the redirect normalizes it)', () => {
    expect(routeAt('/steering').current).toMatchObject({ panel: 'steering', steeringType: null });
    expect(routeAt('/steering/bogus').current).toMatchObject({ panel: 'steering', steeringType: null });
  });

  it('the retired /wiki and /rules addresses fold into the steering panel', () => {
    expect(routeAt('/wiki').current).toMatchObject({ panel: 'steering', steeringType: null });
    expect(routeAt('/rules').current).toMatchObject({ panel: 'steering', steeringType: null });
  });

  it('every other route spells steeringType null without claiming the steering panel', () => {
    const r = routeAt('/policies').current;
    expect(r.panel).toBe('policies');
    expect(r.steeringType).toBeNull();
  });
});

describe('useSteeringRedirect', () => {
  it('REPLACES a type-less steering address with the Architecture page', () => {
    const navigate = vi.fn();
    renderHook(() => useSteeringRedirect('steering', null, navigate));
    expect(navigate).toHaveBeenCalledWith('/steering/architecture', { replace: true });
  });

  it('leaves a valid type alone, and every non-steering panel alone', () => {
    const navigate = vi.fn();
    renderHook(() => useSteeringRedirect('steering', 'security', navigate));
    renderHook(() => useSteeringRedirect('policies', null, navigate));
    expect(navigate).not.toHaveBeenCalled();
  });
});
