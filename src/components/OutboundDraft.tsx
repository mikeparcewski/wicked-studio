import type { OutboundKind } from '../api/outbound.js';
import { OUTBOUND_ACTIONS, useOutboundDraft } from '../hooks/useOutboundDraft.js';
import { CopyButton } from './CopyButton.js';

/**
 * The outbound harness (studio wave 1): the drafted text in an editable text area, and the
 * send actions under it. Presentational — the draft and the action list are
 * `useOutboundDraft` / `OUTBOUND_ACTIONS`.
 */
export function OutboundDraft({ kind, runId }: { kind: OutboundKind; runId: string }): React.ReactElement {
  const { draft, setText } = useOutboundDraft(kind, runId);
  const small: React.CSSProperties = { fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', margin: 0 };
  return (
    <div data-testid="outbound-draft" data-kind={kind} data-state={draft.state} className="flex flex-col gap-2">
      {draft.state === 'loading' && <p style={{ ...small, color: 'var(--ink-dim)' }}>Drafting…</p>}
      {draft.state === 'error' && (
        <p role="alert" data-testid="outbound-error" style={{ ...small, color: 'var(--status-fail)' }}>
          Could not draft: {draft.message}
        </p>
      )}
      {draft.state === 'ready' && (
        <>
          <textarea
            data-testid="outbound-text"
            aria-label={kind === 'pr' ? 'Pull request draft' : 'Status update draft'}
            value={draft.text}
            onChange={(e) => setText(e.target.value)}
            rows={16}
            className="w-full rounded-lg p-3"
            style={{
              ...small, resize: 'vertical', minWidth: '32rem',
              background: 'var(--surface-base)', color: 'var(--ink-body)',
              border: '1px solid var(--surface-raised)',
            }}
          />
          <div className="flex items-center gap-2" data-testid="outbound-actions">
            {OUTBOUND_ACTIONS.map((action) =>
              action === 'copy' ? <CopyButton key={action} command={draft.text} label="Copy the draft" /> : null,
            )}
          </div>
        </>
      )}
    </div>
  );
}
