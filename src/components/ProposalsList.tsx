import {
  memoryPayload,
  policyPayload,
  policySteeringType,
  proposalKind,
  type Proposal,
} from '../api/proposals.js';
import { SeverityChip } from './SteeringChips.js';
import { KeyValueChips, KindChip } from './ProposalChips.js';

/**
 * The proposal QUEUE list — one card per pending proposal, the review-surface twin of
 * SteeringGrid's spreadsheet. Each card shows the kind chip, the payload (memory: content +
 * tier; policy: the rule + severity), the facets, and the provenance (which run/agent proposed
 * it), with Approve / Reject actions. The page owns the wire calls + optimistic state; this
 * component is presentational (loading / error / empty states handled here, exactly like
 * SteeringGrid).
 */

/** One label:value detail line — the drawer's DetailRow grammar. */
function DetailRow({ label, testid, children }: {
  label: string;
  testid: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="w-24 shrink-0 text-[10px] uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>{label}</span>
      <span data-testid={testid} className="min-w-0 break-words" style={{ color: 'var(--ink-muted)' }}>{children}</span>
    </div>
  );
}

/** The payload, rendered by kind — memory shows content + tier, policy shows the rule +
 *  severity chip, an unrecognized kind shows the raw JSON so nothing is silently swallowed. */
function PayloadDetail({ proposal }: { proposal: Proposal }): React.ReactElement {
  const kind = proposalKind(proposal);
  if (kind === 'memory') {
    const { content, tier } = memoryPayload(proposal);
    return (
      <>
        <DetailRow label="Content" testid="proposal-memory-content">
          {content ?? <span style={{ color: 'var(--ink-dim)' }}>— (no content)</span>}
        </DetailRow>
        <DetailRow label="Tier" testid="proposal-memory-tier">
          {tier !== null ? <span className="font-mono">{tier}</span> : <span style={{ color: 'var(--ink-dim)' }}>—</span>}
        </DetailRow>
      </>
    );
  }
  if (kind === 'policy') {
    const { rule, severity } = policyPayload(proposal);
    return (
      <>
        <DetailRow label="Rule" testid="proposal-policy-rule">
          {rule ?? <span style={{ color: 'var(--ink-dim)' }}>— (no rule text)</span>}
        </DetailRow>
        <DetailRow label="Severity" testid="proposal-policy-severity">
          {severity !== null ? <SeverityChip severity={severity} /> : <span style={{ color: 'var(--ink-dim)' }}>—</span>}
        </DetailRow>
      </>
    );
  }
  return (
    <DetailRow label="Payload" testid="proposal-raw-payload">
      <code className="whitespace-pre-wrap break-all font-mono text-[10px]">
        {JSON.stringify(proposal.payload)}
      </code>
    </DetailRow>
  );
}

function ProposalCard({ proposal, deciding, onApprove, onReject }: {
  proposal: Proposal;
  deciding: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}): React.ReactElement {
  const steeringType = policySteeringType(proposal);
  return (
    <li
      data-testid="proposal-card"
      data-proposal-id={proposal.id}
      data-kind={proposalKind(proposal)}
      className="flex flex-col gap-2 rounded p-3"
      style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
    >
      <div className="flex items-center gap-2">
        <KindChip proposal={proposal} />
        {steeringType !== null && (
          <span data-testid="proposal-policy-target" className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            → {steeringType}
          </span>
        )}
        <span className="font-mono text-[10px]" style={{ color: 'var(--ink-dim)' }}>{proposal.id}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <PayloadDetail proposal={proposal} />
        <DetailRow label="Facets" testid="proposal-facets">
          <KeyValueChips testid="proposal-facets-chips" entries={proposal.facets} />
        </DetailRow>
        <DetailRow label="Proposed by" testid="proposal-provenance">
          <KeyValueChips testid="proposal-provenance-chips" entries={proposal.provenance} />
        </DetailRow>
      </div>

      <div className="flex items-center justify-end gap-2 pt-0.5">
        <button
          data-testid="proposal-reject"
          type="button"
          disabled={deciding}
          onClick={() => onReject(proposal.id)}
          className="rounded px-2 py-1 text-[10px] font-semibold disabled:opacity-50"
          style={{ color: 'var(--status-fail)', border: '1px solid var(--status-fail-dim)' }}
        >
          Reject
        </button>
        <button
          data-testid="proposal-approve"
          type="button"
          disabled={deciding}
          onClick={() => onApprove(proposal.id)}
          className="rounded px-2 py-1 text-[10px] font-semibold disabled:opacity-50"
          style={{ color: 'var(--status-done)', border: '1px solid var(--surface-raised)' }}
        >
          Approve
        </button>
      </div>
    </li>
  );
}

export function ProposalsList({ proposals, loading, error, decidingIds, onApprove, onReject }: {
  proposals: Proposal[];
  loading: boolean;
  error: string | null;
  /** Ids whose approve/reject is in flight — their buttons disable. */
  decidingIds: ReadonlySet<string>;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}): React.ReactElement {
  if (loading) {
    return <p data-testid="proposals-loading" className="text-xs" style={{ color: 'var(--ink-dim)' }}>Loading proposals…</p>;
  }
  if (error !== null) {
    return (
      <p data-testid="proposals-error" className="rounded px-2 py-1 text-xs" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
        {error}
      </p>
    );
  }
  if (proposals.length === 0) {
    return (
      <p data-testid="proposals-empty" className="rounded px-3 py-2 text-xs" style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}>
        No proposals to review.
      </p>
    );
  }
  return (
    <ul data-testid="proposals-list" className="flex flex-col gap-3">
      {proposals.map((p) => (
        <ProposalCard
          key={p.id}
          proposal={p}
          deciding={decidingIds.has(p.id)}
          onApprove={onApprove}
          onReject={onReject}
        />
      ))}
    </ul>
  );
}
