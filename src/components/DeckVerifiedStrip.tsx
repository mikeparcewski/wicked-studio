import { useMemo } from 'react';
import type { SessionView } from '../api/types.js';
import type { Navigate } from '../hooks/useRoute.js';
import { deliveryCounts } from '../board/windowStats.js';
import { useIsSystemWorkflow } from '../store/workflowCache.js';

/**
 * The verified-vs-needs-review strip (command-deck redesign) — the delivery outcomes pulled UP from
 * the run detail into the landing, so "what shipped vs what still needs me" reads at a glance. One
 * fold ({@link deliveryCounts}) shared with the ribbon's ATTENTION "review" tile, off the run DTO's
 * `delivery` field — nothing is fetched per run. Each cell is a door into the matching Work filter.
 *
 * The `vacuous` cell counts only runs that were EXPECTED to deliver (wicked-studio#250,
 * F-3R2-018): the fold takes the app's `is_system` lookup — the ONE `GET /workflows` the cache
 * already budgets for the whole session — so onboarding and the other system workflows, which
 * deliver nothing by design, no longer read as "9 Vacuous — needs retry" and bury the real signal.
 * The label states the condition ("no change to deliver"), not a prescription.
 */
export function DeckVerifiedStrip({ runs, navigate }: {
  runs: SessionView[];
  navigate: Navigate;
}): React.ReactElement {
  const isSystemWorkflow = useIsSystemWorkflow();
  const c = useMemo(() => deliveryCounts(runs, isSystemWorkflow), [runs, isSystemWorkflow]);
  const cell = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  return (
    <div className="deck-vrbar" data-testid="home-delivery-strip" role="group" aria-label="Delivery outcomes">
      <a className="deck-vrcell" data-testid="delivery-verified" href="/work?filter=delivered" onClick={cell('/work?filter=delivered')}>
        <span className="deck-vn ok">{c.delivered}</span>
        <span className="deck-vl">Verified &amp; delivered</span>
      </a>
      <a className="deck-vrcell" data-testid="delivery-stranded" href="/work?filter=stranded" onClick={cell('/work?filter=stranded')}>
        <span className="deck-vn warn">{c.stranded}</span>
        <span className="deck-vl">Stranded — needs review</span>
      </a>
      <a className="deck-vrcell" data-testid="delivery-vacuous" href="/work?filter=vacuous" onClick={cell('/work?filter=vacuous')}>
        <span className="deck-vn bad">{c.vacuous}</span>
        <span className="deck-vl">Vacuous — no change to deliver</span>
      </a>
    </div>
  );
}
