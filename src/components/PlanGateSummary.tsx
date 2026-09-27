import { floorAddedText, planGateReasonText, type PlanGateView } from '../board/planModel.js';

/**
 * Why a plan gate stopped the run (D10): the score and band, the score's reasons as the engine
 * wrote them (a stale code graph fails closed at 100 and says so), what the floor added and why,
 * and why the gate opened. Read off `GET /runs/:id/team`; `null` while it loads.
 */
export function PlanGateSummary({ view }: { view: PlanGateView | null }): React.ReactElement {
  if (view === null) {
    return (
      <p data-testid="plan-gate-summary" data-state="loading" className="text-xs font-mono mb-2" style={{ color: 'var(--ink-dim)' }}>
        Reading the plan’s score…
      </p>
    );
  }
  return (
    <div
      data-testid="plan-gate-summary"
      data-state="ready"
      data-high-risk={view.highRisk ? 'true' : 'false'}
      className="flex flex-col gap-1 text-xs font-mono mb-2 rounded-lg px-3 py-2"
      style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-body)' }}
    >
      <p data-testid="plan-gate-score" style={{ color: view.highRisk ? 'var(--status-gate)' : 'var(--ink-high)' }}>
        {view.score !== null ? `Score ${view.score} · ` : ''}band {view.band}
        {view.highRisk ? ' · high risk' : ''}
      </p>
      {view.reasons.length > 0 && (
        <ul data-testid="plan-gate-reasons" className="flex flex-col gap-0.5 pl-3" style={{ listStyle: 'disc', overflowWrap: 'anywhere' }}>
          {view.reasons.map((r, i) => (
            <li key={i} data-testid="plan-gate-reason">{r}</li>
          ))}
        </ul>
      )}
      <p data-testid="plan-gate-floor">{floorAddedText(view)}</p>
      <p data-testid="plan-gate-why" style={{ color: 'var(--ink-muted)' }}>
        Why it stops here: {planGateReasonText(view)}.
      </p>
    </div>
  );
}
