import { useEffect } from 'react';
import { isSteeringType, policiesPath, steeringDashboardPath } from '../api/steering.js';
import { testingPath } from '../api/testing.js';
import type { Navigate } from './useRoute.js';

/*
 * S16a-2d: the run page's legacy filing (`/runs/:id` → `/p/<project>/build/:id` after a membership
 * scan, and the dead bare-`/runs` → `/work` branch) is gone — `/runs/:id` MOVED to the run's session
 * thread (`useMovedRoutes`), and the bare `/runs` parses to "See everything" (S15c). The steering,
 * retired-settings and testing redirects below stay.
 */

/**
 * The unified Steering surface's address normalizer (DES-MEM-FACETED-001, unified surface;
 * governed-knowledge dashboard). `/steering/dashboard`, `/steering/policies` and
 * `/steering/memories` are the real addresses and never redirect; every OTHER parse that landed on
 * `panel: 'steering'` with `steeringSection === null` is an address that needs to resolve onto one
 * of the sub-sections:
 *
 *   /steering                → /steering/dashboard            (the review-forward home)
 *   /steering/:type          → /steering/policies?type=:type  (the seven pages collapsed into a
 *                              filter — bookmarks keep their type)
 *   /wiki, /policies         → /steering/policies             (the retired governance panels — the
 *                              rule-management surface)
 *   /proposals               → /steering/dashboard            (the retired standalone review queue
 *                              → the dashboard's consolidated review inbox, its successor — for
 *                              every ?type=, since the inbox reviews BOTH kinds in one place)
 *
 * A typo'd `/steering/foo` parses to `not-found` (usability review #4), so this hook never sees
 * `panel: 'steering'` for it and leaves the address alone. REPLACE, like every redirect in this
 * module, so Back never re-enters the dead address.
 */
export function useSteeringRedirect(
  panel: string,
  steeringSection: string | null,
  pathname: string,
  search: string,
  navigate: Navigate,
): void {
  useEffect(() => {
    if (panel !== 'steering' || steeringSection !== null) return;
    const [, first = '', second = ''] = pathname.split('/');
    // The retired standalone review queue → the dashboard's consolidated review inbox (its
    // successor), which reviews memory AND policy proposals in one place (its old ?type= filter no
    // longer forks the target — `search` stays a dep only so a query-only change still re-runs).
    if (first === 'proposals') {
      navigate(steeringDashboardPath(), { replace: true });
      return;
    }
    // A legacy `/steering/:type` keeps its type as the Policies filter.
    if (first === 'steering' && isSteeringType(second)) {
      navigate(policiesPath(second), { replace: true });
      return;
    }
    // The retired `/wiki` `/policies` panels are the rule-management surface → Policies. (`/rules`
    // is a real route again — the Rules page, S12 — and never reaches this hook.)
    if (first === 'wiki' || first === 'policies') {
      navigate(policiesPath(), { replace: true });
      return;
    }
    // Bare `/steering` → the review-forward dashboard home.
    navigate(steeringDashboardPath(), { replace: true });
  }, [panel, steeringSection, pathname, search, navigate]);
}

/**
 * The retired settings panels' address normalizer (the steering-UX wave): `/coverage` and
 * `/domain` — the orphaned, context-free settings panels — retired; both parse to the System
 * page (so it renders instantly on the pre-redirect tick) and this hook REPLACES the address
 * with `/system`, so Back never re-enters the dead address.
 */
export function useRetiredSettingsRedirect(pathname: string, navigate: Navigate): void {
  useEffect(() => {
    const [, first = ''] = pathname.split('/');
    if (first !== 'coverage' && first !== 'domain') return;
    navigate('/system', { replace: true });
  }, [pathname, navigate]);
}


/**
 * The Testing surface's address normalizer (same grammar as {@link useSteeringRedirect}):
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
