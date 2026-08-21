import { useGateStore } from '../store/gates.js';

interface Props {
  onSelect: (runId: string) => void;
  /** When set, only show the gate toast for this run (fixes studio#10). */
  runId?: string | null;
}

export function GateNotifications({ onSelect, runId }: Props): React.ReactElement {
  const gates = useGateStore((s) => s.gates);
  const all = Object.values(gates);
  const open = runId ? all.filter((g) => g.runId === runId) : all;

  if (open.length === 0) return <></>;

  return (
    <div
      className="fixed bottom-4 right-4 flex flex-col gap-2 z-50"
      data-testid="gate-notification"
      style={{ pointerEvents: 'none' }}
    >
      {open.map((gate) => (
        <button
          key={gate.runId}
          type="button"
          onClick={() => onSelect(gate.runId)}
          data-testid="gate-toast"
          data-run-id={gate.runId}
          className="w-72 rounded-xl p-3 text-left transition-all"
          style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--status-gate-dim)',
            boxShadow: 'var(--shadow-overlay)',
            pointerEvents: 'auto',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--status-gate)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--status-gate-dim)'; }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--status-gate)' }} />
            <p className="text-xs font-semibold" style={{ color: 'var(--status-gate)' }}>Run awaiting human</p>
          </div>
          <p className="text-[11px] font-mono" style={{ color: 'var(--ink-dim)' }}>
            {gate.runId.slice(0, 8)} · before unit #{gate.ord}
          </p>
          {gate.prompt && (
            <p className="mt-1 text-xs line-clamp-2" style={{ color: 'var(--ink-muted)' }}>{gate.prompt}</p>
          )}
          <p className="mt-1.5 text-[11px] font-mono" style={{ color: 'var(--accent)' }}>Review →</p>
        </button>
      ))}
    </div>
  );
}
