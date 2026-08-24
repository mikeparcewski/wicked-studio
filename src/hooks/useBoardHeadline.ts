import type { SessionView, WorkUnit } from '../api/types.js';
import { outputKey, useRuntimeStore, type LoggedEvent } from '../store/runtime.js';

/**
 * The board card's narration altitude (DES-MERGE-001 §3.4(b)).
 *
 * The thread and the board card read the SAME `unitOutputDelta` stream out of the
 * same runtime store, but they are not the same component and must not render the
 * same thing: the thread shows a 4 KB scrolling tail, the card gets ONE line and
 * no scroll. This module is that reduction — the last *meaningful* line, never a
 * raw dump, and never a bare "Working…" (§3.3: every status names its subject).
 */

/** Statuses in which a run has stopped narrating — a terminal run has no live line. */
const TERMINAL: ReadonlySet<string> = new Set(['completed', 'cancelled', 'failed']);

/** Is this run still in flight? A gated run is: it is paused, not finished. */
export function isLive(view: SessionView): boolean {
  return !TERMINAL.has(view.session.status);
}

/**
 * Frames that name a phase transition — §3.4(b) rule 1's "explicit structured
 * status". Their `detail` is already the store's one-line summary of the frame.
 */
const STRUCTURED: ReadonlySet<string> = new Set([
  'sessionStarted',
  'unitPlanned',
  'unitDistributed',
  'unitExecuting',
  'unitDone',
  'unitDenied',
  'awaitingHuman',
  'resumed',
  'workerStalled',
  'stepFailed',
]);

/** One card line, so a chatty worker cannot widen or wrap the fixed-height card. */
const HEADLINE_CAP = 110;

/** CSI escapes (colour, cursor moves) — invisible in a terminal, noise on a card. */
const ANSI = /\u001B\[[0-9;?]*[ -\u002F]*[@-~]/g;
/** Progress-bar redraws: block-glyph runs and ASCII bars say nothing (§3.4(b) rule 2). */
const PROGRESS = /[█▉▊▋▌▍▎▏▁▂▃▄▅▆▇░▒▓]{2,}|[=#*.-]{6,}/;

function clamp(line: string): string {
  return line.length > HEADLINE_CAP ? `${line.slice(0, HEADLINE_CAP - 1)}…` : line;
}

/**
 * The newest `max` DISTINCT lines of a delta buffer worth showing, newest first —
 * the live feed's per-block window (DES-VISION-001 §1.3: "the last 2 narration
 * lines"). ANSI is stripped; `\r` counts as a line break because a progress bar
 * redraws in place — the segment after the last `\r` is that line's newest state,
 * not a continuation of it. Duplicates are folded because a worker that re-emits
 * the same status every second is saying ONE thing, not two.
 */
export function lastMeaningfulLines(text: string | undefined, max: number): string[] {
  if (text === undefined || text === '' || max < 1) return [];
  const lines = text.replace(ANSI, '').split(/[\r\n]+/);
  const found: string[] = [];
  for (let i = lines.length - 1; i >= 0 && found.length < max; i--) {
    const line = (lines[i] ?? '').trim();
    // Pure punctuation / box drawing / bars carry no subject, so they are not a status.
    if (line === '' || !/[\p{L}\p{N}]/u.test(line) || PROGRESS.test(line)) continue;
    const clamped = clamp(line);
    if (!found.includes(clamped)) found.push(clamped);
  }
  return found;
}

/**
 * The newest line of a delta buffer worth showing, or `null` when the buffer holds
 * only noise — the card's one-line reduction of the same window.
 */
export function lastMeaningfulLine(text: string | undefined): string | null {
  return lastMeaningfulLines(text, 1)[0] ?? null;
}

/** The unit the run is on — the one whose buffer and phase the card is about. */
export function activeUnit(view: SessionView): WorkUnit | undefined {
  return view.units[view.session.unit_ix] ?? view.units[view.units.length - 1];
}

export interface HeadlineInput {
  view: SessionView;
  /** The active unit's accumulated delta buffer. */
  text: string | undefined;
  /** The run's structured event log (deltas are deliberately absent from it). */
  log: LoggedEvent[] | undefined;
  /** Arrival `seq` of this run's newest delta; `-1` when none has arrived. */
  deltaSeq: number;
}

/**
 * §3.4(b)'s derivation, in its stated priority order, always rendered as
 * `<phase> — <what>` so the line carries a subject the user recognises:
 *
 *   1. a structured status, when it is NEWER than the delta buffer;
 *   2. otherwise the last meaningful line of that buffer;
 *   3. otherwise the unit's title.
 *
 * Rule 3 is why a bare "Working…" is never needed: the client already holds a
 * truthful subject for every state a run can be in.
 */
export function deriveHeadline({ view, text, log, deltaSeq }: HeadlineInput): string {
  const unit = activeUnit(view);
  const phase = unit?.stage ?? view.session.status;
  return (
    deriveNarration({ view, text, log, deltaSeq }) ??
    `${phase} — ${clamp((unit?.description ?? view.session.problem).trim())}`
  );
}

/**
 * Rules 1–2 only: the line is real narration (a structured status or streamed
 * output), or `null` when only rule 3's generic fallback would remain. Slice BA
 * (DES-UX-002 §1.3) is the consumer: on a card with an active run the phase
 * strip + current-unit description REPLACE the generic narration line, so the
 * card's live line renders only what actually streamed — never the same unit
 * description twice.
 */
export function deriveNarration({ view, text, log, deltaSeq }: HeadlineInput): string | null {
  const unit = activeUnit(view);
  const phase = unit?.stage ?? view.session.status;
  const what =
    (log ?? []).slice().reverse().find((e) => STRUCTURED.has(e.type) && e.seq > deltaSeq)?.detail ||
    lastMeaningfulLine(text);
  return what == null || what === '' ? null : `${phase} — ${clamp(what.trim())}`;
}

/**
 * The live headline for one run, subscribed to the SHARED runtime store — the same
 * store the run view reads, fed by the one `/ws` subscription (§3.5). Each selector
 * returns a primitive, so a card re-renders only when its own run's slice moves.
 */
export function useRunHeadline(view: SessionView): string {
  const runId = view.session.id;
  const ord = activeUnit(view)?.ord ?? 0;
  const text = useRuntimeStore((s) => s.outputs[outputKey(runId, ord)]);
  const log = useRuntimeStore((s) => s.logs[runId]);
  const deltaSeq = useRuntimeStore((s) => s.deltaSeq[runId] ?? -1);
  return deriveHeadline({ view, text, log, deltaSeq });
}

/**
 * The live narration for one run, or `null` when nothing has genuinely
 * streamed (rules 1–2 empty) — same store, same slices as `useRunHeadline`.
 */
export function useRunNarration(view: SessionView): string | null {
  const runId = view.session.id;
  const ord = activeUnit(view)?.ord ?? 0;
  const text = useRuntimeStore((s) => s.outputs[outputKey(runId, ord)]);
  const log = useRuntimeStore((s) => s.logs[runId]);
  const deltaSeq = useRuntimeStore((s) => s.deltaSeq[runId] ?? -1);
  return deriveNarration({ view, text, log, deltaSeq });
}
