import { useEffect } from 'react';
import { api } from '../api/client.js';
import { isSteeringType, policiesPath, steeringDashboardPath } from '../api/steering.js';
import { testingPath } from '../api/testing.js';
import { modePath, projectPath, type Mode, type Navigate } from './useRoute.js';

/** The synthesized "unfiled" project — a run that appears only there has no project. */
const DEFAULT_PROJECT_ID = 'default';

/** Membership kinds that make a run/thread a member of a project. */
const RUN_KINDS = new Set(['crew.run', 'crew.chat']);

/**
 * Resolve the project a run is filed under (DES-MERGE-001 §1.5 back-compat).
 *
 * Crew has no reverse lookup, so this scans membership: `GET /projects` then each
 * project's members, concurrently. `default` is skipped deliberately — it is the
 * SYNTHESIZED project that holds every unfiled run, so a hit there means "no
 * project", and the caller keeps the legacy run view rather than inventing a home.
 * Any project that fails to answer is treated as a miss, never as an error.
 */
export async function resolveRunProject(runId: string): Promise<string | null> {
  const { projects } = await api.listProjects();
  const hits = await Promise.all(
    projects
      .filter((p) => p.id !== DEFAULT_PROJECT_ID)
      .map(async (p) => {
        try {
          const { members } = await api.listProjectMembers(p.id);
          return members.some((m) => m.member_ref === runId && RUN_KINDS.has(m.member_kind)) ? p.id : null;
        } catch {
          return null;
        }
      }),
  );
  return hits.find((id): id is string => id !== null) ?? null;
}

interface LegacyRoute {
  panel: string;
  runId: string | null;
  projectId: string | null;
  mode: Mode | null;
  showLaunch: boolean;
  /** True on the chat-surface routes (`/chat/new`, `/chat/:id`) — these are
   *  NOT the legacy bare-`/runs` listing and must never redirect to /work. */
  chatMode: boolean;
}

/**
 * Client-side redirects from the pre-merge paths into the project shell (§1.5).
 * Every redirect REPLACES its history entry, so Back leaves the shell instead of
 * bouncing through the redirect again.
 *
 *   /projects/:id  →  /p/:id                    (the project dashboard, §4.1)
 *   /runs/:id      →  /p/<project>/build/:id   (when the run is filed under one)
 *   /runs          →  /work                     (DES-UX-001 §7.4, slice Y: the bare
 *                     listing retires — /work is the ONE canonical runs surface.
 *                     /runs/:id and /runs/new stay routable; only the listing goes.
 *                     Query params carry over, so a failure-context entry like
 *                     /runs?filter=failed lands with the Failed filter active.)
 *
 * A bare `/p/:id` is NOT redirected any more — it IS the project dashboard
 * (DES-FEEDBACK-001 §4.1, slice D). The last-used-mode redirect is gone.
 *
 * A run with no project keeps the existing run view: no bookmark breaks, and no
 * guessed project binding.
 */
export function useLegacyRedirect(route: LegacyRoute, navigate: Navigate): void {
  const { panel, runId, projectId, mode, showLaunch, chatMode } = route;

  useEffect(() => {
    if (mode !== null) return; // already in the shell
    if (chatMode) return; // `/chat/*` is the chat surface, not a legacy run route

    if (projectId !== null) {
      // Only the LEGACY `/projects/:id` panel redirects — onto the dashboard
      // route. `/p/:id` renders the dashboard directly and must stay put.
      if (panel === 'project-detail') {
        navigate(projectPath(projectId), { replace: true });
      }
      return;
    }

    if (panel !== 'runs' || showLaunch) return;
    if (runId === null) {
      // §7.4 (slice Y): the bare `/runs` listing retires into a redirect — `/work`
      // is canonical. The search string rides along (context-sensitive filters).
      navigate(`/work${window.location.search}`, { replace: true });
      return;
    }
    let cancelled = false;
    void resolveRunProject(runId)
      .then((pid) => {
        if (!cancelled && pid !== null) navigate(modePath(pid, 'build', runId), { replace: true });
      })
      .catch(() => {
        /* projects surface unreachable — the legacy run view stays, which is the honest fallback */
      });
    return () => { cancelled = true; };
  }, [panel, runId, projectId, mode, showLaunch, chatMode, navigate]);
}

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
 *   /wiki, /rules, /policies  → /steering/policies             (the retired governance panels — the
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
    // The retired `/wiki` `/rules` `/policies` panels are the rule-management surface → Policies.
    if (first === 'wiki' || first === 'rules' || first === 'policies') {
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
 * The retired `/make` address normalizer (the nav-reorg split Make into Execute / Vibe / Demo):
 * `/make` parses to the `execute` panel (so the Execute dashboard renders instantly on the
 * pre-redirect tick) and this hook REPLACES the address with `/execute`, so Back never re-enters
 * the dead address. Only the bare `/make` moves — Vibe and Demo have their own top-level routes,
 * and the in-project `/p/:id/:mode` document/video vocabulary is untouched.
 */
export function useMakeRedirect(pathname: string, navigate: Navigate): void {
  useEffect(() => {
    const [, first = '', second = ''] = pathname.split('/');
    // Only the BARE `/make` (and a trailing-slash `/make/`) moves — a deeper `/make/foo` is not a
    // retired Make address (Make had no URL sub-vocabulary; the in-project `/p/:id/:mode` document/
    // video paths are untouched), so blanket-collapsing it to `/execute` would silently swallow a
    // typo that should honestly reach `not-found`.
    if (first !== 'make' || second !== '') return;
    navigate('/execute', { replace: true });
  }, [pathname, navigate]);
}

/**
 * The Testing surface's address normalizer (same grammar as {@link useSteeringRedirect}):
 *
 *  - the RETIRED flat campaign addresses `/campaigns` and `/campaigns/:id` (the campaign
 *    surface MOVED under Testing) rewrite onto `/testing/campaigns[...]` — the path tail rides
 *    along verbatim, so a bookmarked scoreboard lands on the same campaign;
 *  - a page-less `/testing` address — the bare parent AND the RETIRED `/testing/harness`
 *    (the Harness folded into the eval runner's creation verbs, testing-UX wave) — normalizes
 *    onto Evals: the nav-reorg renamed the section Evals and Evals IS `/testing`'s home now
 *    (Campaigns moved into the project shell), so the bare parent lands there, not on Campaigns.
 *
 * REPLACE, like every redirect in this module, so Back never re-enters the dead address; the
 * parse already lands both on `panel: 'testing'`, so the page renders instantly on the
 * pre-redirect tick and nothing flashes.
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
    if (testingPage === null) navigate(testingPath('evals'), { replace: true });
  }, [panel, testingPage, pathname, navigate]);
}
