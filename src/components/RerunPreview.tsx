import type { RerunFromHere } from '../hooks/useRerunFromHere.js';

/**
 * The consequence of "Rerun from here", shown before the move (brainstorm-actionable idea 6): what
 * is kept, what is redone, roughly how long. It sits under the phase breadcrumb it was opened from
 * and speaks only the breadcrumb's type; the move itself is the hook's `rerun`.
 */
export function RerunPreview({ rerun, onClose }: {
  rerun: RerunFromHere;
  onClose: () => void;
}): React.ReactElement | null {
  const { offer, state } = rerun;
  if (state.kind === 'sent') {
    return (
      <p data-testid="rerun-sent" className="basis-full pt-1" style={{ color: 'var(--ink-body)' }}>
        Sent: {state.phase} reruns, and every phase after it runs again.
      </p>
    );
  }
  if (offer === null) return null;
  const busy = state.kind === 'sending';
  return (
    <div
      data-testid="rerun-preview"
      data-ord={offer.ord}
      className="basis-full flex items-center gap-2 flex-wrap pt-1.5"
    >
      <span data-testid="rerun-consequence" style={{ color: 'var(--ink-body)' }}>{offer.consequence}</span>
      <button
        type="button"
        data-testid="rerun-confirm"
        onClick={() => void rerun.rerun()}
        disabled={busy}
        className="rounded-full px-2.5 py-0.5 disabled:opacity-50"
        style={{ background: 'var(--accent)', color: 'var(--accent-fg)', border: '1px solid var(--accent)' }}
      >
        {busy ? 'Sending…' : `Rerun from ${offer.phase}`}
      </button>
      <button
        type="button"
        data-testid="rerun-cancel"
        onClick={onClose}
        disabled={busy}
        className="rounded-full px-2.5 py-0.5 disabled:opacity-50"
        style={{ background: 'transparent', color: 'var(--ink-muted)', border: '1px solid var(--surface-raised)' }}
      >
        Keep going
      </button>
      {state.kind === 'error' && (
        <span data-testid="rerun-error" style={{ color: 'var(--status-fail)' }}>Not sent: {state.message}</span>
      )}
    </div>
  );
}
