import { useDecisionResults, useUndoToasts } from '../hooks/useUndoToasts.js';

const RESULT_COLOR = { sent: 'var(--status-run)', failed: 'var(--status-fail)', 'not-sent': 'var(--status-gate)' } as const;

/**
 * The Undo toasts (studio wave 2a, behaviour 5) — a skin over `useUndoToasts`: one toast
 * per queued gate decision, "Approving in 10 s", the what-will-happen line, the page-close
 * contract, and Undo. Every word and every timer lives in `board/undoQueue.ts`.
 */
export function UndoToasts(): React.ReactElement | null {
  const toasts = useUndoToasts();
  const results = useDecisionResults();
  if (toasts.length === 0 && results.length === 0) return null;
  return (
    <div
      // Top-centre: a decision is made on a card or a row lower down the page, and the toast
      // must never sit over the thing it is about to change.
      className="fixed left-1/2 flex flex-col items-center gap-2 z-50"
      style={{ top: 12, transform: 'translateX(-50%)' }}
    >
      {results.map((r) => (
        <p
          key={`r${r.id}`}
          role="status"
          aria-live="polite"
          data-testid="undo-result"
          data-kind={r.kind}
          className="wk-toast"
          style={{ margin: 0, maxWidth: 480, padding: '7px 12px', fontSize: 'var(--text-xs)', color: RESULT_COLOR[r.kind] }}
        >
          {r.text}
        </p>
      ))}
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          aria-live="polite"
          data-testid="undo-toast"
          data-verb={t.verb}
          className={`wk-toast wk-toast--${t.verb === 'approve' ? 'approve' : 'reject'} flex items-center gap-3`}
          style={{ padding: '10px 12px 10px 16px', maxWidth: 480 }}
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
            // The obvious action on the toast (design council S4); the bar along the toast's
            // foot drains over the undo window (--undo-window, styles/components.css).
            className="wk-btn wk-btn--link"
            style={{ flexShrink: 0 }}
          >
            Undo
          </button>
        </div>
      ))}
    </div>
  );
}
