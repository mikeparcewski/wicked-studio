import type { CoreEvent } from '../api/types.js';
import type { OpenGate } from '../store/gates.js';
import type { GateAnswer } from './gateActions.js';
import type { GateRowChoice } from './gateRowModel.js';

/**
 * A JOB THAT KEEPS GOING (domain-graph-3): a domain-extraction run maps a repository one page at a time and loops
 * back for the next page until the target or the operator's word. Each page ends with the engine's `stepRepeated`
 * frame carrying the step's own progress line — "Mapping wicked-crew · 3% → 12% → 19% · target 80% · page 4 · about
 * 2 h left" — and a spent budget opens a `repeat` ask whose `repeatLine` says the same with why it stopped. That one
 * line is the job's headline while it runs, and what the requirements view says while the graph is not built yet.
 * Pure: everything is read off the run's events and the requirements read.
 */

/** Events after which a loop's ask is no longer open: the run moved on (an answer re-ran a step) or ended. */
const ASK_CLOSED_BY = new Set(['resumed', 'unitExecuting', 'unitDispatched', 'runCancelled', 'sessionCompleted', 'sessionFailed']);

/** Events that put the run on a step (or a step's own gate before it runs): one past the loop's own step means the loop
 *  is over. */
const STEP_STARTED_BY = new Set(['unitExecuting', 'unitDispatched', 'awaitingHuman']);

/** The event types {@link repeatLineOf} reads: a caller that fetches a subset of the trail asks for these. */
export const REPEAT_LINE_EVENTS = ['stepRepeated', 'awaitingHuman', 'resumed', 'unitExecuting', 'unitDispatched'] as const;

/**
 * The run's latest progress line, or null when no page has finished yet (or the run is not a loop). An ask's line
 * ("… budget reached …") counts only while that ask is open: once the run moved on, the newest page's line stands
 * (agy on the studio branch: the operator chose "Map more" and the header still said the budget was reached).
 *
 * studio#1366: a loop that is done says nothing more. The engine emits `stepRepeated` only when it sends the run back
 * for another page; a page that reached the minimum (or an answer that finished with what was found) lets the run move
 * on with no frame of its own. So once a step AFTER the loop's step is dispatched, runs, or opens its gate before it
 * runs ("ask me before every step"), the last page's "42% · about 41 min left" is history, and the line is null.
 */
export function repeatLineOf(events: readonly CoreEvent[] | null | undefined): string | null {
  const list = events ?? [];
  let movedOn = false;
  /** The furthest step the run started after the event being read (scanning back from the newest). */
  let reached = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i] as unknown as Record<string, unknown>;
    const type = e['type'];
    if (typeof type === 'string' && ASK_CLOSED_BY.has(type)) movedOn = true;
    if (typeof type === 'string' && STEP_STARTED_BY.has(type) && typeof e['ord'] === 'number' && e['ord'] > reached) reached = e['ord'];
    const loopOver = typeof e['ord'] === 'number' && reached > e['ord'];
    if (type === 'stepRepeated' && typeof e['line'] === 'string' && e['line'].trim() !== '') return loopOver ? null : e['line'].trim();
    if (type === 'awaitingHuman' && e['gateKind'] === 'repeat' && !movedOn && !loopOver
      && typeof e['repeatLine'] === 'string' && e['repeatLine'].trim() !== '') return e['repeatLine'].trim();
  }
  return null;
}

const LIVE = new Set(['planning', 'distributing', 'executing', 'awaiting_human']);

/** Whether a session status is a run still going (crew's published non-terminal statuses). */
export function isLiveStatus(status: string): boolean {
  return LIVE.has(status);
}

/**
 * The headline's progress line for a set of runs: the newest LIVE run's line, or nothing. A finished, stopped or failed
 * run says nothing here (its badge says it ended), and an older run never speaks for a newer one.
 */
export function headlineProgress(
  runs: readonly { session: { id: string; status: string; created_at?: number | null } }[],
  eventsByRun: Readonly<Record<string, readonly CoreEvent[] | undefined>>,
): string | null {
  // The newest live run alone speaks (codex r2 on the branch): an older run's line never stands in for a newer run
  // that has not finished its first page, or does not loop.
  const newest = runs
    .filter((v) => isLiveStatus(v.session.status))
    .reduce<(typeof runs)[number] | null>((best, v) => (best === null || (v.session.created_at ?? 0) > (best.session.created_at ?? 0) ? v : best), null);
  return newest === null ? null : repeatLineOf(eventsByRun[newest.session.id]);
}

