import type { SessionView } from '../api/types.js';

/**
 * ONE STATUS WORD PER STATE (design/UI-CONTRACT.md §5; studio#687, UX audit row 36). The Desk, the
 * rail, Everything, the session header and the palette all say a run's state through `statusWord`,
 * so one run is never "Run failed" here, "blocked" there and "Quiet" in its header. Pure.
 */
export type StatusWord = 'Archived' | 'Waiting on you' | 'Working' | 'Failed' | 'Cancelled' | 'Stopped' | 'Finished' | 'Unknown';
export type StatusTone = 'run' | 'gate' | 'ok' | 'fail' | 'quiet';

const BY_STATUS: Readonly<Record<string, { word: StatusWord; tone: StatusTone }>> = {
  awaiting_human: { word: 'Waiting on you', tone: 'gate' },
  executing: { word: 'Working', tone: 'run' },
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
};

/** Precedence: archived first, then the status table; anything unmapped is "Unknown" (quiet). */
export function statusWord(view: Pick<SessionView, 'session'>): { word: StatusWord; tone: StatusTone } {
  const s = view.session as { status?: string; archived_at?: number | string | null };
  if (s.archived_at !== null && s.archived_at !== undefined && s.archived_at !== '') return { word: 'Archived', tone: 'quiet' };
  return BY_STATUS[String(s.status ?? '').toLowerCase()] ?? { word: 'Unknown', tone: 'quiet' };
}

/** A chat (several runs) reads its newest run's word; no runs = "Unknown". */
export function chatStatusWord(views: readonly Pick<SessionView, 'session'>[]): { word: StatusWord; tone: StatusTone } {
  const newest = [...views].sort((a, b) => Number((b.session as { created_at?: number }).created_at ?? 0) - Number((a.session as { created_at?: number }).created_at ?? 0))[0];
  return newest === undefined ? { word: 'Unknown', tone: 'quiet' } : statusWord(newest);
}
