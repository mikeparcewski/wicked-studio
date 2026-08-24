import type { SessionView, WorkUnit } from '../api/types.js';
import type { LoggedEvent } from '../store/runtime.js';

/**
 * The phase-progress derivation (DES-UX-002 §1.2, slice BA) — pure functions,
 * no React, no clock, so the strip's verdicts are pinnable in unit tests.
 *
 * Everything here is a CLIENT derivation over data the studio already holds:
 * the run's ordered `units` (on every `SessionView` the board fetched) and the
 * run's live event log (the shared runtime store, fed by the one `/ws`
 * subscription). Zero new requests — §1.5's request-tap AC.
 */

/** Statuses in which a run is moving under its own power — the runs whose
 *  cards carry the phase strip (§1.3 "cards with an active run"). One spelling,
 *  shared with the live feed's block-eligibility rule. */
export const MOVING: ReadonlySet<string> = new Set(['planning', 'distributing', 'executing']);

/** One stage node on the strip: a consecutive run of same-stage units. */
export interface PhaseNode {
  stage: string;
  /** The ords of the units this node spans, in plan order. */
  ords: number[];
  state: 'complete' | 'active' | 'future';
}

/** §1.3's truncation: cap a description for a one-line surface, honestly elided. */
export function truncate(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap - 1)}…` : text;
}

/** The newest `unitDispatched` ord in a run's live log, or undefined. */
function dispatchedOrd(log: LoggedEvent[] | undefined): number | undefined {
  if (log === undefined) return undefined;
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry !== undefined && entry.type === 'unitDispatched' && typeof entry.ord === 'number') {
      return entry.ord;
    }
  }
  return undefined;
}

/**
 * The unit the run is on — §1.2's CLIENT derivation, with the live wire on top:
 *
 *   1. the newest `unitDispatched` in the run's event log names the current
 *      unit (the event IS the dispatch — this is what makes the description
 *      line move within a frame of the frame, no refetch);
 *   2. otherwise the lowest-ord `distributed` unit;
 *   3. otherwise the lowest-ord `pending` unit after the last `done`.
 *
 * A dispatch whose unit the (possibly fresher) unit list already shows as
 * terminal is stale, not current — rule 1 yields to the list.
 */
export function currentUnitOf(
  units: readonly WorkUnit[],
  log?: LoggedEvent[],
): WorkUnit | undefined {
  const ordered = [...units].sort((a, b) => a.ord - b.ord);
  const live = dispatchedOrd(log);
  if (live !== undefined) {
    const unit = ordered.find((u) => u.ord === live);
    if (unit !== undefined && unit.status !== 'done' && unit.status !== 'rejected') return unit;
  }
  const distributed = ordered.find((u) => u.status === 'distributed');
  if (distributed !== undefined) return distributed;
  let lastDone = -1;
  for (const u of ordered) if (u.status === 'done') lastDone = u.ord;
  return ordered.find((u) => u.status === 'pending' && u.ord > lastDone)
    ?? ordered.find((u) => u.status === 'pending');
}

/**
 * The strip's nodes: the plan's units in `ord` order, grouped into consecutive
 * same-stage runs (§1.3 "one per distinct stage value in the run's unit plan" —
 * a plan that returns to `build` after `review` earns a second build node,
 * because that IS a distinct leg of the plan). A node is `complete` when every
 * unit it spans is done, `active` when it holds the current unit, `future`
 * otherwise.
 */
export function phaseNodesOf(
  units: readonly WorkUnit[],
  currentOrd: number | undefined,
): PhaseNode[] {
  const ordered = [...units].sort((a, b) => a.ord - b.ord);
  const groups: { stage: string; units: WorkUnit[] }[] = [];
  for (const unit of ordered) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.stage === unit.stage) last.units.push(unit);
    else groups.push({ stage: unit.stage, units: [unit] });
  }
  return groups.map((g) => ({
    stage: g.stage,
    ords: g.units.map((u) => u.ord),
    state:
      currentOrd !== undefined && g.units.some((u) => u.ord === currentOrd)
        ? 'active'
        : g.units.every((u) => u.status === 'done')
          ? 'complete'
          : 'future',
  }));
}

/**
 * The sidebar's phase line (§1.3): `phase n/N · stage-name`, off the active
 * node — or null when no node is active (no plan yet, or a terminal run),
 * so the block never states a position it does not hold.
 */
export function phaseLineOf(nodes: readonly PhaseNode[]): string | null {
  const active = nodes.findIndex((n) => n.state === 'active');
  if (active === -1) return null;
  const node = nodes[active];
  return node === undefined ? null : `phase ${active + 1}/${nodes.length} · ${node.stage}`;
}

/** The leading moving run of a card/block — the one whose plan the strip shows. */
export function leadMovingRun(runs: readonly SessionView[]): SessionView | undefined {
  return runs.find((v) => MOVING.has(v.session.status));
}
