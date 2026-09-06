import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  approveProposal,
  isProposalsUnsupported,
  listProposals,
  PROPOSAL_KIND_LABELS,
  PROPOSAL_KINDS,
  PROPOSALS_UNSUPPORTED_COPY,
  proposalMatchesKind,
  proposalsPath,
  readProposalKind,
  rejectProposal,
  type Proposal,
  type ProposalKind,
} from '../api/proposals.js';
import { ProposalsList } from './ProposalsList.js';

/**
 * The proposal-queue surface (DES-MEM-FACETED-001) — the "policies and memories, one surface
 * with a type filter" review queue, the read/decide twin of the Steering management surface
 * (SteeringPage). It lists the PENDING governed-knowledge proposals the estate store holds
 * (memories + steering policies), each awaiting a human approve/reject.
 *
 *  - Default view: `state=pending`, all kinds. The TYPE FILTER (all | memory | policy) is a
 *    first-class dimension driven by `PROPOSAL_KINDS`, deep-linked via `?type=<kind>` so it is
 *    back-button-correct and shared with the rail's accordion rows — adding a kind is a
 *    one-line change in `../api/proposals.ts`, nothing here.
 *  - Approve / Reject ride crew's `/api/v1/proposals/:id/{approve,reject}` (the governed
 *    operator path — estate MCP stays read-only); on success the row leaves the queue and the
 *    list reloads for the server's state, exactly the honesty posture SteeringPage keeps.
 *  - Loading / error / empty ("No proposals to review.") and the forward-compat unsupported
 *    state all render honestly in-band — a daemon that predates the routes is never an error card.
 */

export function ProposalsPage({ navigate, search = '' }: {
  navigate: (path: string) => void;
  /** The URL search string — `?type=<kind>` selects the active type filter. */
  search?: string;
}): React.ReactElement {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  /** Ids whose approve/reject is in flight — their buttons disable until it resolves. */
  const [decidingIds, setDecidingIds] = useState<ReadonlySet<string>>(new Set<string>());
  /** The post-decision note (approved / rejected / a failed decision), in-band. */
  const [note, setNote] = useState<string | null>(null);

  const filter = readProposalKind(search);

  const loadProposals = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setUnsupported(false);
    try {
      // Load every PENDING proposal once; the coarse memory-vs-policy filter is applied
      // client-side below, so switching it never re-hits the wire.
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
    () => proposals.filter((p) => proposalMatchesKind(p, filter)),
    [proposals, filter],
  );

  /** Per-kind counts for the filter chips — computed over the full loaded set (unfiltered). */
  const counts = useMemo(() => {
    const c: Record<ProposalKind, number> = { all: proposals.length, memory: 0, policy: 0 };
    for (const p of proposals) {
      if (proposalMatchesKind(p, 'memory')) c.memory += 1;
      else if (proposalMatchesKind(p, 'policy')) c.policy += 1;
    }
    return c;
  }, [proposals]);

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
    <div className="flex-1 overflow-y-auto p-6">
      <div data-testid="proposals-page" className="flex max-w-4xl flex-col gap-4">
        <div className="flex items-center gap-2">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>Proposals</h2>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              The governed-knowledge review queue — agent-proposed memories and steering policies,
              each pending until you approve or reject it.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadProposals()}
            className="ml-auto text-[10px] hover:underline"
            style={{ color: 'var(--ink-dim)' }}
          >
            Refresh
          </button>
        </div>

        {/* The type filter — first-class, data-driven from PROPOSAL_KINDS (all | memory | policy),
            deep-linked via ?type= so it is back-button-correct and shared with the rail. */}
        <div data-testid="proposals-filter" role="tablist" aria-label="Filter proposals by type" className="flex flex-wrap gap-1.5">
          {PROPOSAL_KINDS.map((k) => {
            const active = filter === k;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid="proposals-filter-chip"
                data-kind={k}
                data-active={active}
                onClick={() => navigate(proposalsPath(k))}
                className="rounded px-2 py-1 text-[11px] font-semibold transition-colors"
                style={{
                  background: active ? 'var(--surface-raised)' : 'transparent',
                  color: active ? 'var(--ink-high)' : 'var(--ink-muted)',
                  border: '1px solid var(--surface-raised)',
                }}
              >
                {PROPOSAL_KIND_LABELS[k]} <span style={{ color: 'var(--ink-dim)' }}>({counts[k]})</span>
              </button>
            );
          })}
        </div>

        {note !== null && (
          <p
            data-testid="proposals-note"
            className="rounded px-3 py-2 text-[11px]"
            style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
          >
            {note}
          </p>
        )}

        {unsupported ? (
          <p
            data-testid="proposals-unsupported"
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
      </div>
    </div>
  );
}
