import type { CoreEvent, SessionView } from '../api/types.js';

/** `unitDistributed.pool` (core-ts 0.7.44 `UnitPoolSeatingJson`; api-types `UnitPoolSeating` from
 *  crew#894 — read here until studio's pin carries it). */
export interface UnitPoolSeating {
  requested: number;
  seated: number;
  monitors: string[];
  missing: string[];
  shortfall: string | null;
}

/**
 * studio#617 (wicked-core#810, core-ts 0.7.44): how each unit's WORKER POOL was filled — one creator
 * plus monitors (`unitDistributed.pool`). A pool larger than the signed-in instances is seated SHORT
 * and the engine says so rather than refusing the run; the run's record says it too: one quiet line
 * per pooled unit ("build: pool 3 · seated 3 · monitors claude#2, claude#3"), and a shortfall in the
 * warning tone, naming the missing instances and the remedy (sign them in). A pure view over the
 * run's event log: the LATEST distribution of each ord speaks (a re-dispatch re-seats the pool).
 * Nothing on a run whose units all have a pool of 1 (`pool: null`) or an engine before the field.
 */

export interface UnitPoolLine {
  ord: number;
  phase: string;
  pool: UnitPoolSeating;
  short: boolean;
}

function isPool(v: unknown): v is UnitPoolSeating {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.requested === 'number' && typeof p.seated === 'number' && Array.isArray(p.monitors) && Array.isArray(p.missing);
}

/** The fold: the latest pooled distribution of each ord, in ord order. */
export function unitPools(events: readonly CoreEvent[], units: SessionView['units']): UnitPoolLine[] {
  const byOrd = new Map<number, UnitPoolSeating | null>();
  for (const e of events) {
    if (e.type !== 'unitDistributed' || typeof e.ord !== 'number') continue;
    const pool = (e as { pool?: unknown }).pool;
    byOrd.set(e.ord, isPool(pool) ? pool : null);
  }
  const out: UnitPoolLine[] = [];
  for (const [ord, pool] of [...byOrd.entries()].sort((a, b) => a[0] - b[0])) {
    if (pool === null) continue;
    const u = units.find((x) => x.ord === ord);
    const phase = u?.phase_ref ?? u?.id.split(':').pop() ?? `step ${ord}`;
    out.push({ ord, phase, pool, short: pool.seated < pool.requested });
  }
  return out;
}

/** "build: pool 3 · seated 2 · monitors claude#2". Pure. */
export function poolWords(l: UnitPoolLine): string {
  const monitors = l.pool.monitors.length > 0 ? ` · monitors ${l.pool.monitors.join(', ')}` : '';
  return `${l.phase}: pool ${l.pool.requested} · seated ${l.pool.seated}${monitors}`;
}

/** "Seated short — 2 of 3: claude#3 is not signed in. Sign it in under Settings to fill the pool." Pure. */
export function shortfallWords(l: UnitPoolLine): string {
  // No signed-out instance to name (the pool asks for more instances than are configured): the
  // remedy is to add one, then sign it in (codex r1).
  const missing = l.pool.missing.length > 0
    ? ` Missing: ${l.pool.missing.join(', ')} — sign ${l.pool.missing.length === 1 ? 'it' : 'them'} in under Settings to fill the pool.`
    : ' Add another instance of a seat under Settings and sign it in to fill the pool.';
  const why = l.pool.shortfall !== null && l.pool.shortfall.trim() !== '' ? ` ${l.pool.shortfall.trim().replace(/\.?$/, '.')}` : '';
  return `${l.phase} was seated short — ${l.pool.seated} of ${l.pool.requested}.${why}${missing}`;
}

export function RunPoolNote({ events, units }: { events: readonly CoreEvent[]; units: SessionView['units'] }): React.ReactElement | null {
  const lines = unitPools(events, units);
  if (lines.length === 0) return null;
  return (
    <div data-testid="run-pools" className="wk-session-grey">
      {lines.map((l) => (
        <p key={l.ord} data-testid="run-pool" data-ord={l.ord} data-short={l.short ? 'true' : 'false'}>
          {poolWords(l)}
          {l.short && (
            <span data-testid="run-pool-shortfall" className="wk-run-pool-short"> {shortfallWords(l)}</span>
          )}
        </p>
      ))}
    </div>
  );
}
