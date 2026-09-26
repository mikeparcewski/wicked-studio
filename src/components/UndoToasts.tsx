import { useUndoToasts } from '../hooks/useUndoToasts.js';

/**
 * The Undo toasts (studio wave 2a, behaviour 5) — a skin over `useUndoToasts`: one toast
 * per queued gate decision, "Approving in 10 s", the what-will-happen line, the page-close
 * contract, and Undo. Every word and every timer lives in `board/undoQueue.ts`.
 */
export function UndoToasts(): React.ReactElement | null {
  const toasts = useUndoToasts();
  if (toasts.length === 0) return null;
  return (
    <div
      // Top-centre: a decision is made on a card or a row lower down the page, and the toast
      // must never sit over the thing it is about to change.
      className="fixed left-1/2 flex flex-col items-center gap-2 z-50"
      style={{ top: 12, transform: 'translateX(-50%)' }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          aria-live="polite"
          data-testid="undo-toast"
          data-verb={t.verb}
          className="flex items-start gap-3"
          style={{
            background: 'var(--surface-overlay)',
            boxShadow: 'var(--shadow-overlay)',
            borderRadius: 'var(--radius-lg)',
            padding: '10px 14px',
            maxWidth: 480,
          }}
        >
          <div className="flex flex-col gap-0.5 min-w-0">
            <p
              data-testid="undo-headline"
              style={{
                margin: 0, fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semi)',
                color: t.verb === 'approve' ? 'var(--status-run)' : 'var(--status-fail)',
              }}
            >
              {t.headline}
            </p>
            <p data-testid="undo-preview" style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--ink-body)' }}>
              {t.preview}
            </p>
            <p data-testid="undo-close-note" style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)' }}>
              {t.closeNote}
            </p>
          </div>
          <button
            type="button"
            data-testid="undo-button"
            onClick={t.undo}
            style={{
              flexShrink: 0, border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-md)',
              background: 'var(--surface-raised)', color: 'var(--ink-high)',
              fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semi)', padding: '4px 10px',
            }}
          >
            Undo
          </button>
        </div>
      ))}
    </div>
  );
}
