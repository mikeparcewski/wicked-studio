import { useState } from 'react';
import { FREEZE_CONSEQUENCE, frozenBannerText, UNFREEZE_CONSEQUENCE } from '../api/deliveryFreeze.js';
import { useDeliveryFreezeStore } from '../store/deliveryFreeze.js';

/**
 * Freeze deliveries (Wave C, idea 15) — the SRE stop-the-line, in the status bar every route
 * shows (and, under the desk skin, in "Everything else" and on the Desk while frozen). Thawed, it is one quiet "Freeze deliveries" control; frozen, the bar carries the banner:
 * who froze it, since when, why — the daemon's audited record — and the Unfreeze move.
 *
 * Either move says what it does before it is taken: the click opens a confirm above the bar with
 * the consequence, and only its button changes anything (`PUT /deliveries/freeze`). Not drawn at
 * all when the daemon cannot say (`status !== 'ready'`), so there is never a dead switch.
 */

const ACT: React.CSSProperties = {
  fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', fontWeight: 'var(--weight-semi)',
  border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-md)',
  padding: '1px 8px', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
};

export function DeliveryFreezeSwitch({ placement = 'bar', banner = true }: {
  /** `bar`: the status bar's switch, its confirm floating above the bar. `inline`: anywhere else
   *  (the desk's "Everything else", the Desk's frozen row) — the confirm opens in place. */
  placement?: 'bar' | 'inline';
  /** Draw the frozen banner beside the switch (off where the row already says it). */
  banner?: boolean;
} = {}): React.ReactElement | null {
  const status = useDeliveryFreezeStore((s) => s.status);
  const state = useDeliveryFreezeStore((s) => s.state);
  const busy = useDeliveryFreezeStore((s) => s.busy);
  const error = useDeliveryFreezeStore((s) => s.error);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (status !== 'ready' || state === null) return null;
  const frozen = state.frozen;
  // The desk's default layer carries no mono (studio#425): inline, the switch takes the page's face.
  const font = placement === 'inline' ? 'inherit' : 'var(--font-mono)';
  const act = { ...ACT, fontFamily: font };

  const confirm = async (): Promise<void> => {
    const ok = await useDeliveryFreezeStore.getState().set(!frozen, frozen ? undefined : reason);
    if (ok) {
      setOpen(false);
      setReason('');
    }
  };

  return (
    <span className={placement === 'inline' ? 'flex flex-col items-start gap-2 min-w-0' : 'flex items-center gap-2 min-w-0'} style={{ flexShrink: 1 }}>
      {frozen && banner && (
        <span
          data-testid="delivery-freeze-banner"
          role="status"
          title={frozenBannerText(state)}
          style={{
            color: 'var(--status-fail)', fontWeight: 'var(--weight-semi)', minWidth: 0,
            // Inline (a narrow menu) the whole record wraps; in the bar it is one ellipsised line.
            ...(placement === 'inline' ? { whiteSpace: 'normal' } : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
          }}
        >
          {`❄ ${frozenBannerText(state)}`}
        </span>
      )}
      <button
        type="button"
        data-testid="delivery-freeze-open"
        data-frozen={String(frozen)}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ ...act, color: frozen ? 'var(--status-fail)' : 'var(--ink-muted)' }}
      >
        {frozen ? 'Unfreeze' : 'Freeze deliveries'}
      </button>
      {open && (
        <div
          data-testid="delivery-freeze-confirm"
          data-action={frozen ? 'unfreeze' : 'freeze'}
          role="dialog"
          aria-label={frozen ? 'Unfreeze deliveries' : 'Freeze deliveries'}
          className={placement === 'inline' ? 'flex flex-col gap-2' : 'fixed flex flex-col gap-2'}
          style={{
            ...(placement === 'inline' ? { width: 'min(360px, 100%)' } : { bottom: 34, right: 12, width: 'min(380px, 90vw)', zIndex: 41 }),
            padding: '10px 12px',
            background: 'var(--surface-card)', border: '1px solid var(--surface-raised)',
            borderRadius: 'var(--radius-lg)', fontSize: 'var(--text-xs)', fontFamily: font,
          }}
        >
          <p data-testid="delivery-freeze-consequence" style={{ margin: 0, color: 'var(--ink-body)', whiteSpace: 'normal' }}>
            {frozen ? UNFREEZE_CONSEQUENCE : FREEZE_CONSEQUENCE}
          </p>
          {!frozen && (
            <input
              data-testid="delivery-freeze-reason"
              aria-label="Why (optional)"
              placeholder="Why (optional), e.g. incident 42"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              style={{
                fontSize: 'var(--text-xs)', fontFamily: font, padding: '3px 6px',
                background: 'var(--surface-base)', color: 'var(--ink-body)',
                border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-md)',
              }}
            />
          )}
          {error !== null && (
            <p role="alert" data-testid="delivery-freeze-error" style={{ margin: 0, color: 'var(--status-fail)' }}>
              {error}
            </p>
          )}
          <span className="flex gap-2">
            <button
              type="button"
              data-testid="delivery-freeze-confirm-btn"
              disabled={busy}
              onClick={() => void confirm()}
              style={{ ...act, color: frozen ? 'var(--accent)' : 'var(--status-fail)' }}
            >
              {busy ? 'Saving…' : frozen ? 'Unfreeze deliveries' : 'Freeze deliveries'}
            </button>
            <button type="button" onClick={() => setOpen(false)} style={{ ...act, color: 'var(--ink-muted)' }}>
              Cancel
            </button>
          </span>
        </div>
      )}
    </span>
  );
}
