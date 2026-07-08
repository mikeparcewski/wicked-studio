import type { SessionView } from '../api/types.js';
import type { LoggedEvent } from '../store/runtime.js';

interface Props {
  view: SessionView;
  /** The run's event log — the source of the halt reason (`error` frame), real data only. */
  log: LoggedEvent[];
}

/**
 * The run-halted explainer (DES-STUDIO-001 §11.5). Shown only for terminal-bad
 * runs (failed / cancelled). The halt reason comes from the `error` CoreEvent in
 * the run's log (core exposes no failure field on `AgentSession`), plus any
 * per-unit denial reasons — never fabricated.
 */
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
        className="rounded border border-gray-300 bg-gray-50 p-3 text-xs text-gray-600"
      >
        Run cancelled.
      </div>
    );
  }

  return (
    <div
      data-testid="failure-banner"
      data-kind="failed"
      className="rounded border border-red-300 bg-red-50 p-3 text-xs text-red-700"
    >
      <p className="font-semibold">Run halted.</p>
      {lastError && <p className="mt-1">{lastError.detail}</p>}
      {denied.length > 0 && (
        <ul className="mt-1 list-disc pl-4">
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
