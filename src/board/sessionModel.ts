import type { SessionView } from '../api/types.js';
import { plainRunTitle } from './deskWords.js';
import { endedAtMs } from './needsYou.js';

/**
 * SESSIONS (DES-STUDIO-REBUILD-001 §5.2-§5.3, slice S6a): a session is a chat plus the runs
 * launched from it. Pure: the rail, the Desk cards and `/s/:id` render what this returns.
 *
 *  - The runs of a chat are `GET /runs` filtered by `chat_id` (C1). A daemon that does not say
 *    `GET /health.capabilities.runChatId` gets one session per run, `run:<id>` (§7 "chat_id
 *    absent"): nothing is lost, nothing is guessed.
 *  - The goal sentence is the chat's first operator turn, else the first run's intent (R1).
 *  - A chat this daemon reclaimed (its transcript gone: `GET /chats/:id` answers `scope: null`,
 *    `messages: []`) is `conversation: 'closed'`; its thread renders from the runs with one honest
 *    line. A run with no chat has no conversation at all (`'none'`).
 *  - `progress.checked` stays `null`: "checked" needs the acceptance read's `check_state` (WT).
 */

export type SessionState = 'working' | 'waiting' | 'blocked' | 'done' | 'quiet';

export function sessionState(status: string): SessionState {
  switch (status) {
    case 'awaiting_human': return 'waiting';
    case 'failed': return 'blocked';
    case 'completed': return 'done';
    case 'cancelled': return 'quiet';
    default: return 'working';
  }
}

/** The chat a run was launched from (C1, api-types 0.71.0), or `null` (absent, or an older daemon). */
export function runChatIdOf(view: SessionView): string | null {
  const v = (view.session as unknown as { chat_id?: unknown }).chat_id;
  return typeof v === 'string' && v !== '' ? v : null;
}

/** The session a run belongs to: its chat when the daemon stamps `chat_id`, else itself. */
export function sessionIdOf(view: SessionView, runChatId: boolean): string {
  const chat = runChatId ? runChatIdOf(view) : null;
  return chat ?? `run:${view.session.id}`;
}

export type SessionRef = { kind: 'run'; runId: string } | { kind: 'chat'; chatId: string };

export function parseSessionId(id: string): SessionRef {
  return id.startsWith('run:') ? { kind: 'run', runId: id.slice(4) } : { kind: 'chat', chatId: id };
}

export function sessionPath(id: string): string {
  return `/s/${encodeURIComponent(id)}`;
}

/** A run's own clock: its end when the daemon recorded one, else its launch (both unix seconds). */
function runClockMs(v: SessionView): number {
  const ended = endedAtMs(v);
  if (ended !== null) return ended;
  const c = (v.session as unknown as { created_at?: unknown }).created_at;
  return typeof c === 'number' && Number.isFinite(c) ? c * 1000 : 0;
}

function launchedMs(v: SessionView): number {
  const c = (v.session as unknown as { created_at?: unknown }).created_at;
  return typeof c === 'number' && Number.isFinite(c) ? c * 1000 : 0;
}

// Live work first; then the newest run's own state.
function aggregateState(runs: readonly SessionView[]): SessionState {
  const states = runs.map((v) => sessionState(v.session.status));
  if (states.includes('waiting')) return 'waiting';
  if (states.includes('working')) return 'working';
  return states[states.length - 1] ?? 'quiet';
}

export interface SessionSummary {
  id: string;
  ref: SessionRef;
  projectId: string | null;
  title: string;
  state: SessionState;
  progress: { done: number; total: number; checked: number | null };
  lastChangeAt: number;
  /** Oldest launch first. */
  runIds: string[];
  /** Needs-you items that name any of its runs. */
  badge: number;
  path: string;
}

function projectOf(v: SessionView): string | null {
  const p = (v.session as unknown as { project_id?: unknown }).project_id;
  return typeof p === 'string' && p !== '' ? p : null;
}

/** Every session over the run list, in first-seen order of the input. */
export function groupSessions(
  runs: readonly SessionView[],
  opts: { runChatId: boolean; badges: Record<string, number> },
): SessionSummary[] {
  const byId = new Map<string, SessionView[]>();
  for (const v of runs) {
    const id = sessionIdOf(v, opts.runChatId);
    const list = byId.get(id);
    if (list === undefined) byId.set(id, [v]);
    else list.push(v);
  }
  return [...byId.entries()].map(([id, list]) => summarize(id, list, opts.badges));
}

