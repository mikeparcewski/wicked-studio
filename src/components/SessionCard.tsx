import type { Session, Phase } from '../api/client.js';
import { PhaseGraph } from './PhaseGraph.js';

interface Props {
  session: Session;
  phases: Phase[];
}

export function SessionCard({ session, phases }: Props): React.ReactElement {
  const statusColors: Record<string, string> = {
    pending: 'text-gray-500',
    running: 'text-blue-600',
    paused: 'text-yellow-600',
    completed: 'text-green-600',
    failed: 'text-red-600',
  };

  return (
    <div className="rounded-lg border p-4 bg-white shadow-sm" data-testid="session-card">
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="font-semibold text-sm truncate max-w-xs">{session.goal}</p>
          <p className="text-xs text-gray-400 font-mono">{session.id.slice(0, 8)}</p>
        </div>
        <span className={`text-xs font-medium ${statusColors[session.status] ?? 'text-gray-500'}`}>
          {session.status}
        </span>
      </div>
      <PhaseGraph phases={phases} />
    </div>
  );
}
