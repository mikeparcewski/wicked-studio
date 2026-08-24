import { useMemo } from 'react';
import type { SessionView, WorkUnit } from '../api/types.js';
import { currentUnitOf, phaseNodesOf, type PhaseNode } from '../board/phaseProgress.js';
import { useRuntimeStore } from '../store/runtime.js';

/**
 * The phase progress strip (DES-UX-002 §1.3, slice BA): a horizontal row of
 * stage nodes, one per consecutive same-stage leg of the run's unit plan.
 * The active node glows `--status-run-dim`, completed nodes are
 * `--status-done`, future nodes `--ink-dim`; the 2px gaps between nodes are
 * the card's own surface (§1.4's gap-fill) — no new semantic tokens.
 *
 * Overflow past 5 nodes collapses to an honest mono label rather than
 * squeezing the strip — the count is stated, never silently dropped.
 */

/** Nodes shown before the strip collapses the tail into a count (§1.3). */
const MAX_NODES = 5;

const NODE_BG: Record<PhaseNode['state'], string> = {
  active: 'var(--status-run-dim)',
  complete: 'var(--status-done)',
  future: 'var(--ink-dim)',
};

/**
 * The current unit of a run, live: the shared runtime log's newest
 * `unitDispatched` wins (so the strip and the description line move within a
 * frame of the frame's fold — no refetch), degrading to the unit list's own
 * statuses (§1.2's CLIENT derivation).
 */
export function useCurrentUnit(view: SessionView): WorkUnit | undefined {
  const log = useRuntimeStore((s) => s.logs[view.session.id]);
  return useMemo(() => currentUnitOf(view.units, log), [view, log]);
}

export function PhaseStrip({ units, currentOrd }: {
  units: readonly WorkUnit[];
  /** The current unit's ord — `undefined` marks no node active. */
  currentOrd: number | undefined;
}): React.ReactElement | null {
  const nodes = phaseNodesOf(units, currentOrd);
  if (nodes.length === 0) return null;
  const shown = nodes.slice(0, MAX_NODES);
  const hidden = nodes.length - shown.length;
  return (
    <div
      data-testid="phase-strip"
      data-nodes={nodes.length}
      style={{ display: 'flex', alignItems: 'center', gap: '2px', marginTop: '8px' }}
    >
      {shown.map((node, i) => (
        <span
          key={`${node.stage}:${node.ords[0] ?? i}`}
          data-testid="phase-node"
          data-stage={node.stage}
          {...(node.state === 'active' ? { 'data-active': 'true' } : {})}
          {...(node.state === 'complete' ? { 'data-complete': 'true' } : {})}
          title={node.stage}
          style={{
            width: '8px', height: '8px', borderRadius: 'var(--radius-full)', flexShrink: 0,
            background: NODE_BG[node.state],
            // The §1.3 glow — same token as the fill, halo only, no new color.
            boxShadow: node.state === 'active' ? '0 0 4px 1px var(--status-run-dim)' : 'none',
          }}
        />
      ))}
      {hidden > 0 && (
        <span
          data-testid="phase-strip-overflow"
          style={{
            fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
            color: 'var(--ink-dim)', marginLeft: '4px',
          }}
        >
          · {hidden} remaining
        </span>
      )}
    </div>
  );
}
