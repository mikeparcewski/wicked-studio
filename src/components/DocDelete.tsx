import { useState } from 'react';
import {
  BridgeUnavailableError,
  DocDeletePartialError,
  deleteDoc,
} from '../api/interactive.js';
import type { DocDeleteResult } from '../api/interactive.js';
import { ApiError } from '../api/errors.js';
import { useDocsCache } from '../store/docsCache.js';
import { useModalEscape } from './Modal.js';

// The doc/demo DELETE affordance (studio#119) — one trigger + one confirm, shared
// by every surface where the artifacts live: the doc picker's rows, the demo
// picker's rows, and the open artifact's panel (Versions tab).
//
// Grammar the surfaces agree on:
//  - DESTRUCTIVE, so never one click: the trigger only opens a confirm that NAMES
//    the artifact and says what a delete actually is on this wire — a retire
//    (soft tombstone: versions kept on disk, the canvas answers 410 Gone, the
//    NAME STAYS RESERVED) plus the drop of crew's handoff-ledger rows. No vague
//    "are you sure?" over an action the user can't picture.
//  - The confirm speaks the governed crew route (`deleteDoc`, crew#338) — both
//    halves in one call, loud on divergence. The 500 PARTIAL is the one state
//    needing operator attention, so it renders VERBATIM in its own loud box, and
//    the confirm button stays armed: the wire's own sentence says a re-issued
//    DELETE is the retry, and it is (retire idempotent, sweep idempotent).
//  - Escape/Cancel close the confirm without touching the wire — except while
//    the DELETE is in flight, when neither can pretend to abort it.

const S = {
  border: 'var(--surface-raised)',
  card: 'var(--surface-card)',
  ink: 'var(--ink-high)',
  body: 'var(--ink-body)',
  muted: 'var(--ink-muted)',
  danger: 'var(--status-fail)',
};

/** What the surfaces call the artifact — the picker rows and the panel agree
 *  with the surface they sit on (VIDEO-FB: a demo surface never says "document"). */
export type DeleteSubject = 'document' | 'demo';

interface Failure {
  kind: 'partial' | 'bridge' | 'wire';
  /** partial → the wire's sentence VERBATIM; bridge → the runnable hint;
   *  wire → the EC33-translated operator sentence. */
  message: string;
}

function asDeleteFailure(e: unknown): Failure {
  if (e instanceof DocDeletePartialError) return { kind: 'partial', message: e.wire };
  if (e instanceof BridgeUnavailableError) return { kind: 'bridge', message: e.hint };
  if (e instanceof ApiError) return { kind: 'wire', message: e.message };
  return { kind: 'wire', message: e instanceof Error ? e.message : String(e) };
}

export interface DocDeleteConfirmProps {
  projectId: string;
  docId: string;
  subject: DeleteSubject;
  /** Close without deleting (Cancel, Escape). Ignored while the DELETE is in flight. */
  onClose: () => void;
  /** The delete SETTLED — retired, already retired, or ghost-cleaned. The cache
   *  row is already dropped; the owner refreshes its own list / leaves the doc. */
  onDeleted: (result: DocDeleteResult) => void;
}

