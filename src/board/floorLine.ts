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
/** (studio#1441) The steering-rule check, each a whole line of the engine's own (`engine_note` writes "\n{text}\n", so a
 *  line quoted in a seat's output is not one): its judges note ("rule check: 5 steering rule(s) in force; judges: codex,
 *  pi") as it starts, its heartbeat ("rule check: judging the steering rules — 10 min", every 5 min), and its summary
 *  ("rule check: 5 rules checked: 5 kept, 0 broken, 0 not applicable (702113 ms)") as it ends (`cli_runner.rs`). */
const RULES = /(?:^|\n)rule check: judging the steering rules\s*[—-]\s*(\d+) min(?:;[^\n]*)?(?=\n|$)/gu;
const RULE_JUDGES = /(?:^|\n)rule check: \d+ steering rules?(?:\(s\))? in force; judges: ([^\n]*)/gu;
const RULES_DONE = /(?:^|\n)rule check: \d+ rules? checked: [^\n]*\(\d+ ms\)(?=\n|$)/gu;
const FLOOR = /repo checks floor \(([^)]*)\): running the repository's own checks\s*[—-]\s*(\d+) min(?:; now `([^`]+)`)?/gu;

export interface FloorLine {
  /** `checks`: the floor running the repository's checks; `judge`: the judge reviewing the change before them;
   *  `rules`: the engine judging the steering rules (studio#1441). */
  phase: 'checks' | 'judge' | 'rules';
  /** The floor's role as the engine names it: `creator`, `verify`, … */
  role: string;
  /** Whole minutes the floor has been running when it said this line. */
  minutes: number;
  /** The check running now (`test`), when the line names one. */
  check: string | null;
  /** The rule check's judges (seat keys), when the line names them. */
  judges?: string[];
  /** The rule check's summary: it is over. */
  done?: boolean;
}

/** The newest floor line in a streamed chunk (a chunk may carry two), or null when it has none. */
export function floorLineOf(text: unknown): FloorLine | null {
  if (typeof text !== 'string' || (!text.includes('repo checks floor (') && !text.includes('judge: ') && !text.includes('rule check: '))) return null;
  let last: { at: number; line: FloorLine } | null = null;
  const take = (at: number, line: FloorLine): void => { if (last === null || at >= last.at) last = { at, line }; };
  for (const m of text.matchAll(FLOOR)) take(m.index, { phase: 'checks', role: m[1]!, minutes: Number(m[2]), check: m[3] ?? null });
  for (const m of text.matchAll(JUDGE)) take(m.index, { phase: 'judge', role: 'judge', minutes: Number(m[1]), check: null });
  for (const m of text.matchAll(RULES)) take(m.index, { phase: 'rules', role: 'rules', minutes: Number(m[1]), check: null });
  let judges: string[] | undefined;
  for (const m of text.matchAll(RULE_JUDGES)) {
    judges = m[1]!.split(',').map((s) => s.trim()).filter((s) => s !== '' && s !== 'none');
    take(m.index, { phase: 'rules', role: 'rules', minutes: 0, check: null, judges });
  }
  for (const m of text.matchAll(RULES_DONE)) take(m.index, { phase: 'rules', role: 'rules', minutes: 0, check: null, done: true });
  const line = (last as { at: number; line: FloorLine } | null)?.line ?? null;
  // The judges note and the first tick can come in one chunk: the tick keeps the judges the note named.
  return line !== null && line.phase === 'rules' && line.done !== true && line.judges === undefined && judges !== undefined ? { ...line, judges } : line;
}

/** A frame that is the floor talking: an output delta carrying a floor line. */
export function isFloorDelta(e: { type: string; text?: unknown }): boolean {
  return e.type === 'unitOutputDelta' && floorLineOf(e.text) !== null;
}
