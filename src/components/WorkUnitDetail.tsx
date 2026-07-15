import { useState } from 'react';
import { api } from '../api/client.js';
import type { StageKind, UnitStatus, WorkUnit } from '../api/types.js';
import { useGateStore } from '../store/gates.js';
import { useRuntimeStore, outputKey } from '../store/runtime.js';
import { RoutingProvenance } from './RoutingProvenance.js';

const STAGE_STYLE: Record<StageKind, string> = {
  recon: 'bg-blue-100 text-blue-700',
  build: 'bg-green-100 text-green-700',
  review: 'bg-indigo-100 text-indigo-700',
  test: 'bg-amber-100 text-amber-700',
};

const UNIT_STATUS_STYLE: Record<UnitStatus, string> = {
  pending: 'text-gray-400',
  distributed: 'text-blue-600',
  done: 'text-green-600',
  rejected: 'text-red-600',
};

interface Props {
  runId: string;
  unit: WorkUnit;
  /** True when the run is paused before this exact unit (the gated ord). Enables per-unit approve. */
  isGated: boolean;
  /** Called after a per-unit approve resolves. */
  onResolved?: () => void;
}

/**
 * A work-unit row (DES-STUDIO-001 §11.9): ord, stage badge, assigned CLI,
 * status, routing provenance + denial reason, a per-unit approve on the gated
 * unit, and a lazy transcript link.
 */
export function WorkUnitDetail({ runId, unit, isGated, onResolved }: Props): React.ReactElement {
  const clearGate = useGateStore((s) => s.clearGate);
  // Buffered live output for this unit (populated from cliOutputDelta while connected).
  const liveOutput = useRuntimeStore((s) => s.outputs[outputKey(runId, unit.ord)]);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [approving, setApproving] = useState(false);

  async function toggleTranscript(): Promise<void> {
    if (showTranscript) {
      setShowTranscript(false);
      return;
    }
    setShowTranscript(true);
    if (transcript === null) {
      setLoadingTranscript(true);
      try {
        // unit.id is `<session>:<phase_id>` for workflow runs, `<session>:u<ord>` for free-text.
        // unitKey is the REST path suffix (e.g. "survey" or "u1") used in GET /units/:unitKey/output.
        const unitKey = unit.id.startsWith(`${runId}:`) ? unit.id.slice(runId.length + 1) : `u${unit.ord}`;
        const { output } = await api.getUnitOutput(runId, unitKey);
        // If REST returns null (e.g. unit still executing or id mismatch), use the buffered
        // live output that arrived via cliOutputDelta events while connected.
        setTranscript(output ?? liveOutput ?? '(no transcript captured)');
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

  return (
    <li className="rounded border border-gray-200 p-2" data-testid="work-unit" data-ord={unit.ord}>
      <div className="flex items-center gap-2 text-sm">
        <span className="w-6 text-center text-xs text-gray-400 shrink-0">#{unit.ord}</span>
        <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${STAGE_STYLE[unit.stage] ?? 'bg-gray-100 text-gray-600'}`}>
          {unit.stage}
        </span>
        {/* For workflow runs, description is "<phase> — <problem>". Show the phase label
            prominently; the problem suffix is identical across all units and adds no signal. */}
        {(() => {
          const sep = unit.description.indexOf(' — ');
          return sep === -1 ? (
            <span className="flex-1 truncate text-xs text-gray-700">{unit.description}</span>
          ) : (
            <span className="flex-1 min-w-0 flex items-baseline gap-1">
              <span className="text-xs font-medium text-gray-800 shrink-0">
                {unit.description.slice(0, sep)}
              </span>
              <span className="truncate text-[10px] text-gray-400">
                {unit.description.slice(sep + 3)}
              </span>
            </span>
          );
        })()}
        <span className={`text-[11px] font-medium ${UNIT_STATUS_STYLE[unit.status] ?? 'text-gray-500'}`}>
          {unit.status}
        </span>
      </div>

      <div className="mt-1 pl-8 flex flex-col gap-0.5">
        {unit.assigned_cli && (
          <p className="text-[11px] text-gray-500">
            CLI: <span className="font-mono">{unit.assigned_cli}</span>
          </p>
        )}
        <RoutingProvenance routing={unit.routing} />
        {unit.denial_reason && (
          <p className="text-[11px] text-red-600" data-testid="unit-denial-reason">
            Denied: {unit.denial_reason}
          </p>
        )}

        <div className="flex items-center gap-3 mt-1">
          <button
            type="button"
            data-testid="unit-transcript-toggle"
            onClick={() => void toggleTranscript()}
            className="text-[11px] text-blue-600 hover:underline"
          >
            {showTranscript ? 'Hide transcript' : 'View transcript'}
          </button>
          {isGated && (
            <button
              type="button"
              data-testid="unit-approve"
              onClick={() => void approve()}
              disabled={approving}
              className="rounded bg-green-600 px-2 py-0.5 text-[11px] text-white hover:bg-green-700 disabled:opacity-50"
            >
              Approve this unit
            </button>
          )}
        </div>

        {showTranscript && (
          <pre
            data-testid="unit-transcript"
            className="mt-1 max-h-48 overflow-auto rounded bg-gray-900 p-2 text-[10px] leading-tight text-gray-100 whitespace-pre-wrap"
          >
            {loadingTranscript ? 'Loading…' : transcript}
          </pre>
        )}
      </div>
    </li>
  );
}
