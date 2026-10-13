import { create } from 'zustand';
import type { CoreEvent } from '../api/types.js';

/**
 * THE DESK'S LIVE STREAM (DES-desk-v2 §2.2): the CoreEvents arriving over `/ws` from every run,
 * plus a one-time backfill of recent durable frames (`GET /runs/:id/events`) so the stream is not
 * empty on first load. Only frames the stream says something about are kept (`STREAM_TYPES`), and
 * at most `CAP` of them (newest kept). Nothing is ever synthesised: an item is a real frame.
 *
 * A live `/ws` frame carries no `ts` (the durable log stamps it); its clock is when it arrived.
 */

export const STREAM_TYPES: ReadonlySet<string> = new Set([
  'sessionStarted', 'sessionCompleted', 'sessionFailed', 'runCancelled',
  'unitExecuting', 'unitDone', 'stepFailed', 'awaitingHuman', 'gateDecided', 'gateEscalated',
  'unitReassigned', 'councilSeatFailed', 'governanceUnenforced', 'acpFallback', 'failureTriaged', 'repoChecksEvaluated',
]);

export const CAP = 200;

export interface StreamItem {
  /** Dedupe identity: run + type + ord + seq (or arrival order for a live frame). */
  key: string;
  runId: string;
  type: string;
  at: number;
  /** Arrived over the socket after the Desk mounted (it animates in). */
  live: boolean;
  event: CoreEvent;
}

interface DeskStreamState {
  items: StreamItem[];
  backfilled: boolean;
  ingest: (e: CoreEvent) => void;
  backfill: (events: readonly CoreEvent[]) => void;
}

let arrivals = 0;

function keyOf(e: CoreEvent, live: boolean): string {
  const r = e as unknown as { session?: string; type?: string; ord?: number; seq?: number; cli?: string; attempt?: number };
  // A live frame lacks `seq`: it keys on its content so the backfill copy of the same frame merges.
  return `${r.session ?? ''}|${r.type ?? ''}|${r.ord ?? ''}|${r.attempt ?? ''}|${r.cli ?? ''}|${live ? '' : r.seq ?? ''}`;
}

function itemOf(e: CoreEvent, live: boolean): StreamItem | null {
  const r = e as unknown as { session?: unknown; type?: unknown; ts?: unknown };
  if (typeof r.type !== 'string' || !STREAM_TYPES.has(r.type) || typeof r.session !== 'string') return null;
  const at = typeof r.ts === 'number' && r.ts > 0 ? r.ts : Date.now();
  return { key: live ? `${keyOf(e, true)}#${(arrivals += 1)}` : keyOf(e, false), runId: r.session, type: r.type, at, live, event: e };
}

export const useDeskStream = create<DeskStreamState>((set) => ({
  items: [],
  backfilled: false,
  ingest: (e) => {
    const it = itemOf(e, true);
    if (it === null) return;
    set((s) => ({ items: [it, ...s.items].slice(0, CAP) }));
  },
  backfill: (events) => {
    const got = events.map((e) => itemOf(e, false)).filter((x): x is StreamItem => x !== null);
    set((s) => {
      const have = new Set(s.items.map((i) => i.key));
      const merged = [...s.items, ...got.filter((g) => !have.has(g.key))].sort((a, b) => b.at - a.at).slice(0, CAP);
      return { items: merged, backfilled: true };
    });
  },
}));

/** Test hook. */
export function resetDeskStream(): void { useDeskStream.setState({ items: [], backfilled: false }); arrivals = 0; }
