import type { RepoEntry, SessionView } from '../api/types.js';
import { outcomeOf } from './metrics.js';
import { statusCounts, type StatusCounts } from './windowStats.js';

/**
 * The Repositories section's fold layer (lane B, the 0.4.6 command-surface
 * treatment): pure derivations over what the wires HONESTLY serve —
 *
 *  - `GET /repos` carries the register only: `{id, name, root_path,
 *    default_branch, registered_at, git_url?, code_graph_db?}` — NO
 *    indexed-version or last-indexed field exists on this wire, so a "stale
 *    graph" clock cannot be derived from it and no fold here pretends to;
 *  - `GET /runs` carries every run's `repo_ref` + `workflow_id`, and the
 *    onboarding workflow (`onboarding` — index + annotate) IS the graph
 *    build. So the honest per-repo graph story is the repo's newest
 *    onboarding run: completed = ready, failed = the graph build failed,
 *    non-terminal = building now, none on record = never onboarded (as far
 *    as the run history can say).
 *
 * Windowed counts reuse `statusCounts`/`outcomeOf` — never re-implemented.
 */

/** The graph-building workflow's id (crew's BUILTIN_WORKFLOWS). */
export const ONBOARDING_WORKFLOW_ID = 'onboarding';

/**
 * A repo's graph state, derived from its newest onboarding run:
 *  - `ready`      — newest decisive onboard completed;
 *  - `onboarding` — an onboard run is in flight right now;
 *  - `failed`     — newest decisive onboard failed;
 *  - `never`      — no onboarding run on record (the run history is the only
 *    witness this wire offers, and the label must say so).
 * Cancelled onboards are skipped, not verdicts — an operator withdrew them.
 */
export type OnboardState = 'ready' | 'onboarding' | 'failed' | 'never';

export interface RepoOnboard {
  state: OnboardState;
  /** The run the state derives from (`null` only for `never`). */
  run: SessionView | null;
}

/** One repo's fleet-card model — one fold per card, shared by grid and chips. */
export interface RepoFleetModel {
  repo: RepoEntry;
  /** The repo's runs inside the current recency window (unarchived). */
  windowed: SessionView[];
  counts: StatusCounts;
  /** Runs waiting on a human RIGHT NOW — unwindowed (a gate is a gate). */
  waiting: SessionView[];
  activeNow: boolean;
  /** Failed runs in the window, or the graph build itself failed. */
  failing: boolean;
  onboard: RepoOnboard;
  /** Newest attach clock among the repo's runs; `null` = no clock known. */
  lastAt: number | null;
}

/**
 * A repo's graph state off the salience-ordered run list (daemon order:
 * actionable first, then newest first — the same positional idiom every
 * window fold rides). First in-flight onboard wins (`onboarding`); otherwise
 * the first terminal, non-cancelled onboard is the verdict.
 */
export function repoOnboard(runs: readonly SessionView[], repoId: string): RepoOnboard {
  let verdict: RepoOnboard | null = null;
  for (const v of runs) {
    const s = v.session;
    if (s.archived_at != null || s.repo_ref !== repoId || s.workflow_id !== ONBOARDING_WORKFLOW_ID) continue;
    const o = outcomeOf(s.status);
    if (o === 'run' || o === 'gate') return { state: 'onboarding', run: v };
    if (o === 'cancelled') continue; // withdrawn, not a verdict — look further back
    if (verdict === null) verdict = { state: o === 'done' ? 'ready' : 'failed', run: v };
  }
  return verdict ?? { state: 'never', run: null };
}

/**
 * Every repo's card model, attention-ordered: needs-you floats FIRST, then
 * failing, then active, then newest activity, then name. `repoRuns` is the
 * unarchived repo-linked run list in daemon order; `windowIds` is the current
 * recency window's membership (the page's `windowBuckets` output).
 */
export function repoFleetModels(
  repos: readonly RepoEntry[],
  repoRuns: readonly SessionView[],
  attachedAt: Record<string, number>,
  windowIds: ReadonlySet<string>,
): RepoFleetModel[] {
  return repos.map((repo) => {
    const mine = repoRuns.filter((v) => v.session.repo_ref === repo.id);
    const windowed = mine.filter((v) => windowIds.has(v.session.id));
    const counts = statusCounts(windowed);
    const onboard = repoOnboard(mine, repo.id);
    const clocks = mine
      .map((v) => attachedAt[v.session.id])
      .filter((t): t is number => typeof t === 'number');
    return {
      repo,
      windowed,
      counts,
      waiting: mine.filter((v) => v.session.status === 'awaiting_human'),
      activeNow: mine.some((v) => outcomeOf(v.session.status) === 'run'),
      failing: counts.failed > 0 || onboard.state === 'failed',
      onboard,
      lastAt: clocks.length > 0 ? Math.max(...clocks) : null,
    };
  }).sort((a, b) =>
    (b.waiting.length > 0 ? 1 : 0) - (a.waiting.length > 0 ? 1 : 0)
    || (b.failing ? 1 : 0) - (a.failing ? 1 : 0)
    || (b.activeNow ? 1 : 0) - (a.activeNow ? 1 : 0)
    || (b.lastAt ?? 0) - (a.lastAt ?? 0)
    || a.repo.name.localeCompare(b.repo.name),
  );
}

export type RepoChip = 'all' | 'needs-you' | 'active' | 'failing' | 'ready' | 'never';

export function matchesRepoChip(m: RepoFleetModel, chip: RepoChip): boolean {
  if (chip === 'all') return true;
  if (chip === 'needs-you') return m.waiting.length > 0;
  if (chip === 'active') return m.activeNow;
  if (chip === 'failing') return m.failing;
  if (chip === 'ready') return m.onboard.state === 'ready';
  return m.onboard.state === 'never'; // never onboarded (no run on record)
}
