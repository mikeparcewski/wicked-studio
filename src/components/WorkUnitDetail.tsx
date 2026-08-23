import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { StageKind, UnitStatus, WorkUnit } from '../api/types.js';
import { useGateStore } from '../store/gates.js';
import { useRuntimeStore, outputKey } from '../store/runtime.js';
import { Markdown } from './Markdown.js';
import { RoutingProvenance } from './RoutingProvenance.js';

const STAGE_STYLE: Record<StageKind, { bg: string; color: string }> = {
  recon:   { bg: 'var(--accent-subtle)', color: 'var(--accent)' },
  build:   { bg: 'var(--status-run-dim)',   color: 'var(--status-run)' },
  review:  { bg: 'var(--accent-subtle)', color: 'var(--accent)' },
  test:    { bg: 'var(--status-gate-dim)', color: 'var(--status-gate)' },
};

const UNIT_STATUS_COLOR: Record<UnitStatus, string> = {
  pending:     'var(--ink-dim)',
  distributed: 'var(--accent)',
  done:        'var(--status-run)',
  rejected:    'var(--status-fail)',
};

interface Props {
  runId: string;
  unit: WorkUnit;
  isGated: boolean;
  onResolved?: () => void;
  /** Evidence-reference wiring (slice R): file links in the transcript open the FileViewer. */
  onOpenFile?: (path: string) => void;
}

export function WorkUnitDetail({ runId, unit, isGated, onResolved, onOpenFile }: Props): React.ReactElement {
  const clearGate = useGateStore((s) => s.clearGate);
  const liveOutput = useRuntimeStore((s) => s.outputs[outputKey(runId, unit.ord)]);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [approving, setApproving] = useState(false);
  const autoLoadedRef = useRef(false);

  // Auto-open for both TERMINAL statuses, not just `done`. A rejected unit is the one an
  // operator opens the run to read, and it was the one that stayed shut — so the panel that
  // would have carried the daemon's reason never asked for it (FINDING-006).
  useEffect(() => {
    if ((unit.status !== 'done' && unit.status !== 'rejected') || autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    setShowTranscript(true);
    setLoadingTranscript(true);
    const unitKey = unit.id.startsWith(`${runId}:`) ? unit.id.slice(runId.length + 1) : `u${unit.ord}`;
    void api
      .getUnitOutput(runId, unitKey)
      .then(({ output, outputUnavailable }) => {
        setTranscript(output ?? outputUnavailable ?? liveOutput ?? '(no transcript captured)');
      })
      .catch((err) => {
        setTranscript(liveOutput ?? `(failed to load: ${err instanceof Error ? err.message : String(err)})`);
      })
      .finally(() => setLoadingTranscript(false));
  }, [unit.status, runId, unit.id, unit.ord, liveOutput]);

  async function toggleTranscript(): Promise<void> {
    if (showTranscript) {
      setShowTranscript(false);
      return;
    }
    setShowTranscript(true);
    if (transcript === null) {
      setLoadingTranscript(true);
      try {
        const unitKey = unit.id.startsWith(`${runId}:`) ? unit.id.slice(runId.length + 1) : `u${unit.ord}`;
        // The daemon's `outputUnavailable` outranks the in-memory live scrap: it is a statement
        // about the durable RECORD, and it survives a page reload that the scrap does not.
        const { output, outputUnavailable } = await api.getUnitOutput(runId, unitKey);
        setTranscript(output ?? outputUnavailable ?? liveOutput ?? '(no transcript captured)');
      } catch (err) {
        setTranscript(liveOutput ?? `(failed to load transcript: ${err instanceof Error ? err.message : String(err)})`);
      } finally {
        setLoadingTranscript(false);
      }
    }
  }

  async function approve(): Promise<void> {
    setApproving(true);
    try {
      await api.confirmGate(runId, { approve: true });
      clearGate(runId);
      onResolved?.();
    } finally {
      setApproving(false);
    }
  }

  const stageBadge = STAGE_STYLE[unit.stage] ?? { bg: 'var(--surface-raised)', color: 'var(--ink-muted)' };
  const statusColor = UNIT_STATUS_COLOR[unit.status] ?? 'var(--ink-dim)';

  return (
    <li
      className="rounded-lg p-3"
      style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
      data-testid="work-unit"
      data-ord={unit.ord}
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="w-6 text-center text-xs shrink-0 font-mono" style={{ color: 'var(--ink-dim)' }}>
          #{unit.ord}
        </span>
        <span
          className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase font-mono"
          style={{ background: stageBadge.bg, color: stageBadge.color }}
        >
          {unit.stage}
        </span>
        {(() => {
          const sep = unit.description.indexOf(' — ');
          return sep === -1 ? (
            <span className="flex-1 truncate text-xs" style={{ color: 'var(--ink-muted)' }}>{unit.description}</span>
          ) : (
            <span className="flex-1 min-w-0 flex items-baseline gap-1">
              <span className="text-xs font-medium shrink-0" style={{ color: 'var(--ink-high)' }}>
                {unit.description.slice(0, sep)}
              </span>
              <span className="truncate text-[10px]" style={{ color: 'var(--ink-dim)' }}>
                {unit.description.slice(sep + 3)}
              </span>
            </span>
          );
        })()}
        <span className="text-[11px] font-medium font-mono shrink-0" style={{ color: statusColor }}>
          {unit.status}
        </span>
      </div>

      <div className="mt-1.5 pl-8 flex flex-col gap-0.5">
        {unit.assigned_cli && (
          <p className="text-[11px] font-mono" style={{ color: 'var(--ink-dim)' }}>
            cli: <span style={{ color: 'var(--ink-muted)' }}>{unit.assigned_cli}</span>
          </p>
        )}
        <RoutingProvenance routing={unit.routing} />
        {unit.denial_reason && (
          <p className="text-[11px] font-mono" style={{ color: 'var(--status-fail)' }} data-testid="unit-denial-reason">
            denied: {unit.denial_reason}
          </p>
        )}

        <div className="flex items-center gap-3 mt-1">
          <button
            type="button"
            data-testid="unit-transcript-toggle"
            onClick={() => void toggleTranscript()}
            className="text-[11px] hover:underline font-mono"
            style={{ color: 'var(--accent)' }}
          >
            {showTranscript ? 'Hide transcript' : 'View transcript'}
          </button>
          {isGated && (
            <button
              type="button"
              data-testid="unit-approve"
              onClick={() => void approve()}
              disabled={approving}
              className="rounded px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50"
              style={{ background: 'var(--status-run)', color: 'var(--surface-base)' }}
            >
              Approve this unit
            </button>
          )}
        </div>

        {showTranscript && (
          <div
            data-testid="unit-transcript"
            className="mt-1 max-h-96 overflow-auto rounded-lg p-2 text-[10px] leading-tight"
            style={{ background: 'var(--surface-base)', color: 'var(--ink-high)' }}
          >
            {/* Markdown, matching the run thread's done-unit treatment — so an evidence
                reference in the transcript is a live link into the FileViewer, not a
                dead underline (DES-UX-001 §1.3-4c). */}
            {loadingTranscript
              ? <span className="font-mono">Loading…</span>
              : (
                <Markdown
                  className="whitespace-pre-wrap"
                  {...(onOpenFile !== undefined ? { onOpenFile } : {})}
                >
                  {transcript ?? ''}
                </Markdown>
              )}
          </div>
        )}
      </div>
    </li>
  );
}
