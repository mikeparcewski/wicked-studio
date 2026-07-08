import { useState } from 'react';
import { api, type GateDecision } from '../api/client.js';
import { useGateStore } from '../store/gates.js';

interface Props {
  /** The run this gate belongs to. ALL actions bind to this id, never a list index (§11.2). */
  runId: string;
  /** The unit ord the run paused before (from the awaitingHuman event / gate cache). */
  ord?: number;
  /** The gate prompt. Absent after a daemon restart (prompt not persisted) — actions still work. */
  prompt?: string;
  /** Called after any action resolves (the run leaves `awaiting_human`). */
  onResolved?: () => void;
}

/**
 * The steering gate — the load-bearing HITL control (DES-STUDIO-001 §3.2,
 * DES-CAMPAIGN-001 §11.1). Four distinct actions, all bound to `runId`:
 *  - Approve            -> POST /runs/:id/gate {approve:true}
 *  - Approve with steer  -> POST /runs/:id/gate {approve:true, amend:<text>}  (steers the next unit)
 *  - Reject             -> POST /runs/:id/gate {approve:false}                (cancels the run)
 *  - Cancel run          -> POST /runs/:id/cancel                             (distinct third action)
 */
export function SteeringGate({ runId, ord, prompt, onResolved }: Props): React.ReactElement {
  const clearGate = useGateStore((s) => s.clearGate);
  const [amend, setAmend] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      await action();
      clearGate(runId);
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const approve = (): Promise<void> => run(() => api.confirmGate(runId, { approve: true }));

  const approveWithSteer = (): Promise<void> => {
    const text = amend.trim();
    if (!text) return Promise.resolve();
    const decision: GateDecision = { approve: true, amend: text };
    return run(() => api.confirmGate(runId, decision));
  };

  const reject = (): Promise<void> => run(() => api.confirmGate(runId, { approve: false }));
  const cancel = (): Promise<void> => run(() => api.cancelRun(runId));

  return (
    <div
      className="rounded-lg border border-yellow-300 bg-white p-4 shadow-lg"
      data-testid="steering-gate"
      data-run-id={runId}
    >
      <p className="font-semibold text-sm mb-1">Awaiting human decision</p>
      <p className="text-xs text-gray-400 font-mono mb-2">
        run {runId.slice(0, 8)}
        {typeof ord === 'number' ? ` · before unit #${ord}` : ''}
      </p>
      <p className="text-xs text-gray-600 mb-3 whitespace-pre-wrap" data-testid="steering-prompt">
        {prompt ?? 'Prompt unavailable (daemon restarted) — you can still approve, reject, or cancel.'}
      </p>

      <textarea
        data-testid="steering-amend"
        className="w-full rounded border p-2 text-xs mb-2 resize-none"
        rows={2}
        placeholder="Optional steer / amend — sent with Approve with steer to guide the next unit"
        value={amend}
        onChange={(e) => setAmend(e.target.value)}
        disabled={loading}
      />

      {error && (
        <p className="text-xs text-red-600 mb-2" data-testid="steering-error">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          data-testid="steering-approve"
          onClick={() => void approve()}
          disabled={loading}
          className="rounded bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700 disabled:opacity-50"
        >
          Approve
        </button>
        <button
          data-testid="steering-approve-steer"
          onClick={() => void approveWithSteer()}
          disabled={loading || !amend.trim()}
          className="rounded bg-amber-500 px-3 py-1.5 text-xs text-white hover:bg-amber-600 disabled:opacity-50"
        >
          Approve with steer
        </button>
        <button
          data-testid="steering-reject"
          onClick={() => void reject()}
          disabled={loading}
          className="rounded bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700 disabled:opacity-50"
        >
          Reject
        </button>
        <button
          data-testid="steering-cancel"
          onClick={() => void cancel()}
          disabled={loading}
          className="rounded bg-gray-700 px-3 py-1.5 text-xs text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Cancel run
        </button>
      </div>
    </div>
  );
}
