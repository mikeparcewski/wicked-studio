import type { CoreEvent } from '../api/types.js';
import { arrivedAt } from '../store/events.js';
import { activityRows, type ActivityKind, type LiveRow, type TurnRef } from './liveActivity.js';

/**
 * A WORKING TURN, in words (operator 2026-10-30: "On the 'studio working' activity in the chat, people get impatient.
 * We should be broadcasting live events happening (or summaries) so the user sees something happening"):
 *  - a one-line ROLLING SUMMARY of the last half minute, refreshed every {@link SUMMARY_EVERY_MS} ("Reading 4 files in
 *    packages/crew/src/api", "Ran the tests: passed · edited 2 files in src/board"), derived from the step's own
 *    frames, never by another model;
 *  - its METER: how long it has run, its tokens so far (the engine's live `usageProgress` total, else the attempt's
 *    `cliUsage`) and its cost when the seat states one;
 *  - when to offer the IN-FLIGHT CHECK ("This has been running 6 min · Check on it?"): {@link checkAfterMs}.
 */

/** How often the rolling summary line moves. */
export const SUMMARY_EVERY_MS = 25_000;
/** The window it sums: the last half minute of the turn. */
export const SUMMARY_WINDOW_MS = 30_000;
/** A turn shorter than this needs no summary: its rows say it all. */
export const SUMMARY_AFTER_MS = 20_000;
/** When the check is offered, by default: a chat turn after 3 min, a run's step after 10 (operator 2026-10-30). */
export const CHECK_AFTER_MS = { chat: 3 * 60_000, step: 10 * 60_000 } as const;
export type TurnKind = keyof typeof CHECK_AFTER_MS;

type Ev = CoreEvent & Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const timeOf = (e: Ev): number | null => num(e.ts) ?? arrivedAt(e) ?? num(e.at);

/**
 * When to offer the check: the default for the kind, or the person's own minutes (`localStorage`
 * `wicked.check.chatMinutes` / `wicked.check.stepMinutes`, 1 to 120).
 */
export function checkAfterMs(kind: TurnKind, store: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): number {
  try {
    const raw = store?.getItem(kind === 'chat' ? 'wicked.check.chatMinutes' : 'wicked.check.stepMinutes');
    const m = raw === null || raw === undefined ? NaN : Number(raw);
    if (Number.isFinite(m) && m >= 1 && m <= 120) return m * 60_000;
  } catch {
    /* no storage: the default */
  }
  return CHECK_AFTER_MS[kind];
}

/** The step's newest dispatch: when it started (unix ms) and its attempt; null when the log has none yet. */
export function turnStart(events: readonly CoreEvent[] | null | undefined, ord: number): { at: number | null; attempt: number } | null {
  const list = (events ?? []) as readonly Ev[];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const e = list[i]!;
    if (e.ord === ord && (e.type === 'unitDispatched' || e.type === 'unitExecuting')) {
      // A dispatch and its executing frame come together: the dispatch names the attempt.
      const d = e.type === 'unitDispatched' ? e : (list.slice(0, i).reverse().find((x) => x.ord === ord && x.type === 'unitDispatched') ?? e);
      return { at: timeOf(d) ?? timeOf(e), attempt: num(d.attempt) ?? 0 };
    }
  }
  return null;
}

/** The step a run is working on now, read off its frames: the newest dispatched one with no end after it. */
export function workingOrdOf(events: readonly CoreEvent[] | null | undefined): number | null {
  const list = (events ?? []) as readonly Ev[];
  const ended = new Set<number>();
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const e = list[i]!;
    if (typeof e.ord !== 'number') {
      if (e.type === 'sessionCompleted' || e.type === 'sessionFailed' || e.type === 'runCancelled' || e.type === 'awaitingHuman') return null;
      continue;
    }
    if (e.type === 'unitDone' || e.type === 'stepFailed' || e.type === 'unitDenied') ended.add(e.ord);
    if ((e.type === 'unitDispatched' || e.type === 'unitExecuting') && !ended.has(e.ord)) return e.ord;
  }
  return null;
}

export interface TurnMeter {
  startedAt: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  /** The tokens are the live running total (`usageProgress`), not the attempt's final count. */
  live: boolean;
}

/** The step's meter for its newest attempt. */
export function turnMeter(events: readonly CoreEvent[] | null | undefined, ord: number): TurnMeter | null {
  const start = turnStart(events, ord);
  if (start === null) return null;
  const list = (events ?? []) as readonly Ev[];
  let usage: Ev | null = null;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const e = list[i]!;
    if (e.ord !== ord) continue;
    if (e.type === 'unitDispatched') break;
    if ((e.type === 'usageProgress' || e.type === 'cliUsage') && (e.attempt === undefined || e.attempt === start.attempt)) { usage = e; break; }
  }
  return {
    startedAt: start.at,
    inputTokens: usage !== null ? num(usage.inputTokens) : null,
    outputTokens: usage !== null ? num(usage.outputTokens) : null,
    costUsd: usage !== null ? num(usage.costUsd) : null,
    live: usage?.type === 'usageProgress',
  };
}

