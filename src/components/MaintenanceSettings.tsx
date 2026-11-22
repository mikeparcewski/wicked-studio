import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { isRouteUnsupported } from '../api/errors.js';
import type { MaintenanceState } from '../api/maintenance-wire.js';
import { sessionPath } from '../board/sessionModel.js';
import type { Navigate } from '../hooks/useRoute.js';
import { SectionTitle } from './ui/PageFrame.js';
import { Switch } from './ui/Switch.js';
import { TechDetails } from './ui/TechDetails.js';

/** While draining, the state is read again this often, so "idle" shows when the last job stops. */
export const DRAIN_POLL_MS = 5_000;

/** "Draining since 14:02" (today) or with the date. */
function sinceWords(since: number | null, now: number = Date.now()): string {
  if (since === null) return 'Draining';
  const d = new Date(since);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `Draining since ${sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`}`;
}

/**
 * MAINTENANCE (crew#1475, Settings > General): "Drain for maintenance" stops Studio's service taking new work (new
 * jobs, resumes, and gate answers that start work are refused with 503 `maintenance_drain`) while the work already
 * running finishes. It shows whether the service is idle (safe to update or restart) and lists the jobs still working.
 * Drain lasts until it is turned off or the service restarts. A service without the route says so.
 */
export function MaintenanceSettings({ navigate }: { navigate: Navigate }): React.ReactElement {
  const [state, setState] = useState<MaintenanceState | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Only the newest read or write lands. */
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const read = useCallback((): void => {
    const mine = ++seq.current;
    api.getMaintenance().then(
      (s) => { if (alive.current && mine === seq.current) { setState(s); setReadError(null); } },
      (e: unknown) => {
        if (!alive.current || mine !== seq.current) return;
        if (isRouteUnsupported(e)) setUnsupported(true);
        else setReadError(e instanceof Error ? e.message : String(e));
      },
    );
  }, []);
  useEffect(read, [read]);

  // Draining with work still running: read again until it is idle.
  const draining = state?.draining === true;
  const idle = state?.idle === true;
  useEffect(() => {
    if (!draining || idle) return;
    const t = setInterval(read, DRAIN_POLL_MS);
    return () => clearInterval(t);
  }, [draining, idle, read]);

  const setDrain = async (drain: boolean): Promise<void> => {
    if (busy) return;
    const mine = ++seq.current;
    setBusy(true);
    setWriteError(null);
    try {
      const s = await api.setMaintenance(drain);
      if (alive.current && mine === seq.current) setState(s);
    } catch (e) {
      if (alive.current) setWriteError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <section data-testid="maintenance-settings" className="wk-card" data-state={unsupported ? 'unsupported' : state === null ? 'reading' : draining ? 'draining' : 'admitting'}>
      <SectionTitle>Maintenance</SectionTitle>
      {unsupported ? (
        <p className="wk-field-note" data-testid="maintenance-unsupported">This version of Studio’s service can’t drain for maintenance. Update wicked to get it.</p>
      ) : state === null ? (
        readError !== null ? (
          <div data-testid="maintenance-read-error">
            <p className="wk-field-note">Studio couldn’t read whether its service is taking new work.</p>
            <TechDetails text={readError} />
            <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="maintenance-retry" onClick={read}>Try again</button>
          </div>
        ) : <p className="wk-field-note">Reading…</p>
      ) : (
        <>
          <Switch label="Drain for maintenance" data-testid="maintenance-drain-toggle" checked={draining}
            disabled={busy ? (draining ? 'Admitting work again…' : 'Starting to drain…') : null}
            onChange={(on) => void setDrain(on)}
            hint={draining
              ? 'On: new jobs, resumes and gate answers that start work are refused. Work already running finishes. Turn it off, or restart the service, to take work again.'
              : 'Turn on before you update or restart: new jobs, resumes and gate answers that start work are refused while running work finishes.'} />
          {writeError !== null && (
            <div data-testid="maintenance-write-error">
              <p className="wk-field-note wk-field-note--bad">That didn’t change.</p>
              <TechDetails text={writeError} />
            </div>
          )}
          <div data-testid="maintenance-status" data-idle={idle ? 'true' : 'false'} role="status">
            {draining && <p className="wk-field-note" data-testid="maintenance-since">{sinceWords(state.since)}.</p>}
            {idle ? (
              <p className="wk-field-note" data-testid="maintenance-idle">
                Idle: no job is working now.{draining ? ' It’s safe to update or restart.' : ''}
              </p>
            ) : (
              <>
                <p className="wk-field-note" data-testid="maintenance-busy">
                  {state.active.length === 1 ? '1 job is working' : `${state.active.length} jobs are working`}{draining ? `. Wait for ${state.active.length === 1 ? 'it' : 'them'} to finish before you update or restart.` : '.'}
                </p>
                {state.active.length > 0 && (
                  <ul className="flex flex-col gap-1" data-testid="maintenance-active">
                    {state.active.map((a) => (
                      <li key={a.runId} className="wk-field-note">
                        <a href={sessionPath(a.runId)} className="wk-link" data-testid="maintenance-active-run" data-run-id={a.runId}
                          onClick={(e) => { e.preventDefault(); navigate(sessionPath(a.runId)); }}>{a.runId}</a>{' '}
                        <span>({a.status})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="maintenance-reread" onClick={read}>Check again</button>
          </div>
        </>
      )}
    </section>
  );
}
