import type { SessionView } from '../api/types.js';
import { clockTime } from './handover.js';

/**
 * "SINCE YOU WERE LAST HERE" (studio wave 2b, behaviour 7) — the pure half.
 *
 * Leaving a project snapshots its runs' statuses; returning compares that snapshot with
 * the live run list. The run wire carries no per-status clocks, so the snapshot IS the
 * honest clock: a run that was live when you left and is terminal now finished while
 * you were away — whatever its `ended_at` says or omits.
 */

/** A project's runs at the moment the operator left it: run id → status. */
export type StatusSnapshot = Record<string, string>;

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

export function snapshotStatuses(runs: readonly SessionView[]): StatusSnapshot {
  const out: StatusSnapshot = {};
  for (const v of runs) if (v.session.archived_at == null) out[v.session.id] = v.session.status;
  return out;
}

export interface BriefCounts {
  /** Live when you left, completed now. */
  finished: number;
  /** Live when you left, failed now. */
  failed: number;
  /** Runs that did not exist when you left. */
  started: number;
  /** Open decisions now: runs waiting on a human. */
  gates: number;
}

export function projectBrief(before: StatusSnapshot, runs: readonly SessionView[]): BriefCounts {
  const counts: BriefCounts = { finished: 0, failed: 0, started: 0, gates: 0 };
  for (const v of runs) {
    if (v.session.archived_at != null) continue;
    const was = before[v.session.id];
    const now = v.session.status;
    if (now === 'awaiting_human') counts.gates += 1;
    if (was === undefined) {
      counts.started += 1;
      continue;
    }
    if (!TERMINAL.has(was) && TERMINAL.has(now)) {
      if (now === 'failed') counts.failed += 1;
      else if (now === 'completed') counts.finished += 1;
    }
  }
  return counts;
}

/** True when the brief has something to say. */
export function briefHasNews(c: BriefCounts): boolean {
  return c.finished + c.failed + c.started + c.gates > 0;
}

const n = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;

/** "since 14:05: 1 run finished, 1 gate" — what changed first, then the open decisions. */
export function briefLine(since: number, c: BriefCounts): string {
  const parts: string[] = [];
  if (c.finished > 0) parts.push(`${n(c.finished, 'run', 'runs')} finished`);
  if (c.failed > 0) parts.push(`${n(c.failed, 'run', 'runs')} failed`);
  if (c.started > 0) parts.push(`${n(c.started, 'new run', 'new runs')}`);
  if (c.gates > 0) parts.push(n(c.gates, 'gate', 'gates'));
  return `since ${clockTime(since)}: ${parts.join(', ')}`;
}
