import type { SessionStatus, SessionView } from '../api/types.js';
import { isAskTurnRun } from './askTurn.js';

/**
 * ONE STATUS WORD PER STATE (design/UI-CONTRACT.md §5; studio#687, UX audit row 36). The Desk, the
 * rail, Everything, the session header and the palette all say a run's state through `statusWord`,
 * so one run is never "Run failed" here, "blocked" there and "Quiet" in its header. Pure.
 */
export type StatusWord = 'Archived' | 'Waiting on you' | 'Answered' | 'Working' | 'Failed' | 'Cancelled' | 'Stopped' | 'Finished' | 'Unknown';
export type StatusTone = 'run' | 'gate' | 'ok' | 'fail' | 'quiet';

const BY_STATUS = {
  awaiting_human: { word: 'Waiting on you', tone: 'gate' },
  executing: { word: 'Working', tone: 'run' },
  distributing: { word: 'Working', tone: 'run' },
  pending: { word: 'Working', tone: 'run' },
  planning: { word: 'Working', tone: 'run' },
  running: { word: 'Working', tone: 'run' },
  failed: { word: 'Failed', tone: 'fail' },
  cancelled: { word: 'Cancelled', tone: 'quiet' },
  canceled: { word: 'Cancelled', tone: 'quiet' },
  stopped: { word: 'Stopped', tone: 'quiet' },
  halted: { word: 'Stopped', tone: 'quiet' },
  paused: { word: 'Stopped', tone: 'quiet' },
  completed: { word: 'Finished', tone: 'ok' },
  done: { word: 'Finished', tone: 'ok' },
} satisfies Record<SessionStatus, { word: StatusWord; tone: StatusTone }> & Record<string, { word: StatusWord; tone: StatusTone }>;
const STATUS_TABLE: Readonly<Record<string, { word: StatusWord; tone: StatusTone }>> = BY_STATUS;

/**
 * Precedence: archived first; then an answered ask parked at its turn gate (crew's `ask_turn`) reads
 * "Answered" — it waits on no one (`waitsOnYou`), so it must not say "Waiting on you"; then the
 * status table; anything unmapped is "Unknown" (quiet).
 */
export function statusWord(view: Pick<SessionView, 'session'>): { word: StatusWord; tone: StatusTone } {
  const s = view.session as { status?: string; archived_at?: number | string | null };
  if (s.archived_at !== null && s.archived_at !== undefined && s.archived_at !== '') return { word: 'Archived', tone: 'quiet' };
  if (s.status === 'awaiting_human' && isAskTurnRun(view.session)) return { word: 'Answered', tone: 'ok' };
  return STATUS_TABLE[String(s.status ?? '').toLowerCase()] ?? { word: 'Unknown', tone: 'quiet' };
}

/** A chat (several runs) reads its newest run's word; no runs = "Unknown". */
export function chatStatusWord(views: readonly Pick<SessionView, 'session'>[]): { word: StatusWord; tone: StatusTone } {
  const newest = [...views].sort((a, b) => Number((b.session as { created_at?: number }).created_at ?? 0) - Number((a.session as { created_at?: number }).created_at ?? 0))[0];
  return newest === undefined ? { word: 'Unknown', tone: 'quiet' } : statusWord(newest);
}

/**
 * The Desk's one "how much is live" count, by {@link statusWord}: `working` = runs whose word is
 * Working and that Needs you does not hold (`held`: a stall, an orphan, an open question — the
 * Running now card's exact rule), `chatsOpen` = chats answered and waiting at their turn for the next
 * message. The calm line and the Desk peek say these numbers, so neither can call a paused run, a
 * held run or an idle chat "working" beside "Running now 0".
 */
export function deskLiveCounts(
  runs: readonly Pick<SessionView, 'session'>[],
  held: ReadonlySet<string> = new Set(),
): { working: number; chatsOpen: number } {
  let working = 0;
  let chatsOpen = 0;
  for (const v of runs) {
    const { word, tone } = statusWord(v);
    if (tone === 'run') { if (!held.has(v.session.id)) working += 1; }
    else if (word === 'Answered') chatsOpen += 1;
  }
  return { working, chatsOpen };
}
