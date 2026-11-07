import { api } from '../api/client.js';
import type { Project } from '../api/types.js';

/**
 * The projects a registered repository belongs to (its `crew.repo` memberships), and the projects a person can file a
 * job in. Read on demand (GETs only), for a job that needs a project: a named opener that knows only the repository
 * (the Requirements page's "Generate it") and the job passage's "Which project?" (F39).
 */

const REPO_KIND = 'crew.repo';

/** Projects a job can be filed in: active, not the Unfiled bucket. */
export function fileableProjects(projects: readonly Project[]): Project[] {
  return projects.filter((p) => p.id !== 'default' && (p as { status?: string }).status !== 'archived');
}

/** Every fileable project and, of those, the ones that hold `repoId` (a member read per project). A failed members read
 *  counts as "does not hold it": the person still gets every project to choose from. */
export async function projectsForRepo(repoId: string | null): Promise<{ all: Project[]; holding: Project[] }> {
  const { projects } = await api.listProjects();
  const all = fileableProjects(projects);
  if (repoId === null || repoId === '') return { all, holding: [] };
  const holds = await Promise.all(all.map(async (p) => {
    try {
      const { members } = await api.listProjectMembers(p.id);
      return members.some((m) => m.member_kind === REPO_KIND && m.member_ref === repoId);
    } catch { return false; }
  }));
  return { all, holding: all.filter((_, i) => holds[i]) };
}
