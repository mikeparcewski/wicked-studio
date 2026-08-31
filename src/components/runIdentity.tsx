import type { AgentSession, CoreEvent } from '../api/types.js';
import { useRunEventStore } from '../store/events.js';
import { useRuntimeStore, type LoggedEvent } from '../store/runtime.js';
import { ageWord } from './DashboardTiles.js';

/**
 * Run identity (DES-UX-001 §7.5, slice Y2 — EC40): "five visually identical
 * rows… retries are indistinguishable". The wire verdict is CLIENT: the run
 * DTO (`AgentSession`) carries NO timestamps, so
 *
 *  - every run LIST row renders a **synthesized display title** — truncated
 *    intent + short-id + attempt ordinal (`fix the auth flow · 3eda21 · #1`) —
 *    plus the membership **attach clock** already mirrored into
 *    `useMembershipStore.attachedAtByRun` (the one honest per-run clock a
 *    list can have, no new fetches);
 *  - the run DETAIL derives started/ended/duration from the run's **event
 *    log** (`GET /runs/:id/events`, already fetched by App's FINDING-013
 *    backfill into `useRunEventStore`), falling back to the runtime store's
 *    arrival-stamped log for live runs — labeled "observed", the house
 *    grammar — and where the log lacks the events it SAYS SO, never
 *    fabricates (§13: this derivation is the honest v1; a durable
 *    `started_at` on the DTO is a non-requested follow-up).
 *
 * Model-generated titles are explicitly out of scope this round (§13).
 */

/** The composed title's short-id width (§7.5's `3eda21` example). */
const SHORT_ID = 6;

/** Longest intent fragment kept inside a composed title (the F7 rule: the
 *  intent phrase leads, truncated — never the raw paragraph). Exported so the
 *  palette can clip match-highlight positions to the intent it displays. */
export const INTENT_MAX = 40;

/** The default title budget where a list has room for a real headline
 *  (usability review #2: word-boundary trim at ~64 chars). */
export const HUMAN_TITLE_MAX = 64;

export function runShortId(id: string): string {
  return id.slice(0, SHORT_ID);
}

/**
 * The ONE human-title derivation (usability review #2: raw prompt text was the
 * run title on Make, Work, Home's unfiled shelf and the run header — five
 * identical 300-char rows were indistinguishable). Client-side, zero wires:
 *
 *  - the FIRST sentence/clause is the title (cut at `.`/`!`/`?`/`:`/`;`
 *    followed by whitespace, or at the first line break);
 *  - still too long → word-boundary trim to ~`max` chars plus an ellipsis;
 *  - the full intent moves to the hover title / detail, never the row.
 *
 * The fragment before the ellipsis stays a literal PREFIX of the raw intent
 * (only trailing whitespace/punctuation is dropped), so the palette's
 * match-highlight positions — computed against the raw problem — keep landing
 * on the characters they name.
 */
export function humanTitle(intent: string, max: number = HUMAN_TITLE_MAX): string {
  const stop = intent.search(/[.!?:;](?=\s)|\n/);
  let clause = (stop === -1 ? intent : intent.slice(0, stop)).trimEnd();
  if (clause === '') clause = intent.trimEnd();
  if (clause.length <= max) return clause;
  const cut = clause.slice(0, max + 1);
  const atWord = cut.lastIndexOf(' ');
  const head = (atWord > 0 ? cut.slice(0, atWord) : cut.slice(0, max)).replace(/[\s,;:·—-]+$/, '');
  return `${head}…`;
}

/**
 * §7.5's synthesized display title: `intent clause · short-id · #ordinal`.
 * The attempt ordinal is 1-based off the DTO's 0-based `attempt`, so five
 * identical prompts stop being quintuplets — the short-id alone already
 * distinguishes them; the ordinal names reworks. The intent half goes through
 * {@link humanTitle} — one derivation, not four copies.
 */
export function runTitle(session: AgentSession, intentMax: number = INTENT_MAX): string {
  return `${humanTitle(session.problem, intentMax)} · ${runShortId(session.id)} · #${session.attempt + 1}`;
}

