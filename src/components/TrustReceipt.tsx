import { useTrustReceipt } from '../hooks/useTrustReceipt.js';

/**
 * "Trust this route for low-risk runs like this" (brainstorm-actionable idea 13), in the Insights
 * panel's What / Where card: the consequence first (which runs skip plan approval; the deliver gate
 * stays manual), then the one button that makes the band-scoped standing order. Once an order
 * covers the route the card says so instead of offering it again. Renders nothing for a run crew
 * could not trust (no project, no preset, not band 0-19, high risk, a steering-author run).
 */
export function TrustReceipt({ session }: {
  session: { id: string; project_id?: unknown; workflow_id?: unknown; team_plan?: unknown };
}): React.ReactElement | null {
  const { receipt, made, busy, error, trust } = useTrustReceipt(session);
  if (receipt === null) return null;
  if (receipt.kind === 'trusted') {
    return (
      <div
        data-testid={made !== null ? 'trust-receipt-made' : 'trust-receipt-in-force'}
        className="flex gap-2 text-[11px] pt-1"
      >
        <span className="w-20 shrink-0 font-mono" style={{ color: 'var(--ink-dim)' }}>trust</span>
        <span style={{ color: 'var(--ink-muted)' }}>
          {made !== null ? 'Trusted: ' : 'Trusted by an order: '}{receipt.order.text}
        </span>
      </div>
    );
  }
  return (
    <div data-testid="trust-receipt" className="flex flex-col gap-1 text-[11px] pt-1">
      <span data-testid="trust-receipt-question" className="font-medium" style={{ color: 'var(--ink-high)' }}>
        {receipt.question}
      </span>
      <span data-testid="trust-receipt-consequence" style={{ color: 'var(--ink-muted)' }}>{receipt.consequence}</span>
      <button
        type="button"
        data-testid="trust-receipt-make"
        onClick={() => void trust()}
        disabled={busy}
        className="self-start rounded px-2 py-1 font-mono disabled:opacity-50"
        style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
      >
        {busy ? 'Trusting…' : 'Trust this route'}
      </button>
      {error !== null && (
        <span data-testid="trust-receipt-error" style={{ color: 'var(--status-fail)' }}>Not made: {error}</span>
      )}
    </div>
  );
}
