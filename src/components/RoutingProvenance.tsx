import type { RoutingInfo } from '../api/types.js';

interface Props {
  routing: RoutingInfo | null;
}

/**
 * "Why this CLI won" (DES-STUDIO-001 §11.5). Renders the unit's `RoutingInfo`:
 * a council vote, a degraded fallback, or the evaluator-distinct reassignment
 * (evaluator != creator). Renders nothing until core has attached routing.
 */
export function RoutingProvenance({ routing }: Props): React.ReactElement | null {
  if (!routing) return null;

  if (routing.method === 'council') {
    return (
      <p className="text-[11px] text-gray-500" data-testid="routing-provenance">
        <span className="font-medium">Council:</span> {routing.winner} won ·{' '}
        {routing.agreement_pct}% agreement · {routing.returned} returned · {routing.dissent} dissent
      </p>
    );
  }

  if (routing.method === 'degraded') {
    return (
      <p className="text-[11px] text-amber-600" data-testid="routing-provenance">
        <span className="font-medium">Degraded:</span> {routing.reason}
      </p>
    );
  }

  // evaluator_distinct — the reviewer/tester was reassigned off the council pick
  // to enforce evaluator != creator.
  return (
    <p className="text-[11px] text-indigo-600" data-testid="routing-provenance">
      <span className="font-medium">Evaluator-distinct:</span> {routing.winner} (was {routing.was})
    </p>
  );
}
