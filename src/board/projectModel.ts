import type { ProjectMember, RepoEntry, SessionView } from '../api/types.js';
import { needRunId } from './deskModel.js';
import type { NeedRow } from './needsYou.js';
import { createdAtMs } from './windowStats.js';

/**
 * THE PROJECT DASHBOARD's model (DES-frontdoor concept P). Pure folds over what the page already
 * reads: the project's members (`GET /projects/:id`), the app's run list (`GET /runs`) and the repo
 * register (`GET /repos`). The numbers and sentences reuse the Desk's (`board/deskPulse.ts`), so the
 * Desk and a project page can never disagree on a window or a duration.
 */

const RUN_KIND = 'crew.run';
const REPO_KIND = 'crew.repo';

/** The project's runs: every `crew.run` member the run list holds, and any run the daemon files in it. */
export function projectRuns(runs: readonly SessionView[], members: readonly ProjectMember[], projectId: string): SessionView[] {
  const refs = new Set(members.filter((m) => m.member_kind === RUN_KIND).map((m) => m.member_ref));
  return runs.filter((v) => refs.has(v.session.id) || (typeof v.session.project_id === 'string' && v.session.project_id === projectId));
}

export interface RepoUse {
  repo: RepoEntry | null;
  /** The ref the runs or the membership name it by (an id, or a legacy name). */
  ref: string;
  name: string;
  /** How many of the project's jobs worked in it. */
  jobs: number;
  attached: boolean;
}

/**
 * The repositories the project's jobs actually used, beside the ones attached to it: a repo that
 * work ran in but nobody attached is the "No repository attached" dead end, offered an Attach.
 * Attached first, then by jobs; a ref the register no longer holds keeps its name and no repo.
 */
export function reposUsed(runs: readonly SessionView[], members: readonly ProjectMember[], register: readonly RepoEntry[]): RepoUse[] {
  const find = (ref: string): RepoEntry | null => register.find((r) => r.id === ref || r.name === ref) ?? null;
  const byKey = new Map<string, RepoUse>();
  const keyOf = (ref: string): string => find(ref)?.id ?? ref;
  for (const m of members) {
    if (m.member_kind !== REPO_KIND) continue;
    const repo = find(m.member_ref);
    byKey.set(keyOf(m.member_ref), { repo, ref: m.member_ref, name: repo?.name ?? m.member_ref, jobs: 0, attached: true });
  }
  for (const v of runs) {
    const ref = v.session.repo_ref;
    if (typeof ref !== 'string' || ref === '') continue;
    const k = keyOf(ref);
    const cur = byKey.get(k);
    if (cur !== undefined) cur.jobs += 1;
    else {
      const repo = find(ref);
      byKey.set(k, { repo, ref: repo?.id ?? ref, name: repo?.name ?? ref, jobs: 1, attached: false });
    }
  }
  return [...byKey.values()].sort((a, b) => Number(b.attached) - Number(a.attached) || b.jobs - a.jobs || a.name.localeCompare(b.name));
}

/** The needs-you rows about this project's runs (a row names its run in its key). */
export function projectNeeds(rows: readonly NeedRow[], runIds: ReadonlySet<string>): NeedRow[] {
  return rows.filter((r) => {
    const id = needRunId(r);
    return id !== null && runIds.has(id);
  });
}

/** "Created 5 weeks ago · 5 jobs · 3 repositories used, 1 attached" — the facts under the name. */
export function projectMeta(createdWords: string | null, jobs: number, repos: readonly RepoUse[]): string {
  const used = repos.filter((r) => r.jobs > 0).length;
  const attached = repos.filter((r) => r.attached).length;
  const repoWords = used === 0 && attached === 0 ? 'no repositories yet'
    : used === 0 ? `${attached} ${attached === 1 ? 'repository' : 'repositories'} attached`
      : `${used} ${used === 1 ? 'repository' : 'repositories'} used, ${attached === 0 ? 'none' : attached} attached`;
  return [createdWords, `${jobs} ${jobs === 1 ? 'job' : 'jobs'}`, repoWords].filter((x): x is string => x !== null).join(' · ');
}

/** Jobs by state, all time: the stacked bar's parts, in a fixed order. */
export interface StateCount { key: 'working' | 'waiting' | 'finished' | 'failed' | 'cancelled'; label: string; count: number; tone: string }

export function stateCounts(runs: readonly SessionView[]): StateCount[] {
  const live = runs.filter((v) => v.session.archived_at == null);
  const of = (pred: (s: string) => boolean): number => live.filter((v) => pred(v.session.status)).length;
  return [
    { key: 'working', label: 'working', count: of((s) => s === 'planning' || s === 'distributing' || s === 'executing'), tone: 'run' },
    { key: 'waiting', label: 'waiting on you', count: of((s) => s === 'awaiting_human'), tone: 'gate' },
    { key: 'finished', label: 'finished', count: of((s) => s === 'completed'), tone: 'ok' },
    { key: 'failed', label: 'failed', count: of((s) => s === 'failed'), tone: 'fail' },
    { key: 'cancelled', label: 'cancelled', count: of((s) => s === 'cancelled'), tone: 'quiet' },
  ];
}

/** The quality-check verdicts of the jobs read: passed of recorded; `recorded: 0` = none recorded. */
export interface QualityTally { read: number; recorded: number; passed: number }

export function qualityTally(gates: readonly ({ verdict: string | null; satisfied: boolean } | null)[]): QualityTally {
  const known = gates.filter((g): g is { verdict: string | null; satisfied: boolean } => g !== null);
  const recorded = known.filter((g) => g.verdict !== null);
  return { read: known.length, recorded: recorded.length, passed: recorded.filter((g) => g.satisfied).length };
}

/** Newest launch first; undated runs last. */
export function newestFirst(runs: readonly SessionView[]): SessionView[] {
  return [...runs].sort((a, b) => (createdAtMs(b) ?? -1) - (createdAtMs(a) ?? -1));
}
