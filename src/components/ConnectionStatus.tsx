import { useConnectionStore } from '../store/connection.js';

const statusConfig = {
  connecting:   { label: 'Connecting…', color: 'var(--status-gate)' },
  connected:    { label: 'Connected',   color: 'var(--status-run)' },
  disconnected: { label: 'Disconnected',color: 'var(--status-fail)' },
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
