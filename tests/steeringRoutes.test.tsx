import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRoute } from '../src/hooks/useRoute.js';
import { legacySteeringTarget, useRetiredSettingsRedirect } from '../src/hooks/useLegacyRedirect.js';
import { STEERING_TYPES } from '../src/api/steering.js';
import { deskTabPath } from '../src/components/desk/DeskV2.js';

/**
 * Steer's and Memory's routes (operator 2026-10-17: "memories and steering are separate"):
 *  - `/steering/policies` and `/steering/proposals` parse to the steering panel with their section;
 *  - `/memory` parses to the memory panel (its view rides `?view=`);
 *  - bare `/steering`, a LEGACY `/steering/:type` and the retired `/steering/dashboard` and
 *    `/steering/memories` parse with `steeringSection: null`, and so do the retired `/wiki`,
 *    `/policies` and `/proposals`; `legacySteeringTarget` says which Desk tab each lands on;
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

describe('useRoute — /steering/{policies,proposals} and /memory', () => {
  it('parses the two Steer sub-sections to the one steering panel', () => {
    const pol = routeAt('/steering/policies').current;
    expect(pol).toMatchObject({ panel: 'steering', steeringSection: 'policies' });
    expect(pol.runId).toBeNull();
    expect(pol.projectId).toBeNull();
    expect(routeAt('/steering/proposals').current).toMatchObject({ panel: 'steering', steeringSection: 'proposals' });
  });

  it('/memory is its own page; a deeper spelling is a dead address', () => {
    expect(routeAt('/memory').current).toMatchObject({ panel: 'memory', steeringSection: null });
    expect(routeAt('/memory/').current.panel).toBe('memory');
    expect(routeAt('/memory/x').current.panel).toBe('not-found');
  });

  it('the retired /steering/dashboard and /steering/memories parse with no section (they only redirect)', () => {
    expect(routeAt('/steering/dashboard').current).toMatchObject({ panel: 'steering', steeringSection: null });
    expect(routeAt('/steering/memories').current).toMatchObject({ panel: 'steering', steeringSection: null });
  });

  it('a bare /steering parses with steeringSection null — the redirect resolves it', () => {
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

  it('/rules is a REAL route again — the Rules page (S12), not a fold into steering', () => {
    expect(routeAt('/rules').current).toMatchObject({ panel: 'rules', ruleId: null });
    expect(routeAt('/rules/proposal%3Apr-1').current).toMatchObject({ panel: 'rules', ruleId: 'proposal:pr-1' });
  });

  it('the retired /wiki, /policies panels and the /proposals queue fold into the steering panel', () => {
    for (const p of ['/wiki', '/policies', '/proposals']) {
      expect(routeAt(p).current).toMatchObject({ panel: 'steering', steeringSection: null });
    }
  });

  it('the retired /coverage and /domain settings panels fold into the System page', () => {
    expect(routeAt('/coverage').current.panel).toBe('system');
    expect(routeAt('/domain').current.panel).toBe('system');
  });

  it('the retired "General settings" overview (/settings, and any /settings/...) folds into General (/system)', () => {
    expect(routeAt('/settings').current.panel).toBe('system');
    expect(routeAt('/settings/system').current.panel).toBe('system');
  });

  it('every other route spells steeringSection null without claiming the steering panel', () => {
    const r = routeAt('/skills').current;
    expect(r.panel).toBe('skills');
    expect(r.steeringSection).toBeNull();
  });
});

describe('legacySteeringTarget — where each steering-family address lands', () => {
  it('memory addresses land on the Memory tab', () => {
    expect(legacySteeringTarget('/steering/memories', '')).toBe(deskTabPath('memory'));
    expect(legacySteeringTarget('/proposals', '?type=memory')).toBe(deskTabPath('memory', '/memory?view=proposals'));
  });

  it('the dashboard and the old review queue land on Steer\'s policy Proposals', () => {
    for (const [path, search] of [['/steering/dashboard', ''], ['/proposals', ''], ['/proposals', '?type=policy']] as const) {
      expect(legacySteeringTarget(path, search)).toBe(deskTabPath('steer', '/steering/proposals'));
    }
  });

  it('a legacy /steering/:type keeps its type as the Policies filter (bookmarks keep their type)', () => {
    expect(legacySteeringTarget('/steering/security', '')).toBe(deskTabPath('steer', '/steering/policies?type=security'));
  });

  it('the retired /wiki and /policies panels land on Policies; bare /steering on the Steer tab', () => {
    expect(legacySteeringTarget('/wiki', '')).toBe(deskTabPath('steer', '/steering/policies'));
    expect(legacySteeringTarget('/policies', '')).toBe(deskTabPath('steer', '/steering/policies'));
    expect(legacySteeringTarget('/steering', '')).toBe(deskTabPath('steer'));
  });

  it("an old address on a project's Desk stays on that project", () => {
    expect(legacySteeringTarget('/steering/memories', '', '/projects/p1')).toBe(deskTabPath('memory', undefined, '/projects/p1'));
    expect(legacySteeringTarget('/steering/dashboard', '', '/projects/p1')).toBe(deskTabPath('steer', '/steering/proposals', '/projects/p1'));
  });

  it('a current address rides onto the Steer tab as it is', () => {
    expect(legacySteeringTarget('/steering/policies', '?type=testing&view=table')).toBe(deskTabPath('steer', '/steering/policies?type=testing&view=table'));
    expect(legacySteeringTarget('/steering/proposals', '')).toBe(deskTabPath('steer', '/steering/proposals'));
  });
});

describe('useRetiredSettingsRedirect', () => {
  it('REPLACES /coverage, /domain and the retired /settings overview with /system', () => {
    for (const path of ['/coverage', '/domain', '/settings', '/settings/theme']) {
      const navigate = vi.fn();
      renderHook(() => useRetiredSettingsRedirect(path, navigate));
      expect(navigate).toHaveBeenCalledWith('/system', { replace: true });
    }
  });

  it('leaves every live route alone', () => {
    const navigate = vi.fn();
    for (const path of ['/system', '/theme', '/workflows', '/steering/policies', '/memory', '/']) {
      renderHook(() => useRetiredSettingsRedirect(path, navigate));
    }
    expect(navigate).not.toHaveBeenCalled();
  });
});
