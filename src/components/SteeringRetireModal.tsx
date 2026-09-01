import { useState } from 'react';
import { api } from '../api/client.js';
import type { SteeringRule } from '../api/steering.js';
import { useModalEscape } from './Modal.js';

/**
 * The retire kill switch (retired-not-deleted) — ONE modal for both retire affordances: the
 * rule drawer's "Retire…" and the grid row's remove. Typed confirmation + a REQUIRED reason
 * over the shipping `DELETE /governance/rules/:id` wire. The wire carries NO reason field
 * (recon, crew 0.7.6 routes) — the reason is the operator's note for the doc PR that retires
 * the doctrine at its source, echoed by the page after the wire succeeds; it is never
 * silently dropped, and never pretended to be server-recorded.
 *
 * Un-retire is deliberately ABSENT: there is no un-retire wire (recon: only the DELETE
 * kill switch and the rule upsert exist), and re-writing the row with `retired: false`
 * through the upsert would side-step the retire audit trail (`governance.rule.retired`) —
 * a retired rule comes back through a deliberate re-ingest/re-author, not a grid toggle.
 */
export function SteeringRetireModal({ rule, onClose, onRetired }: {
  rule: SteeringRule;
  onClose: () => void;
  /** Fires after the retire wire succeeded, with the operator's reason. */
  onRetired: (reason: string) => void;
}): React.ReactElement {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useModalEscape(onClose);

  const armed = typed === rule.id && reason.trim() !== '' && !busy;

  const confirm = async (): Promise<void> => {
    if (!armed) return;
    setBusy(true);
    setError(null);
    try {
      await api.retireConformanceRule(rule.id);
      onRetired(reason.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--scrim)' }}>
      <div
        data-testid="steering-retire-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Retire ${rule.id}`}
        className="flex w-[28rem] max-w-[92vw] flex-col gap-3 rounded-xl p-4 shadow-2xl"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--status-fail-dim)' }}
      >
        <h3 className="text-sm font-semibold" style={{ color: 'var(--status-fail)' }}>
          Retire {rule.id}
        </h3>
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Withdraws this rule from recall and enforcement <em>now</em>. The record stays listed —
          past gate decisions cite it, and deleting it would break that audit trail. A doc-ingested
          rule&rsquo;s doctrine still lives in its source doc: carry your reason into the doc PR that
          retires it there.
        </p>
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Type the rule id to confirm
          <input
            data-testid="steering-retire-confirm-input"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={rule.id}
            spellCheck={false}
            className="rounded px-2 py-1 font-mono text-[11px] focus:outline-none"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Reason (required)
          <textarea
            data-testid="steering-retire-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this rule must stop steering now"
            className="min-h-[3.5rem] resize-y rounded px-2 py-1 text-[11px] focus:outline-none"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
        </label>
        {error !== null && (
          <p data-testid="steering-retire-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            data-testid="steering-retire-cancel"
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1 text-[11px]"
            style={{ color: 'var(--ink-muted)', border: '1px solid var(--surface-raised)' }}
          >
            Cancel
          </button>
          <button
            data-testid="steering-retire-confirm"
            type="button"
            disabled={!armed}
            onClick={() => void confirm()}
            className="rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
            style={{ background: 'var(--status-fail)', color: 'var(--surface-base)' }}
          >
            {busy ? 'Retiring…' : 'Retire rule'}
          </button>
        </div>
      </div>
    </div>
  );
}
