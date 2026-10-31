import { useState } from 'react';
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
import { sessionPath } from '../board/sessionModel.js';

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

function ProposalCard({ proposal, deciding, onApprove, onReject, editable }: {
  proposal: Proposal;
  deciding: boolean;
  /** `content`: approve a memory proposal with these words instead of its own. */
  onApprove: (id: string, content?: string) => void;
  onReject: (id: string) => void;
  editable: boolean;
}): React.ReactElement {
  const kind = proposalKind(proposal);
  const [draft, setDraft] = useState<string | null>(null);
  const canEdit = editable && kind === 'memory';
  const original = memoryPayload(proposal).content ?? '';
  const edited = draft !== null && draft.trim() !== '' && draft.trim() !== original.trim();
  const steeringType = kind === 'policy' ? policySteeringType(proposal) : null;
  const severity = policyPayload(proposal).severity;
  const tier = kind === 'memory' ? memoryPayload(proposal).tier : null;
  // A worker's proposal carries the engine-stamped `run_agent` (crew's own learnings say `crew`); older ones `agent`.
  const agent = proposal.provenance['run_agent'] ?? proposal.provenance.agent ?? proposal.provenance.helper;
  const proposer = agent === 'crew' ? 'crew, from the run\u2019s record' : agent;
  const fromRun = proposal.provenance['run_id'];
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
      {draft === null ? <PayloadText proposal={proposal} /> : (
        <label className="wk-se-field">
          <span>The memory, in your words</span>
          <textarea data-testid="proposal-edit-text" className="wk-field" rows={3} maxLength={4000} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
      )}
      {/* studio#689 row 79: what approving does, said once, in plain words. */}
      {kind === 'policy' && (
        <p className="wk-gk-muted">
          Approving adds a {steeringType ?? 'steering'} rule
          {severity !== null && <> (<span data-testid="proposal-policy-severity">{severityWord(severity)}</span>)</>}.
        </p>
      )}
      <p data-testid="proposal-provenance" className="wk-gk-muted">
        Proposed by {proposer ?? 'a helper'}
        {fromRun !== undefined && fromRun !== '' && <> · <a data-testid="proposal-source-run" href={sessionPath(`run:${fromRun}`)}>from this run</a></>}
      </p>
      <div data-testid="proposal-facets"><TechDetails text={details} /></div>
      <div className="wk-gk-actions">
        {draft === null ? <>
          <button data-testid="proposal-reject" type="button" disabled={deciding} onClick={() => onReject(proposal.id)} className="wk-btn wk-btn--secondary">Reject</button>
          {canEdit && <button data-testid="proposal-edit" type="button" disabled={deciding} onClick={() => setDraft(original)} className="wk-btn wk-btn--secondary">Edit</button>}
          <button data-testid="proposal-approve" type="button" disabled={deciding} onClick={() => onApprove(proposal.id)} className="wk-btn wk-btn--primary">Approve</button>
        </> : <>
          <button data-testid="proposal-edit-cancel" type="button" disabled={deciding} onClick={() => setDraft(null)} className="wk-btn wk-btn--secondary">Cancel</button>
          <button data-testid="proposal-approve-edited" type="button" disabled={deciding || !edited}
            title={edited ? undefined : 'Change the words to approve an edit, or Cancel and approve it as filed'}
            onClick={() => onApprove(proposal.id, draft.trim())} className="wk-btn wk-btn--primary">Approve with this edit</button>
        </>}
      </div>
    </li>
  );
}

export function ProposalsList({ proposals, loading, error, decidingIds, onApprove, onReject, onRetry, errorKind, editable = false }: {
  proposals: Proposal[];
  loading: boolean;
  error: string | null;
  decidingIds: ReadonlySet<string>;
  onApprove: (id: string, content?: string) => void;
  editable?: boolean;
  onReject: (id: string) => void;
  onRetry?: () => void;
  errorKind?: 'offline' | 'error';
}): React.ReactElement {
  // Only the first read shows the skeleton: a background re-read keeps the cards (and any draft) mounted.
  if (loading && proposals.length === 0) return <Skeleton data-testid="proposals-loading" variant="card" />;
  if (error !== null) {
    return <StateBanner data-testid="proposals-error" kind={errorKind ?? readErrorKind(error)} what="proposals" error={error} {...(onRetry !== undefined ? { onRetry } : {})} />;
  }
  if (proposals.length === 0) return <EmptyState data-testid="proposals-empty" title="No proposals to review." />;
  return (
    <ul data-testid="proposals-list" className="wk-gk-list">
      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id} editable={editable} proposal={proposal} deciding={decidingIds.has(proposal.id)} onApprove={onApprove} onReject={onReject} />
      ))}
    </ul>
  );
}
