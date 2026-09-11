import type { CoreEvent } from '../api/types.js';
import { distributionDegradedReason } from '../api/wave6-wire.js';

/**
 * "council degraded: …" on the run head (wave 6 — F-7R2-006 / F-4R2-007 studio half, api-types
 * 0.36.0 `unitDistributed.degradedReason`): whenever the engine seated FEWER seats than the run
 * configured — "4 of 5 seats benched: codex, pi (signed out), opencode (dispatch budget)" — the
 * run head says so in one line, so a "council 100%" agreement a few rows down is read for what it
 * is: one seat agreeing with itself. A pure view over the run's event log; the LATEST distribution
 * that carried a reason speaks, and how many units were affected is counted beside it. Nothing on
 * a run whose distributions carry no reason (a full council, or a pre-0.36 daemon).
 */

export interface DegradedCouncil {
  /** The latest `degradedReason` the log carries. */
  reason: string;
  /** The unit that distribution was for, when the frame named one. */
  ord: number | null;
  /** How many distributions in the log carried a reason. */
  units: number;
}

/** The fold: the latest degraded distribution + how many there were; `null` when none. */
export function degradedCouncil(events: readonly CoreEvent[]): DegradedCouncil | null {
  let latest: DegradedCouncil | null = null;
  let units = 0;
  for (const e of events) {
    if (e.type !== 'unitDistributed') continue;
    const reason = distributionDegradedReason(e);
    if (reason === null) continue;
    units += 1;
    latest = { reason, ord: typeof e.ord === 'number' ? e.ord : null, units };
  }
  return latest === null ? null : { ...latest, units };
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
      title="The engine seated fewer seats than this run configured — routing considers only seats whose health probe says usable (signed in, or a declared free tier); a seat that failed auth once is benched for the run."
    >
      <span className="font-semibold">council degraded:</span> {d.reason}
      {d.units > 1 && <span style={{ color: 'var(--ink-muted)' }}> · {d.units} units routed this way</span>}
    </p>
  );
}
