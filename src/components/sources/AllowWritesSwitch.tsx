import { useState } from 'react';
import { sourcesApi, type SourcePrivilegeReport } from '../../api/sources.js';
import { ALLOW_WRITES_ALLOWS, allowWritesCanChange } from './sourceModel.js';

/**
 * THE ALLOW WRITES SWITCH (DES-APPS-001 §7.4): per Postgres source, off on every new one. While it is
 * off, no row write on the source can be granted, prepared or run; turning it off withdraws every
 * row-write grant on the source.
 *
 * Human-only in the UI as at crew (which answers 403 to anything but a human operator): this component
 * is the ONLY caller of `sourcesApi.setAllowWrites` (pinned by `tests/sourcesHumanOnly.test.ts`), it acts
 * only on a click, and each direction takes a second, explicit confirmation saying what it does. No URL
 * parameter, palette verb, plugin request or chat reply reaches it.
 */
export function AllowWritesSwitch({ source, login, allowWrites, saved, privileges, onChanged, 'data-testid': testId = 'source-allow-writes' }: {
  source: string;
  login: string | null;
  allowWrites: boolean;
  /** A new source is off and can't be switched until it is saved (the switch is the saved source's). */
  saved: boolean;
  privileges: SourcePrivilegeReport | null | undefined;
  onChanged: (allowed: boolean, withdrawnGrants: number) => void;
  'data-testid'?: string;
}): React.ReactElement {
  const [asking, setAsking] = useState<null | 'on' | 'off'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawn, setWithdrawn] = useState<number | null>(null);
  const canChange = allowWritesCanChange(privileges);

  const apply = async (allowed: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await sourcesApi.setAllowWrites(source, allowed);
      setAsking(null);
      setWithdrawn(allowed ? null : r.withdrawnGrants);
      onChanged(r.allowWrites, r.withdrawnGrants);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wk-src-box wk-src-writes" data-testid={testId} data-allow-writes={allowWrites ? 'on' : 'off'}>
      <div className="wk-src-writes-head">
        <button
          type="button"
          role="switch"
          aria-checked={allowWrites}
          aria-label={`Allow writes for ${source}`}
          data-testid={`${testId}-switch`}
          disabled={!saved || busy || asking !== null}
          className={`wk-src-toggle${allowWrites ? ' wk-src-toggle--on' : ''}`}
          onClick={() => { setError(null); setAsking(allowWrites ? 'off' : 'on'); }}
        >
          <span aria-hidden className="wk-src-toggle-thumb" />
        </button>
        <span className="wk-src-strong">Allow writes</span>
        <span className="wk-src-sp" />
        <span className="wk-src-cap" data-testid={`${testId}-state`}>{allowWrites ? 'on' : 'off'}</span>
      </div>
      <p className="wk-src-note">{ALLOW_WRITES_ALLOWS}</p>
      {canChange !== null && <p className="wk-src-note" data-testid={`${testId}-can-change`}>{canChange}</p>}
      {!saved && <p className="wk-src-note" data-testid={`${testId}-unsaved`}>It starts off. Save the source first; then you can turn it on here.</p>}
      {asking === 'on' && (
        <div className="wk-src-confirm" role="group" aria-label="Turn on Allow writes" data-testid={`${testId}-confirm`}>
          <p>
            Turn on Allow writes for <b>{source}</b>? Apps can then ask to change single rows{login !== null ? <> through <b>{login}</b></> : null}. Nothing
            changes until you grant an action, and every run still shows you its card first.
          </p>
          <div className="wk-src-row-btns">
            <button type="button" className="wk-btn wk-btn--primary" disabled={busy} data-testid={`${testId}-confirm-on`} onClick={() => void apply(true)}>{busy ? 'Turning on…' : 'Turn on'}</button>
            <button type="button" className="wk-btn wk-btn--quiet" disabled={busy} onClick={() => setAsking(null)}>Keep it off</button>
          </div>
        </div>
      )}
      {asking === 'off' && (
        <div className="wk-src-confirm" role="group" aria-label="Turn off Allow writes" data-testid={`${testId}-confirm`}>
          <p>Turn off Allow writes for <b>{source}</b>? Every row-write grant on it is withdrawn; turning it back on needs new grants.</p>
          <div className="wk-src-row-btns">
            <button type="button" className="wk-btn wk-btn--primary" disabled={busy} data-testid={`${testId}-confirm-off`} onClick={() => void apply(false)}>{busy ? 'Turning off…' : 'Turn off'}</button>
            <button type="button" className="wk-btn wk-btn--quiet" disabled={busy} onClick={() => setAsking(null)}>Keep it on</button>
          </div>
        </div>
      )}
      {withdrawn !== null && withdrawn > 0 && <p className="wk-src-note" data-testid={`${testId}-withdrawn`}>Withdrew {withdrawn} row-write grant{withdrawn === 1 ? '' : 's'}.</p>}
      {error !== null && <p role="alert" className="wk-src-note wk-src-tone-fail" data-testid={`${testId}-error`}>{error}</p>}
    </div>
  );
}
