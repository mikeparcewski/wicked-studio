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
} from '../api/proposals.js';
import { ProposalsList } from './ProposalsList.js';
import { useNeedsSources } from '../store/needsSources.js';
import { readErrorKind } from '../api/errors.js';
import { shortContent } from './ProposalChips.js';
import { EmptyState, StateBanner } from './ui/index.js';

export function ProposalsSection({ kind, heading, onDecision, editable = false, revision = 0, runId = null, onShowAll }: {
  /** Which proposals this section reviews: Steer reviews policies, Memory reviews memories. */
  kind: 'memory' | 'policy';
  /** The section title, e.g. "Rule proposals" / "Memory proposals". */
  heading: string;
  /** Memory proposals only: each card can be edited before it is approved (crew's approve-with-edit). */
  editable?: boolean;
  /** Bumped by the host when it filed a proposal itself: the list reads the queue again. */
  revision?: number;
  /** Fired after a successful approve/reject — lets a host (the dashboard) refresh its own
   *  headline count, which this self-contained section otherwise cannot know changed. */
  onDecision?: (() => void) | undefined;
  /** Only the proposals one run filed (its learnings: `provenance.run_id`), from the run's end card. */
  runId?: string | null;
  /** Leave the one-run filter. */
  onShowAll?: (() => void) | undefined;
}): React.ReactElement {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  /** Ids whose approve/reject is in flight — their buttons disable until it resolves. */
  const [decidingIds, setDecidingIds] = useState<ReadonlySet<string>>(new Set<string>());
  /** The post-decision note (approved / rejected / a failed decision), in-band. */
  const [note, setNote] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<{ kind: 'offline' | 'error'; message: string; id: string; verb: 'approve' | 'reject'; content?: string } | null>(null);
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
  }, [loadProposals, revision]);

  const visible = useMemo(
    () => proposals.filter((p) => proposalKind(p) === kind && (runId === null || p.provenance['run_id'] === runId)),
    [proposals, kind, runId],
  );

  const decide = useCallback((id: string, verb: 'approve' | 'reject', content?: string): void => {
    setNote(null);
    setDecisionError(null);
    const proposal = proposals.find((p) => p.id === id);
    const title = content !== undefined ? shortContent(content) : proposal === undefined ? 'Proposal' : shortContent(memoryPayload(proposal).content ?? policyPayload(proposal).rule ?? 'Proposal');
    setDecidingIds((cur) => new Set(cur).add(id));
    // An approve with an edit: crew files the edited copy, approves it and rejects the original.
    const call = verb === 'reject' ? rejectProposal(id) : content !== undefined ? approveProposal(id, { content }) : approveProposal(id);
    void call
      .then((out) => {
        // The row leaves the queue optimistically; a background reload reconciles with the
        // server's state (another reviewer may have decided others in the meantime).
        setProposals((cur) => cur.filter((p) => p.id !== id));
        // An approve-with-edit approves an edited COPY and then rejects the original; when that reject
        // failed, the original is still pending and must not be approved too (api-types ProposalEdit).
        const originalPending = (out as { edited?: { originalPending?: boolean } } | undefined)?.edited?.originalPending === true;
        setNote(originalPending
          ? `Saved your edit: ${title}. The original proposal is still pending; reject it so its words are not approved too.`
          : `${verb === 'approve' ? (content !== undefined ? 'Approved with your edit' : 'Approved') : 'Rejected'}: ${title}`);
        onDecision?.();
        void loadProposals();
      })
      .catch((e: unknown) => {
        setDecisionError({ kind: readErrorKind(e), message: e instanceof Error ? e.message : String(e), id, verb, ...(content !== undefined ? { content } : {}) });
      })
      .finally(() => {
        setDecidingIds((cur) => {
          const next = new Set(cur);
          next.delete(id);
          return next;
        });
      });
  }, [loadProposals, onDecision, proposals]);

  const onApprove = useCallback((id: string, content?: string) => decide(id, 'approve', content), [decide]);
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
      {runId !== null && (
        <p data-testid="proposals-section-run-filter" className="wk-gk-muted">
          What one run learned.{' '}
          {onShowAll !== undefined && <button type="button" data-testid="proposals-section-show-all" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={onShowAll}>Show every proposal</button>}
        </p>
      )}
      {note !== null && <p data-testid="proposals-section-note" role="status" className="wk-gk-note">{note}</p>}
      {decisionError !== null && (
        <div data-testid="proposals-section-note">
          <p className="wk-gk-muted">Could not {decisionError.verb} this proposal.</p>
          <StateBanner kind={decisionError.kind} what="the decision result" error={decisionError.message} onRetry={() => decide(decisionError.id, decisionError.verb, decisionError.content)} />
        </div>
      )}
      {unsupported ? (
        <EmptyState data-testid="proposals-section-unsupported" title="Studio's service does not support proposal review yet." />
      ) : (
        <ProposalsList editable={editable} proposals={visible} loading={loading} error={error} errorKind={errorKind} decidingIds={decidingIds} onApprove={onApprove} onReject={onReject} onRetry={() => void loadProposals()} />
      )}
    </section>
  );
}
