import type { SessionView } from '../api/types.js';
import type { LoggedEvent } from '../store/runtime.js';

interface Props {
  view: SessionView;
  log: LoggedEvent[];
}

export function FailureBanner({ view, log }: Props): React.ReactElement | null {
  const { status } = view.session;
  if (status !== 'failed' && status !== 'cancelled') return null;

  const lastError = [...log].reverse().find((e) => e.type === 'error');
  const denied = view.units.filter((u) => u.denial_reason || u.status === 'rejected');

  if (status === 'cancelled') {
    return (
      <div
        data-testid="failure-banner"
        data-kind="cancelled"
        className="rounded-lg p-3 text-xs font-mono"
        style={{
          background: 'rgba(230,237,243,0.04)',
          border: '1px solid rgba(230,237,243,0.1)',
          color: 'rgba(230,237,243,0.5)',
        }}
      >
        Run cancelled.
      </div>
    );
  }

  return (
    <div
      data-testid="failure-banner"
      data-kind="failed"
      className="rounded-lg p-3 text-xs font-mono"
      style={{
        background: 'rgba(248,81,73,0.08)',
        border: '1px solid rgba(248,81,73,0.25)',
        color: '#f85149',
      }}
    >
      <p className="font-semibold">Run halted.</p>
      {lastError && <p className="mt-1" style={{ color: 'rgba(230,237,243,0.65)' }}>{lastError.detail}</p>}
      {denied.length > 0 && (
        <ul className="mt-1 list-disc pl-4" style={{ color: 'rgba(230,237,243,0.55)' }}>
          {denied.map((u) => (
            <li key={u.id}>
              Unit #{u.ord}: {u.denial_reason ?? 'rejected'}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
