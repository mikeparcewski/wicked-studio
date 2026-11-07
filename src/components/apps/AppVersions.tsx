import { useEffect, useRef, useState } from 'react';
import type { AppDetail, AppSpec, AppVersion } from '../../api/types.js';
import { ago } from '../AgeStamp.js';
import type { AppSession } from '../../editors/apps/appSession.js';
import type { AppVersionView } from '../../editors/apps/appStore.js';

/**
 * VERSIONS (plugins G16b, operator ruling D5: "restore of any earlier version"): every version of the app, newest
 * first, as crew records it: its number, the receipt it landed with, its one line, who made it and when. An earlier
 * version crew accepted offers Restore. Restore first READS that version as it was (crew's version read, nothing
 * changes) and says what it holds against the head; only the person's second click lands it, through the session's
 * one-change-at-a-time path (`AppSession.restore`), as a new version on the head they saw. The version it replaces stays
 * in the list. Drawn by studio, outside the app's frame; never on a phone (view + chat there).
 */

const ACCEPTED = new Set(['you', 'reviewed', 'restored']);

function receiptLine(v: AppVersion): string {
  const r = v.receipt;
  if (r == null) return 'not accepted';
  if (r.kind === 'restored') return `restored from v${r.restoredFrom?.version ?? '?'}`;
  return r.kind === 'you' ? 'by hand' : 'reviewed';
}

function authorLine(v: AppVersion): string {
  if (v.author.kind === 'seat') return 'a chat turn';
  if (v.author.kind === 'crew') return 'crew';
  return v.author.id === 'local' || v.author.id === 'you' ? 'you' : v.author.id.slice(0, 60);
}

/** What a spec holds, in one line ("2 pages · 7 components · 3 queries"). */
export function holdsLine(spec: AppSpec): string {
  const pages = spec.pages.length;
  const comps = spec.pages.reduce((n, p) => n + (Array.isArray(p.components) ? p.components.length : 0), 0);
  const q = spec.queries.length;
  const n = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;
  return `${n(pages, 'page', 'pages')} · ${n(comps, 'component', 'components')} · ${n(q, 'query', 'queries')}`;
}

type Asking = { version: number; state: 'reading' } | { version: number; state: 'read'; read: AppVersionView } | { version: number; state: 'failed'; message: string };

export function AppVersions({ detail, session, disabledWhy, onDone, onClose }: {
  detail: AppDetail;
  session: AppSession;
  /** Why nothing can be restored right now (a turn, an archived app, a framed page), or null. */
  disabledWhy: string | null;
  /** The restore's outcome, as one status line for the host. */
  onDone: (line: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLElement | null>(null);
  useEffect(() => { panel.current?.focus(); }, []);
  const head = detail.head.version;
  const rows = [...detail.versions].sort((a, b) => b.version - a.version);

  const ask = async (version: number): Promise<void> => {
    setAsking({ version, state: 'reading' });
    const r = await session.store.readVersion(version);
    setAsking((cur) => (cur?.version !== version ? cur : r.ok ? { version, state: 'read', read: r.read } : { version, state: 'failed', message: r.message }));
  };
  const restore = async (version: number): Promise<void> => {
    setBusy(true);
    try {
      const r = await session.restore(version, head);
      onDone(r.ok ? `Restored v${version}: now v${r.version}` : r.message);
      if (r.ok) setAsking(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section ref={panel} tabIndex={-1} className="wk-apps-versions" data-testid="apps-versions" aria-label="Versions"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <header className="wk-apps-versions-head">
        <h2 className="wk-apps-versions-title">Versions</h2>
        <span className="wk-apps-versions-sub">Restore brings an earlier version back as the newest one. Nothing is lost: the version it replaces stays here.</span>
        <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-versions-close" onClick={onClose}>Close</button>
      </header>
      {disabledWhy !== null && <p className="wk-apps-versions-why" data-testid="apps-versions-why">{disabledWhy}</p>}
      <ol className="wk-apps-versions-list">
        {rows.map((v) => {
          const now = v.version === head;
          const restorable = !now && v.receipt != null && ACCEPTED.has(v.receipt.kind);
          const open = asking !== null && asking.version === v.version;
          return (
            <li key={v.version} className="wk-apps-version" data-testid="apps-versions-row" data-version={v.version} data-now={now}>
              <div className="wk-apps-version-row">
                <span className="wk-apps-version-n">v{v.version}</span>
                <span className="wk-apps-version-what">
                  <span className="wk-apps-version-summary">{v.summary.trim() !== '' ? v.summary : 'No description'}</span>
                  <span className="wk-apps-version-meta">{receiptLine(v)} · {authorLine(v)} · {ago(v.at)} ago</span>
                </span>
                {now && <span className="wk-pill" data-testid="apps-version-now">Now</span>}
                {restorable && !open && (
                  <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-version-restore" disabled={disabledWhy !== null || busy}
                    onClick={() => void ask(v.version)}>Restore…</button>
                )}
              </div>
              {open && (
                <div className="wk-apps-version-confirm" data-testid="apps-version-confirm" role="group" aria-label={`Restore v${v.version}?`}>
                  {asking.state === 'reading' && <p className="wk-apps-version-line">Reading v{v.version}…</p>}
                  {asking.state === 'failed' && <p className="wk-apps-version-line wk-apps-line--fail" data-testid="apps-version-failed">v{v.version} could not be read: {asking.message}</p>}
                  {asking.state === 'read' && (
                    <p className="wk-apps-version-line" data-testid="apps-version-holds">
                      v{v.version} holds {holdsLine(asking.read.spec)}. Now (v{head}): {holdsLine(detail.spec)}. It comes back as v{head + 1}.
                    </p>
                  )}
                  <span className="wk-apps-version-actions">
                    <button type="button" className="wk-btn wk-btn--primary wk-btn--sm" data-testid="apps-version-restore-confirm"
                      disabled={asking.state !== 'read' || disabledWhy !== null || busy} onClick={() => void restore(v.version)}>Restore v{v.version}</button>
                    <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-version-restore-cancel" onClick={() => setAsking(null)}>Cancel</button>
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
