import { useCallback, useEffect } from 'react';
import { CoverageView } from './components/CoverageView.js';
import { DomainModelBrowser } from './components/DomainModelBrowser.js';
import { GateNotifications } from './components/GateNotifications.js';
import { LeftSidebar } from './components/LeftSidebar.js';
import { PolicyManager } from './components/PolicyManager.js';
import { RepositoriesPanel } from './components/RepositoriesPanel.js';
import { RightPanel } from './components/RightPanel.js';
import { RuleManager } from './components/RuleManager.js';
import { ChatPanel } from './components/ChatPanel.js';
import { WorkflowViewer } from './components/WorkflowViewer.js';
import { useEventStream } from './hooks/useEventStream.js';
import { useRoute } from './hooks/useRoute.js';
import { useRuns } from './hooks/useRuns.js';
import { useGateStore } from './store/gates.js';
import { useRuntimeStore } from './store/runtime.js';
import { useRunEventStore } from './store/events.js';
import type { CoreEvent } from './api/types.js';
import { api } from './api/client.js';

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

/**
 * Ctrl+K keyboard shortcut — kill the selected run when it is not in a terminal state.
 * Wired here (global handler) so it works regardless of which panel has focus.
 */
function useKillShortcut(
  runId: string | null,
  runs: { session: { id: string; status: string } }[],
  onKill: (id: string) => Promise<void>,
): void {
  useEffect(() => {
    if (!runId) return;
    function handler(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k' && runId) {
        const tag = (e.target as HTMLElement).tagName.toLowerCase();
        const editable = (e.target as HTMLElement).isContentEditable;
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || editable) return;
        const run = runs.find((r) => r.session.id === runId);
        if (!run) return;
        const terminal = ['completed', 'cancelled', 'failed'].includes(run.session.status);
        if (!terminal) {
          e.preventDefault();
          void onKill(runId);
        }
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [runId, runs, onKill]);
}

export function App(): React.ReactElement {
  const { panel, runId, navigate } = useRoute();
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

  const selectRun = useCallback(
    (id: string) => navigate(`/runs/${encodeURIComponent(id)}`),
    [navigate],
  );

  const onLaunched = useCallback(
    (id: string) => {
      refresh();
      navigate(`/runs/${encodeURIComponent(id)}`);
    },
    [navigate, refresh],
  );

  const onNavigateBack = useCallback(() => navigate('/'), [navigate]);

  const onKill = useCallback(
    async (id: string) => {
      try {
        await api.cancelRun(id);
        refresh();
      } catch {
        // surface kill errors only in RightPanel; fail silently from the shortcut
      }
    },
    [refresh],
  );

  useKillShortcut(runId, runs, onKill);

  const selected = runs.find((v) => v.session.id === runId) ?? null;

  // Center panel content based on route
  function renderCenter(): React.ReactElement {
    if (panel === 'coverage') {
      return (
        <div className="flex-1 overflow-y-auto p-6 bg-white">
          <CoverageView />
        </div>
      );
    }
    if (panel === 'workflows') {
      return (
        <div className="flex-1 overflow-y-auto p-6 bg-white">
          <WorkflowViewer />
        </div>
      );
    }
    if (panel === 'domain') {
      return (
        <div className="flex-1 overflow-y-auto p-6 bg-white">
          <DomainModelBrowser />
        </div>
      );
    }
    if (panel === 'policies') {
      return (
        <div className="flex-1 overflow-y-auto p-6 bg-white">
          <PolicyManager />
        </div>
      );
    }
    if (panel === 'rules') {
      return (
        <div className="flex-1 overflow-y-auto p-6 bg-white">
          <RuleManager />
        </div>
      );
    }
    if (panel === 'repos') {
      return (
        <div className="flex-1 overflow-hidden bg-white">
          <RepositoriesPanel onSelectRun={selectRun} />
        </div>
      );
    }
    // Default: runs / chat panel
    return (
      <div className="flex-1 overflow-hidden bg-white">
        <ChatPanel
          view={selected}
          onLaunched={onLaunched}
          onNavigateBack={onNavigateBack}
          onRefresh={refresh}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-900">
      <LeftSidebar
        runs={runs}
        selectedRunId={runId}
        onSelectRun={selectRun}
        navigate={navigate}
      />

      <div className="flex flex-1 overflow-hidden">
        {renderCenter()}
      </div>

      {/* Right panel only when a run is selected */}
      {selected !== null && (
        <RightPanel
          view={selected}
          onRefresh={refresh}
        />
      )}

      {/* Gate toasts — always mounted, renders above everything */}
      <GateNotifications onSelect={selectRun} />
    </div>
  );
}
