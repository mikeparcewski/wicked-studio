import { useState, useCallback } from 'react';
import { ConnectionStatus } from './components/ConnectionStatus.js';
import { GateNotifications } from './components/GateNotifications.js';
import { SessionList } from './components/SessionList.js';
import { useEventStream, type CrewEvent } from './hooks/useEventStream.js';
import { useGateStore } from './store/gates.js';

export function App(): React.ReactElement {
  const addGate = useGateStore((s) => s.addGate);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const handleEvent = useCallback((event: CrewEvent) => {
    if (event.type === 'wicked.crew.gate.awaiting_human') {
      const payload = event.payload as { session_id?: string; phase_id?: string };
      if (payload.session_id && payload.phase_id) {
        addGate({
          sessionId: payload.session_id,
          phaseId: payload.phase_id,
          receivedAt: Date.now(),
        });
      }
    }
    // Any session-state event triggers a list refresh
    if (event.type.startsWith('wicked.crew.session.') || event.type.startsWith('wicked.crew.phase.')) {
      setRefreshCounter((n) => n + 1);
    }
  }, [addGate]);

  useEventStream(handleEvent);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="h-12 flex items-center justify-between px-4 bg-white border-b shadow-sm">
        <span className="font-bold text-sm tracking-tight">wicked-studio</span>
        <ConnectionStatus />
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 border-r bg-white overflow-y-auto">
          <p className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Sessions
          </p>
          <SessionList triggerRefresh={refreshCounter} />
        </aside>

        <main className="flex-1 overflow-y-auto p-6">
          <p className="text-sm text-gray-400">Select a session to view details.</p>
        </main>
      </div>

      <GateNotifications />
    </div>
  );
}
