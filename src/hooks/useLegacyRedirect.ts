import { useEffect } from 'react';
import { api } from '../api/client.js';
import { lastMode, modePath, type Mode, type Navigate } from './useRoute.js';

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
}

/**
 * Client-side redirects from the pre-merge paths into the project shell (§1.5).
 * Every redirect REPLACES its history entry, so Back leaves the shell instead of
 * bouncing through the redirect again.
 *
 *   /projects/:id  →  /p/:id/<last-used mode>
 *   /runs/:id      →  /p/<project>/build/:id   (when the run is filed under one)
 *
 * A run with no project keeps the existing run view: no bookmark breaks, and no
 * guessed project binding.
 */
export function useLegacyRedirect(route: LegacyRoute, navigate: Navigate): void {
  const { panel, runId, projectId, mode, showLaunch } = route;

  useEffect(() => {
    if (mode !== null) return; // already in the shell

    if (projectId !== null) {
      // Both `/projects/:id` (legacy panel) and a bare `/p/:id` land on the last-used mode.
      navigate(modePath(projectId, lastMode(projectId)), { replace: true });
      return;
    }

    if (panel !== 'runs' || runId === null || showLaunch) return;
    let cancelled = false;
    void resolveRunProject(runId)
      .then((pid) => {
        if (!cancelled && pid !== null) navigate(modePath(pid, 'build', runId), { replace: true });
      })
      .catch(() => {
        /* projects surface unreachable — the legacy run view stays, which is the honest fallback */
      });
    return () => { cancelled = true; };
  }, [panel, runId, projectId, mode, showLaunch, navigate]);
}
