import { useCallback, useRef, useState } from 'react';
import { ORDER_INVARIANT, ORIGIN_LABEL, orderOrigin } from '../board/standingOrders.js';
import { useStandingOrders } from '../hooks/useStandingOrders.js';
import { clockTime } from '../board/handover.js';
import { AnchoredOverlay } from './AnchoredOverlay.js';

/**
 * STANDING ORDERS (Studio OS behaviour 10) — a skin over `useStandingOrders`. It lives in Home's
 * header and never takes a row of its own:
 *
 *   none       — "No standing instructions · Mark me away" (UX audit row 31: plain words, readable ink);
 *   some       — ONE line: "3 orders active · while away: will approve … · Manage · Mark me away".
 *
 * The full Away preview and crew's invariant are the line's tooltip and the head of Manage — an
 * overlay holding the orders (every one, including those made at a gate or from the trust receipt,
 * each saying where it came from), the add flow (words → the rule said back → confirm) and the
 * outbox of queued messages. No behaviour lives here.
 */

export function StandingOrdersPanel(): React.ReactElement | null {
  const so = useStandingOrders();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const manageEl = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  if (so.state === 'unavailable') return null;
  if (so.state === null) {
    // A read that failed is said, never shown as "no orders" (a 404 — no surface — renders nothing).
    // Plain words only (UX audit row 10): the page's own banner says when studio's service is down.
    return so.error === null ? null : (
      <p data-testid="standing-orders-error" role="status" className="wk-orders-error">
        Standing instructions couldn’t load.
      </p>
    );
  }
  const { away, awaySince, orders, outbox } = so.state;
  const d = so.draft;
  // No orders (and nothing queued) stays the small chip whether or not you are away: going away
  // with no orders changes nothing, and the chip must not claim otherwise (codex on #376).
  const none = orders.length === 0 && outbox.length === 0;
  const whileAway = away ? `away${awaySince !== null ? ` since ${clockTime(awaySince)}` : ''}` : 'while away';
  const full = `${away ? `Away${awaySince !== null ? ` since ${clockTime(awaySince)}` : ''}. ` : 'While you are away: '}${so.preview ?? ''}`;
  const awayButton = (
    <button
      type="button"
      data-testid="standing-orders-away"
      aria-pressed={away}
      onClick={() => void so.setAway(!away)}
      className="wk-orders-act"
      data-on={away ? 'true' : undefined}
    >
      {!away ? 'Mark me away' : orders.length > 0 ? 'Away: instructions active' : 'Away: every question waits'}
    </button>
  );
  const manageButton = (label: string): React.ReactElement => (
    <button
      ref={manageEl}
      type="button"
      data-testid="standing-orders-toggle"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className="wk-orders-act"
      title="Manage standing instructions"
    >
      {label}
    </button>
  );
  return (
    <div
      data-testid="standing-orders-panel"
      data-variant={none ? 'chip' : 'line'}
      data-away={away ? 'true' : 'false'}
      role="group"
      aria-label="Standing instructions"
      className={none ? 'wk-orders wk-orders--chip' : 'wk-orders wk-orders--line'}
      title={`${full} · ${ORDER_INVARIANT}`}
    >
      {none ? (
        <>
          {manageButton('No standing instructions')}
          <span aria-hidden className="wk-orders-sep">·</span>
          {awayButton}
        </>
      ) : (
        <>
          <span data-testid="standing-orders-count" className="wk-orders-count">
            {so.line?.count ?? `${orders.length} orders`}
            {outbox.length > 0 ? ` · ${outbox.length} queued` : ''}
          </span>
          <span aria-hidden className="wk-orders-sep">·</span>
          <span data-testid="standing-orders-summary" className="wk-orders-will">
            {whileAway}: {so.line?.will ?? ''}
          </span>
          <span aria-hidden className="wk-orders-sep">·</span>
          {manageButton('Manage')}
          <span aria-hidden className="wk-orders-sep">·</span>
          {awayButton}
        </>
      )}
      {so.error !== null && !open && (
        <span data-testid="standing-orders-error" role="status" className="wk-orders-error">
          That didn’t save. Try again.
        </span>
      )}
      {open && (
        <AnchoredOverlay anchor={manageEl.current} onClose={close} label="Standing instructions" testId="standing-orders-manage" width={560}>
        <div className="wk-orders-pop">
          {/* UX audit row 33: said once. With none, one sentence and an example; with some, what
              going away does with them. What an instruction can never do is the field's note. */}
          {none ? (
            <p data-testid="standing-orders-preview">No standing instructions yet: while you’re away, every question waits for you.</p>
          ) : (
            <p data-testid="standing-orders-preview">{full}</p>
          )}
          {so.error !== null && (
            <p data-testid="standing-orders-error" role="alert" className="wk-orders-pop-err">That didn’t save. Try again.</p>
          )}
          {orders.length > 0 && (
            <ul className="wk-orders-pop-list">
              {orders.map((o) => (
                <li key={o.id} data-testid="standing-order-row" data-order-id={o.id} data-origin={orderOrigin(o)} className="wk-orders-pop-row">
                  <span data-testid="standing-order-origin" className="wk-tag">{ORIGIN_LABEL[orderOrigin(o)]}</span>
                  <span style={{ color: 'var(--ink-high)', fontWeight: 'var(--weight-semi)' }}>{o.text}</span>
                  <span className="wk-orders-pop-rule">{so.words(o.rule)}</span>
                  <button type="button" data-testid="standing-order-remove" onClick={() => void so.remove(o.id)} className="wk-btn wk-btn--quiet wk-btn--sm">
                    Retire
                  </button>
                </li>
              ))}
            </ul>
          )}

          {d.step === 'confirm' ? (
            <div data-testid="standing-order-parsed" className="wk-orders-pop-parsed">
              <p style={{ color: 'var(--ink-muted)' }}>“{d.text}” reads as:</p>
              <p data-testid="standing-order-words" style={{ color: 'var(--ink-high)', fontWeight: 'var(--weight-semi)' }}>{d.words}</p>
              {d.parsed.refused !== undefined && (
                <p data-testid="standing-order-refused" role="alert" className="wk-orders-pop-err">Can’t keep this one: {d.parsed.refused}.</p>
              )}
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  type="button"
                  data-testid="standing-order-confirm"
                  disabled={d.parsed.refused !== undefined}
                  onClick={() => { void so.confirm(); setText(''); }}
                  className="wk-btn wk-btn--primary wk-btn--sm"
                >
                  Keep it
                </button>
                <button type="button" data-testid="standing-order-cancel" onClick={so.cancel} className="wk-btn wk-btn--quiet wk-btn--sm">
                  Not that
                </button>
              </div>
            </div>
          ) : (
            <>
              <form onSubmit={(e) => { e.preventDefault(); void so.parse(text); }} className="wk-orders-pop-form">
                <input
                  data-testid="standing-order-input"
                  aria-label="A standing instruction in plain words"
                  placeholder="e.g. approve intake steps while I’m away"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="wk-field"
                />
                <button type="submit" data-testid="standing-order-parse" disabled={d.step === 'parsing' || text.trim() === ''} className="wk-btn wk-btn--secondary wk-btn--sm">
                  {d.step === 'parsing' ? 'Checking…' : 'Check wording'}
                </button>
              </form>
              <p data-testid="standing-orders-invariant" className="wk-field-note">{ORDER_INVARIANT}</p>
            </>
          )}
          {d.step === 'failed' && (
            <p data-testid="standing-order-parse-error" role="alert" className="wk-orders-pop-err">
              {d.error}{d.answer !== undefined ? ` (the helper said: ${d.answer})` : ''}
            </p>
          )}

          {outbox.length > 0 && (
            <div data-testid="standing-orders-outbox">
              <p className="wk-section-title" style={{ fontSize: 'var(--text-xs)' }}>Queued, not sent</p>
              <ul className="wk-orders-pop-list">
                {outbox.map((m) => (
                  <li key={m.id} data-testid="standing-order-queued" style={{ color: 'var(--ink-muted)' }}>
                    {m.text} <span style={{ color: 'var(--ink-dim)' }}>(“{m.orderText}”)</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        </AnchoredOverlay>
      )}
    </div>
  );
}
