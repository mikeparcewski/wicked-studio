import { useMemo } from 'react';
import type { SessionView } from '../api/types.js';
import type { Navigate } from '../hooks/useRoute.js';
import { COUNT_TONE_COLOR, countTone, type CountKind } from '../board/countTone.js';
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
  const cells: Array<{ key: string; count: number; kind: CountKind; path: string; label: string }> = [
    { key: 'verified', count: c.delivered, kind: 'neutral', path: '/work?filter=delivered', label: 'Verified & delivered' },
    { key: 'stranded', count: c.stranded, kind: 'gate', path: '/work?filter=stranded', label: 'Stranded — needs review' },
    { key: 'vacuous', count: c.vacuous, kind: 'gate', path: '/work?filter=vacuous', label: 'Vacuous — no change to deliver' },
  ];
  return (
    <div className="deck-vrbar" data-testid="home-delivery-strip" role="group" aria-label="Delivery outcomes">
      {cells.map((x) => {
        // Zero is quiet: the tone is the count-tone model's, never a fixed per-cell colour.
        const tone = countTone(x.count, x.kind);
        return (
          <a
            key={x.key}
            className="deck-vrcell"
            data-testid={`delivery-${x.key}`}
            data-tone={tone}
            href={x.path}
            onClick={(e) => { e.preventDefault(); navigate(x.path); }}
          >
            <span className="deck-vn" style={{ color: COUNT_TONE_COLOR[tone] }}>{x.count}</span>
            <span className="deck-vl">{x.label}</span>
          </a>
        );
      })}
    </div>
  );
}
