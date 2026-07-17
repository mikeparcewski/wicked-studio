import { useCallback } from 'react';
import { ConnectionStatus } from './components/ConnectionStatus.js';
import { CoverageView } from './components/CoverageView.js';
import { DomainModelBrowser } from './components/DomainModelBrowser.js';
import { GateNotifications } from './components/GateNotifications.js';
import { PolicyManager } from './components/PolicyManager.js';
import { RunList } from './components/RunList.js';
import { RunDetail } from './components/RunDetail.js';
import { LaunchForm } from './components/LaunchForm.js';
import { RuleManager } from './components/RuleManager.js';
import { WorkflowViewer } from './components/WorkflowViewer.js';
import { useEventStream } from './hooks/useEventStream.js';
import { useRoute } from './hooks/useRoute.js';
import { useRuns } from './hooks/useRuns.js';
import { useGateStore } from './store/gates.js';
import { useRuntimeStore } from './store/runtime.js';
import { useRunEventStore } from './store/events.js';
import type { CoreEvent } from './api/types.js';
import type { Panel } from './hooks/useRoute.js';

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
  const { panel, runId, showLaunch, navigate, panelPath } = useRoute();
  const { runs, refresh } = useRuns();
  const ingestGate = useGateStore((s) => s.ingest);
  const ingestRuntime = useRuntimeStore((s) => s.ingest);
  const ingestRunEvent = useRunEventStore((s) => s.ingest);

  const handleEvent = useCallback(
    (event: CoreEvent) => {
      ingestGate(event);
      ingestRuntime(event);
      ingestRunEvent(event);
      if (LIFECYCLE_EVENTS.has(event.type)) refresh();
    },
    [ingestGate, ingestRuntime, ingestRunEvent, refresh],
  );

  useEventStream(handleEvent);

  const selectRun = useCallback((id: string) => {
    navigate(`/runs/${encodeURIComponent(id)}`);
  }, [navigate]);

  const onLaunched = useCallback((id: string) => {
    refresh();
    navigate(`/runs/${encodeURIComponent(id)}`);
  }, [navigate, refresh]);

  const selected = runs.find((v) => v.session.id === runId) ?? null;

  const NAV_PANELS: Panel[] = ['runs', 'coverage', 'workflows', 'domain', 'policies', 'rules'];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="h-12 flex items-center justify-between px-4 bg-white border-b shadow-sm">
        <div className="flex items-center gap-3">
          <span className="font-bold text-sm tracking-tight">wicked-studio</span>
          <nav className="flex gap-1">
            {NAV_PANELS.map((p) => (
              <a
                key={p}
                href={panelPath(p)}
                onClick={(e) => { e.preventDefault(); navigate(panelPath(p)); }}
                className={`rounded px-2 py-0.5 text-[11px] font-medium capitalize ${
                  panel === p
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {p}
              </a>
            ))}
          </nav>
        </div>
        <ConnectionStatus />
      </header>

      {panel === 'coverage' ? (
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto p-6">
            <CoverageView />
          </main>
        </div>
      ) : panel === 'workflows' ? (
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto p-6">
            <WorkflowViewer />
          </main>
        </div>
      ) : panel === 'domain' ? (
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto p-6">
            <DomainModelBrowser />
          </main>
        </div>
      ) : panel === 'policies' ? (
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto p-6">
            <PolicyManager />
          </main>
        </div>
      ) : panel === 'rules' ? (
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto p-6">
            <RuleManager />
          </main>
        </div>
      ) : showLaunch ? (
        <div className="flex flex-1 overflow-y-auto p-6">
          <div className="mx-auto w-full max-w-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-800">New run</h2>
              <button
                type="button"
                onClick={() => navigate('/')}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                ← Back to runs
              </button>
            </div>
            <LaunchForm onLaunched={onLaunched} onCancel={() => navigate('/')} />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-80 border-r bg-white flex flex-col">
            <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Runs</p>
              <button
                type="button"
                data-testid="new-run"
                onClick={() => navigate('/runs/new')}
                className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700"
              >
                New run
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <RunList runs={runs} selectedRunId={runId} onSelect={selectRun} />
            </div>
          </aside>

          <main className="flex-1 overflow-y-auto p-6">
            {selected ? (
              <RunDetail key={selected.session.id} view={selected} onRefresh={refresh} />
            ) : (
              <p className="text-sm text-gray-400">Select a run, or launch a new one.</p>
            )}
          </main>
        </div>
      )}

      <GateNotifications onSelect={selectRun} />
    </div>
  );
}
