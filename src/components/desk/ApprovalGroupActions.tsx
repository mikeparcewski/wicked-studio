import { useEffect, useRef, useState } from 'react';
import {
  BATCH_NOTE_KEY, retryBatchOne, runBatchDecision, useBatchGateStore,
} from '../../board/batchGates.js';
import { decisionPreview, takeRestoredNote } from '../../board/undoQueue.js';

/**
 * THE APPROVALS GROUP ROW'S OWN CONTROLS (DES-STUDIO-REBUILD-001 Amendment 5, slice S18a):
 * the Desk's answer to "2 approvals" — Approve all / Reject all, plus an optional
 * reject-with-a-reason, right on the folded group row (the group still expands to open each
 * member with "Show each").
 *
 * The logic is the classic batch bar's, reused verbatim: seed `useBatchGateStore.selected` with
 * the group's member run ids, then `runBatchDecision` fans out one `POST /runs/:id/gate` each
 * through the ONE audited send path — the single 10 s undo window (the shell's UndoToasts), the
 * per-id failure rows with a retry-just-this-one, never an optimistic "approved all". No desk
 * surface mounts the classic `BatchSelectBox`/`BatchGateBar`, so seeding the shared selection
 * here is uncontended.
 *
 * The safety asymmetry (the classic bar's, §9.2): Approve all and bare Reject all fire directly;
 * Reject with a reason PAUSES on a one-line input whose text rides every reject as `amend`, and a
 * reason handed back by an Undo re-seeds the input (never lost — `BATCH_NOTE_KEY`).
 */
export function ApprovalGroupActions({ runIds, label }: {
  runIds: readonly string[];
  label: string;
}): React.ReactElement {
  const running = useBatchGateStore((s) => s.running);
  const queued = useBatchGateStore((s) => s.queued);
  // Select the raw array (stable reference) and filter outside the selector: calling .filter()
  // inside the selector creates a new reference on every call, causing an infinite render loop.
  const allFailures = useBatchGateStore((s) => s.failures);
  // Filter to this group's ids only: the store is shared, and a prior batch's failures for
  // different run ids must not appear here (they belong to whatever row triggered that batch).
  const failures = allFailures.filter((f) => (runIds as string[]).includes(f.runId));
  const [reasonOpen, setReasonOpen] = useState(false);
  // A reject reason handed back by Undo re-seeds the input (never lost).
  const [note, setNote] = useState(() => takeRestoredNote(BATCH_NOTE_KEY));
  const noteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (reasonOpen) noteRef.current?.focus();
  }, [reasonOpen]);

  const busy = running || queued;
  const seed = (): void => { useBatchGateStore.setState({ selected: [...runIds] }); };
  const approveAll = (): void => { if (busy) return; seed(); void runBatchDecision({ approve: true }); };
  const rejectAll = (): void => { if (busy) return; seed(); void runBatchDecision({ approve: false }); };
  const submitReason = (): void => {
    // Guard busy before clearing state: if another batch started between open and Enter, the
    // note must not be silently discarded — the input stays open for the operator to retry.
    if (busy) return;
    const amend = note.trim();
    setReasonOpen(false);
    setNote('');
    seed();
    void runBatchDecision(amend === '' ? { approve: false } : { approve: false, amend });
  };

  return (
    <span className="wk-need-group-acts" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      {reasonOpen ? (
        <>
          <input
            ref={noteRef}
            type="text"
            data-testid="need-group-reject-reason"
            placeholder="reason (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                submitReason();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setReasonOpen(false);
                setNote('');
              }
            }}
            style={{
              minWidth: '12em', background: 'var(--surface-card)', border: '1px solid var(--surface-raised)',
              borderRadius: 'var(--radius-md)', outline: 'none', fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-sans)', color: 'var(--ink-high)', padding: '3px 8px',
            }}
          />
          <span aria-hidden style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
            ↵ reject all · esc cancel
          </span>
        </>
      ) : (
        <>
          <button
            type="button"
            data-testid="need-group-approve-all"
            disabled={busy}
            title={decisionPreview('approve', runIds.length)}
            onClick={approveAll}
            className="wk-need-act"
          >
            {label}
          </button>
          <button
            type="button"
            data-testid="need-group-reject-all"
            disabled={busy}
            title={decisionPreview('reject', runIds.length)}
            onClick={rejectAll}
            className="wk-need-act"
          >
            {`Reject all ${runIds.length}`}
          </button>
          <button
            type="button"
            data-testid="need-group-reject"
            disabled={busy}
            title="Reject all, with a reason recorded on each gate"
            onClick={() => {
              const restored = takeRestoredNote(BATCH_NOTE_KEY);
              if (restored !== '') setNote(restored);
              setReasonOpen(true);
            }}
            className="wk-need-act"
          >
            Reject with reason…
          </button>
        </>
      )}
      {/* Per-id honesty (§9.2): which ids failed, why, retry-just-this-one. */}
      {failures.map((f) => (
        <span
          key={f.runId}
          data-testid="need-group-failure"
          data-run-id={f.runId}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--status-fail)' }}
        >
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {`failed: ${f.runId} (${f.error})`}
          </span>
          <button
            type="button"
            data-testid="need-group-retry"
            data-run-id={f.runId}
            disabled={running}
            onClick={() => void retryBatchOne(f.runId)}
            className="wk-need-act"
          >
            retry
          </button>
        </span>
      ))}
    </span>
  );
}
