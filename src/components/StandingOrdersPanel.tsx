import { useCallback, useRef, useState } from 'react';
import { ORDER_INVARIANT, ORIGIN_LABEL, orderOrigin } from '../board/standingOrders.js';
import { useStandingOrders } from '../hooks/useStandingOrders.js';
import { clockTime } from '../board/handover.js';
import { AnchoredOverlay } from './AnchoredOverlay.js';

/**
 * STANDING ORDERS (Studio OS behaviour 10) — a skin over `useStandingOrders`. It lives in Home's
 * header and never takes a row of its own:
 *
 *   no orders  — a small chip: "Orders: none · Mark me away";
 *   orders     — ONE line: "3 orders active · while away: will approve … · Manage · Mark me away".
 *
 * The full Away preview and crew's invariant are the line's tooltip and the head of Manage — an
 * overlay holding the orders (every one, including those made at a gate or from the trust receipt,
 * each saying where it came from), the add flow (words → the rule said back → confirm) and the
 * outbox of queued messages. No behaviour lives here.
 */

const chip = {
  background: 'none', cursor: 'pointer', border: '1px solid var(--surface-raised)',
  borderRadius: 'var(--radius-md)', padding: '2px 10px', fontSize: 'var(--text-2xs)',
  fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)',
} as const;

export function StandingOrdersPanel(): React.ReactElement | null {
  const so = useStandingOrders();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const manageEl = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  if (so.state === 'unavailable') return null;
  if (so.state === null) {
    // A read that failed is said, never shown as "no orders" (a 404 — no surface — renders nothing).
    return so.error === null ? null : (
      <p data-testid="standing-orders-error" role="alert" className="wk-orders-error">
        Standing orders: this daemon could not say ({so.error}).
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
      {!away ? 'Mark me away' : orders.length > 0 ? 'Away — orders active' : 'Away — every gate waits'}
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
      title="Manage standing orders"
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
      aria-label="Standing orders"
      className={none ? 'wk-orders wk-orders--chip' : 'wk-orders wk-orders--line'}
      title={`${full} · ${ORDER_INVARIANT}`}
    >
      {none ? (
        <>
          {manageButton('Orders: none')}
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
        <span data-testid="standing-orders-error" role="alert" className="wk-orders-error" title={so.error}>
          {so.error}
        </span>
      )}
      {open && (
        <AnchoredOverlay anchor={manageEl.current} onClose={close} label="Standing orders" testId="standing-orders-manage" width={600}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {/* The consequence first: what going away does, from the orders in force, and what never changes. */}
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', lineHeight: 1.45 }}>
            <span data-testid="standing-orders-preview" style={{ color: 'var(--ink-body)' }}>{full}</span>
          </p>
          <p data-testid="standing-orders-invariant" style={{ margin: 0, fontSize: 'var(--text-xs)', lineHeight: 1.45, color: 'var(--ink-muted)' }}>
            {ORDER_INVARIANT}
          </p>
          {so.error !== null && (
            <p data-testid="standing-orders-error" role="alert" style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--status-fail)' }}>
              {so.error}
            </p>
          )}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {orders.length === 0 && (
              <li style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-dim)' }}>No standing orders. Add one in plain words below.</li>
            )}
            {orders.map((o) => (
              <li key={o.id} data-testid="standing-order-row" data-order-id={o.id} data-origin={orderOrigin(o)} style={{ display: 'flex', gap: '8px', alignItems: 'baseline', fontSize: 'var(--text-xs)', minWidth: 0 }}>
                <span data-testid="standing-order-origin" style={{ ...chip, cursor: 'default', padding: '0 6px', flexShrink: 0 }}>
                  {ORIGIN_LABEL[orderOrigin(o)]}
                </span>
                <span style={{ color: 'var(--ink-high)', fontWeight: 'var(--weight-semi)' }}>{o.text}</span>
                <span style={{ color: 'var(--ink-muted)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {so.words(o.rule)}
                </span>
                <button type="button" data-testid="standing-order-remove" onClick={() => void so.remove(o.id)} style={chip}>
                  Retire
                </button>
              </li>
            ))}
          </ul>

          {d.step === 'confirm' ? (
            <div data-testid="standing-order-parsed" style={{ border: '1px dashed var(--surface-raised)', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--text-xs)' }}>
              <p style={{ margin: '0 0 4px', color: 'var(--ink-muted)' }}>
                “{d.text}” reads as (parsed by {d.parsed.seat}):
              </p>
              <p data-testid="standing-order-words" style={{ margin: '0 0 6px', color: 'var(--ink-high)', fontWeight: 'var(--weight-semi)' }}>
                {d.words}
              </p>
              {d.parsed.refused !== undefined && (
                <p data-testid="standing-order-refused" role="alert" style={{ margin: '0 0 6px', color: 'var(--status-fail)' }}>
                  Can’t keep this one: {d.parsed.refused}.
                </p>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  data-testid="standing-order-confirm"
                  disabled={d.parsed.refused !== undefined}
                  onClick={() => { void so.confirm(); setText(''); }}
                  style={{ ...chip, color: 'var(--accent)', borderColor: 'var(--accent)' }}
                >
                  Keep this order
                </button>
                <button type="button" data-testid="standing-order-cancel" onClick={so.cancel} style={chip}>
                  Not that
                </button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={(e) => { e.preventDefault(); void so.parse(text); }}
              style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
            >
              <input
                data-testid="standing-order-input"
                aria-label="A standing order in plain words"
                placeholder="e.g. auto-approve intake on project A while I'm away"
                value={text}
                onChange={(e) => setText(e.target.value)}
                style={{
                  flex: 1, minWidth: 0, fontSize: 'var(--text-xs)', padding: '4px 8px',
                  background: 'var(--surface-base)', color: 'var(--ink-high)',
                  border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-md)',
                }}
              />
              <button type="submit" data-testid="standing-order-parse" disabled={d.step === 'parsing' || text.trim() === ''} style={chip}>
                {d.step === 'parsing' ? 'Reading…' : 'Read it back'}
              </button>
            </form>
          )}
          {d.step === 'failed' && (
            <p data-testid="standing-order-parse-error" role="alert" style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--status-fail)' }}>
              {d.error}{d.answer !== undefined ? ` — the seat said: ${d.answer}` : ''}
            </p>
          )}

          {outbox.length > 0 && (
            <div data-testid="standing-orders-outbox">
              <p style={{ margin: '0 0 2px', fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-bold)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-dim)' }}>
                Queued, not sent
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {outbox.map((m) => (
                  <li key={m.id} data-testid="standing-order-queued" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>
                    {m.text} <span style={{ color: 'var(--ink-dim)' }}>— “{m.orderText}”</span>
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
