import { useGateStore } from '../store/gates.js';

interface Props {
  /** Focus a run when its gate toast is clicked (binds by run id, §11.2). */
  onSelect: (runId: string) => void;
}

/**
 * Toast container for open gates (DES-STUDIO-001 §3.1). Sourced from the gate
 * cache, keyed by run id (was `${sessionId}-${phaseId}`). Each toast surfaces the
 * awaiting run and jumps to it — the full Approve/Reject/Cancel control is the
 * inline SteeringGate in the run detail (§3.2).
 */
export function GateNotifications({ onSelect }: Props): React.ReactElement {
  const gates = useGateStore((s) => s.gates);
  const open = Object.values(gates);

  if (open.length === 0) return <></>;

  return (
    <div
      className="fixed bottom-4 right-4 flex flex-col gap-2 z-50"
      data-testid="gate-notification"
    >
      {open.map((gate) => (
        <button
          key={gate.runId}
          type="button"
          onClick={() => onSelect(gate.runId)}
          data-testid="gate-toast"
          data-run-id={gate.runId}
          className="w-72 rounded-lg border border-yellow-300 bg-white p-3 text-left shadow-lg hover:border-yellow-400"
        >
          <p className="text-xs font-semibold text-yellow-700">Run awaiting human</p>
          <p className="text-[11px] text-gray-400 font-mono">
            {gate.runId.slice(0, 8)} · before unit #{gate.ord}
          </p>
          <p className="mt-1 text-xs text-gray-600 line-clamp-2">{gate.prompt}</p>
          <p className="mt-1 text-[11px] text-blue-600">Review →</p>
        </button>
      ))}
    </div>
  );
}
