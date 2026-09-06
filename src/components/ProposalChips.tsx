import { proposalKind, type Proposal } from '../api/proposals.js';

/** The proposal queue's shared chip grammar — the kind chip (memory / policy), one spelling for
 *  the queue list, mirroring SteeringChips' severity/effect grammar. Policy severity reuses
 *  SteeringChips' SeverityChip, so the two governance surfaces read identically. */

export const KIND_COLOR: Record<'memory' | 'policy' | 'other', string> = {
  memory: 'var(--accent)',
  policy: 'var(--status-gate)',
  other: 'var(--ink-muted)',
};

/** The kind badge — shows the RAW `kind_type` (`memory`, `policy:security`) so the operator
 *  sees exactly what was proposed, colored by the folded kind. */
export function KindChip({ proposal }: { proposal: Proposal }): React.ReactElement {
  const kind = proposalKind(proposal);
  return (
    <span
      data-testid="proposal-kind-chip"
      data-kind={kind}
      className="inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold font-mono"
      style={{ color: KIND_COLOR[kind], border: `1px solid ${KIND_COLOR[kind]}` }}
    >
      {proposal.kind_type}
    </span>
  );
}

/** A key:value facet/provenance chip list — the drawer's ChipList grammar, keyed so React is
 *  happy and each pair stays legible. Renders a dash when the map is empty. */
export function KeyValueChips({ testid, entries }: {
  testid: string;
  entries: Record<string, string>;
}): React.ReactElement {
  const pairs = Object.entries(entries);
  if (pairs.length === 0) {
    return <span data-testid={testid} style={{ color: 'var(--ink-dim)' }}>—</span>;
  }
  return (
    <span data-testid={testid} className="inline-flex flex-wrap gap-1">
      {pairs.map(([k, v]) => (
        <span
          key={k}
          className="rounded px-1.5 py-0.5 text-[10px] font-mono"
          style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}
        >
          <span style={{ color: 'var(--ink-dim)' }}>{k}:</span> {v}
        </span>
      ))}
    </span>
  );
}