/**
 * The list row's attach-clock word ("13m ago"). `undefined` = the membership
 * mirror names no clock for this run (unfiled, or members not yet read) — the
 * honest absent state is stated, never a fabricated "0s ago".
 */
export function runWhenWord(attachedAtMs: number | undefined, now: number): string {
  return attachedAtMs === undefined ? 'time unknown' : `${ageWord(Math.max(0, now - attachedAtMs))} ago`;
}

/** Hover copy for the attach clock — names WHICH clock this is (wire honesty). */
export const WHEN_TITLE =
  'when this run entered its project (the membership attach clock — the run record itself carries no timestamps)';

/** Event types that end a run, durable-log and live alike. */
const END_TYPES: ReadonlySet<string> = new Set(['sessionCompleted', 'sessionFailed', 'runCancelled']);

/** One derived clock: epoch ms + whether it is arrival-stamped ("observed"). */
export interface DerivedClock {
  ms: number;
  observed: boolean;
}

export interface RunClocks {
  started: DerivedClock | null;
  ended: DerivedClock | null;
}

/**
 * §7.5's detail derivation, spelled once and unit-tested. Durable-log frames
 * (`ts` = capture time) win; the runtime store's arrival-stamped log covers
 * the live-run case ("observed" — the frame's arrival IS the clock we have).
 * A `null` half means the log records no such event — the caller says so.
 */
export function deriveRunClocks(durable: readonly CoreEvent[], live: readonly LoggedEvent[]): RunClocks {
  let started: DerivedClock | null = null;
  let ended: DerivedClock | null = null;
  for (const e of durable) {
    if (typeof e.ts !== 'number') continue;
    if (e.type === 'sessionStarted' && started === null) started = { ms: e.ts, observed: false };
    if (END_TYPES.has(e.type)) ended = { ms: e.ts, observed: false };
  }
  for (const e of live) {
    if (e.type === 'sessionStarted' && started === null) started = { ms: e.ts, observed: true };
    if (END_TYPES.has(e.type) && ended === null) ended = { ms: e.ts, observed: true };
  }
  return { started, ended };
}

/** "1m 40s" / "2h 5m" — a duration between two derived clocks. */
export function durationWord(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

/**
 * The run detail's times line (§7.5 DOM AC: `[data-testid="run-times"]`).
 * Reads the two stores the app already fills for the selected run — zero new
 * requests. Every absent half is stated in operator language.
 */
export function RunTimes({ runId, status }: { runId: string; status: string }): React.ReactElement {
  const durable = useRunEventStore((s) => s.byRun[runId]);
  const live = useRuntimeStore((s) => s.logs[runId]);
  const { started, ended } = deriveRunClocks(durable ?? [], live ?? []);
  const now = Date.now();
  const terminal = TERMINAL.has(status);

  const parts: string[] = [];
  if (started !== null) {
    parts.push(`started ${ageWord(now - started.ms)} ago${started.observed ? ' (observed)' : ''}`);
  }
  if (ended !== null) {
    parts.push(`ended ${ageWord(now - ended.ms)} ago${ended.observed ? ' (observed)' : ''}`);
  } else if (!terminal && started !== null) {
    parts.push('running');
  } else if (terminal && started !== null) {
    parts.push('end not in the event log');
  }
  if (started !== null && ended !== null) {
    parts.push(`took ${durationWord(ended.ms - started.ms)}`);
  }
  const line = parts.length > 0
    ? parts.join(' · ')
    : terminal
      ? "no start or end times survive in this run's event log"
      : "no start time in this run's event log yet";

  const iso = (c: DerivedClock | null): string => (c === null ? '—' : new Date(c.ms).toISOString());
  return (
    <p
      data-testid="run-times"
      data-started={started === null ? 'none' : started.observed ? 'observed' : 'log'}
      data-ended={ended === null ? (terminal ? 'none' : 'running') : ended.observed ? 'observed' : 'log'}
      className="px-6 py-1 text-[11px] font-mono truncate shrink-0"
      style={{ color: 'var(--ink-dim)', margin: 0, borderBottom: '1px solid var(--surface-raised)' }}
      title={`derived from the run's event log (the run record carries no timestamps) — started: ${iso(started)} · ended: ${iso(ended)}`}
    >
      {line}
    </p>
  );
}
