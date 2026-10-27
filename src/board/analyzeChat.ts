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

/**
 * Which repositories Understand's Ask starts with: none on a project's page (the project is the
 * scope, and its graph grounds it), else the most recently registered one (one repository binds its
 * own graph; several without a project bind none). The operator changes the choice before asking.
 */
export function defaultAskRepos(repos: ReadonlyArray<{ id: string; registered_at?: number }>, project: string | null): string[] {
  if (project !== null || repos.length === 0) return [];
  const newest = [...repos].sort((a, b) => (b.registered_at ?? 0) - (a.registered_at ?? 0))[0]!;
  return [newest.id];
}

/** The words under the box that say what the question will read. */
export function askScopeWords(picked: number, onProject: boolean): string {
  if (picked === 0) return onProject ? 'Asks about this project’s repositories.' : 'Asks about all repositories.';
  return picked === 1 ? 'Asks about 1 repository.' : `Asks about ${picked} repositories.`;
}
