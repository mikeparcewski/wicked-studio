import { useEffect, useState } from 'react';
import { api, type Session, type Phase } from '../api/client.js';
import { SessionCard } from './SessionCard.js';
import { useConnectionStore } from '../store/connection.js';

interface SessionEntry {
  session: Session;
  phases: Phase[];
}

interface Props {
  triggerRefresh: number;
}

export function SessionList({ triggerRefresh }: Props): React.ReactElement {
  const status = useConnectionStore((s) => s.status);
  const [entries, setEntries] = useState<SessionEntry[]>([]);

  useEffect(() => {
    if (status !== 'connected') return;
    api.listSessions()
      .then((r) => setEntries(r.sessions))
      .catch(() => { /* silently show stale list */ });
  }, [status, triggerRefresh]);

  if (status === 'disconnected') {
    return (
      <div data-testid="session-list" className="p-4 text-sm text-gray-400 text-center">
        Daemon not reachable — reconnecting…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div data-testid="session-list" className="p-4 text-sm text-gray-400 text-center">
        No active sessions
      </div>
    );
  }

  return (
    <div data-testid="session-list" className="flex flex-col gap-3 p-4">
      {entries.map((e) => (
        <SessionCard key={e.session.id} session={e.session} phases={e.phases} />
      ))}
    </div>
  );
}
