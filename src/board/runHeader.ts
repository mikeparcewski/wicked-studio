import type { SessionView } from '../api/types.js';
import { phaseLabel } from '../components/gateVerdictModel.js';
import type { OpenGate } from '../store/gates.js';
import { needRunId } from './deskModel.js';
import type { NeedRow } from './needsYou.js';
import { relTime } from './relTime.js';
import { stepWord } from './runConversation.js';
import type { SessionState } from './sessionModel.js';
import { chatStatusWord } from './statusWords.js';
import { displayText } from './homePath.js';
import { attentionRows, type NeedsSource } from './attention.js';

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

/** The kinds whose answer is the run's question card (a step's question; a stalled step handed to the operator). */
export const QUESTION_KINDS: ReadonlySet<string> = new Set([KIND_WORDS['elicitation']!, KIND_WORDS['stalled-run']!]);

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
    // Privacy (e2e-1105): a gate's or failure's words can name a file under the home folder; it reads `~/…`.
    const question = displayText((row.question ?? row.text).split('\n')[0]!.trim());
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

/** This session's slice of the badge's source; crew items keep their identity and count. */
export function needsForSession(
  source: NeedsSource,
  rows: readonly NeedRow[],
  views: readonly SessionView[],
  gates: Readonly<Record<string, OpenGate>>,
  now: number,
): WaitingItem[] {
  if (source.phase === 'loading') return [];
  if (source.from === 'fold') return waitingItems(source.rows, views, gates, now);
  const mine = new Set(views.map((v) => v.session.id));
  // A run's words: its decision or failure row first (the badge's own rows), then any other row about it.
  const words = new Map<string, WaitingItem>();
  for (const item of waitingItems([...attentionRows(rows), ...rows], views, gates, now)) {
    if (!words.has(item.runId)) words.set(item.runId, item);
  }
  return source.items.flatMap((item) => {
    const runId = item.runId != null && mine.has(item.runId) ? item.runId : item.blockedRunIds?.find((id) => mine.has(id));
    if (runId === undefined) return [];
    const row = words.get(runId);
    return [{
      key: item.id,
      runId,
      kind: row?.kind ?? 'Needs you',
      step: row?.step ?? null,
      question: row?.question ?? displayText(item.text),
      age: item.waitedSince == null ? null : relTime(item.waitedSince, now),
    }];
  });
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

/** Something inside a thread entry that reads as a message: its identity, and its own time when it has one (null: no
 *  time is known, so it is new whenever it first shows). */
export interface ArrivalPart {
  id: string;
  at: number | null;
}

/** What the jump button counts: one thread entry, and what it holds that reads as messages (`parts`). */
export interface Arrival {
  key: string;
  at: number;
  /** What arrives inside the entry (studio#858): a run block's finished steps, a turn's later messages from the same
   *  seat. An entry already on screen that gains a part is an arrival too. */
  parts?: readonly ArrivalPart[];
  /** The parts are the entry's state now (a run block's steps): a step that leaves it and comes back (it ran again)
   *  is new again. Otherwise the parts seen are kept for the session (a message that blinks out is not new twice). */
  snapshot?: boolean;
}

/** A run block's step that has its message in the block: finished, sent back, or failed. */
const SPOKEN_UNIT: ReadonlySet<string> = new Set(['done', 'rejected', 'failed', 'denied']);

/** What the jump button counts a thread entry as: a turn by its turn and seat (the live reply and the transcript's
 *  record of it are one message), a line by its own time (a finding placed under an older reply is still new), a run
 *  block with its finished steps as parts (a step's output lands inside the block), anything else by its key. */
export function arrival(e: {
  kind: string; key: string; at: number; turnId?: string | null; who?: string; line?: { at: number };
  view?: { units?: readonly { ord: number; status?: unknown }[] };
}): Arrival {
  const key = e.kind === 'turn' && typeof e.turnId === 'string' ? `turn:${e.turnId}:${e.who ?? ''}` : e.key;
  const at = e.kind === 'line' && e.line !== undefined ? e.line.at : e.at;
  if (e.kind === 'run' && e.view !== undefined) {
    // A unit record carries no finishing time: a step is new when it first shows as finished in a block on screen.
    const parts = (e.view.units ?? []).filter((u) => SPOKEN_UNIT.has(String(u.status))).map((u) => ({ id: `${u.ord}:${String(u.status)}`, at: null }));
    return { key, at, parts, snapshot: true };
  }
  return { key, at };
}

/** The thread's arrivals: entries that share a key (a turn's seat that wrote twice) are one arrival whose later
 *  messages are its parts, each with its own time, so a message appended to the same turn counts while the live reply
 *  and its transcript record stay one. */
export function arrivals(entries: readonly Parameters<typeof arrival>[0][]): Arrival[] {
  const out: Arrival[] = [];
  const byKey = new Map<string, { parts: ArrivalPart[]; n: number }>();
  for (const e of entries) {
    const a = arrival(e);
    const held = byKey.get(a.key);
    if (held === undefined) {
      byKey.set(a.key, { parts: [...(a.parts ?? [])], n: 1 });
      out.push(a);
      continue;
    }
    held.parts.push({ id: `#${held.n}`, at: a.at }, ...(a.parts ?? []));
    held.n += 1;
  }
  return out.map((a) => {
    const held = byKey.get(a.key)!;
    if (held.parts.length === 0) return { key: a.key, at: a.at };
    return { key: a.key, at: a.at, parts: held.parts, ...(a.snapshot === true ? { snapshot: true } : {}) };
  });
}

/** What the thread has held this session: each arrival's key and the parts seen in it. A snapshot's parts are its
 *  state now; any other entry keeps every part it has shown. */
export function heldArrivals(next: readonly Arrival[], prev?: ReadonlyMap<string, ReadonlySet<string>>): Map<string, ReadonlySet<string>> {
  const out = new Map<string, ReadonlySet<string>>(prev ?? []);
  for (const a of next) {
    const ids = (a.parts ?? []).map((p) => p.id);
    const before = out.get(a.key);
    out.set(a.key, a.snapshot === true || before === undefined ? new Set(ids) : new Set([...before, ...ids]));
  }
  return out;
}

/** Dated at or after `since` (a part with no time of its own is new when it first shows). */
const fresh = (at: number | null, since: number): boolean => at === null || at >= since;

/** How many entries arrived. An entry `prev` did not hold counts once when it, or a message inside it, is dated at or
 *  after `since` (older history that lands late — a transcript read, the team rows — is not new). An entry `prev`
 *  held counts ONCE when it gained a part dated at or after `since` (a step's output inside its run block: one
 *  arrival however many parts one read brings). `prev` as a set of keys holds no parts. */
export function newEntries(prev: ReadonlySet<string> | ReadonlyMap<string, ReadonlySet<string>>, next: readonly Arrival[], since: number): number {
  let n = 0;
  for (const e of next) {
    const held = 'get' in prev ? prev.get(e.key) : undefined;
    const known = held !== undefined || (!('get' in prev) && prev.has(e.key));
    if (!known) {
      if (e.at >= since || (e.parts ?? []).some((p) => p.at !== null && p.at >= since)) n += 1;
    } else if (held !== undefined && (e.parts ?? []).some((p) => !held.has(p.id) && fresh(p.at, since))) {
      n += 1;
    }
  }
  return n;
}

/** The jump button's words: a count of what arrived while the operator read above, else the plain jump. */
export function jumpLabel(unseen: number): string {
  if (unseen <= 0) return 'Jump to the latest';
  return unseen === 1 ? '1 new message — jump to the latest' : `${unseen} new messages — jump to the latest`;
}

// ── The details panel, remembered per viewer ─────────────────────────────────────────────────────

export const DETAILS_OPEN_KEY = 'studio.runDetailsOpen';

/** Open unless this browser remembers it closed (storage unreadable = the default, open). Written only by the
 *  operator's own close and handle (a link, ⌘K or a card's Options opening the panel is not their choice). */
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
