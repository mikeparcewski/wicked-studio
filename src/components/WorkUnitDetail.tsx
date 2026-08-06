import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { StageKind, UnitStatus, WorkUnit } from '../api/types.js';
import { useGateStore } from '../store/gates.js';
import { useRuntimeStore, outputKey } from '../store/runtime.js';
import { RoutingProvenance } from './RoutingProvenance.js';

const STAGE_STYLE: Record<StageKind, { bg: string; color: string }> = {
  recon:   { bg: 'rgba(121,192,255,0.12)', color: '#79c0ff' },
  build:   { bg: 'rgba(63,185,80,0.12)',   color: '#3fb950' },
  review:  { bg: 'rgba(167,139,250,0.12)', color: '#a78bfa' },
  test:    { bg: 'rgba(255,218,25,0.12)',  color: '#ffda19' },
};

const UNIT_STATUS_COLOR: Record<UnitStatus, string> = {
  pending:     'rgba(230,237,243,0.3)',
  distributed: '#79c0ff',
  done:        '#3fb950',
  rejected:    '#f85149',
};

interface Props {
  runId: string;
  unit: WorkUnit;
  isGated: boolean;
  onResolved?: () => void;
}

export function WorkUnitDetail({ runId, unit, isGated, onResolved }: Props): React.ReactElement {
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

  const stageBadge = STAGE_STYLE[unit.stage] ?? { bg: 'rgba(230,237,243,0.06)', color: 'rgba(230,237,243,0.5)' };
  const statusColor = UNIT_STATUS_COLOR[unit.status] ?? 'rgba(230,237,243,0.4)';

  return (
    <li
      className="rounded-lg p-3"
      style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.07)' }}
      data-testid="work-unit"
      data-ord={unit.ord}
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="w-6 text-center text-xs shrink-0 font-mono" style={{ color: 'rgba(230,237,243,0.3)' }}>
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
            <span className="flex-1 truncate text-xs" style={{ color: 'rgba(230,237,243,0.7)' }}>{unit.description}</span>
          ) : (
            <span className="flex-1 min-w-0 flex items-baseline gap-1">
              <span className="text-xs font-medium shrink-0" style={{ color: '#e6edf3' }}>
                {unit.description.slice(0, sep)}
              </span>
              <span className="truncate text-[10px]" style={{ color: 'rgba(230,237,243,0.4)' }}>
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
          <p className="text-[11px] font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
            cli: <span style={{ color: 'rgba(230,237,243,0.65)' }}>{unit.assigned_cli}</span>
          </p>
        )}
        <RoutingProvenance routing={unit.routing} />
        {unit.denial_reason && (
          <p className="text-[11px] font-mono" style={{ color: '#f85149' }} data-testid="unit-denial-reason">
            denied: {unit.denial_reason}
          </p>
        )}

        <div className="flex items-center gap-3 mt-1">
          <button
            type="button"
            data-testid="unit-transcript-toggle"
            onClick={() => void toggleTranscript()}
            className="text-[11px] hover:underline font-mono"
            style={{ color: '#79c0ff' }}
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
              style={{ background: '#3fb950', color: '#0d1117' }}
            >
              Approve this unit
            </button>
          )}
        </div>

        {showTranscript && (
          <pre
            data-testid="unit-transcript"
            className="mt-1 max-h-96 overflow-auto rounded-lg p-2 text-[10px] leading-tight whitespace-pre-wrap font-mono"
            style={{ background: '#0d1117', color: '#e6edf3' }}
          >
            {loadingTranscript ? 'Loading…' : transcript}
          </pre>
        )}
      </div>
    </li>
  );
}
