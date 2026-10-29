import type { CoreEvent, SessionView } from '../api/types.js';

/**
 * Message timestamps (power-mode mockup, operator 2026-10-29: "Claude Code · orchestrator · 14:03" on every thread
 * message, in power mode and phased runs alike). Every time here is unix MILLIS read from what crew recorded: a
 * logged frame's `ts`, a session's `created_at`/`ended_at` (unix seconds on the wire), a gate's arrival. Nothing is
 * derived from "now" for an old run: a message with no recorded time shows no time.
 */

/** A message's time: one instant, or a span (a step that ran from `from` to `to`). */
export interface MessageTime {
  from: number | null;
  to: number | null;
}

type Ev = CoreEvent & { ord?: unknown; ts?: unknown };

const tsOf = (e: Ev): number | null => (typeof e.ts === 'number' && Number.isFinite(e.ts) && e.ts > 0 ? e.ts : null);

/** The frames that end a step's attempt. */
const STEP_END = new Set(['unitDone', 'stepFailed', 'unitDenied']);

/**
 * Each step's LAST attempt, by ord: from its newest `unitDispatched` to the first frame that ended it after that. A
 * step that ran again (a send-back, a retry) is dated by the attempt whose words the thread shows.
 *
 * `to` is null while the attempt has no ending frame, or when its ending frame came live (live `/ws` frames carry
 * no `ts`; {@link useFirstSeenAt} stamps those).
 */
export function stepTimes(events: readonly CoreEvent[] | null | undefined): Map<number, MessageTime & { ended: boolean }> {
  const out = new Map<number, MessageTime & { ended: boolean }>();
  for (const raw of events ?? []) {
    const e = raw as Ev;
    if (typeof e.ord !== 'number') continue;
    if (e.type === 'unitDispatched') {
      out.set(e.ord, { from: tsOf(e), to: null, ended: false });
    } else if (STEP_END.has(e.type)) {
      const cur = out.get(e.ord) ?? { from: null, to: null, ended: false };
      if (cur.ended) continue;
      out.set(e.ord, { from: cur.from, to: tsOf(e), ended: true });
    }
  }
  return out;
}

/** When the run ended: its first terminal frame's time, else the session's `ended_at` (unix seconds). */
export function endedAt(view: SessionView, events: readonly CoreEvent[] | null | undefined): number | null {
  for (const raw of events ?? []) {
    const e = raw as Ev;
    if (e.type === 'sessionCompleted' || e.type === 'sessionFailed' || e.type === 'runCancelled') {
      const t = tsOf(e);
      if (t !== null) return t;
    }
  }
  const s = (view.session as { ended_at?: unknown }).ended_at;
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? s * 1000 : null;
}

/** When the run's question at `ord` was asked: its newest `awaitingHuman` frame's time. */
export function askedAt(events: readonly CoreEvent[] | null | undefined, ord: number): number | null {
  let at: number | null = null;
  for (const raw of events ?? []) {
    const e = raw as Ev;
    if (e.type === 'awaitingHuman' && e.ord === ord) at = tsOf(e) ?? at;
  }
  return at;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * The words after the speaker: "14:03" today, "27 Oct 14:03" on another day, a span as "14:16–14:21" (the day once,
 * on the start). Null when there is no time to say.
 */
export function messageTimeWords(t: MessageTime | null | undefined, now: number = Date.now()): string | null {
  if (t === null || t === undefined) return null;
  const from = t.from ?? t.to;
  if (from === null) return null;
  const a = new Date(from);
  const today = new Date(now);
  const day = sameDay(a, today) ? '' : `${a.getDate()} ${MONTHS[a.getMonth()]!} `;
  const start = `${day}${hhmm(a)}`;
  if (t.from === null || t.to === null) return start;
  const b = new Date(t.to);
  const end = sameDay(a, b) ? hhmm(b) : `${b.getDate()} ${MONTHS[b.getMonth()]!} ${hhmm(b)}`;
  return end === hhmm(a) && sameDay(a, b) ? start : `${start}–${end}`;
}

/** The full stamp for the tooltip and `dateTime`: ISO-8601. */
export function messageTimeIso(t: MessageTime | null | undefined): string | null {
  const at = t?.from ?? t?.to ?? null;
  return at === null ? null : new Date(at).toISOString();
}

// ── a live frame's arrival, remembered once per message ──────────────────────────────────────────────────
const firstSeen = new Map<string, number>();

/** Test seam. */
export function resetFirstSeen(): void { firstSeen.clear(); }

/**
 * A message whose ending frame came over the live socket (no `ts`) is dated by when this page first saw it end. A
 * reload reads the recorded time instead. `key` names the message; `pending` = there is nothing to stamp yet.
 */
export function firstSeenAt(key: string, pending: boolean, now: number = Date.now()): number | null {
  if (pending) return null;
  const hit = firstSeen.get(key);
  if (hit !== undefined) return hit;
  firstSeen.set(key, now);
  return now;
}
