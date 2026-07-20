import { useGateStore } from '../store/gates.js';

interface Props {
  onSelect: (runId: string) => void;
}

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
          className="w-72 rounded-xl p-3 text-left transition-all"
          style={{
            background: '#1b222e',
            border: '1px solid rgba(255,218,25,0.35)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(255,218,25,0.55)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,218,25,0.35)'; }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#ffda19' }} />
            <p className="text-xs font-semibold" style={{ color: '#ffda19' }}>Run awaiting human</p>
          </div>
          <p className="text-[11px] font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
            {gate.runId.slice(0, 8)} · before unit #{gate.ord}
          </p>
          {gate.prompt && (
            <p className="mt-1 text-xs line-clamp-2" style={{ color: 'rgba(230,237,243,0.6)' }}>{gate.prompt}</p>
          )}
          <p className="mt-1.5 text-[11px] font-mono" style={{ color: '#79c0ff' }}>Review →</p>
        </button>
      ))}
    </div>
  );
}
