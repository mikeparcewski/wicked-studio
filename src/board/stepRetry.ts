import type { SessionView } from '../api/types.js';

/**
 * studio#1489: A STEP THAT FAILED AND IS BEING TRIED AGAIN SAYS SO. Until now the header and the Now panel said only
 * "No output for N min" over a retry (train-17 J6 run B: `stepFailed` attempt 0, `failureTriaged` retry, then
 * `unitDispatched` attempt 1), so a 30 min job looked stuck, with no reason given.
 *
 * Pure: the run and its log in, the retry out. The words are closed. The cause comes from the failure's `failureKind`
 * through {@link CAUSE}. The triage judge's `analysis` and the worker's `detail` are model and worker text: they never
 * reach these words and stay in the run's log.
 */
export interface StepRetry {
  /** The step being tried again. */
  ord: number;
  /** The attempt running now (0-based on the wire; the page says attempt + 1). */
  attempt: number;
  /** The failure's kind, when the closed set knows it; else null. */
  kind: keyof typeof CAUSE | null;
}

const CAUSE = {
  workerError: 'a helper could not finish it',
  timeout: 'it ran out of time',
  timedOut: 'it ran out of time',
  environmentRefused: 'its working copy was refused',
} as const;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The triage decisions that send the step round again (wicked-core `TriageDecision`: `retry_with_flag` / `retry` /
 *  `escalate` / `fail`). */
const RETRY_DECISIONS: ReadonlySet<string> = new Set(['retry', 'retry_with_flag']);
/** Frames that end the run, wherever the step is. */
const RUN_ENDS: ReadonlySet<string> = new Set(['sessionFailed', 'sessionCompleted', 'runCancelled']);

/**
 * The step the run is trying again, or null. It is a retry only while the run is executing and the step's unit is not
 * done or rejected, when all of these hold for that step, whose newest dispatched attempt is A:
 *  - A is 1 or more. It is the highest attempt, not the last frame, so a lagging copy of an old dispatch never rolls
 *    it back. D is A's FIRST dispatch record;
 *  - attempt A - 1 failed. F is its first `stepFailed` record;
 *  - a retry triage for the step (`retry`, `retry_with_flag`) lies between F and D. With `seq` on all three it must sit
 *    between them by `seq`. A triage that repeats one logged before F (same decision and analysis: a replayed copy)
 *    does not count. So A came from THAT failure's retry, not from a reassign or a crash re-drive;
 *  - nothing after D ended attempt A or the run: a `unitDone`, `unitDenied`, `unitReassigned` or
 *    `crashRecoveryRedrive` for the step, a `stepFailed` for attempt A or later, or a frame that ends the run. A
 *    lagging copy of the old failure (attempt A - 1) does not end it.
 * Several steps qualifying (not expected) picks the one dispatched last.
 */
export function stepRetry(view: SessionView, events: readonly unknown[] | null | undefined): StepRetry | null {
  if (events == null || view.session.status !== 'executing') return null;
  const log = events as ReadonlyArray<Record<string, unknown>>;
  const newest = new Map<number, { attempt: number; at: number }>();
  log.forEach((e, i) => {
    const ord = num(e['ord']);
    const attempt = num(e['attempt']);
    if (e['type'] !== 'unitDispatched' || ord === null || attempt === null) return;
    const had = newest.get(ord);
    if (had === undefined || attempt > had.attempt) newest.set(ord, { attempt, at: i });
  });
  const seqOf = (e: Record<string, unknown>): number | null => num(e['seq']);
  let best: (StepRetry & { at: number }) | null = null;
  for (const [ord, { attempt, at: d }] of newest) {
    if (attempt < 1) continue;
    const unit = view.units.find((u) => u.ord === ord);
    if (unit !== undefined && (unit.status === 'done' || unit.status === 'rejected')) continue;
    const after = log.slice(d + 1);
    const ended = after.some((e) => RUN_ENDS.has(String(e['type'])) || (num(e['ord']) === ord && (
      e['type'] === 'unitDone' || e['type'] === 'unitDenied' || e['type'] === 'unitReassigned' || e['type'] === 'crashRecoveryRedrive'
      || (e['type'] === 'stepFailed' && (num(e['attempt']) ?? -1) >= attempt))));
    if (ended) continue;
    const f = log.findIndex((e) => e['type'] === 'stepFailed' && num(e['ord']) === ord && num(e['attempt']) === attempt - 1);
    if (f < 0 || f > d) continue;
    const failed = log[f]!;
    const dispatched = log[d]!;
    const seen = new Set(log.slice(0, f).filter((e) => e['type'] === 'failureTriaged' && num(e['ord']) === ord)
      .map((e) => `${String(e['decision'])}\u0000${String(e['analysis'])}`));
    const triaged = log.slice(f + 1, d).some((e) => {
      if (e['type'] !== 'failureTriaged' || num(e['ord']) !== ord || !RETRY_DECISIONS.has(String(e['decision']))) return false;
      if (seen.has(`${String(e['decision'])}\u0000${String(e['analysis'])}`)) return false;
      const [sf, st, sd] = [seqOf(failed), seqOf(e), seqOf(dispatched)];
      return sf === null || st === null || sd === null || (sf < st && st < sd);
    });
    if (!triaged) continue;
    const k = failed['failureKind'];
    const kind = typeof k === 'string' && Object.hasOwn(CAUSE, k) ? (k as keyof typeof CAUSE) : null;
    if (best === null || d > best.at) best = { ord, attempt, kind, at: d };
  }
  return best === null ? null : { ord: best.ord, attempt: best.attempt, kind: best.kind };
}

/** The header's words: "Trying again · attempt 2", and " · no output for N min" when the retry is silent too. */
export function retryBadge(r: StepRetry, silentMinutes: number | null): string {
  return `Trying again · attempt ${r.attempt + 1}${silentMinutes !== null ? ` · no output for ${silentMinutes} min` : ''}`;
}

/** The Now panel's sentence: "Research failed (a helper could not finish it); trying it again · attempt 2". */
export function retryLine(r: StepRetry, step: string | null, silentMinutes: number | null): string {
  const cause = r.kind !== null ? ` (${CAUSE[r.kind]})` : '';
  return `${step ?? 'A step'} failed${cause}; trying it again · attempt ${r.attempt + 1}${silentMinutes !== null ? ` · no output for ${silentMinutes} min` : ''}`;
}
