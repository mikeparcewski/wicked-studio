import type { RoutingInfo } from '../api/types.js';
import { lostQuorum, quorumLabel } from './councilQuorum.js';

interface Props {
  routing: RoutingInfo | null;
}

export function RoutingProvenance({ routing }: Props): React.ReactElement | null {
  if (!routing) return null;

  if (routing.method === 'council') {
    return (
      <p className="text-[11px] font-mono" style={{ color: 'rgba(230,237,243,0.45)' }} data-testid="routing-provenance">
        <span className="font-medium" style={{ color: 'rgba(230,237,243,0.6)' }}>Council:</span>{' '}
        {routing.winner} won · {routing.agreement_pct}% agreement · {quorumLabel(routing)} · {routing.dissent} dissent
        {lostQuorum(routing) && <span style={{ color: '#ffda19' }}> · quorum lost</span>}
      </p>
    );
  }

  if (routing.method === 'degraded') {
    return (
      <p className="text-[11px] font-mono" style={{ color: '#ffda19' }} data-testid="routing-provenance">
        <span className="font-medium">Degraded:</span> {routing.reason}
      </p>
    );
  }

  if (routing.method === 'tool') {
    return (
      <p className="text-[11px] font-mono" style={{ color: 'rgba(230,237,243,0.4)' }} data-testid="routing-provenance">
        <span className="font-medium">Tool:</span> direct command — no council
      </p>
    );
  }

  return (
    <p className="text-[11px] font-mono" style={{ color: '#a78bfa' }} data-testid="routing-provenance">
      <span className="font-medium">Evaluator-distinct:</span> {routing.winner} (was {routing.was})
    </p>
  );
}
