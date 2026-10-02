import { create } from 'zustand';
import type { RunTeamResponse, TeamRow } from '../api/teamPlan.js';

/**
 * THE TEAM-PLAN FOLD (DES-STUDIO-REBUILD-001 §5.2, slice S6a): one run's `wicked.team.*` rows,
 * hydrated from `GET /runs/:id/team` and then grown by the live `teamEvent` frames crew relays onto
 * `/ws` (crew team/ws-relay.ts).
 *
 *  - Rows are kept once each, ordered by the bus `event_id`: a frame replayed on reconnect, or a
 *    hydrate that overlaps frames already folded, applies nothing twice (no double-apply).
 *  - A frame that arrives BEFORE the hydrate answers is kept (late join); the hydrate merges in.
 *  - The snapshot (teamed, transport, reason, planRev, ended) is the route's, replaced on each
 *    hydrate. A daemon with no bus relay sends no frames: the session re-reads the route on each
 *    run frame instead, and the fold stays exactly what the route said.
 *
 * Pure folds first (unit-tested), then a small store keyed by run id. Only runs a mounted chain
 * tracks are folded (counted, released on unmount), so the store never grows with frames nobody reads.
 */

export interface TeamSnapshot {
  teamed: boolean;
  transport: string | null;
  reason: string | null;
  planRev: number | null;
  ended: boolean;
}

export interface TeamFold {
  /** Unique by `event_id`, ascending. */
  rows: TeamRow[];
  /** `null` until the route answered. */
  snapshot: TeamSnapshot | null;
}

export const EMPTY_FOLD: TeamFold = { rows: [], snapshot: null };

function validRow(r: unknown): r is TeamRow {
  if (typeof r !== 'object' || r === null) return false;
  const x = r as Partial<TeamRow>;
  return typeof x.event_id === 'number' && Number.isFinite(x.event_id) && typeof x.event_type === 'string'
    && typeof x.payload === 'object' && x.payload !== null;
}

/** Merge rows into the fold: each `event_id` once, ascending. Returns the same fold when nothing is new. */
export function foldRows(fold: TeamFold, rows: readonly unknown[]): TeamFold {
  const have = new Set(fold.rows.map((r) => r.event_id));
  const fresh: TeamRow[] = [];
  for (const r of rows) {
    if (!validRow(r) || have.has(r.event_id)) continue;
    have.add(r.event_id);
    fresh.push(r);
  }
  if (fresh.length === 0) return fold;
  return { ...fold, rows: [...fold.rows, ...fresh].sort((a, b) => a.event_id - b.event_id) };
}

/** One live row. */
export function foldFrame(fold: TeamFold, row: TeamRow): TeamFold {
  return foldRows(fold, [row]);
}

/** The route's answer: its rows (run-level and every unit's) merged in, its snapshot taken. */
export function hydrateFold(fold: TeamFold, resp: RunTeamResponse): TeamFold {
  const all = [...(resp.rows ?? []), ...(resp.units ?? []).flatMap((u) => u.rows ?? [])];
  const merged = foldRows(fold, all);
  const teamed = resp.teamed ?? (all.length > 0);
  return {
    rows: merged.rows,
    snapshot: {
      teamed,
      transport: resp.transport ?? null,
      reason: resp.reason ?? null,
      planRev: resp.planRev ?? null,
      ended: resp.ended === true,
    },
  };
}

/** A `/ws` `teamEvent` frame → its run and row, or `null` for every other frame. */
export function teamFrameOf(frame: { type: string } & Record<string, unknown>): { runId: string; row: TeamRow } | null {
  if (frame.type !== 'teamEvent') return null;
  const ev = frame.event;
  if (!validRow(ev)) return null;
  const runId = (ev.payload as { run_id?: unknown }).run_id;
  return typeof runId === 'string' && runId !== '' ? { runId, row: ev } : null;
}

// ── The store ──────────────────────────────────────────────────────────────────────────────

interface TeamPlanStore {
  byRun: Record<string, TeamFold>;
  /** How many mounted chains show each run. */
  refs: Record<string, number>;
  /** A chain that shows this run mounted: start (or keep) folding its frames. */
  track: (runId: string) => void;
  /** That chain unmounted: the last one out drops the fold, so the store holds only what is shown. */
  untrack: (runId: string) => void;
  hydrate: (runId: string, resp: RunTeamResponse) => void;
  ingest: (frame: { type: string } & Record<string, unknown>) => void;
}

export const useTeamPlanStore = create<TeamPlanStore>((set, get) => ({
  byRun: {},
  refs: {},
  track: (runId) =>
    set((s) => ({
      refs: { ...s.refs, [runId]: (s.refs[runId] ?? 0) + 1 },
      byRun: s.byRun[runId] === undefined ? { ...s.byRun, [runId]: EMPTY_FOLD } : s.byRun,
    })),
  untrack: (runId) =>
    set((s) => {
      const n = (s.refs[runId] ?? 0) - 1;
      if (n > 0) return { refs: { ...s.refs, [runId]: n } };
      const refs = { ...s.refs };
      const byRun = { ...s.byRun };
      delete refs[runId];
      delete byRun[runId];
      return { refs, byRun };
    }),
  // A hydrate that answers after its chain unmounted is dropped: nothing shows it.
  hydrate: (runId, resp) => {
    if (get().refs[runId] === undefined) return;
    set((s) => ({ byRun: { ...s.byRun, [runId]: hydrateFold(s.byRun[runId] ?? EMPTY_FOLD, resp) } }));
  },
  ingest: (frame) => {
    const hit = teamFrameOf(frame);
    if (hit === null) return;
    const cur = get().byRun[hit.runId];
    if (cur === undefined) return; // nobody shows this run; a later hydrate carries the row
    const next = foldFrame(cur, hit.row);
    if (next !== cur) set((s) => ({ byRun: { ...s.byRun, [hit.runId]: next } }));
  },
}));
