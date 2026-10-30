/**
 * The engine's repo-checks floor says it is working in its own words, streamed as the step's output
 * (`unitOutputDelta`), every 5 min: "repo checks floor (creator): running the repository's own checks — 10 min; now
 * `test` on the change (pass 1 of `test`), 8 min in". No other frame says a floor is running (its result is
 * `repoChecksEvaluated`), so these lines are the floor's events. Import-free: the run event store keeps these deltas
 * (and only these) by this test.
 */

const FLOOR = /repo checks floor \(([^)]*)\): running the repository's own checks\s*[—-]\s*(\d+) min(?:; now `([^`]+)`)?/gu;

export interface FloorLine {
  /** The floor's role as the engine names it: `creator`, `verify`, … */
  role: string;
  /** Whole minutes the floor has been running when it said this line. */
  minutes: number;
  /** The check running now (`test`), when the line names one. */
  check: string | null;
}

/** The newest floor line in a streamed chunk (a chunk may carry two), or null when it has none. */
export function floorLineOf(text: unknown): FloorLine | null {
  if (typeof text !== 'string' || !text.includes('repo checks floor (')) return null;
  let last: FloorLine | null = null;
  for (const m of text.matchAll(FLOOR)) last = { role: m[1]!, minutes: Number(m[2]), check: m[3] ?? null };
  return last;
}

/** A frame that is the floor talking: an output delta carrying a floor line. */
export function isFloorDelta(e: { type: string; text?: unknown }): boolean {
  return e.type === 'unitOutputDelta' && floorLineOf(e.text) !== null;
}
