import { useConnectionStore } from '../store/connection.js';

/**
 * The lost-connection banner (crew#551). Studio is served by the wicked-crew daemon, so
 * when the socket drops the most likely cause is that the daemon is gone (a reboot, a
 * crash), and the only fix is on the operator's machine. The banner names that fix in
 * the same words `wicked-crew status` prints, and stays up until the socket reconnects
 * (useEventStream retries every 3 s). Nothing renders while connecting or connected:
 * the health rail's pill already reports those.
 */
export const START_DAEMON_COMMAND = 'wicked-crew serve';
export const INSTALL_SERVICE_COMMAND = 'wicked-crew serve --install-service';

export function ConnectionStatus(): React.ReactElement | null {
  const status = useConnectionStore((s) => s.status);
  if (status !== 'disconnected') return null;

  return (
    <div
      data-testid="connection-status"
      aria-label={status}
      role="alert"
      style={{
        position: 'fixed',
        top: 'var(--space-3)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        maxWidth: 'min(720px, calc(100vw - 32px))',
        padding: 'var(--space-2) var(--space-4)',
        borderRadius: 6,
        border: '1px solid var(--status-fail)',
        background: 'var(--surface-card)',
        color: 'var(--status-fail)',
        fontSize: 'var(--text-xs)',
        lineHeight: 1.5,
        boxShadow: 'var(--shadow-overlay)',
      }}
    >
      <strong>Lost the connection to the wicked-crew daemon</strong> — reconnecting.{' '}
      <span data-testid="connection-remedy">
        If it is not running, start it with <code>{START_DAEMON_COMMAND}</code> (or at every login:{' '}
        <code>{INSTALL_SERVICE_COMMAND}</code>); <code>wicked-crew status</code> says which.
      </span>
    </div>
  );
}
