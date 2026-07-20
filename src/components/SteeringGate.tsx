import { useState } from 'react';
import { api, type GateDecision } from '../api/client.js';
import { useGateStore } from '../store/gates.js';
import { useSteeringStore, type SteeringAction } from '../store/steering.js';

interface Props {
  runId: string;
  ord?: number;
  prompt?: string;
  onResolved?: () => void;
}

export function SteeringGate({ runId, ord, prompt, onResolved }: Props): React.ReactElement {
  const clearGate = useGateStore((s) => s.clearGate);
  const recordSteering = useSteeringStore((s) => s.record);
  const [amend, setAmend] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(
    action: () => Promise<unknown>,
    intervention: { kind: SteeringAction; amend?: string },
  ): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      await action();
      recordSteering({
        runId,
        action: intervention.kind,
        ...(typeof ord === 'number' ? { ord } : {}),
        ...(intervention.amend !== undefined ? { amend: intervention.amend } : {}),
      });
      clearGate(runId);
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const approve = (): Promise<void> =>
    run(() => api.confirmGate(runId, { approve: true }), { kind: 'approve' });

  const approveWithSteer = (): Promise<void> => {
    const text = amend.trim();
    if (!text) return Promise.resolve();
    const decision: GateDecision = { approve: true, amend: text };
    return run(() => api.confirmGate(runId, decision), { kind: 'approve-with-steer', amend: text });
  };

  const reject = (): Promise<void> =>
    run(() => api.confirmGate(runId, { approve: false }), { kind: 'reject' });
  const cancel = (): Promise<void> => run(() => api.cancelRun(runId), { kind: 'cancel' });

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: '#161c26',
        border: '1px solid rgba(255,218,25,0.3)',
        boxShadow: '0 0 0 1px rgba(255,218,25,0.08)',
      }}
      data-testid="steering-gate"
      data-run-id={runId}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#ffda19' }} />
        <p className="font-semibold text-sm font-mono" style={{ color: '#ffda19' }}>
          Awaiting human decision
        </p>
      </div>
      <p className="text-xs font-mono mb-3" style={{ color: 'rgba(230,237,243,0.4)' }}>
        run {runId.slice(0, 8)}
        {typeof ord === 'number' ? ` · before unit #${ord}` : ''}
      </p>
      <p
        className="text-xs mb-4 whitespace-pre-wrap leading-relaxed font-mono"
        style={{ color: 'rgba(230,237,243,0.75)' }}
        data-testid="steering-prompt"
      >
        {prompt ?? 'Prompt unavailable (daemon restarted) — you can still approve, reject, or cancel.'}
      </p>

      <textarea
        data-testid="steering-amend"
        className="w-full rounded-lg p-2 text-xs mb-3 resize-none font-mono"
        style={{
          background: '#0f1419',
          border: '1px solid rgba(230,237,243,0.14)',
          color: '#e6edf3',
          outline: 'none',
        }}
        rows={2}
        placeholder="Optional steer / amend — sent with Approve with steer to guide the next unit"
        value={amend}
        onChange={(e) => setAmend(e.target.value)}
        disabled={loading}
      />

      {error && (
        <p className="text-xs mb-3 font-mono" style={{ color: '#f85149' }} data-testid="steering-error">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          data-testid="steering-approve"
          onClick={() => void approve()}
          disabled={loading}
          className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
          style={{ background: '#3fb950', color: '#0d1117' }}
        >
          Approve
        </button>
        <button
          data-testid="steering-approve-steer"
          onClick={() => void approveWithSteer()}
          disabled={loading || !amend.trim()}
          className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
          style={{ background: '#ffda19', color: '#0d1117' }}
        >
          Approve with steer
        </button>
        <button
          data-testid="steering-reject"
          onClick={() => void reject()}
          disabled={loading}
          className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
          style={{ background: 'rgba(248,81,73,0.15)', border: '1px solid rgba(248,81,73,0.3)', color: '#f85149' }}
        >
          Reject
        </button>
        <button
          data-testid="steering-cancel"
          onClick={() => void cancel()}
          disabled={loading}
          className="rounded-lg px-3 py-2 text-xs font-mono disabled:opacity-50 transition-opacity"
          style={{ background: 'rgba(230,237,243,0.06)', border: '1px solid rgba(230,237,243,0.1)', color: 'rgba(230,237,243,0.55)' }}
        >
          Cancel run
        </button>
      </div>
    </div>
  );
}
