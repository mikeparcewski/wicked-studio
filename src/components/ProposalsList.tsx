import {
  memoryPayload,
  policyPayload,
  policySteeringType,
  proposalKind,
  type Proposal,
} from '../api/proposals.js';
import { readErrorKind } from '../api/errors.js';
import { KindChip, severityWord } from './ProposalChips.js';
import { StateBanner, EmptyState, Skeleton, TechDetails } from './ui/index.js';

const cap = (w: string): string => (w === '' ? w : w.charAt(0).toUpperCase() + w.slice(1));

function PayloadText({ proposal }: { proposal: Proposal }): React.ReactElement {
  const kind = proposalKind(proposal);
  if (kind === 'memory') {
    const { content } = memoryPayload(proposal);
    return <p data-testid="proposal-memory-content" className="wk-gk-content">{content ?? 'No content provided.'}</p>;
  }
  if (kind === 'policy') {
    const { rule } = policyPayload(proposal);
    return <p data-testid="proposal-policy-rule" className="wk-gk-content">{rule ?? 'No rule text provided.'}</p>;
  }
  return <p data-testid="proposal-raw-payload" className="wk-gk-content">A proposal Studio can&rsquo;t show in words; its details are below.</p>;
}

function ProposalCard({ proposal, deciding, onApprove, onReject }: {
  proposal: Proposal;
  deciding: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}): React.ReactElement {
  const kind = proposalKind(proposal);
  const steeringType = kind === 'policy' ? policySteeringType(proposal) : null;
  const severity = policyPayload(proposal).severity;
  const tier = kind === 'memory' ? memoryPayload(proposal).tier : null;
  const proposer = proposal.provenance.agent ?? proposal.provenance.helper;
  // One disclosure for every internal: the proposal id, provenance and tags (studio#689 row 47).
  const details = [
    `proposal_id: ${proposal.id}`,
    ...Object.entries(proposal.provenance).map(([k, v]) => `${k}: ${String(v)}`),
    ...Object.entries(proposal.facets).map(([k, v]) => `${k}: ${String(v)}`),
    ...(kind === 'other' && proposal.payload !== undefined ? [JSON.stringify(proposal.payload) ?? ''] : []),
  ];
  return (
    <li data-testid="proposal-card" data-proposal-id={proposal.id} data-kind={kind} className="wk-gk-card">
      <div className="wk-gk-row">
        <KindChip proposal={proposal} />
        {steeringType !== null && <span data-testid="proposal-policy-target" className="wk-tag">{cap(steeringType)}</span>}
        {tier != null && <span data-testid="proposal-memory-tier" className="wk-tag">{cap(tier)}</span>}
      </div>
      <PayloadText proposal={proposal} />
      {/* studio#689 row 79: what approving does, said once, in plain words. */}
      {kind === 'policy' && (
        <p className="wk-gk-muted">
          Approving adds a {steeringType ?? 'steering'} rule
          {severity !== null && <> (<span data-testid="proposal-policy-severity">{severityWord(severity)}</span>)</>}.
        </p>
      )}
      <p data-testid="proposal-provenance" className="wk-gk-muted">Proposed by {proposer ?? 'a helper'}</p>
      <div data-testid="proposal-facets"><TechDetails text={details} /></div>
      <div className="wk-gk-actions">
        <button data-testid="proposal-reject" type="button" disabled={deciding} onClick={() => onReject(proposal.id)} className="wk-btn wk-btn--secondary">Reject</button>
        <button data-testid="proposal-approve" type="button" disabled={deciding} onClick={() => onApprove(proposal.id)} className="wk-btn wk-btn--primary">Approve</button>
      </div>
    </li>
  );
}

export function ProposalsList({ proposals, loading, error, decidingIds, onApprove, onReject, onRetry, errorKind }: {
  proposals: Proposal[];
  loading: boolean;
  error: string | null;
  decidingIds: ReadonlySet<string>;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRetry?: () => void;
  errorKind?: 'offline' | 'error';
}): React.ReactElement {
  if (loading) return <Skeleton data-testid="proposals-loading" variant="card" />;
  if (error !== null) {
    return <StateBanner data-testid="proposals-error" kind={errorKind ?? readErrorKind(error)} what="proposals" error={error} {...(onRetry !== undefined ? { onRetry } : {})} />;
  }
  if (proposals.length === 0) return <EmptyState data-testid="proposals-empty" title="No proposals to review." />;
  return (
    <ul data-testid="proposals-list" className="wk-gk-list">
      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} deciding={decidingIds.has(proposal.id)} onApprove={onApprove} onReject={onReject} />
      ))}
    </ul>
  );
}
