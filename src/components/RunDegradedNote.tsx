import type { CoreEvent } from '../api/types.js';
import { narrateDistributionWarning } from './narrator.js';

/**
 * "council degraded: …" on the run head (wave 6 — F-7R2-006 / F-4R2-007 studio half, api-types
 * 0.36.0 `unitDistributed.degradedReason`): whenever the engine seated FEWER seats than the run
 * configured — "4 of 5 seats benched: codex, pi (signed out), opencode (dispatch budget)" — the
 * run head says so in one line, so a "council 100%" agreement a few rows down is read for what it
 * is: one seat agreeing with itself. A pure view over the run's event log; the LATEST distribution
 * that carried a reason speaks, and how many units were affected is counted beside it. Nothing on
 * a run whose distributions carry neither a degraded reason nor a creator-seat fallback.
 * A fallback is disclosed even on a bench-free single-seat roster (#276).
 */

export interface DegradedCouncil {
  /** The latest routing warning, including creator-seat fallback and any degraded reason. */
  reason: string;
  /** The unit that distribution was for, when the frame named one. */
  ord: number | null;
  /** How many DISTINCT units were routed by a degraded council — a re-dispatch or a re-plan of the
   *  same ord is one unit, not two (independent review of #263, F-11). */
  units: number;
}

/** The fold: the latest degraded distribution + how many distinct units; `null` when none. */
export function degradedCouncil(events: readonly CoreEvent[]): DegradedCouncil | null {
  let latest: { reason: string; ord: number | null } | null = null;
  const ords = new Set<string>();
  for (const e of events) {
    if (e.type !== 'unitDistributed') continue;
    const reason = narrateDistributionWarning(e);
    if (reason === null) continue;
    const ord = typeof e.ord === 'number' ? e.ord : null;
    ords.add(ord === null ? `?${ords.size}` : String(ord));
    latest = { reason, ord };
  }
  return latest === null ? null : { ...latest, units: ords.size };
}

export function RunDegradedNote({ events }: { events: readonly CoreEvent[] }): React.ReactElement | null {
  const d = degradedCouncil(events);
  if (d === null) return null;
  return (
    <p
      data-testid="run-degraded"
      data-units={d.units}
      {...(d.ord !== null ? { 'data-ord': d.ord } : {})}
      className="px-6 py-1.5 text-[11px] font-mono shrink-0"
      style={{
        color: 'var(--status-gate)',
        background: 'var(--status-gate-dim)',
        borderBottom: '1px solid var(--surface-raised)',
        overflowWrap: 'anywhere',
      }}
      title="Routing used fewer seats than configured, or a review stayed on its creator seat because no distinct eligible seat was available."
    >
      {d.reason}
      {d.units > 1 && <span style={{ color: 'var(--ink-muted)' }}> · {d.units} units routed this way</span>}
    </p>
  );
}
