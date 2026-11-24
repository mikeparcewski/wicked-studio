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
        {state === 'on' ? `On: Studio’s service on port ${status.port} starts when you sign in to this computer.`
          : state === 'off' ? `Off: Studio’s service on port ${status.port} doesn’t start when you sign in to this computer.`
          : 'Studio can’t set this computer to start its service when you sign in. This command prints the steps to set it up by hand:'}
      </p>
      {state === 'on' && status.unit !== null && (
        <p className="wk-field-note" data-testid="start-on-login-unit">Set up by <code style={{ overflowWrap: 'anywhere' }}>{status.unit}</code></p>
      )}
      {state !== 'manual' && (
        <p className="wk-field-note">{state === 'on' ? 'To stop it starting when you sign in, run this in a terminal:' : 'To start it when you sign in, run this in a terminal:'}</p>
      )}
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <code className="px-1 rounded min-w-0" data-testid="start-on-login-command" style={CODE}>{command}</code>
        <CopyButton command={command} />
      </div>
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