/** "45 s", "3 min 12 s", "1 h 4 min". */
export function elapsedWords(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** 950 → "950", 41_200 → "41k", 1_240_000 → "1.2M". */
export function tokenWords(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** "$0.21", "<$0.01". */
export function costWords(usd: number): string {
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}

/** The meter in one line: "3 min 12 s · 412k tokens · $0.21" (tokens and cost only when known). */
export function meterWords(m: TurnMeter, now: number): string {
  const parts: string[] = [];
  if (m.startedAt !== null) parts.push(elapsedWords(now - m.startedAt));
  if (m.inputTokens !== null || m.outputTokens !== null) parts.push(`${tokenWords((m.inputTokens ?? 0) + (m.outputTokens ?? 0))} tokens`);
  if (m.costUsd !== null) parts.push(costWords(m.costUsd));
  return parts.join(' · ');
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The folder most of `paths` share ("packages/crew/src/api"), or null when they share none. */
export function commonDir(paths: readonly string[]): string | null {
  const dirs = paths.map((p) => p.replace(/\\/g, '/').split('/').slice(0, -1)).filter((d) => d.length > 0);
  if (dirs.length === 0 || dirs.length < paths.length) return null;
  const first = dirs[0]!;
  let n = first.length;
  for (const d of dirs) {
    let i = 0;
    while (i < n && i < d.length && d[i] === first[i]) i += 1;
    n = i;
  }
  return n === 0 ? null : first.slice(0, n).join('/');
}

/** The path a row names ("Read src/a.ts" → "src/a.ts"), or null. */
function pathOf(r: LiveRow): string | null {
  const m = /^(?:Reading|Read|Editing|Edited|Writing|Wrote) (\S+)/u.exec(r.text);
  return m !== null && m[1]!.includes('.') ? m[1]! : null;
}

function phrase(kind: ActivityKind, rows: readonly LiveRow[], running: boolean): string | null {
  const n = rows.length;
  if (n === 0) return null;
  const paths = rows.map(pathOf).filter((p): p is string => p !== null);
  const where = paths.length === n && n > 1 ? commonDir(paths) : null;
  const one = n === 1 && paths.length === 1 ? paths[0]! : null;
  switch (kind) {
    case 'read': return `${running ? 'Reading' : 'Read'} ${one ?? plural(n, 'file')}${where !== null ? ` in ${where}` : ''}`;
    case 'search': return `${running ? 'Searching' : 'Searched'} the code${n > 1 ? ` (${n} searches)` : ''}`;
    case 'edit':
    case 'write': {
      const files = new Set(paths);
      return `${running ? 'Editing' : 'Edited'} ${one ?? (files.size > 0 ? plural(files.size, 'file') : plural(n, 'edit'))}${where !== null ? ` in ${where}` : ''}`;
    }
    case 'test': {
      const last = rows[n - 1]!;
      if (last.running) return 'Running the tests';
      const failed = rows.filter((r) => r.ok === false).length;
      return n === 1 ? `Ran the tests: ${failed > 0 ? 'failed' : 'passed'}` : `Ran the tests ${n} times: ${failed > 0 ? `${failed} failed` : 'all passed'}`;
    }
    case 'run': return `${running ? 'Running' : 'Ran'} ${plural(n, 'command')}`;
    case 'commit': return plural(n, 'commit');
    case 'skill': return `${running ? 'Using' : 'Used'} ${plural(n, 'skill')}`;
    case 'task': return `${running ? 'Asking' : 'Asked'} ${plural(n, 'helper')}`;
    default: return `${running ? 'Using' : 'Used'} ${plural(n, 'tool')}`;
  }
}

/** Which kinds lead a summary, most telling first. */
const LEAD: readonly ActivityKind[] = ['test', 'edit', 'write', 'commit', 'run', 'search', 'read', 'task', 'skill', 'other'];

/**
 * One line for the last {@link SUMMARY_WINDOW_MS} of a working turn, as of `now` rounded down to the summary's own
 * beat ({@link SUMMARY_EVERY_MS}, so it moves every 25 s, not every frame): its two most telling kinds of activity
 * ("Ran the tests: passed · edited 2 files in src/board"); else, when the window was quiet, the turn's whole
 * activity so far ("So far: read 6 files · ran 2 commands"). Null for a turn under {@link SUMMARY_AFTER_MS} or with
 * nothing recorded.
 */
export function rollingSummary(events: readonly CoreEvent[] | null | undefined, ord: number, now: number, turn: TurnRef | null = null): string | null {
  const start = turnStart(events, ord);
  if (start === null || start.at === null || now - start.at < SUMMARY_AFTER_MS) return null;
  const beat = Math.floor(now / SUMMARY_EVERY_MS) * SUMMARY_EVERY_MS;
  const rows = activityRows(events, ord, turn).filter((r) => r.kind !== 'working' && (r.at === null || r.at <= beat));
  if (rows.length === 0) return null;
  const recent = rows.filter((r) => r.at !== null && r.at > beat - SUMMARY_WINDOW_MS);
  const lineOf = (set: readonly LiveRow[], running: boolean): string[] => {
    const by = new Map<ActivityKind, LiveRow[]>();
    for (const r of set) {
      const k = r.kind === 'write' ? 'edit' : r.kind;
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    return LEAD.filter((k) => by.has(k)).map((k) => phrase(k, by.get(k)!, running && by.get(k)!.some((r) => r.running))).filter((p): p is string => p !== null);
  };
  if (recent.length > 0) {
    const parts = lineOf(recent, true).slice(0, 2).map((p, i) => (i === 0 ? p : p.charAt(0).toLowerCase() + p.slice(1)));
    const line = parts.join(' · ');
    return line.charAt(0).toUpperCase() + line.slice(1);
  }
  const parts = lineOf(rows, false).slice(0, 3).map((p) => p.charAt(0).toLowerCase() + p.slice(1));
  return `So far: ${parts.join(' · ')}`;
}
