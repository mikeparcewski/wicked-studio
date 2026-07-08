import type { SessionView } from '../api/types.js';
import { useConnectionStore } from '../store/connection.js';
import { RunCard } from './RunCard.js';

interface Props {
  /** Runs, already sorted actionable-first by the daemon (§11.6). */
  runs: SessionView[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}

export function RunList({ runs, selectedRunId, onSelect }: Props): React.ReactElement {
  const status = useConnectionStore((s) => s.status);

  // Graceful disconnected state — keep showing the last-known list is risky (stale
  // actions), so we surface the disconnect explicitly and let reconnect refill.
  if (status === 'disconnected') {
    return (
      <div data-testid="run-list" className="p-4 text-sm text-gray-400 text-center">
        Daemon not reachable — reconnecting…
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div data-testid="run-list" className="p-4 text-sm text-gray-400 text-center">
        No runs yet
      </div>
    );
  }

  return (
    <div data-testid="run-list" className="flex flex-col gap-3 p-4">
      {runs.map((view) => (
        <RunCard
          key={view.session.id}
          view={view}
          selected={view.session.id === selectedRunId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
