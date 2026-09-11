import type { CoreEvent } from '../api/types.js';
import { shortId } from './gateVerdictModel.js';

/**
 * runBase — how the run's BASE commit was chosen when its worktree was minted (wicked-core#431 /
 * F-3R2-013, api-types 0.33.0 `runBaseResolved`): the engine fetches `origin` and, when the
 * registered clone's `HEAD` is strictly behind the remote default branch's tip, bases the run on
 * that tip — so the worker starts from the current code and the deliver lift has nothing to move.
 *
 * Session-level (no `ord`), emitted once per freshly minted worktree BEFORE `worktreeReady`; a
 * resumed run reuses its live worktree and emits nothing, and a daemon that predates the frame
 * never sends it — every surface renders NOTHING then, never a base it did not see.
 */
export interface RunBaseView {
  /** The remote default ref (`origin/main`), or `null` when none could be resolved. */
  baseRef: string | null;
  /** The commit the run worktree was minted from. */
  baseCommit: string;
  /** The registered clone's `HEAD` at mint time. */
  localHead: string;
  /** How many commits `localHead` was behind `baseRef`; `0` when not behind or unknown. */
  behind: number;
  /** Whether `git fetch origin` succeeded (a failed fetch is disclosed in `note`, cached refs used). */
  fetched: boolean;
  /** `true` = the base moved off the clone's `HEAD` by `behind` commits. */
  lifted: boolean;
  /** Local unpushed work kept, a failed fetch, … — the engine's own words. */
  note: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** One `runBaseResolved` frame narrowed, or `null` for any other frame / a frame with no commit. */
export function runBaseOf(ev: CoreEvent): RunBaseView | null {
  if (ev.type !== 'runBaseResolved') return null;
  const baseCommit = str(ev.baseCommit);
  if (baseCommit === null || baseCommit === '') return null;
  return {
    baseRef: str(ev.baseRef),
    baseCommit,
    localHead: str(ev.localHead) ?? '',
    behind: typeof ev.behind === 'number' && Number.isFinite(ev.behind) && ev.behind > 0 ? Math.floor(ev.behind) : 0,
    fetched: ev.fetched !== false,
    lifted: ev.lifted === true,
    note: str(ev.note),
  };
}

/** The run's base as the LAST `runBaseResolved` in the log says it, or `null` when none was sent. */
export function runBase(events: readonly CoreEvent[]): RunBaseView | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const v = runBaseOf(events[i]!);
    if (v !== null) return v;
  }
  return null;
}

/**
 * The one-line note every surface prints (the run header row, the timeline, the feed):
 * "origin/main @ f57069d · 5 behind · lifted to the tip". Facts only, in the engine's own terms —
 * `lifted` is the engine's word for "the base moved off the clone's HEAD", not a claim about a PR.
 */
export function runBaseLine(v: RunBaseView): string {
  const at = `@ ${shortId(v.baseCommit, 7)}`;
  const parts: string[] = [];
  if (v.baseRef === null) {
    parts.push(`local HEAD ${at}`, 'no remote default branch resolved');
  } else if (v.lifted) {
    parts.push(`${v.baseRef} ${at}`, `${v.behind} behind`, 'lifted to the tip');
  } else {
    parts.push(`${v.baseRef} ${at}`, v.note === null ? 'at the tip' : 'local HEAD kept');
  }
  if (!v.fetched) parts.push('fetch failed — cached refs');
  return parts.join(' · ');
}
