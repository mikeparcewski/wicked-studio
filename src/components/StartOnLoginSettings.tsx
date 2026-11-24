import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { isRouteUnsupported } from '../api/errors.js';
import type { StartOnLoginStatus } from '../api/startOnLogin-wire.js';
import { CopyButton } from './CopyButton.js';
import { SectionTitle } from './ui/PageFrame.js';
import { TechDetails } from './ui/TechDetails.js';

/** A command to copy, as the gate card draws one (GateVerdict's suggestion ref). */
const CODE: React.CSSProperties = { background: 'var(--surface-rail)', color: 'var(--ink-high)', userSelect: 'all', overflowWrap: 'anywhere' };

/** What the card says for crew's answer: on, off, or a system where nothing is automated. */
function stateOf(s: StartOnLoginStatus): 'on' | 'off' | 'manual' {
  if (s.platform === 'other') return 'manual';
  return s.installed ? 'on' : 'off';
}

/**
 * START AT LOGIN (studio#1324, Settings > General): whether Studio's service on this port starts when the person signs
 * in to this computer (`wicked-crew serve --install-service`, crew#1469: one unit per port), read from crew's
 * `GET /settings/start-on-login` (crew#1829). Installing and removing stay terminal steps (they write and load a unit
 * for the account, which a browser request should not do), so the card gives the command to copy and a Check again
 * for after it ran. A service without the route says so.
 */
export function StartOnLoginSettings(): React.ReactElement {
  const [status, setStatus] = useState<StartOnLoginStatus | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  /** One read at a time: a press while one is out is held, so an older answer never lands over a newer one. */
  const out = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const read = useCallback((): void => {
    if (out.current) return;
    out.current = true;
    setReading(true);
    setReadError(null);
    api.getStartOnLogin().then(
      (s) => { if (alive.current) { setStatus(s); setReadError(null); setUnsupported(false); } },
      (e: unknown) => {
        if (!alive.current) return;
        if (isRouteUnsupported(e)) { setUnsupported(true); return; }
        setReadError(e instanceof Error ? e.message : String(e));
      },
    ).finally(() => {
      out.current = false;
      if (alive.current) setReading(false);
    });
  }, []);
  useEffect(read, [read]);

  const state = unsupported ? 'unsupported' : status === null ? (readError !== null ? 'error' : 'reading') : stateOf(status);
  return (
    <section data-testid="start-on-login-settings" className="wk-card" data-state={state}>
      <SectionTitle>Start at login</SectionTitle>
      {unsupported ? (
        <p className="wk-field-note" data-testid="start-on-login-unsupported">This version of Studio’s service can’t say whether it starts when you sign in. Update wicked to get it.</p>
      ) : status === null ? (
        readError !== null && !reading ? (
          <div data-testid="start-on-login-read-error">
            <p className="wk-field-note">Studio couldn’t read whether its service starts when you sign in.</p>
            <TechDetails text={readError} />
            <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="start-on-login-retry" onClick={read}>Try again</button>
          </div>
        ) : <p className="wk-field-note">Reading…</p>
      ) : (
        <StartOnLoginBody status={status} reading={reading} onReread={read} readError={readError} />
      )}
    </section>
  );
}

function StartOnLoginBody({ status, reading, onReread, readError }: {
  status: StartOnLoginStatus; reading: boolean; onReread: () => void; readError: string | null;
}): React.ReactElement {
  const state = stateOf(status);
  const command = state === 'on' ? status.uninstallCommand : status.installCommand;
  return (
    <div className="flex flex-col gap-2">
      <p data-testid="start-on-login-status">
        {/* crew reports whether its unit file is there (`installedService`), not whether the account's service manager
            has it enabled: the words say what was set up, never that a start is confirmed (codex r1). */}
        {state === 'on' ? `On: a start-at-login service is set up for Studio’s service on port ${status.port}.`
          : state === 'off' ? `Off: nothing is set up to start Studio’s service on port ${status.port} when you sign in to this computer.`
          : 'Studio can’t set this computer to start its service when you sign in. This command prints the steps to set it up by hand:'}
      </p>
      {state === 'on' && status.unit !== null && (
        <p className="wk-field-note" data-testid="start-on-login-unit">Set up by <code style={{ overflowWrap: 'anywhere' }}>{status.unit}</code></p>
      )}
      {state === 'off' && (
        <p className="wk-field-note" data-testid="start-on-login-howto">
          First stop the service you started by hand (in its terminal): the install refuses while it holds port {status.port}, and starts
          the service again itself. Then run this in a terminal, and reload this page once it is back:
        </p>
      )}
      {state === 'on' && (
        <p className="wk-field-note" data-testid="start-on-login-howto">
          To stop it starting when you sign in, run this in a terminal. If the service is running under it, this also stops
          the service now: start it again the way you start it by hand, with the same options.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <code className="px-1 rounded min-w-0" data-testid="start-on-login-command" style={CODE}>{command}</code>
        <CopyButton command={command} />
      </div>
      {state !== 'manual' && (
        // crew's commands name only the port; a service started with other options (`--db`) keeps them only if they are
        // added (crew's unit re-runs the install's own serve options, codex r2).
        <p className="wk-field-note" data-testid="start-on-login-options">If you start the service with other options, such as <code>--db</code>, add them to this command.</p>
      )}
      {readError !== null && (
        <div data-testid="start-on-login-reread-error" role="status">
          <p className="wk-field-note wk-field-note--bad">Studio couldn’t check again. This is what its service said last time.</p>
          <TechDetails text={readError} />
        </div>
      )}
      <div>
        <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="start-on-login-reread" disabled={reading} onClick={onReread}>
          {reading ? 'Checking…' : 'Check again'}
        </button>
      </div>
    </div>
  );
}
