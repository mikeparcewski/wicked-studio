import type { SessionView } from '../api/types.js';
import { useRunRawEvents } from '../hooks/useRunRawEvents.js';
import { leaveRoute, type Navigate } from '../hooks/useRoute.js';
import { FileViewer } from './FileViewer.js';
import { runTitle } from './runIdentity.js';

/**
 * The raw routes (studio wave 1, "raw in one step"): `/runs/:id/events` shows the run's
 * event trail as JSON; `/runs/:id/files` opens the existing worktree/diff viewer. Both are
 * reached from the palette for any run; closing either goes Back to where the operator was.
 * Presentational: the data is `useRunRawEvents`, the targets are `palette/runTargets`.
 */
export function RunRawView({ target, runId, run, navigate }: {
  target: 'events' | 'files';
  runId: string;
  run: SessionView | null;
  navigate: Navigate;
}): React.ReactElement {
  const title = run !== null ? runTitle(run.session) : runId;
  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid={`run-raw-${target}`} data-run-id={runId}>
      <header
        className="flex items-center gap-3 px-6 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--surface-raised)', background: 'var(--surface-card)' }}
      >
        <button
          type="button"
          data-testid="run-raw-back"
          onClick={() => leaveRoute(navigate)}
          aria-label="Back"
          style={{ color: 'var(--ink-dim)', background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          ←
        </button>
        <p className="flex-1 truncate" style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--ink-high)' }} title={title}>
          {target === 'events' ? 'Raw events' : 'Worktree / files'} · {title}
        </p>
      </header>
      {target === 'events' ? (
        <RawEvents runId={runId} />
      ) : (
        <FileViewer
          runId={runId}
          defaultTab="diff"
          base="merge-base"
          onClose={() => leaveRoute(navigate)}
          onUnsupported={() => leaveRoute(navigate)}
        />
      )}
    </div>
  );
}

function RawEvents({ runId }: { runId: string }): React.ReactElement {
  const st = useRunRawEvents(runId);
  const mono: React.CSSProperties = { fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', margin: 0 };
  if (st.state === 'loading') {
    return <p className="px-6 py-3" style={{ ...mono, color: 'var(--ink-dim)' }}>Loading events…</p>;
  }
  if (st.state === 'error') {
    return (
      <p role="alert" data-testid="raw-events-error" className="px-6 py-3" style={{ ...mono, color: 'var(--status-fail)' }}>
        Could not read the event trail: {st.message}
      </p>
    );
  }
  return (
    <pre
      data-testid="raw-events"
      data-count={st.events.length}
      className="flex-1 overflow-auto px-6 py-3"
      style={{ ...mono, color: 'var(--ink-body)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
    >
      {JSON.stringify(st.events, null, 2)}
    </pre>
  );
}
