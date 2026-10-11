import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  approveProposal,
  isProposalsUnsupported,
  listProposals,
  memoryPayload,
  policyPayload,
  proposalKind,
  rejectProposal,
  type Proposal,
  type ProposalKind,
} from '../api/proposals.js';
import { ProposalsList } from './ProposalsList.js';
import { useNeedsSources } from '../store/needsSources.js';
import { readErrorKind } from '../api/errors.js';
import { shortContent } from './ProposalChips.js';
import { EmptyState, StateBanner } from './ui/index.js';

export function ProposalsSection({ kind, heading, onDecision }: {
  /** Which proposals this section reviews — the sub-section it lives in. */
  kind: Extract<ProposalKind, 'memory' | 'policy'>;
  /** The section title, e.g. "Policy proposals" / "Memory proposals". */
  heading: string;
  /** Fired after a successful approve/reject — lets a host (the dashboard) refresh its own
   *  headline count, which this self-contained section otherwise cannot know changed. */
  onDecision?: (() => void) | undefined;
}): React.ReactElement {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  /** Ids whose approve/reject is in flight — their buttons disable until it resolves. */
  const [decidingIds, setDecidingIds] = useState<ReadonlySet<string>>(new Set<string>());
  /** The post-decision note (approved / rejected / a failed decision), in-band. */
  const [note, setNote] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<{ kind: 'offline' | 'error'; message: string; id: string; verb: 'approve' | 'reject' } | null>(null);
  const [errorKind, setErrorKind] = useState<'offline' | 'error'>('error');

  const loadProposals = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setUnsupported(false);
    try {
      const ps = await listProposals({ state: 'pending' });
      setProposals(ps);
      // The needs-you queue's proposals input rides this read (a deposit, zero requests), so a
      // decided proposal leaves the rail and peek as soon as this list reconciles.
      useNeedsSources.getState().depositProposals(ps);
    } catch (e) {
      setProposals([]);
      setErrorKind(readErrorKind(e));
      if (isProposalsUnsupported(e)) setUnsupported(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProposals();
  }, [loadProposals]);

  const visible = useMemo(
    () => proposals.filter((p) => proposalKind(p) === kind),
    [proposals, kind],
  );

  const decide = useCallback((id: string, verb: 'approve' | 'reject'): void => {
    setNote(null);
    setDecisionError(null);
    const proposal = proposals.find((p) => p.id === id);
    const title = proposal === undefined ? 'Proposal' : shortContent(memoryPayload(proposal).content ?? policyPayload(proposal).rule ?? 'Proposal');
    setDecidingIds((cur) => new Set(cur).add(id));
    const call = verb === 'approve' ? approveProposal(id) : rejectProposal(id);
    void call
      .then(() => {
        // The row leaves the queue optimistically; a background reload reconciles with the
        // server's state (another reviewer may have decided others in the meantime).
        setProposals((cur) => cur.filter((p) => p.id !== id));
        setNote(`${verb === 'approve' ? 'Approved' : 'Rejected'}: ${title}`);
        onDecision?.();
        void loadProposals();
      })
      .catch((e: unknown) => {
        setDecisionError({ kind: readErrorKind(e), message: e instanceof Error ? e.message : String(e), id, verb });
      })
      .finally(() => {
        setDecidingIds((cur) => {
          const next = new Set(cur);
          next.delete(id);
          return next;
        });
      });
  }, [loadProposals, onDecision, proposals]);

  const onApprove = useCallback((id: string) => decide(id, 'approve'), [decide]);
  const onReject = useCallback((id: string) => decide(id, 'reject'), [decide]);

  return (
    <section data-testid="proposals-section" data-kind={kind} className="wk-gk-stack">
      <div className="wk-gk-row">
        <h2 className="wk-section-title">
          {heading}
          {!unsupported && !loading && error === null && <span className="wk-gk-count"> ({visible.length})</span>}
        </h2>
        <button type="button" data-testid="proposals-section-refresh" onClick={() => void loadProposals()} className="wk-btn wk-btn--quiet wk-btn--sm">Refresh</button>
      </div>
      {note !== null && <p data-testid="proposals-section-note" role="status" className="wk-gk-note">{note}</p>}
      {decisionError !== null && (
        <div data-testid="proposals-section-note">
          <p className="wk-gk-muted">Could not {decisionError.verb} this proposal.</p>
          <StateBanner kind={decisionError.kind} what="the decision result" error={decisionError.message} onRetry={() => decide(decisionError.id, decisionError.verb)} />
        </div>
      )}
      {unsupported ? (
        <EmptyState data-testid="proposals-section-unsupported" title="Studio's service does not support proposal review yet." />
      ) : (
        <ProposalsList proposals={visible} loading={loading} error={error} errorKind={errorKind} decidingIds={decidingIds} onApprove={onApprove} onReject={onReject} onRetry={() => void loadProposals()} />
      )}
    </section>
  );
}
