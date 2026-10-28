import type { SessionView } from '../api/types.js';
import { isAskTurnRun } from './askTurn.js';
import type { NeedRow } from './needsYou.js';
import { needCount, needSection } from './needsQueue.js';
import { createdAtMs } from './windowStats.js';

/**
 * THE ATTENTION MODEL: one pure module that defines what needs the operator, so no surface counts
 * it a second way. Every Desk number, sentence, row label and the rail badge read these.
 *
 *  - WAITING ON YOU (a run): `awaiting_human` at a gate a person must answer — `waitsOnYou`. An
 *    answered ask parked at its turn gate (crew's `ask_turn: true`, studio#588) is NOT: nothing is
 *    asked, a follow-up in its chat is optional, and its status word is "Answered".
 *    The waiting COUNT is the needs fold's decision rows (`waitingCount`): gate rows (built only
 *    for `waitsOnYou` runs), elicitations and steer requests.
 *  - OPEN FAILURE: a Needs you `failed-run` row — failed, unarchived, not retried (no run names it
 *    in `retry_of`), not replaced by its repo's re-index row (`openFailedIds`).
 *  - FAILED (in a window): the open failures LAUNCHED in the window; the rest of the open set is
 *    `older`; failed runs in the window that a retry answered are `retried` (said, not counted).
 *  - BADGE: decisions + failures (every row in those two sections, a group counting its members),
 *    never reviews (`attentionBadge`).
 *  - START TIME: `session.created_at` (unix SECONDS); for a run the wire left undated, the `ts` of
 *    its event log's `sessionStarted` (`startedSecs` → `withStartClocks`). Nothing else stands in.
 */

/** The one definition of "waiting on you" for a run. */
export function waitsOnYou(session: SessionView['session']): boolean {
  return session.status === 'awaiting_human' && !isAskTurnRun(session);
}

/** How many decisions wait on you: the fold's decision rows, members counted. */
export function waitingCount(rows: readonly NeedRow[]): number {
  return needCount(rows.filter((r) => needSection(r) === 'decision'));
}

/** The rows that "need you": decisions + failures, never reviews (the badge's set; the landing's card picks from it). */
export function attentionRows<T extends NeedRow>(rows: readonly T[]): T[] {
  return rows.filter((r) => { const s = needSection(r); return s === 'decision' || s === 'failure'; });
}

/** THE "need you" number (the rail and phone badge, the Desk): decisions + failures, never reviews. */
export function attentionBadge(rows: readonly NeedRow[]): number {
  return needCount(attentionRows(rows));
}

const FAIL_PREFIX = 'fail:';

/** The run ids of the open failures (the Needs you `failed-run` rows). */
export function openFailedIds(rows: readonly NeedRow[]): Set<string> {
  return new Set(rows.filter((r) => r.kind === 'failed-run' && r.key.startsWith(FAIL_PREFIX)).map((r) => r.key.slice(FAIL_PREFIX.length)));
}

export interface FailureCounts {
  /** Open failures launched in the window. */
  inWindow: SessionView[];
  /** Open failures launched before the window, or with no start time. */
  older: number;
  /** Failed runs launched in the window that a retry answered (not counted, said in the note). */
  retried: number;
}

/** The open failures split by the window `[now - days, now)` on the real start clock. */
export function failureCounts(runs: readonly SessionView[], rows: readonly NeedRow[], days: number, now: number): FailureCounts {
  const open = openFailedIds(rows);
  const live = runs.filter((v) => v.session.archived_at == null);
  const inside = (v: SessionView): boolean => { const at = createdAtMs(v); return at !== null && at >= now - days * 86_400_000 && at < now; };
  // Every run's `retry_of`, archived ones too — the same rule the needs fold drops a failure by.
  const retriedIds = new Set(runs.map((v) => v.session.retry_of).filter((id): id is string => typeof id === 'string' && id !== ''));
  const openRuns = live.filter((v) => v.session.status === 'failed' && open.has(v.session.id));
  const inWindow = openRuns.filter(inside);
  return {
    inWindow,
    older: openRuns.length - inWindow.length,
    retried: live.filter((v) => v.session.status === 'failed' && !open.has(v.session.id) && retriedIds.has(v.session.id) && inside(v)).length,
  };
}

/** The first `sessionStarted` ts in a run's events (unix MILLIS on the wire), as unix SECONDS, or null. */
export function startedSecs(events: readonly { type?: unknown; ts?: unknown }[]): number | null {
  const first = events.find((e) => e.type === 'sessionStarted' && typeof e.ts === 'number' && e.ts > 0);
  return first === undefined ? null : Math.floor((first.ts as number) / 1000);
}

/** The runs with `created_at` filled from `starts` (runId → unix seconds) where the wire left it out. */
export function withStartClocks(runs: readonly SessionView[], starts: ReadonlyMap<string, number | null>): SessionView[] {
  return runs.map((v) => {
    if (createdAtMs(v) !== null) return v;
    const at = starts.get(v.session.id);
    return typeof at === 'number' ? { ...v, session: { ...v.session, created_at: at } } : v;
  });
}
