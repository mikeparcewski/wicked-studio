import { useConnectionStore } from '../store/connection.js';

const statusConfig = {
  connecting:   { label: 'Connecting…', color: '#ffda19' },
  connected:    { label: 'Connected',   color: '#3fb950' },
  disconnected: { label: 'Disconnected',color: '#f85149' },
} as const;

export function ConnectionStatus(): React.ReactElement {
  const status = useConnectionStore((s) => s.status);
  const { label, color } = statusConfig[status];

  return (
    <div
      data-testid="connection-status"
      aria-label={status}
      className="flex items-center gap-1.5 text-xs font-mono"
      style={{ color }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </div>
  );
}