export function summarize(id: string, list: readonly SessionView[], badges: Record<string, number>): SessionSummary {
  const ordered = [...list].sort((a, b) => launchedMs(a) - launchedMs(b));
  let done = 0;
  let total = 0;
  for (const v of ordered) {
    total += v.units.length;
    done += v.units.filter((u) => u.status === 'done').length;
  }
  return {
    id,
    ref: parseSessionId(id),
    projectId: ordered.map(projectOf).find((p) => p !== null) ?? null,
    title: sessionTitle([], ordered),
    state: aggregateState(ordered),
    progress: { done, total, checked: null },
    lastChangeAt: Math.max(0, ...ordered.map(runClockMs)),
    runIds: ordered.map((v) => v.session.id),
    badge: ordered.reduce((n, v) => n + (badges[v.session.id] ?? 0), 0),
    path: sessionPath(id),
  };
}

// ── The goal sentence and the conversation ──────────────────────────────────────────────────

interface TranscriptLike {
  kind: string;
  text?: unknown;
}

/** R1: the chat's first operator turn, else the first run's intent. */
export function sessionTitle(messages: readonly TranscriptLike[], runs: readonly SessionView[]): string {
  const first = messages.find((m) => m.kind === 'user' && typeof m.text === 'string' && m.text.trim() !== '');
  if (first !== undefined) return plainRunTitle(String(first.text));
  const v = runs[0];
  return v === undefined ? 'A session' : plainRunTitle(v.session.problem || v.session.id);
}

export type Conversation = 'live' | 'closed' | 'none';

/** A chat is live while the daemon still holds it (a scope, or a transcript); else it was closed. */
export function conversationOf(
  ref: SessionRef,
  detail: { scope?: unknown; messages?: readonly unknown[] } | null,
): Conversation {
  if (ref.kind === 'run') return 'none';
  if (detail === null) return 'closed';
  const held = detail.scope !== null && detail.scope !== undefined;
  return held || (detail.messages?.length ?? 0) > 0 ? 'live' : 'closed';
}

export const CLOSED_LINE = 'The conversation before this was closed. The work is below.';

// ── Since you left (R2) ─────────────────────────────────────────────────────────────────────

/** A session opened after this long away shows the since-you-left card. */
export const SINCE_IDLE_MS = 4 * 3_600_000;

export interface SinceCard {
  away: string;
  finished: string[];
  failed: string[];
  needsYou: number;
  summary: string;
}

function awayWords(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h < 48) return h === 1 ? '1 hour' : `${h} hours`;
  const d = Math.floor(h / 24);
  const rest = h % 24;
  return rest === 0 ? `${d} days` : `${d} days ${rest} h`;
}

/**
 * The card for a session last opened at `lastSeen`: `null` on a first visit or under 4 h. What
 * finished or stopped counts only runs whose end the daemon recorded after that visit.
 */
export function sinceYouLeft(
  lastSeen: number | null,
  now: number,
  runs: readonly SessionView[],
  badges: Record<string, number>,
): SinceCard | null {
  if (lastSeen === null || now - lastSeen < SINCE_IDLE_MS) return null;
  const after = runs.filter((v) => {
    const e = endedAtMs(v);
    return e !== null && e > lastSeen;
  });
  const finished = after.filter((v) => v.session.status === 'completed').map((v) => v.session.id);
  const failed = after.filter((v) => v.session.status === 'failed').map((v) => v.session.id);
  const needsYou = runs.reduce((n, v) => n + (badges[v.session.id] ?? 0), 0);
  const parts = [
    finished.length > 0 ? `${finished.length} finished` : null,
    failed.length > 0 ? `${failed.length} stopped` : null,
    needsYou > 0 ? `${needsYou} need${needsYou === 1 ? 's' : ''} you` : null,
  ].filter((p): p is string => p !== null);
  return {
    away: awayWords(now - lastSeen),
    finished,
    failed,
    needsYou,
    summary: parts.length === 0 ? 'Nothing changed' : parts.join(' · '),
  };
}
