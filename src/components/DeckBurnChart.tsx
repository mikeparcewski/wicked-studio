import { useMemo } from 'react';
import { burnSteps } from '../board/metrics.js';
import { useRuntimeStore } from '../store/runtime.js';

/**
 * The live-pulse burn chart (command-deck redesign) — the cumulative token/cost spend curve, drawn
 * from the `cliUsage` frames observed on the /ws stream THIS session (`burnSteps`). Honestly labeled
 * "session": per-run cost is not on the run DTO yet (api-types defers a durable store), so this is
 * the live-observed spend, not a historical total. Empty until a run burns tokens — then a glowing
 * curve with an emphasized endpoint, the deck's one chart flourish.
 */
export function DeckBurnChart(): React.ReactElement {
  const logs = useRuntimeStore((s) => s.logs);
  const { steps, total } = useMemo(() => burnSteps(logs), [logs]);

  const path = useMemo(() => {
    if (steps.length < 2) return null;
    const W = 320;
    const H = 96;
    const max = steps[steps.length - 1]!.total || 1;
    const pts = steps.map((s, i) => {
      const x = (i / (steps.length - 1)) * W;
      const y = H - (s.total / max) * (H - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { line: pts.join(' '), area: `${pts.join(' ')} ${W},${H} 0,${H}`, endX: W, endY: parseFloat(pts[pts.length - 1]!.split(',')[1]!) };
  }, [steps]);

  return (
    <section className="deck-pulse" data-testid="home-burn-chart">
      <div className="deck-pulse-head">
        <span className="deck-pulse-t">Spend · session</span>
        <span className="deck-pulse-v" data-testid="burn-total">
          {total > 0 ? `$${total.toFixed(2)}` : '—'} <small>{steps.length > 0 ? `· ${steps.length} frames` : '· no usage yet'}</small>
        </span>
      </div>
      <svg className="deck-pulse-chart" viewBox="0 0 320 96" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="deck-burn" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.4" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1="32" x2="320" y2="32" stroke="var(--surface-raised)" strokeWidth="1" />
        <line x1="0" y1="64" x2="320" y2="64" stroke="var(--surface-raised)" strokeWidth="1" />
        {path !== null ? (
          <>
            <polygon points={path.area} fill="url(#deck-burn)" />
            <polyline points={path.line} fill="none" stroke="var(--accent)" strokeWidth="1.9" style={{ filter: 'drop-shadow(0 0 5px color-mix(in oklab, var(--accent) 60%, transparent))' }} />
            <circle cx={path.endX} cy={path.endY} r="2.6" fill="var(--accent)" />
          </>
        ) : (
          <line x1="0" y1="88" x2="320" y2="88" stroke="var(--surface-raised)" strokeWidth="1.5" />
        )}
      </svg>
    </section>
  );
}
