import { useCallback, useState } from 'react';
import { ConnectionStatus } from './components/ConnectionStatus.js';
import { GateNotifications } from './components/GateNotifications.js';
import { RunList } from './components/RunList.js';
import { RunDetail } from './components/RunDetail.js';
import { LaunchForm } from './components/LaunchForm.js';
import { useEventStream } from './hooks/useEventStream.js';
import { useRuns } from './hooks/useRuns.js';
import { useGateStore } from './store/gates.js';
import { useRuntimeStore } from './store/runtime.js';
import { useRunEventStore } from './store/events.js';
import type { CoreEvent } from './api/types.js';

/** Frames that change run-list / unit state → trigger a `GET /runs` reconcile. */
const LIFECYCLE_EVENTS: ReadonlySet<string> = new Set([
  'sessionStarted',
  'unitPlanned',
  'unitDistributed',
  'unitExecuting',
  'gateDecided',
  'unitDone',
  'unitDenied',
  'awaitingHuman',
  'resumed',
  'runCancelled',
  'sessionFailed',
  'sessionCompleted',
]);

export function App(): React.ReactElement {
  const { runs, refresh } = useRuns();
  const ingestGate = useGateStore((s) => s.ingest);
  const ingestRuntime = useRuntimeStore((s) => s.ingest);
  const ingestRunEvent = useRunEventStore((s) => s.ingest);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [showLaunch, setShowLaunch] = useState(false);

  const handleEvent = useCallback(
    (event: CoreEvent) => {
      // Fold each frame into the gate cache + the live-output/event-log store + the
      // per-run structured append log (the useRunModel merge source), then reconcile
      // the run list on any lifecycle transition. Unknown types are folded harmlessly
      // and never trigger a refresh (additive-safe).
      ingestGate(event);
      ingestRuntime(event);
      ingestRunEvent(event);
      if (LIFECYCLE_EVENTS.has(event.type)) refresh();
    },
    [ingestGate, ingestRuntime, ingestRunEvent, refresh],
  );

  useEventStream(handleEvent);

  const selectRun = useCallback((runId: string) => {
    setSelectedRunId(runId);
    setShowLaunch(false);
  }, []);

  const onLaunched = useCallback(
    (runId: string) => {
      setSelectedRunId(runId);
      setShowLaunch(false);
      refresh();
    },
    [refresh],
  );

  const selected = runs.find((v) => v.session.id === selectedRunId) ?? null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="h-12 flex items-center justify-between px-4 bg-white border-b shadow-sm">
        <span className="font-bold text-sm tracking-tight">wicked-studio</span>
        <ConnectionStatus />
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 border-r bg-white overflow-y-auto flex flex-col">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Runs</p>
            <button
              type="button"
              data-testid="new-run"
              onClick={() => {
                setShowLaunch(true);
                setSelectedRunId(null);
              }}
              className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700"
            >
              New run
            </button>
          </div>
          <RunList runs={runs} selectedRunId={selectedRunId} onSelect={selectRun} />
        </aside>

        <main className="flex-1 overflow-y-auto p-6">
          {showLaunch ? (
            <LaunchForm onLaunched={onLaunched} onCancel={() => setShowLaunch(false)} />
          ) : selected ? (
            <RunDetail key={selected.session.id} view={selected} onRefresh={refresh} />
          ) : (
            <p className="text-sm text-gray-400">Select a run, or launch a new one.</p>
          )}
        </main>
      </div>

      <GateNotifications onSelect={selectRun} />
    </div>
  );
}
