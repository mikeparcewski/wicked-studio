import { useEffect } from 'react';
import { api } from '../api/client.js';
import { DEFAULT_STEERING_TYPE, steeringPath } from '../api/steering.js';
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
 * The Steering surface's address normalizer (the STEERING program): any parse that landed on
 * `panel: 'steering'` WITHOUT a valid type — bare `/steering`, a typo'd `/steering/foo`, and
 * the two RETIRED addresses `/wiki` (the old Architecture Wiki page) and `/rules` (the old
 * RuleManager) — is replaced with the Architecture page's real URL. REPLACE, like every
 * redirect in this module, so Back never re-enters the dead address; the page itself renders
 * Architecture on the pre-redirect tick, so nothing flashes.
 */
export function useSteeringRedirect(panel: string, steeringType: string | null, navigate: Navigate): void {
  useEffect(() => {
    if (panel !== 'steering' || steeringType !== null) return;
    navigate(steeringPath(DEFAULT_STEERING_TYPE), { replace: true });
  }, [panel, steeringType, navigate]);
}
