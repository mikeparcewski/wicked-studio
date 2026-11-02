/**
 * The engine's repo-checks floor says it is working in its own words, streamed as the step's output
 * (`unitOutputDelta`), every 5 min: "repo checks floor (creator): running the repository's own checks — 10 min; now
 * `test` on the change (pass 1 of `test`), 8 min in". No other frame says a floor is running (its result is
 * `repoChecksEvaluated`), so these lines are the floor's events. Import-free: the run event store keeps these deltas
 * (and only these) by this test.
 *
 * The judge that reviews a hand-off BEFORE the floor (core#1211) says itself the same way, on the same stream: "judge: a
 * judge seat is reviewing the change before the checks run — 0 min" as it starts, then every 5 min. Without it the 1.5
 * min between the hand-off and the floor read as silence.
 */

const JUDGE = /judge: an? (?:judge|distinct) seat is reviewing the change(?: before the checks run)?\s*[—-]\s*(\d+) min/gu;
const FLOOR = /repo checks floor \(([^)]*)\): running the repository's own checks\s*[—-]\s*(\d+) min(?:; now `([^`]+)`)?/gu;

export interface FloorLine {
  /** `checks`: the floor running the repository's checks; `judge`: the judge reviewing the change before them. */
  phase: 'checks' | 'judge';
  /** The floor's role as the engine names it: `creator`, `verify`, … */
  role: string;
  /** Whole minutes the floor has been running when it said this line. */
  minutes: number;
  /** The check running now (`test`), when the line names one. */
  check: string | null;
}

/** The newest floor line in a streamed chunk (a chunk may carry two), or null when it has none. */
export function floorLineOf(text: unknown): FloorLine | null {
  if (typeof text !== 'string' || (!text.includes('repo checks floor (') && !text.includes('judge: '))) return null;
  let last: { at: number; line: FloorLine } | null = null;
  const take = (at: number, line: FloorLine): void => { if (last === null || at >= last.at) last = { at, line }; };
  for (const m of text.matchAll(FLOOR)) take(m.index, { phase: 'checks', role: m[1]!, minutes: Number(m[2]), check: m[3] ?? null });
  for (const m of text.matchAll(JUDGE)) take(m.index, { phase: 'judge', role: 'judge', minutes: Number(m[1]), check: null });
  return (last as { at: number; line: FloorLine } | null)?.line ?? null;
}

/** A frame that is the floor talking: an output delta carrying a floor line. */
export function isFloorDelta(e: { type: string; text?: unknown }): boolean {
  return e.type === 'unitOutputDelta' && floorLineOf(e.text) !== null;
}
