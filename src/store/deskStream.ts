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

/** One scope's backfill (the Desk, or a project's runs): pending while it reads, then what failed. */
export interface BackfillState { phase: 'pending' | 'done'; failed: number; total: number }

interface DeskStreamState {
  items: StreamItem[];
  backfilled: boolean;
  /** Per scope key ('desk' or a project id): each scope backfills its own recent runs once. */
  backfills: Record<string, BackfillState>;
  ingest: (e: CoreEvent) => void;
  backfill: (events: readonly CoreEvent[]) => void;
  /** Claims a scope's backfill; false when it was already claimed (pending or done). */
  claimBackfill: (key: string) => boolean;
  finishBackfill: (key: string, events: readonly CoreEvent[], failed: number, total: number) => void;
  /** Retry: the scope reads again on its next render. */
  releaseBackfill: (key: string) => void;
}

let arrivals = 0;

/** Order-stable JSON (object keys sorted), so two copies of one payload stringify alike. */
function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(',')}]`;
  if (x !== null && typeof x === 'object') return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stable((x as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(x) ?? 'null';
}

/**
 * A frame's content identity: its whole payload except what only the durable log stamps (`seq`, `ts`).
 * A live frame and its backfilled copy share it; two different frames (another seat, kind or reason
 * on the same run) never do.
 */
function contentKey(e: CoreEvent): string {
  const rest: Record<string, unknown> = { ...(e as unknown as Record<string, unknown>) };
  delete rest.seq;
  delete rest.ts;
  return stable(rest);
}

function keyOf(e: CoreEvent, live: boolean): string {
  const r = e as unknown as { seq?: number };
  // A live frame lacks `seq`: it keys on its content (plus an arrival count, see itemOf).
  return live ? contentKey(e) : `${contentKey(e)}|${r.seq ?? ''}`;
}

function itemOf(e: CoreEvent, live: boolean): StreamItem | null {
  const r = e as unknown as { session?: unknown; type?: unknown; ts?: unknown };
  if (typeof r.type !== 'string' || !STREAM_TYPES.has(r.type) || typeof r.session !== 'string') return null;
  const at = typeof r.ts === 'number' && r.ts > 0 ? r.ts : Date.now();
  return { key: live ? `${keyOf(e, true)}#${(arrivals += 1)}` : keyOf(e, false), runId: r.session, type: r.type, at, live, event: e };
}

export const useDeskStream = create<DeskStreamState>((set, get) => ({
  items: [],
  backfilled: false,
  backfills: {},
  claimBackfill: (key) => {
    if (get().backfills[key] !== undefined) return false;
    set((s) => ({ backfills: { ...s.backfills, [key]: { phase: 'pending', failed: 0, total: 0 } } }));
    return true;
  },
  finishBackfill: (key, events, failed, total) => {
    get().backfill(events);
    set((s) => ({ backfills: { ...s.backfills, [key]: { phase: 'done', failed, total } } }));
  },
  releaseBackfill: (key) => set((s) => { const b = { ...s.backfills }; delete b[key]; return { backfills: b }; }),
  ingest: (e) => {
    const it = itemOf(e, true);
    if (it === null) return;
    set((s) => ({ items: [it, ...s.items].slice(0, CAP) }));
  },
  backfill: (events) => {
    const got = events.map((e) => itemOf(e, false)).filter((x): x is StreamItem => x !== null);
    set((s) => {
      const have = new Set(s.items.map((i) => i.key));
      // A frame seen live and then backfilled shows once: each live item answers for ONE durable copy
      // with the same content (one-for-one, so a frame that really repeated keeps its count). Items
      // already backfilled are matched by their durable key (content + seq) instead.
      const liveLeft = new Map<string, number>();
      for (const i of s.items) if (i.live) { const k = contentKey(i.event); liveLeft.set(k, (liveLeft.get(k) ?? 0) + 1); }
      const fresh = got.filter((g) => {
        if (have.has(g.key)) return false;
        const k = contentKey(g.event);
        const n = liveLeft.get(k) ?? 0;
        if (n > 0) { liveLeft.set(k, n - 1); return false; }
        return true;
      });
      const merged = [...s.items, ...fresh].sort((a, b) => b.at - a.at).slice(0, CAP);
      return { items: merged, backfilled: true };
    });
  },
}));

/** Test hook. */
export function resetDeskStream(): void { useDeskStream.setState({ items: [], backfilled: false, backfills: {} }); arrivals = 0; }
