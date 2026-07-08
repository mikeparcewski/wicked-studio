import { useState } from 'react';
import { api } from '../api/client.js';
import type { StageKind, UnitStatus, WorkUnit } from '../api/types.js';
import { useGateStore } from '../store/gates.js';
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
        const { output } = await api.getUnitOutput(runId, unit.ord);
        setTranscript(output ?? '(no transcript captured)');
      } catch (err) {
        setTranscript(`(failed to load transcript: ${err instanceof Error ? err.message : String(err)})`);
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
        <span className="flex-1 truncate text-xs text-gray-700">{unit.description}</span>
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
