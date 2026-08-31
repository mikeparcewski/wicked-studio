import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRoute } from '../src/hooks/useRoute.js';
import { useRetiredSettingsRedirect, useSteeringRedirect } from '../src/hooks/useLegacyRedirect.js';
import { STEERING_TYPES } from '../src/api/steering.js';

/**
 * The Steering routes (the STEERING program, re-aimed by the steering-UX wave):
 *  - `/steering/:type` parses to the steering panel for each of the seven types;
 *  - bare `/steering` IS the landing (the seven type cards) — parsed with a null type and
 *    NEVER redirected;
 *  - the RETIRED addresses `/wiki` (the old Architecture Wiki page), `/rules` (the old
 *    RuleManager) and `/policies` (the old policies settings panel — policies merged into
 *    steering rules) parse to the steering panel with a null type, then get REPLACED by
 *    `useSteeringRedirect` with the landing's real URL, so bookmarks land on the surface
 *    that replaced them;
 *  - a typo'd `/steering/foo` normalizes onto the landing the same way; a VALID type never
 *    redirects;
 *  - the RETIRED `/coverage` and `/domain` settings panels parse to the System page and get
 *    REPLACED with `/system` by `useRetiredSettingsRedirect`.
 */

function routeAt(path: string) {
  window.history.replaceState(null, '', path);
  return renderHook(() => useRoute()).result;
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useRoute — /steering[/:type]', () => {
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

  it('a bare or unknown-type /steering parses with steeringType null (the landing / its redirect)', () => {
    expect(routeAt('/steering').current).toMatchObject({ panel: 'steering', steeringType: null });
    expect(routeAt('/steering/bogus').current).toMatchObject({ panel: 'steering', steeringType: null });
  });

  it('the retired /wiki, /rules and /policies addresses fold into the steering panel', () => {
    expect(routeAt('/wiki').current).toMatchObject({ panel: 'steering', steeringType: null });
    expect(routeAt('/rules').current).toMatchObject({ panel: 'steering', steeringType: null });
    expect(routeAt('/policies').current).toMatchObject({ panel: 'steering', steeringType: null });
  });

  it('the retired /coverage and /domain settings panels fold into the System page', () => {
    expect(routeAt('/coverage').current.panel).toBe('system');
    expect(routeAt('/domain').current.panel).toBe('system');
  });

  it('every other route spells steeringType null without claiming the steering panel', () => {
    const r = routeAt('/work').current;
    expect(r.panel).toBe('work');
    expect(r.steeringType).toBeNull();
  });
});

describe('useSteeringRedirect', () => {
  it('leaves the bare /steering landing alone — it IS the page', () => {
    const navigate = vi.fn();
    renderHook(() => useSteeringRedirect('steering', null, '/steering', navigate));
    renderHook(() => useSteeringRedirect('steering', null, '/steering/', navigate));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('REPLACES the retired addresses and a typo’d type with the landing', () => {
    for (const path of ['/wiki', '/rules', '/policies', '/steering/bogus']) {
      const navigate = vi.fn();
      renderHook(() => useSteeringRedirect('steering', null, path, navigate));
      expect(navigate).toHaveBeenCalledWith('/steering', { replace: true });
    }
  });

  it('leaves a valid type alone, and every non-steering panel alone', () => {
    const navigate = vi.fn();
    renderHook(() => useSteeringRedirect('steering', 'security', '/steering/security', navigate));
    renderHook(() => useSteeringRedirect('system', null, '/system', navigate));
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
    for (const path of ['/system', '/theme', '/workflows', '/steering', '/steering/security', '/']) {
      renderHook(() => useRetiredSettingsRedirect(path, navigate));
    }
    expect(navigate).not.toHaveBeenCalled();
  });
});
