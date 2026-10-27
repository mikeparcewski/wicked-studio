import type { ChatScope } from '../api/types.js';
import { defaultScopeChips, type ScopeChip } from './chatScopes.js';

/**
 * Understand's Ask as an ANALYSIS chat (crew#1157): a new chat that runs crew's read-only `analyze`
 * workflow on the operator's question, scoped to the repositories they chose. Pure.
 */

/** The workflow Understand's Ask runs. */
export const ANALYZE_CHAT_WORKFLOW = 'analyze';

/**
 * The workflow a new chat may send, or `null` for a plain chat: only one this crew names in
 * `capabilities.chatWorkflows` (an older crew's strict schema refuses the key, and one whose engine
 * lacks the workflow answers 409).
 */
export function chatWorkflowFor(requested: string | undefined, served: readonly string[]): string | null {
  return requested !== undefined && served.includes(requested) ? requested : null;
}

/**
 * The scope chips of an analysis chat: the chosen repositories, on, and the project when the ask
 * came from a project's page (its graph grounds them). "This page" is off: the question is about
 * the code, not about the page it was typed on. No chosen repository: the project, else all repos.
 */
export function analysisScopeChips(
  repos: ReadonlyArray<{ id: string; name: string }>,
  project: { id: string; name: string } | null,
): ScopeChip[] {
  const base = defaultScopeChips({ project, repo: null })
    .filter((c) => repos.length === 0 || c.kind !== 'all-repos')
    .map((c) => (c.kind === 'page' ? { ...c, on: false } : c));
  const at = base.findIndex((c) => c.kind === 'memory');
  const repoChips: ScopeChip[] = repos.map((r) => ({ key: `repo:${r.id}`, kind: 'repo', label: r.name, ref: r.id, on: true }));
  return at < 0 ? [...base, ...repoChips] : [...base.slice(0, at), ...repoChips, ...base.slice(at)];
}

/**
 * The repository an analysis chat could not ground (no code graph is bound for it), when its scope
 * is exactly one repository: the chat offers "Index this repository" for it. `null` otherwise.
 */
export function indexOfferFor(scope: ChatScope | null | undefined): { repoId: string; name: string } | null {
  if (scope === null || scope === undefined || scope.graph.bound || scope.repos.length !== 1) return null;
  const r = scope.repos[0]!;
  return { repoId: r.id, name: r.name };
}

/** How far back "most active" looks (integrator, 2026-10-27: the newest repository was a test repo). */
export const ACTIVE_WINDOW_DAYS = 7;

/**
 * The repository with the most jobs started in the last {@link ACTIVE_WINDOW_DAYS} days (a tie goes to
 * the one worked on last), or `null` when none was worked on in that window. `created_at` is unix
 * seconds; `nowMs` is milliseconds.
 */
export function mostActiveRepo(
  repos: ReadonlyArray<{ id: string }>,
  runs: ReadonlyArray<{ session: { repo_ref?: string | null; created_at?: number | null; archived_at?: number | null } }>,
  nowMs: number,
): string | null {
  const since = nowMs / 1000 - ACTIVE_WINDOW_DAYS * 86_400;
  const known = new Set(repos.map((r) => r.id));
  const tally = new Map<string, { n: number; last: number }>();
  for (const { session: s } of runs) {
    if (typeof s.repo_ref !== 'string' || !known.has(s.repo_ref) || s.archived_at != null) continue;
    if (typeof s.created_at !== 'number' || s.created_at < since) continue;
    const t = tally.get(s.repo_ref) ?? { n: 0, last: 0 };
    tally.set(s.repo_ref, { n: t.n + 1, last: Math.max(t.last, s.created_at) });
  }
  let best: [string, { n: number; last: number }] | null = null;
  for (const e of tally) if (best === null || e[1].n > best[1].n || (e[1].n === best[1].n && e[1].last > best[1].last)) best = e;
  return best?.[0] ?? null;
}

/**
 * Which repositories Understand's Ask starts with (integrator, 2026-10-27):
 *  1. on a project's page, that project's repositories (`projectRepoIds`, once read);
 *  2. otherwise the most active repository over the last {@link ACTIVE_WINDOW_DAYS} days;
 *  3. otherwise none ("all repositories"), never a repository picked by registration order.
 * The suggested questions are written from this choice ({@link suggestedQuestions} on the chosen
 * names), so they never name a repository the question would not read.
 */
export function defaultAskRepos(
  repos: ReadonlyArray<{ id: string }>,
  opts: {
    projectRepoIds: readonly string[] | null;
    runs: ReadonlyArray<{ session: { repo_ref?: string | null; created_at?: number | null; archived_at?: number | null } }>;
    now: number;
  },
): string[] {
  if (opts.projectRepoIds !== null) return repos.filter((r) => opts.projectRepoIds!.includes(r.id)).map((r) => r.id);
  const active = mostActiveRepo(repos, opts.runs, opts.now);
  return active === null ? [] : [active];
}

/** The words under the box that say what the question will read. */
export function askScopeWords(picked: number, onProject: boolean): string {
  if (picked === 0) return onProject ? 'Asks about this project’s repositories.' : 'Asks about all repositories.';
  return picked === 1 ? 'Asks about 1 repository.' : `Asks about ${picked} repositories.`;
}
