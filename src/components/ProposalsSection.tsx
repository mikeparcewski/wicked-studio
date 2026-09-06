import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  approveProposal,
  isProposalsUnsupported,
  listProposals,
  PROPOSALS_UNSUPPORTED_COPY,
  proposalKind,
  rejectProposal,
  type Proposal,
  type ProposalKind,
} from '../api/proposals.js';
import { ProposalsList } from './ProposalsList.js';

/**
 * The governed-knowledge PROPOSAL-review section — the reusable "proposals (review)" half that
 * both Steering sub-sections embed (DES-MEM-FACETED-001, unified surface): the Policies view
 * embeds it with `kind="policy"`, the Memories view with `kind="memory"`. It lists the PENDING
 * proposals of that one kind and lets a human approve/reject each — the read/decide twin of the
 * management surface beside it.
 *
 *  - Loads every pending proposal once (`GET /proposals?state=pending`) and narrows to the section's
 *    kind client-side (a policy proposal's `kind_type` is `policy:<type>`, so a server-side exact
 *    filter can't gather them — one load, filtered here).
 *  - Approve / Reject ride crew's `/api/v1/proposals/:id/{approve,reject}` (the governed operator
 *    path — estate MCP stays read-only); on success the row leaves the queue and the list reloads
 *    for the server's state.
 *  - Loading / error / empty and the forward-compat unsupported state all render honestly in-band —
 *    a daemon that predates the routes is never an error card.
 */

export function ProposalsSection({ kind, heading }: {
  /** Which proposals this section reviews — the sub-section it lives in. */
  kind: Extract<ProposalKind, 'memory' | 'policy'>;
  /** The section title, e.g. "Policy proposals" / "Memory proposals". */
  heading: string;
}): React.ReactElement {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  /** Ids whose approve/reject is in flight — their buttons disable until it resolves. */
  const [decidingIds, setDecidingIds] = useState<ReadonlySet<string>>(new Set<string>());
  /** The post-decision note (approved / rejected / a failed decision), in-band. */
  const [note, setNote] = useState<string | null>(null);

  const loadProposals = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setUnsupported(false);
    try {
      const ps = await listProposals({ state: 'pending' });
      setProposals(ps);
    } catch (e) {
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
    setDecidingIds((cur) => new Set(cur).add(id));
    const call = verb === 'approve' ? approveProposal(id) : rejectProposal(id);
    void call
      .then(() => {
        // The row leaves the queue optimistically; a background reload reconciles with the
        // server's state (another reviewer may have decided others in the meantime).
        setProposals((cur) => cur.filter((p) => p.id !== id));
        setNote(`${verb === 'approve' ? 'Approved' : 'Rejected'} ${id}.`);
        void loadProposals();
      })
      .catch((e: unknown) => {
        setNote(`Could not ${verb} ${id}: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        setDecidingIds((cur) => {
          const next = new Set(cur);
          next.delete(id);
          return next;
        });
      });
  }, [loadProposals]);

  const onApprove = useCallback((id: string) => decide(id, 'approve'), [decide]);
  const onReject = useCallback((id: string) => decide(id, 'reject'), [decide]);

  return (
    <section
      data-testid="proposals-section"
      data-kind={kind}
      className="flex flex-col gap-3 border-t pt-4"
      style={{ borderColor: 'var(--surface-raised)' }}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold" style={{ color: 'var(--ink-high)' }}>
          {heading}
          {!unsupported && !loading && (
            <span className="ml-1.5 font-mono" style={{ color: 'var(--ink-dim)' }}>({visible.length})</span>
          )}
        </h3>
        <p className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
          Agent-proposed {kind === 'policy' ? 'steering policies' : 'memories'}, each pending until you
          approve or reject it.
        </p>
        <button
          type="button"
          data-testid="proposals-section-refresh"
          onClick={() => void loadProposals()}
          className="ml-auto text-[10px] hover:underline"
          style={{ color: 'var(--ink-dim)' }}
        >
          Refresh
        </button>
      </div>

      {note !== null && (
        <p
          data-testid="proposals-section-note"
          className="rounded px-3 py-2 text-[11px]"
          style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
        >
          {note}
        </p>
      )}

      {unsupported ? (
        <p
          data-testid="proposals-section-unsupported"
          className="rounded px-3 py-2 text-xs"
          style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
        >
          {PROPOSALS_UNSUPPORTED_COPY}
        </p>
      ) : (
        <ProposalsList
          proposals={visible}
          loading={loading}
          error={error}
          decidingIds={decidingIds}
          onApprove={onApprove}
          onReject={onReject}
        />
      )}
    </section>
  );
}