/** The confirm dialog — modal-family (scrim, Escape via the shared ledger). */
export function DocDeleteConfirm({
  projectId, docId, subject, onClose, onDeleted,
}: DocDeleteConfirmProps): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  useModalEscape(() => { if (!busy) onClose(); });

  async function run(): Promise<void> {
    setBusy(true);
    setFailure(null);
    try {
      const result = await deleteDoc(projectId, docId);
      // Every cache reader agrees with the wire immediately; the owner's own
      // refresh (a re-list, a navigation off the dead doc) rides on onDeleted.
      useDocsCache.getState().remove(projectId, docId);
      onDeleted(result);
    } catch (e: unknown) {
      setFailure(asDeleteFailure(e));
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--scrim)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${subject} ${docId}`}
        data-testid="doc-delete-confirm"
        data-doc-id={docId}
        className="flex flex-col gap-3"
        style={{
          background: S.card, border: `1px solid ${S.border}`,
          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-overlay)',
          fontFamily: 'var(--font-sans)', maxWidth: 'min(480px, 90vw)', padding: '18px 20px',
        }}
      >
        <h2 style={{ color: S.ink, fontSize: 'var(--text-md)', fontWeight: 700, margin: 0 }}>
          Delete “{docId}”?
        </h2>
        <p style={{ color: S.body, fontSize: 'var(--text-sm)', lineHeight: 1.5, margin: 0 }}>
          This retires the {subject}: the canvas, versions and exports stop serving,
          and the name <strong>{docId}</strong> stays reserved — it cannot be created
          again. Crew also drops its draft-handoff records for it in the same call.
          There is no undo from here.
        </p>
        {failure !== null && failure.kind === 'partial' && (
          <div
            data-testid="doc-delete-partial"
            style={{
              border: `1px solid ${S.danger}`, borderLeft: `4px solid ${S.danger}`,
              borderRadius: 'var(--radius-md)', padding: '10px 12px',
            }}
          >
            <p style={{ color: S.danger, fontSize: 'var(--text-xs)', fontWeight: 700,
                        margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Partial delete — needs attention
            </p>
            {/* The wire's own sentence, VERBATIM: it names which half happened and
                says the retry instruction — paraphrasing a divergence would hide it. */}
            <p style={{ color: S.ink, fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)',
                        lineHeight: 1.5, margin: 0, overflowWrap: 'anywhere' }}>
              {failure.message}
            </p>
          </div>
        )}
        {failure !== null && failure.kind === 'bridge' && (
          <p
            data-testid="doc-delete-bridge-hint"
            style={{ borderLeft: `2px solid ${S.danger}`, color: S.ink, margin: 0,
                     fontSize: 'var(--text-sm)', lineHeight: 1.5, paddingLeft: '10px' }}
          >
            <strong>To fix:</strong> {failure.message}
          </p>
        )}
        {failure !== null && failure.kind === 'wire' && (
          <p
            data-testid="doc-delete-error"
            style={{ borderLeft: `2px solid ${S.danger}`, color: S.muted, margin: 0,
                     fontSize: 'var(--text-sm)', lineHeight: 1.5, paddingLeft: '10px' }}
          >
            {failure.message}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="doc-delete-cancel"
            disabled={busy}
            onClick={onClose}
            style={{
              background: 'transparent', border: `1px solid ${S.border}`,
              borderRadius: 'var(--radius-sm)', color: S.ink,
              cursor: busy ? 'not-allowed' : 'pointer', fontSize: 'var(--text-xs)',
              opacity: busy ? 0.5 : 1, padding: '6px 12px',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="doc-delete-go"
            disabled={busy}
            onClick={() => void run()}
            style={{
              background: S.danger, border: `1px solid ${S.danger}`,
              borderRadius: 'var(--radius-sm)', color: 'var(--surface-base)',
              cursor: busy ? 'wait' : 'pointer', fontSize: 'var(--text-xs)', fontWeight: 600,
              opacity: busy ? 0.6 : 1, padding: '6px 12px',
            }}
          >
            {busy
              ? 'Deleting…'
              : failure?.kind === 'partial' ? `Retry delete ${docId}` : `Delete ${docId}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface DeleteDocButtonProps {
  projectId: string;
  docId: string;
  subject: DeleteSubject;
  /** Row dress (the pickers' per-row ✕) or action dress (the panel's button). */
  variant: 'row' | 'action';
  onDeleted: (result: DocDeleteResult) => void;
}

/** The trigger + its confirm. The trigger NEVER deletes — it only opens. */
export function DeleteDocButton({
  projectId, docId, subject, variant, onDeleted,
}: DeleteDocButtonProps): React.ReactElement {
  const [confirming, setConfirming] = useState(false);
  const title = `Delete this ${subject} — retires every version and reserves the name (asks first)`;
  return (
    <>
      {variant === 'row' ? (
        <button
          type="button"
          data-testid="doc-delete-trigger"
          data-doc-id={docId}
          aria-label={`Delete ${subject} ${docId}`}
          title={title}
          onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
          style={{
            background: 'transparent', border: 'none', borderRadius: 'var(--radius-sm)',
            color: S.muted, cursor: 'pointer', flexShrink: 0,
            fontSize: 'var(--text-sm)', lineHeight: 1, padding: '6px 8px',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = S.danger; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = S.muted; }}
        >
          🗑
        </button>
      ) : (
        <button
          type="button"
          data-testid="doc-delete-trigger"
          data-doc-id={docId}
          title={title}
          onClick={() => setConfirming(true)}
          style={{
            alignSelf: 'flex-start', background: 'transparent',
            border: `1px solid ${S.danger}`, borderRadius: 'var(--radius-sm)',
            color: S.danger, cursor: 'pointer', fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-2xs)', lineHeight: 1.6, padding: '2px 8px',
          }}
        >
          Delete {subject}…
        </button>
      )}
      {confirming && (
        <DocDeleteConfirm
          projectId={projectId}
          docId={docId}
          subject={subject}
          onClose={() => setConfirming(false)}
          onDeleted={(result) => { setConfirming(false); onDeleted(result); }}
        />
      )}
    </>
  );
}
