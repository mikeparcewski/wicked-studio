import { useConnectionStore } from '../store/connection.js';

const statusConfig = {
  connecting: { label: 'Connecting…', className: 'text-yellow-500' },
  connected: { label: 'Connected', className: 'text-green-500' },
  disconnected: { label: 'Disconnected', className: 'text-red-500' },
} as const;

export function ConnectionStatus(): React.ReactElement {
  const status = useConnectionStore((s) => s.status);
  const { label, className } = statusConfig[status];

  return (
    <div
      data-testid="connection-status"
      aria-label={status}
      className={`flex items-center gap-1.5 text-sm font-medium ${className}`}
    >
      <span className="inline-block h-2 w-2 rounded-full bg-current" />
      {label}
    </div>
  );
}
