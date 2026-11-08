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

const REPO_OPS = new Set(['pull', 'pulls', 'pull-requests', 'merge_requests', 'tree', 'blob', 'commit', 'commits', 'compare']);

/** The repository one link names, or null (CJ13). GitHub and Bitbucket: `<owner>/<repo>`, whatever follows. Elsewhere
 *  the repository is the segment before the first repository operation after it (`pull`, `tree`, `blob`, `commit`,
 *  `compare`, `merge_requests`, or GitLab's `-` separator before one; on gitlab.com any `-`), so nothing in the content
 *  path after it can rename it; with no operation, a GitLab project home names its last segment and a clone link
 *  (`…/<repo>.git`) its repository. Other links name nothing. */
function linkedRepo(link: string): string | null {
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  const segs = url.pathname.split('/').filter((x) => x !== '').map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  const host = url.hostname.toLowerCase().replace(/^www\./u, '');
  let repo: string | undefined;
  if (host === 'github.com' || host === 'bitbucket.org') repo = segs.length >= 2 ? segs[1] : undefined;
  else {
    const gitlab = host === 'gitlab.com';
    const at = segs.findIndex((x, i) => i >= 2 && (REPO_OPS.has(x) || (x === '-' && (gitlab || REPO_OPS.has(segs[i + 1] ?? '')))));
    if (at >= 2) repo = segs[at - 1];
    else if (gitlab) repo = segs.length >= 2 ? segs[segs.length - 1] : undefined;
    else if (segs.length >= 2 && /\.git$/iu.test(segs[segs.length - 1]!)) repo = segs[segs.length - 1];
  }
  const name = repo?.replace(/\.git$/iu, '').toLowerCase();
  return name === undefined || name === '' || name === '-' ? null : name;
}

/** The repositories the links in the words name (lower-cased). A link ends at a space, a bracket or a quote, and a
 *  sentence's punctuation after it is not part of it; a bare `owner/repo` path is not a link. */
function linkedRepos(words: string): string[] {
  const out: string[] = [];
  for (const m of words.matchAll(/https?:\/\/[^\s<>()[\]"'`]+/giu)) {
    const name = linkedRepo(m[0].replace(/[.,;:!?]+$/u, ''));
    if (name !== null) out.push(name);
  }
  return out;
}

const linkedTo = (linked: readonly string[], r: Pick<RepoEntry, 'id' | 'name'>): boolean =>
  linked.includes(r.name.toLowerCase()) || linked.includes(r.id.toLowerCase());

/** The registered repositories the words name (by name or id), in registry order (F41). */
export function reposNamedIn<R extends Pick<RepoEntry, 'id' | 'name'>>(words: string, repos: readonly R[]): R[] {
  const linked = linkedRepos(words);
  return repos.filter((r) => names(words, r.name) || (r.id !== r.name && names(words, r.id)) || linkedTo(linked, r));
}

/** A name distinct enough to be read as a repository rather than a word: it carries something other than letters (a
 *  digit, `-`, `_`, `.`), as repository slugs do (`billing-api`, `rg1105-r1b`). `domain`, `core` or `docs` never are:
 *  "Map the domain of …" must not pick a repository called `domain` (codex/pi r7). Such a name still leads the chips. */
export function distinctName(name: string): boolean {
  return name.length >= 3 && /[^\p{L}]/u.test(name);
}

/**
 * The one repository a job's words clearly name (F41: `/analyze domain Map the domain of rg1-api …` from a new chat), with
 * the project that certainly and solely holds it (null otherwise). null when the words name none, or several, or the
 * registry could not be read: the job passage then asks, with chips. GETs only.
 */
export async function repoNamedInWords(words: string): Promise<{ repo: RepoEntry; projectId: string | null } | null> {
  if (words.trim() === '') return null;
  let repos: RepoEntry[];
  try { repos = (await api.listRepos()).repos; } catch { return null; }
  const named = reposNamedIn(words, repos);
  // Named by a distinct name or id; two named (or one distinct and one plain) is not clear: the person picks.
  // A link names its repository plainly, whatever its name (`…/acme/payments/pull/9`).
  const linked = linkedRepos(words);
  const clear = named.filter((r) => linkedTo(linked, r) || (distinctName(r.name) && names(words, r.name)) || (r.id !== r.name && distinctName(r.id) && names(words, r.id)));
  if (named.length !== 1 || clear.length !== 1) return null;
  const repo = clear[0]!;
  try {
    const { holding, certain } = await projectsForRepo(repo.id);
    return { repo, projectId: certain && holding.length === 1 ? holding[0]!.id : null };
  } catch { return { repo, projectId: null }; }
}
