import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { WorkflowDef, PhaseDef, GateSpec } from '../api/types.js';

function gateLabel(gate: GateSpec): string {
  if (gate === 'auto') return 'Auto';
  if (gate && typeof gate === 'object' && 'human_confirm' in gate) {
    return gate.human_confirm.unconditional ? 'Human (unconditional)' : 'Human';
  }
  return 'Human if not PASS';
}

function roleChip(role: PhaseDef['role']): React.ReactElement | null {
  if (role === 'neutral') return null;
  const styles: Record<string, string> = {
    creator: 'bg-blue-100 text-blue-800',
    evaluator: 'bg-purple-100 text-purple-800',
  };
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${styles[role]}`}>
      {role}
    </span>
  );
}

function kindDot(kind: PhaseDef['kind']): string {
  const colors: Record<string, string> = { recon: 'bg-gray-400', build: 'bg-blue-500', review: 'bg-purple-500', test: 'bg-green-500' };
  return colors[kind] ?? 'bg-gray-300';
}

function PhaseCard({ phase }: { phase: PhaseDef }): React.ReactElement {
  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-[11px] flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full shrink-0 ${kindDot(phase.kind)}`} title={phase.kind} />
        <span className="font-semibold text-gray-800">{phase.id}</span>
        <span className="text-gray-400 text-[10px]">{phase.kind}</span>
        {roleChip(phase.role)}
        {phase.executes_code && <span className="text-blue-500 text-[10px]">⟨code⟩</span>}
        {phase.verified_evidence && <span className="text-green-600 text-[10px]">verified</span>}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-gray-500">
        <span>
          <span className="font-medium text-gray-600">gate:</span>{' '}
          {phase.gate_type ? `${phase.gate_type} / ` : ''}{gateLabel(phase.gate)}
        </span>
        {phase.skill_ref && (
          <span>
            <span className="font-medium text-gray-600">skill:</span>{' '}
            <span className="font-mono">{phase.skill_ref}</span>
          </span>
        )}
        {phase.depends_on.length > 0 && (
          <span>
            <span className="font-medium text-gray-600">after:</span>{' '}
            <span className="font-mono">{phase.depends_on.join(', ')}</span>
          </span>
        )}
        {phase.validator_pin && (
          <span className="text-yellow-600">
            <span className="font-medium">pin:</span> {phase.validator_pin.slice(0, 8)}…
          </span>
        )}
      </div>
    </div>
  );
}

function WorkflowCard({ wf, selected, onSelect }: { wf: WorkflowDef; selected: boolean; onSelect: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded border px-3 py-2 text-[11px] transition-colors ${
        selected ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      <span className="font-semibold">{wf.id}</span>
      <span className="ml-2 text-gray-400">{wf.phases.length} phases</span>
    </button>
  );
}

/**
 * FR: Workflow viewer (crew#44). Lists registered workflow definitions and renders
 * each as an ordered phase ladder with gate specs, roles, and dependency info.
 */
export function WorkflowViewer(): React.ReactElement {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { workflows: wfs } = await api.listWorkflows();
      setWorkflows(wfs);
      if (wfs.length > 0 && !selected) setSelected(wfs[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="text-xs text-gray-400">Loading workflows…</p>;
  if (error) return <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>;

  const current = workflows.find((w) => w.id === selected) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">Workflows</h2>
        <button
          type="button"
          onClick={() => void load()}
          className="text-[10px] text-gray-400 hover:text-gray-700 underline"
        >
          Refresh
        </button>
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col gap-1.5 w-36 shrink-0">
          {workflows.map((w) => (
            <WorkflowCard
              key={w.id}
              wf={w}
              selected={w.id === selected}
              onSelect={() => setSelected(w.id)}
            />
          ))}
        </div>

        {current && (
          <div className="flex-1 flex flex-col gap-2 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {current.id}
              </span>
              <span className="text-[10px] text-gray-400">— {current.phases.length} phases</span>
            </div>
            {current.phases.map((p) => (
              <PhaseCard key={p.id} phase={p} />
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] text-gray-300">
        Built-in workflows: feature / bug / migration. Drop-in workflows loaded from{' '}
        <span className="font-mono">workflows/</span> appear here after restart.
      </p>
    </div>
  );
}
