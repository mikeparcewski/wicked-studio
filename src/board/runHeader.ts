import type { SessionView } from '../api/types.js';
import { phaseLabel } from '../components/gateVerdictModel.js';
import type { OpenGate } from '../store/gates.js';
import { needRunId } from './deskModel.js';
import type { NeedRow } from './needsYou.js';
import { relTime } from './relTime.js';
import { stepWord } from './runConversation.js';
import type { SessionState } from './sessionModel.js';
import { chatStatusWord } from './statusWords.js';

/**
 * THE RUN PAGE'S HEADER, ITS "NEEDS YOU" BANNER AND ITS JUMP-TO-LATEST (operator 2026-10-18: "Header could be much
 * cleaner … Stopped should stand out — something red and dangerous. Waiting on you line should appear as a banner
 * below the header (when needed) and putting mouse over the yellow text will give you a quick overview"). Pure.
 *
 *  - The header is the title and ONE state badge. A failed, stopped or cancelled run's badge is the danger tone.
 *  - The banner shows only while something here waits on the operator; its overview lists each waiting item.
 *  - The jump button shows while the thread is not at its newest message, with a count of what arrived since.
 */

export type HeaderTone = 'run' | 'gate' | 'ok' | 'danger' | 'quiet';

/** The header's one state badge. "Waiting on you" belongs to the banner below the header, so the badge says "Waiting". */
export function headerBadge(views: readonly Pick<SessionView, 'session'>[], state: SessionState): { word: string; tone: HeaderTone } {
  if (state === 'waiting') return { word: 'Waiting', tone: 'gate' };
  const { word, tone } = chatStatusWord(views);
  if (tone === 'fail' || word === 'Stopped' || word === 'Cancelled') return { word, tone: 'danger' };
  if (word === 'Waiting on you') return { word: 'Waiting', tone: 'gate' };
  return { word, tone };
}

export interface WaitingItem {
  key: string;
  runId: string;
  /** What kind of thing waits: "Plan approval", "Hand-over", "Failed run", … */
  kind: string;
  /** The step it waits at, in words, or null when nothing names one. */
  step: string | null;
  /** The one-line question. */
  question: string;
  /** How long it has waited, in words, or null when no wire carries a clock. */
  age: string | null;
}

const KIND_WORDS: Readonly<Record<string, string>> = {
  elicitation: 'Question',
  'failed-run': 'Failed run',
  'stalled-run': 'Stalled',
  'stall-escalated': 'Stalled',
  'stranded-run': 'Stranded',
  'orphaned-run': 'Nothing working on it',
  'steer-request': 'Steer request',
};

function gateKindWord(gate: OpenGate | undefined, question: string): string {
  const kind = gate?.gateKind;
  if (kind === 'plan_approval' || /^Approve the plan\b/.test(question)) return 'Plan approval';
  if (kind === 'deliver' || /hand-over/i.test(question)) return 'Hand-over';
  if (kind === 'escalation') return 'Escalation';
  return 'Approval';
}

const FAILED_UNIT = new Set(['rejected', 'failed', 'denied']);

/** The step a row waits at: an open gate's step, else the step that failed. */
function stepOf(view: SessionView | undefined, gate: OpenGate | undefined): string | null {
  if (view === undefined) return null;
  const units = view.units ?? [];
  const ord = gate?.ord ?? units.find((u) => FAILED_UNIT.has(String(u.status)))?.ord ?? null;
  if (ord === null || !units.some((u) => u.ord === ord)) return null;
  return stepWord(phaseLabel(view.session.id, units, ord));
}

/** What waits on the operator in THIS session: the Needs-you rows (a folded group's members) about its runs. */
export function waitingItems(
  rows: readonly NeedRow[],
  views: readonly SessionView[],
  gates: Readonly<Record<string, OpenGate>>,
  now: number,
): WaitingItem[] {
  const byId = new Map(views.map((v) => [v.session.id, v]));
  const out: WaitingItem[] = [];
  for (const row of rows.flatMap((r) => r.members ?? [r])) {
    const runId = needRunId(row);
    if (runId === null || !byId.has(runId)) continue;
    const gate = row.kind === 'gate' ? gates[runId] : undefined;
    const question = (row.question ?? row.text).split('\n')[0]!.trim();
    out.push({
      key: row.key,
      runId,
      kind: row.kind === 'gate' ? gateKindWord(gate, question) : KIND_WORDS[row.kind] ?? 'Needs you',
      step: stepOf(byId.get(runId), gate),
      question,
      age: row.at === null ? null : relTime(row.at, now),
    });
  }
  return out;
}

/** The banner's yellow words. */
export function needsWords(n: number): string {
  return n === 1 ? '1 needs you' : `${n} need you`;
}

// ── Jump to latest ───────────────────────────────────────────────────────────────────────────────

/** Within this many px of the bottom the thread is "at its newest message" (the follow rule's own threshold). */
export const AT_END_PX = 80;

export function atEnd(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < AT_END_PX;
}

/** How many entries arrived: the keys in `next` that `prev` did not hold. */
export function newEntries(prev: ReadonlySet<string>, next: readonly string[]): number {
  let n = 0;
  for (const k of next) if (!prev.has(k)) n += 1;
  return n;
}

/** The jump button's words: a count of what arrived while the operator read above, else the plain jump. */
export function jumpLabel(unseen: number): string {
  if (unseen <= 0) return 'Jump to the latest';
  return unseen === 1 ? '1 new message — jump to the latest' : `${unseen} new messages — jump to the latest`;
}

// ── The details panel, remembered per viewer ─────────────────────────────────────────────────────

export const DETAILS_OPEN_KEY = 'studio.runDetailsOpen';

/** Open unless this browser remembers it closed (storage unreadable = the default, open). */
export function readDetailsOpen(): boolean {
  try {
    return window.localStorage.getItem(DETAILS_OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function writeDetailsOpen(open: boolean): void {
  try {
    window.localStorage.setItem(DETAILS_OPEN_KEY, open ? 'true' : 'false');
  } catch {
    /* storage unavailable: the panel opens by default next time */
  }
}
