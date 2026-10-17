import { useEffect } from 'react';
import { memoryPath } from '../api/memory.js';
import { isSteeringType, policiesPath, steerProposalsPath } from '../api/steering.js';
import { testingPath } from '../api/testing.js';
import { deskTabPath } from '../components/desk/DeskV2.js';
import type { Navigate } from './useRoute.js';

/*
 * X1 (operator ruling 2026-10-09): the S15c / S16a moved addresses (`/runs/:id`, `/work`, `/p/…`, …)
 * no longer redirect — they parse to `not-found` (`RETIRED_ADDRESSES` in useRoute.ts). The steering,
 * retired-settings and testing normalizers below stay.
 */

/**
 * Where a steering-family address lands (App redirects every `steering` and `rules` parse here, with
 * REPLACE, so Back never re-enters the old address). Steer lives on the Desk's Steer tab and Memory
 * on its Memory tab (operator 2026-10-17: "memories and steering are separate"):
 *
 *   /steering/memories          → the Memory tab
 *   /proposals?type=memory      → the Memory tab's proposals (`/memory?view=proposals`)
 *   /steering/dashboard         → Steer's policy proposals (`/steering/proposals`)
 *   /proposals (any other type) → Steer's policy proposals
 *   /steering/:type             → Steer's Policies filtered to that type (bookmarks keep their type)
 *   /wiki, /policies            → Steer's Policies (the retired governance panels)
 *   /steering                   → the Steer tab's home
 *   anything else               → the Steer tab at that address (`/steering/policies…`, `/rules…`)
 *
 * `base` is the Desk the address was on (`/`, or a project's page when a project Desk hosted it), so an
 * old project-hosted bookmark stays on that project. A typo'd `/steering/foo` parses to `not-found`
 * (usability review #4), so it never comes here.
 */
export function legacySteeringTarget(pathname: string, search: string, base = '/'): string {
  const [, first = '', second = ''] = pathname.split('/');
  const tab = (t: 'steer' | 'memory', at?: string): string => deskTabPath(t, at, base);
  if (first === 'proposals') {
    return new URLSearchParams(search).get('type') === 'memory' ? tab('memory', memoryPath('proposals')) : tab('steer', steerProposalsPath());
  }
  if (first === 'wiki' || first === 'policies') return tab('steer', policiesPath());
  if (first === 'steering') {
    if (second === 'memories') return tab('memory');
    if (second === 'dashboard') return tab('steer', steerProposalsPath());
    if (isSteeringType(second)) return tab('steer', policiesPath(second));
    if (second === '') return tab('steer');
  }
  return tab('steer', pathname + search);
}

/**
 * The retired settings panels' address normalizer (the steering-UX wave): `/coverage` and
 * `/domain` — the orphaned, context-free settings panels — retired, and so did the "General
 * settings" overview at `/settings` (rail restructure 2026-10-13); all parse to the General (`/system`)
 * page (so it renders instantly on the pre-redirect tick) and this hook REPLACES the address
 * with `/system`, so Back never re-enters the dead address.
 */
export function useRetiredSettingsRedirect(pathname: string, navigate: Navigate): void {
  useEffect(() => {
    const [, first = ''] = pathname.split('/');
    if (first !== 'coverage' && first !== 'domain' && first !== 'settings') return;
    navigate('/system', { replace: true });
  }, [pathname, navigate]);
}


/**
 * The Testing surface's address normalizer:
 *
 *  - the RETIRED flat campaign addresses `/campaigns` and `/campaigns/:id` (the campaign
 *    surface MOVED under Testing) rewrite onto `/testing/campaigns[...]` — the path tail rides
 *    along verbatim, so a bookmarked scoreboard lands on the same campaign;
 *  - a page-less `/testing` address — the bare parent AND the RETIRED `/testing/harness`
 *    (the Harness folded into the Test landing's creation verbs, testing-UX wave) — normalizes
 *    onto the TEST landing (`/testing/campaigns`), as `src/api/testing.ts` has documented all
 *    along ("Campaigns IS the landing"). Acceptance finding F-075 / F-7R2-009: for two releases
 *    this sent both addresses to Evals (the steering-rule eval runner), so "build tests for a
 *    repo" was not findable by name — a customer typing `/testing` landed on rule evals. Evals
 *    keeps its own address (`/testing/evals`) as a sub-page.
 *
 * REPLACE, like every redirect in this module, so Back never re-enters the dead address; the
 * parse already lands both on `panel: 'testing'` with the Test landing as the page-less default,
 * so the page renders instantly on the pre-redirect tick and nothing flashes.
 */
export function useTestingRedirect(
  panel: string,
  testingPage: string | null,
  pathname: string,
  navigate: Navigate,
): void {
  useEffect(() => {
    if (panel !== 'testing') return;
    if (pathname === '/campaigns' || pathname.startsWith('/campaigns/')) {
      navigate(`/testing${pathname}`, { replace: true });
      return;
    }
    if (testingPage === null) navigate(testingPath('campaigns'), { replace: true });
  }, [panel, testingPage, pathname, navigate]);
}
