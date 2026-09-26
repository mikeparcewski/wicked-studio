import { useEffect, useRef, useState } from 'react';
import {
  BATCH_NOTE_KEY,
  clearBatchSelection,
  eligibleSelection,
  retryBatchOne,
  runBatchDecision,
  toggleBatchSelect,
  useBatchGateStore,
} from '../board/batchGates.js';
import { gateOpenPath, useGateActionStore } from '../board/gateActions.js';
import { decisionPreview, takeRestoredNote } from '../board/undoQueue.js';
import type { Navigate } from '../hooks/useRoute.js';
import { isSimpleGate, type OpenGate } from '../store/gates.js';
import { useMembershipStore } from '../store/membership.js';

/**
 * The batch bar (DES-FEEDBACK-002 §9.2, slice L): docks above the board /
 * gate inbox while ≥1 simple gate is selected.
 *
 *   3 gates selected   [Approve all]  [Reject all…]  [clear]
 *
 * The safety asymmetry (§9.2): Approve all fires directly — approving a
 * routine gate is the routine act. Reject all… PAUSES: the ellipsis opens the
 * §2.3 inline note ONCE at bar level, and the typed reason rides every reject
 * in the fan-out as `amend` (reject cancels runs — never a single silent
 * key). In flight the bar counts `2/3…`; failures stay listed per-id with the
 * named error, a retry that fires ONLY that id, and the honest open-the-
 * thread door.
 *
 * Tokens (§9.3): `--surface-raised` ground under `--shadow-raised`,
 * `--radius-lg`; approve in the `--status-run` pair and reject in the
 * `--status-fail` pair — status semantics, not accent (these are run-state
 * actions). Failure lines `--text-xs --font-mono --status-fail`.
 */

const CSS = {
  bar: {
    display: 'flex', flexDirection: 'column', gap: '6px',
    background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)',
    borderRadius: 'var(--radius-lg)', padding: '8px 12px',
    margin: '0 var(--space-6) var(--space-2)',
  },
  row: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 },
  count: {
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
    color: 'var(--ink-high)', margin: 0, flexShrink: 0,
  },
  btn: {
    border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-md)',
    fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semi)', padding: '4px 10px',
  },
  clear: {
    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)',
  },
  fail: {
    display: 'flex', alignItems: 'center', gap: '8px', margin: 0,
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--status-fail)',
    minWidth: 0,
  },
  failBtn: {
    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
    color: 'var(--ink-body)', textDecoration: 'underline', flexShrink: 0,
  },
  noteInput: {
    flex: 1, minWidth: 0, background: 'var(--surface-card)',
    border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-md)',
    outline: 'none', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)',
    color: 'var(--ink-high)', padding: '3px 8px',
  },
  hint: {
    flexShrink: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)',
    fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
  },
} as const satisfies Record<string, React.CSSProperties>;

/**
 * The per-row selection slot (§9.2): renders NOTHING until ≥1 gate is
 * selected (the first selection is the cursor's `x` — after that, mouse users
 * click these directly). A simple gate gets the checkbox (`--radius-sm` box,
 * checked fill `--accent`); a complex gate gets the `↗` "needs the thread"
 * marker instead — it cannot be batch-answered for the same reason its chip
 * has no inline buttons (§2.3).
 */
export function BatchSelectBox({ runId, gate }: {
  runId: string;
  gate: OpenGate | undefined;
}): React.ReactElement | null {
  const any = useBatchGateStore((s) => s.selected.length > 0);
  const checked = useBatchGateStore((s) => s.selected.includes(runId));
  const running = useBatchGateStore((s) => s.running);
  if (!any) return null;
  if (!isSimpleGate(gate)) {
    return (
      <span
        data-testid="batch-ineligible"
        title="needs the thread — open it to answer"
        aria-hidden
        style={{ flexShrink: 0, fontSize: 'var(--text-xs)', color: 'var(--ink-dim)' }}
      >
        ↗
      </span>
    );
  }
  return (
    <input
      type="checkbox"
      data-testid={`batch-select-${runId}`}
      aria-label="Select this gate for batch resolution"
      checked={checked}
      disabled={running}
      onChange={() => toggleBatchSelect(runId)}
      onClick={(e) => e.stopPropagation()}
      style={{ flexShrink: 0, accentColor: 'var(--accent)', borderRadius: 'var(--radius-sm)', margin: 0 }}
    />
  );
}