/** How many pages the run has finished (the newest `stepRepeated` pass), or 0. */
export function pagesDoneOf(events: readonly CoreEvent[] | null | undefined): number {
  const list = events ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i] as unknown as Record<string, unknown>;
    if (e['type'] === 'stepRepeated' && typeof e['pass'] === 'number') return e['pass'];
  }
  return 0;
}

/** The newest `awaitingHuman` frame for a gate's step. */
function frameOf(gate: OpenGate, events: readonly CoreEvent[] | null): Record<string, unknown> | null {
  const list = events ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i] as unknown as Record<string, unknown>;
    if (e['type'] === 'awaitingHuman' && e['ord'] === gate.ord) return e;
  }
  return null;
}

export const BUDGET_QUESTION = 'The budget for this job is spent — keep going?';

/** studio#1082: the first matching stop reason names the repeat ask. */
export function repeatQuestion(line: string | null | undefined): string {
  const text = line ?? '';
  if (/nothing (?:is )?left to map/i.test(text)) return 'Nothing is left to map and the minimum isn’t met — finish with what was found, or stop?';
  if (/(?:resolved|answered) under 1 in \d+ of its units/i.test(text)) return 'The last page resolved almost none of its units — read its review before you choose';
  if (/out of reach/i.test(text)) return 'The minimum is out of reach in this run — keep going anyway?';
  if (/added no real requirement/i.test(text)) return 'The last two pages added no real requirement — keep going?';
  if (/budget reached/i.test(text)) return BUDGET_QUESTION;
  return 'The job stopped to ask how to go on';
}

const STOP_TITLE = 'End the job here. The real requirements found so far are kept, and a later run continues from them.';

/**
 * A `repeat` ask's answers, from its frame, each with the label the step gave it: its own choices (`consent:<id>`
 * tokens — "Map up to 20 more pages", "Lower the target to 23% for wicked-crew and build the graph"), or `approve`
 * ("Run it again") when it offered none, and `reject` (stop: the run ends and the real requirements found so far are kept). Nothing is
 * preselected; the step's recommendation is marked. Null when the frame names no answer (the row keeps its generic
 * approve / stop).
 */
export function repeatChoicesOf(gate: OpenGate, events: readonly CoreEvent[] | null): GateRowChoice[] | null {
  const frame = frameOf(gate, events);
  const tokens = frame !== null && Array.isArray(frame['choices']) ? (frame['choices'] as unknown[]) : (gate.choices ?? []);
  if (!tokens.some((t) => typeof t === 'string' && (t.startsWith('consent:') || t === 'approve'))) return null;
  const labels = ((frame?.['choiceLabels'] ?? {}) as Record<string, unknown>);
  // The frame's own recommendation, or none (an ask without one recommends nothing); the cached gate's only when no
  // frame is at hand.
  const rec = frame !== null ? (typeof frame['recommended'] === 'number' ? frame['recommended'] : undefined) : gate.recommended;
  const labelOf = (t: string, fallback: string): string => (typeof labels[t] === 'string' && labels[t] !== '' ? (labels[t] as string) : fallback);
  const out: GateRowChoice[] = [];
  tokens.forEach((t, i) => {
    if (typeof t !== 'string') return;
    const mark = rec === i ? { isDefault: true } : {};
    if (t.startsWith('consent:')) {
      const label = labelOf(t, t.slice('consent:'.length));
      out.push({ key: t, label, decision: { approve: true, action: t } as unknown as GateAnswer, note: 'none', title: label, ...mark });
    } else if (t === 'approve') {
      const label = labelOf(t, 'Run it again');
      out.push({ key: 'approve', label, decision: { approve: true }, note: 'none', title: 'Run the step again.', ...mark });
    } else if (t === 'reject') {
      out.push({ key: 'stop', label: labelOf(t, 'Stop here'), decision: { approve: false }, note: 'required', title: STOP_TITLE, ...mark });
    }
  });
  // Stop is always an answer, even if a producer's list left it out.
  if (!out.some((c) => c.key === 'stop')) out.push({ key: 'stop', label: 'Stop here', decision: { approve: false }, note: 'required', title: STOP_TITLE });
  return out;
}

