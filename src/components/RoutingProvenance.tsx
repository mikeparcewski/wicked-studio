import type { RoutingInfo } from '../api/types.js';
import { lostQuorum, quorumLabel } from './councilQuorum.js';

interface Props {
  routing: RoutingInfo | null;
}

export function RoutingProvenance({ routing }: Props): React.ReactElement | null {
  if (!routing) return null;

  if (routing.method === 'council') {
    return (
      <p className="text-[11px] font-mono" style={{ color: 'var(--ink-muted)' }} data-testid="routing-provenance">
        <span className="font-medium" style={{ color: 'var(--ink-muted)' }}>Council:</span>{' '}
        {routing.winner} won · {routing.agreement_pct}% agreement · {quorumLabel(routing)} · {routing.dissent} dissent
        {lostQuorum(routing) && <span style={{ color: 'var(--status-gate)' }}> · quorum lost</span>}
      </p>
    );
  }

  if (routing.method === 'degraded') {
    return (
      <p className="text-[11px] font-mono" style={{ color: 'var(--status-gate)' }} data-testid="routing-provenance">
        <span className="font-medium">Degraded:</span> {routing.reason}
      </p>
    );
  }

  if (routing.method === 'tool') {
    return (
      <p className="text-[11px] font-mono" style={{ color: 'var(--ink-dim)' }} data-testid="routing-provenance">
        <span className="font-medium">Tool:</span> direct command — no council
      </p>
    );
  }

  return (
    <p className="text-[11px] font-mono" style={{ color: 'var(--accent)' }} data-testid="routing-provenance">
      <span className="font-medium">Evaluator-distinct:</span> {routing.winner} (was {routing.was})
    </p>
  );
}
