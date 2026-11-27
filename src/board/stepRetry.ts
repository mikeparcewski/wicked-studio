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

/**
 * The step the run is trying again, or null. It is a retry only while the run is executing and the step's unit is not
 * done or rejected, when all of these hold for that step:
 *  - its newest dispatched attempt A is 1 or more. This is the highest attempt, not the last frame, so a lagging copy
 *    of an old dispatch never rolls it back;
 *  - a `stepFailed` for an earlier attempt is logged (the highest such attempt, at its first record), and a
 *    `failureTriaged` with decision `retry` for the step follows it;
 *  - nothing ended attempt A: a `unitDone` or `unitDenied` for the step, or a `stepFailed` for attempt A or later. A
 *    lagging copy of the old failure does not end it.
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
  let best: (StepRetry & { at: number }) | null = null;
  for (const [ord, { attempt, at }] of newest) {
    if (attempt < 1) continue;
    const unit = view.units.find((u) => u.ord === ord);
    if (unit !== undefined && (unit.status === 'done' || unit.status === 'rejected')) continue;
    const mine = log.filter((e) => num(e['ord']) === ord);
    const ended = mine.some((e) => e['type'] === 'unitDone' || e['type'] === 'unitDenied'
      || (e['type'] === 'stepFailed' && (num(e['attempt']) ?? -1) >= attempt));
    if (ended) continue;
    // The failure the retry answers: the highest earlier attempt that failed, at its FIRST record (a late copy of the
    // same failure, appended after the retry began, is not a new failure).
    let failedAt = -1;
    let failedAttempt = -1;
    mine.forEach((e, i) => {
      const a = num(e['attempt']);
      if (e['type'] === 'stepFailed' && a !== null && a < attempt && a > failedAttempt) { failedAt = i; failedAttempt = a; }
    });
    if (failedAt < 0) continue;
    const triaged = mine.slice(failedAt + 1).some((e) => e['type'] === 'failureTriaged' && e['decision'] === 'retry');
    if (!triaged) continue;
    const k = mine[failedAt]!['failureKind'];
    const kind = typeof k === 'string' && Object.hasOwn(CAUSE, k) ? (k as keyof typeof CAUSE) : null;
    if (best === null || at > best.at) best = { ord, attempt, kind, at };
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
