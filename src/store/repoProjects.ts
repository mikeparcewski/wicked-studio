import { api } from '../api/client.js';
import { UNFILED_MOUNT } from '../api/interactive.js';
import type { Project } from '../api/types.js';

/**
 * The projects a registered repository belongs to (its `crew.repo` memberships), and the projects a person can file a
 * job in. Read on demand (GETs only), for a job that needs a project: a named opener that knows only the repository
 * (the Requirements page's "Generate it") and the job passage's "Which project?" (F39).
 */

const REPO_KIND = 'crew.repo';

/** Projects a job can be filed in: active, not the Unfiled bucket. */
export function fileableProjects(projects: readonly Project[]): Project[] {
  return projects.filter((p) => p.id !== UNFILED_MOUNT && (p as { status?: string }).status !== 'archived');
}

/** Every fileable project; of those, the ones that hold `repoId`; and whether that is certain (a members read that
 *  failed makes it uncertain: the caller then picks nothing on the person's behalf and offers every project). */
export async function projectsForRepo(repoId: string | null): Promise<{ all: Project[]; holding: Project[]; certain: boolean }> {
  const { projects } = await api.listProjects();
  const all = fileableProjects(projects);
  if (repoId === null || repoId === '') return { all, holding: [], certain: true };
  const holds = await Promise.all(all.map(async (p) => {
    try {
      const { members } = await api.listProjectMembers(p.id);
      return members.some((m) => m.member_kind === REPO_KIND && m.member_ref === repoId);
    } catch { return null; }
  }));
  return { all, holding: all.filter((_, i) => holds[i] === true), certain: holds.every((h) => h !== null) };
}