export function BatchGateBar({ navigate }: { navigate: Navigate }): React.ReactElement | null {
  const { selected: chosen, running, queued, done, total, failures } = useBatchGateStore();
  // Honest counts (wave 2a round 3): a selected gate that already carries a decision (queued,
  // in flight, answered) is not something this bar will send.
  useGateActionStore((s) => s.byGate);
  const selected = queued || running ? chosen : eligibleSelection(chosen);
  const decided = chosen.length - selected.length;
  const projectIdByRun = useMembershipStore((s) => s.projectIdByRun);
  const [noteOpen, setNoteOpen] = useState(false);
  // A reject note handed back by Undo re-seeds the input (never lost).
  const [note, setNote] = useState(() => takeRestoredNote(BATCH_NOTE_KEY));
  const noteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (noteOpen) noteRef.current?.focus();
  }, [noteOpen]);

  if (chosen.length === 0 && failures.length === 0) return null;

  const submitRejects = (): void => {
    setNoteOpen(false);
    const amend = note.trim();
    setNote('');
    void runBatchDecision(amend === '' ? { approve: false } : { approve: false, amend });
  };

  return (
    <div
      data-testid="batch-bar"
      data-count={selected.length}
      data-running={running ? 'true' : 'false'}
      style={CSS.bar}
    >
      <div style={CSS.row}>
        <p style={CSS.count}>
          {running
            ? `${done}/${total}…`
            : `${selected.length} ${selected.length === 1 ? 'gate' : 'gates'} selected${
              decided > 0 ? ` · ${decided} already decided, left out` : ''}`}
        </p>
        {noteOpen ? (
          // §9.2: the reject note opens ONCE at bar level; its text rides
          // every reject in the fan-out as `amend`. Escape cancels, firing
          // nothing — the same contract as the per-card note (§2.3).
          <>
            <input
              ref={noteRef}
              type="text"
              data-testid="batch-reject-note"
              placeholder="reason (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitRejects();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setNoteOpen(false);
                  setNote('');
                }
              }}
              style={CSS.noteInput}
            />
            <span style={CSS.hint} aria-hidden>↵ reject all · esc cancel</span>
          </>
        ) : (
          <>
            <button
              type="button"
              data-testid="batch-approve-all"
              disabled={running || queued || selected.length === 0}
              title={decisionPreview('approve', selected.length)}
              onClick={() => void runBatchDecision({ approve: true })}
              style={{ ...CSS.btn, background: 'var(--status-run-dim)', color: 'var(--status-run)' }}
            >
              Approve all
            </button>
            <button
              type="button"
              data-testid="batch-reject-all"
              disabled={running || queued || selected.length === 0}
              title={decisionPreview('reject', selected.length)}
              onClick={() => {
                const restored = takeRestoredNote(BATCH_NOTE_KEY);
                if (restored !== '') setNote(restored);
                setNoteOpen(true);
              }}
              style={{ ...CSS.btn, background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}
            >
              Reject all…
            </button>
            <button
              type="button"
              data-testid="batch-clear"
              disabled={running || queued}
              onClick={clearBatchSelection}
              style={CSS.clear}
            >
              [ clear ]
            </button>
          </>
        )}
      </div>

      {/* Wave 2a: what each verb will do, before it is committed (10 s undo after). */}
      {!running && !queued && selected.length > 0 && (
        <p data-testid="batch-preview" style={{ ...CSS.hint, margin: 0, whiteSpace: 'normal' }}>
          Approve all: {decisionPreview('approve', selected.length)} Reject all: {decisionPreview('reject', selected.length)} Both wait 10 s for Undo.
        </p>
      )}

      {/* §9.2 per-id honesty: which ids failed, why, retry-just-this-one. */}
      {failures.map((f) => {
        const pid = projectIdByRun[f.runId];
        return (
          <p key={f.runId} data-testid="batch-failure-row" data-run-id={f.runId} style={CSS.fail}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              failed: {f.runId} ({f.error})
            </span>
            <button
              type="button"
              data-testid={`batch-retry-${f.runId}`}
              disabled={running}
              onClick={() => void retryBatchOne(f.runId)}
              style={CSS.failBtn}
            >
              retry
            </button>
            {pid !== undefined && (
              <button
                type="button"
                data-testid={`batch-open-${f.runId}`}
                onClick={() => navigate(gateOpenPath(pid, f.runId))}
                style={CSS.failBtn}
              >
                open
              </button>
            )}
          </p>
        );
      })}
    </div>
  );
}
