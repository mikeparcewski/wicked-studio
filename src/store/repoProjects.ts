import { api } from '../api/client.js';
import { UNFILED_MOUNT } from '../api/interactive.js';
import type { Project, RepoEntry } from '../api/types.js';

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

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `words` name `term` as a whole token (case-insensitive): not inside a longer name (`rg1` is not named by
 *  `rg10` or `rg1-old`); a sentence's punctuation after it still ends it. */
function names(words: string, term: string): boolean {
  if (term.trim() === '') return false;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_./-])${escapeRe(term)}(?=$|[^\\p{L}\\p{N}_./-]|\\.(?:$|[^\\p{L}\\p{N}_./-]))`, 'iu').test(words);
}

/** The registered repositories the words name (by name or id), in registry order (F41). */
export function reposNamedIn<R extends Pick<RepoEntry, 'id' | 'name'>>(words: string, repos: readonly R[]): R[] {
  return repos.filter((r) => names(words, r.name) || (r.id !== r.name && names(words, r.id)));
}

/**
 * The one repository a job's words clearly name (F41: `/analyze domain Map the domain of rg1 …` from a new chat), with
 * the project that certainly and solely holds it (null otherwise). null when the words name none, or several, or the
 * registry could not be read: the job passage then asks, with chips. GETs only.
 */
export async function repoNamedInWords(words: string): Promise<{ repo: RepoEntry; projectId: string | null } | null> {
  if (words.trim() === '') return null;
  let repos: RepoEntry[];
  try { repos = (await api.listRepos()).repos; } catch { return null; }
  const named = reposNamedIn(words, repos);
  if (named.length !== 1) return null;
  const repo = named[0]!;
  try {
    const { holding, certain } = await projectsForRepo(repo.id);
    return { repo, projectId: certain && holding.length === 1 ? holding[0]!.id : null };
  } catch { return { repo, projectId: null }; }
}
