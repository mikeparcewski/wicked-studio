import { useState } from 'react';
import { api } from '../api/client.js';
import { useGateStore, type PendingGate } from '../store/gates.js';

interface Props {
  gate: PendingGate;
}

export function GatePanel({ gate }: Props): React.ReactElement {
  const removeGate = useGateStore((s) => s.removeGate);
  const [conditions, setConditions] = useState('');
  const [showConditions, setShowConditions] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleApprove(): Promise<void> {
    setLoading(true);
    try {
      await api.approveGate(gate.sessionId, gate.phaseId);
      removeGate(gate.sessionId, gate.phaseId);
    } finally {
      setLoading(false);
    }
  }

  async function handleReject(): Promise<void> {
    setLoading(true);
    try {
      await api.rejectGate(gate.sessionId, gate.phaseId);
      removeGate(gate.sessionId, gate.phaseId);
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveWithConditions(): Promise<void> {
    if (!conditions.trim()) return;
    setLoading(true);
    try {
      await api.approveWithConditions(gate.sessionId, gate.phaseId, conditions);
      removeGate(gate.sessionId, gate.phaseId);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="rounded-lg border border-yellow-300 bg-white p-4 shadow-lg w-80"
      data-testid="gate-panel"
    >
      <p className="font-semibold text-sm mb-1">Gate awaiting approval</p>
      <p className="text-xs text-gray-500 mb-3">
        Phase: <span className="font-mono">{gate.phaseId}</span>
      </p>

      {showConditions && (
        <textarea
          className="w-full rounded border p-2 text-xs mb-2 resize-none"
          rows={3}
          placeholder="Describe the conditions for approval…"
          value={conditions}
          onChange={(e) => setConditions(e.target.value)}
        />
      )}

      <div className="flex gap-2 flex-wrap">
        <button
          data-testid="gate-panel-approve"
          onClick={() => void handleApprove()}
          disabled={loading}
          className="flex-1 rounded bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700 disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={() => setShowConditions((v) => !v)}
          disabled={loading}
          className="flex-1 rounded bg-amber-500 px-3 py-1.5 text-xs text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {showConditions ? 'Submit conditions' : 'Modify with conditions'}
        </button>
        <button
          onClick={() => (showConditions ? void handleApproveWithConditions() : void handleReject())}
          disabled={loading}
          className="flex-1 rounded bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700 disabled:opacity-50"
        >
          {showConditions ? 'Apply' : 'Reject'}
        </button>
      </div>
    </div>
  );
}
