import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRoute } from '../src/hooks/useRoute.js';
import { useRetiredSettingsRedirect, useSteeringRedirect } from '../src/hooks/useLegacyRedirect.js';
import { STEERING_TYPES } from '../src/api/steering.js';

/**
 * The unified Steering surface's routes (DES-MEM-FACETED-001, unified surface): one home, two
 * sub-sections (`/steering/policies`, `/steering/memories`), each managing existing items AND
 * reviewing proposals.
 *  - `/steering/policies` and `/steering/memories` parse to the steering panel with their section;
 *  - bare `/steering` and a LEGACY `/steering/:type` (a valid type — the seven pages collapsed into
 *    a `?type=` filter on Policies) parse with `steeringSection: null`, then `useSteeringRedirect`
 *    REPLACES the address (bare → `/steering/policies`, legacy type → `/steering/policies?type=…`);
 *  - the RETIRED addresses `/wiki`, `/rules`, `/policies` (the old governance panels) and
 *    `/proposals` (the standalone review queue — proposals now live inside the sub-sections) parse
 *    to the steering panel with a null section and are REPLACED onto the right sub-section
 *    (`/proposals?type=memory` → Memories, everything else → Policies);
 *  - a typo'd `/steering/foo` normalizes onto nothing — it is the not-found panel (review #4);
 *  - the RETIRED `/coverage` and `/domain` settings panels parse to System and get REPLACED with
 *    `/system` by `useRetiredSettingsRedirect`.
 */

function routeAt(path: string) {
  window.history.replaceState(null, '', path);
  return renderHook(() => useRoute()).result;
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useRoute — /steering/{dashboard,policies,memories}', () => {
  it('parses the dashboard home + the two management sub-sections to the one steering panel', () => {
    const dash = routeAt('/steering/dashboard').current;
    expect(dash).toMatchObject({ panel: 'steering', steeringSection: 'dashboard' });
    expect(dash.runId).toBeNull();
    expect(dash.projectId).toBeNull();
    const pol = routeAt('/steering/policies').current;
    expect(pol).toMatchObject({ panel: 'steering', steeringSection: 'policies' });
    expect(pol.runId).toBeNull();
    expect(pol.projectId).toBeNull();
    expect(routeAt('/steering/memories').current).toMatchObject({ panel: 'steering', steeringSection: 'memories' });
  });

  it('a bare /steering parses with steeringSection null — the redirect resolves it onto the Dashboard', () => {
    expect(routeAt('/steering').current).toMatchObject({ panel: 'steering', steeringSection: null });
    expect(routeAt('/steering/').current).toMatchObject({ panel: 'steering', steeringSection: null });
  });

  it('a LEGACY /steering/:type parses to the steering panel (section null — the redirect adds ?type=)', () => {
    for (const t of STEERING_TYPES) {
      const r = routeAt(`/steering/${t}`).current;
      expect(r.panel).toBe('steering');
      expect(r.steeringSection).toBeNull();
      // No run-selected machinery ever fires against a steering address.
      expect(r.runId).toBeNull();
      expect(r.projectId).toBeNull();
    }
  });

  it('an unknown steering sub-route is a DEAD address — not-found, never a silent swap (review #4)', () => {
    expect(routeAt('/steering/bogus').current).toMatchObject({ panel: 'not-found' });
    expect(routeAt('/steering/securty').current).toMatchObject({ panel: 'not-found' });
  });

  it('the retired /wiki, /rules, /policies panels and the /proposals queue fold into the steering panel', () => {
    for (const p of ['/wiki', '/rules', '/policies', '/proposals']) {
      expect(routeAt(p).current).toMatchObject({ panel: 'steering', steeringSection: null });
    }
  });

  it('the retired /coverage and /domain settings panels fold into the System page', () => {
    expect(routeAt('/coverage').current.panel).toBe('system');
    expect(routeAt('/domain').current.panel).toBe('system');
  });

  it('every other route spells steeringSection null without claiming the steering panel', () => {
    const r = routeAt('/work').current;
    expect(r.panel).toBe('work');
    expect(r.steeringSection).toBeNull();
  });
});

describe('useSteeringRedirect', () => {
  it('leaves the real sub-section addresses alone (dashboard / policies / memories)', () => {
    const navigate = vi.fn();
    renderHook(() => useSteeringRedirect('steering', 'dashboard', '/steering/dashboard', '', navigate));
    renderHook(() => useSteeringRedirect('steering', 'policies', '/steering/policies', '', navigate));
    renderHook(() => useSteeringRedirect('steering', 'memories', '/steering/memories', '', navigate));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('REPLACES bare /steering with the Dashboard home (the review-forward default)', () => {
    const navigate = vi.fn();
    renderHook(() => useSteeringRedirect('steering', null, '/steering', '', navigate));
    expect(navigate).toHaveBeenCalledWith('/steering/dashboard', { replace: true });
  });

  it('REPLACES the retired /wiki, /rules, /policies rule-management panels with the Policies home', () => {
    for (const path of ['/wiki', '/rules', '/policies']) {
      const navigate = vi.fn();
      renderHook(() => useSteeringRedirect('steering', null, path, '', navigate));
      expect(navigate).toHaveBeenCalledWith('/steering/policies', { replace: true });
    }
  });

  it('REPLACES a legacy /steering/:type with Policies filtered to that type (bookmarks keep their type)', () => {
    const navigate = vi.fn();
    renderHook(() => useSteeringRedirect('steering', null, '/steering/security', '', navigate));
    expect(navigate).toHaveBeenCalledWith('/steering/policies?type=security', { replace: true });
  });

  it('REPLACES the retired /proposals queue onto the Dashboard review inbox (its successor), for every ?type=', () => {
    // The standalone review queue folded into the dashboard's consolidated inbox, which reviews
    // BOTH kinds in one place — so every proposals bookmark (and its old ?type= filter) lands there.
    for (const search of ['', '?type=memory', '?type=policy']) {
      const navigate = vi.fn();
      renderHook(() => useSteeringRedirect('steering', null, '/proposals', search, navigate));
      expect(navigate).toHaveBeenCalledWith('/steering/dashboard', { replace: true });
    }
  });

  it('leaves a typo (parsed not-found) and every non-steering panel alone', () => {
    const navigate = vi.fn();
    // `/steering/bogus` parses to not-found, so this hook never sees `panel: 'steering'` for it.
    renderHook(() => useSteeringRedirect('not-found', null, '/steering/bogus', '', navigate));
    renderHook(() => useSteeringRedirect('system', null, '/system', '', navigate));
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('useRetiredSettingsRedirect', () => {
  it('REPLACES /coverage and /domain with /system', () => {
    for (const path of ['/coverage', '/domain']) {
      const navigate = vi.fn();
      renderHook(() => useRetiredSettingsRedirect(path, navigate));
      expect(navigate).toHaveBeenCalledWith('/system', { replace: true });
    }
  });

  it('leaves every live route alone', () => {
    const navigate = vi.fn();
    for (const path of ['/system', '/theme', '/workflows', '/steering/policies', '/steering/memories', '/']) {
      renderHook(() => useRetiredSettingsRedirect(path, navigate));
    }
    expect(navigate).not.toHaveBeenCalled();
  });
});
