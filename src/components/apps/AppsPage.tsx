import { useEffect, useRef, useState } from 'react';
import { api, apiBase } from '../../api/client.js';
import { listEditors } from '../../api/editors.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import { AppAdapter } from '../../editors/apps/appAdapter.js';
import { AppSession } from '../../editors/apps/appSession.js';
import { FixedAppStore, PREVIEW_LIMIT, loadAppsDirectory, tileHostPort, type AppTileData, type AppsDirectory } from '../../editors/apps/appsDirectory.js';
import { EditorHost } from '../../editors/host.js';
import { bundleUrl, fetchGrants } from '../../editors/model.js';
import { APPS_EDITOR, type PermissionId } from '../../editors/protocol.js';
import { readThemeTokens } from '../../editors/theme.js';
import { PageFrame } from '../ui/index.js';
import { ShareSheet } from './ShareSheet.js';

/**
 * APPS (operator 2026-11-03: "a dashboard itself, just of the available apps"): one card per app — its name and line,
 * a live preview of its first page drawn by the `wicked-apps` runtime at card size (read-only: nothing inside reacts),
 * its headline KPI values, its version and receipt, when it last changed and what it reads. The card opens the app
 * in Preview; Edit and Share sit on it. With crew's app store the cards are crew's apps and carry no numbers (a tile
 * never starts a query); without it, the two sample apps, labelled as samples, with their own rows.
 */

export function appPath(slug: string, mode: 'preview' | 'edit' = 'preview'): string {
  return `/apps/${encodeURIComponent(slug)}${mode === 'edit' ? '?mode=edit' : ''}`;
}

function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1_000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return new Date(at).toLocaleDateString();
}

interface EditorEntry { version: string; sha: string; grants: PermissionId[] }

/** A card's preview: the app's first page in a read-only runtime frame, scaled down by this page's own stylesheet. */
function TilePreview({ tile, editor }: { tile: AppTileData; editor: EditorEntry | null }): React.ReactElement {
  const box = useRef<HTMLDivElement | null>(null);
  const [torn, setTorn] = useState(false);
  useEffect(() => {
    if (editor === null || box.current === null || tile.detail === null) return undefined;
    const store = new FixedAppStore(tile.slug, tile.detail, tile.sample ? 'sample' : 'crew');
    const session = new AppSession(store);
    let host: EditorHost | null = null;
    let cancelled = false;
    void session.load().then(() => {
      if (cancelled || box.current === null) return;
      // Rows only from what is at hand: a sample's own rows in this browser. With crew, no query is ever sent.
      const port = tileHostPort(session, tile);
      host = new EditorHost({
        container: box.current, src: bundleUrl(apiBase(), APPS_EDITOR, editor.version, editor.sha), editor: APPS_EDITOR, version: editor.version,
        name: 'App', title: `Preview of ${tile.name}`, size: 'inline', surface: 'card', grants: editor.grants, theme: readThemeTokens(),
        prefs: { reducedMotion: true, techDetails: false, locale: navigator.language }, firstParty: true,
        adapter: new AppAdapter(session, tile.name), app: port,
        ui: { chips: () => {}, draft: () => {}, typed: () => {}, key: () => {}, morph: () => {}, status: () => {}, notes: () => {}, thread: () => {}, fullscreen: async () => false, torn: () => setTorn(true), log: () => {} },
      });
      host.mount();
      host.frame.tabIndex = -1;
      host.frame.setAttribute('aria-hidden', 'true');
    });
    const theme = new MutationObserver(() => host?.setTheme(readThemeTokens()));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    return () => { cancelled = true; theme.disconnect(); host?.teardown('The page was left'); session.dispose(); };
  }, [tile, editor]);
  return (
    <div className="wk-appcard-prev" data-testid="apps-card-preview" aria-hidden="true">
      <div ref={box} className="wk-appcard-frame" />
      {(editor === null || torn || tile.detail === null) && (
        <p className="wk-appcard-noprev">{tile.detail === null ? 'Open it to see it' : editor === null ? 'The App editor is not installed here' : 'Preview not shown'}</p>
      )}
    </div>
  );
}

function AppCard({ tile, editor, navigate, onShare }: { tile: AppTileData; editor: EditorEntry | null; navigate: (p: string) => void; onShare: () => void }): React.ReactElement {
  return (
    <article className="wk-appcard" data-testid="apps-card" data-slug={tile.slug}>
      <TilePreview tile={tile} editor={editor} />
      <div className="wk-appcard-body">
        <div className="wk-appcard-titlerow">
          <a href={appPath(tile.slug)} className="wk-appcard-open" data-testid="apps-card-open" onClick={(e) => { e.preventDefault(); navigate(appPath(tile.slug)); }}>
            <h2 className="wk-appcard-name" data-testid="apps-card-name">{tile.name}</h2>
          </a>
          {tile.sample && <span className="wk-pill" data-testid="apps-card-sample">Sample</span>}
        </div>
        {tile.description !== '' && <p className="wk-appcard-desc" data-testid="apps-card-desc">{tile.description}</p>}
        {tile.note !== null && <p className="wk-appcard-muted" data-testid="apps-card-note">{tile.note}</p>}
        {tile.kpis.length > 0 && tile.kpis.some((k) => k.value !== null) ? (
          <dl className="wk-appcard-kpis" data-testid="apps-card-kpis">
            {tile.kpis.map((k, i) => (
              <div key={i} className="wk-appcard-kpi"><dt>{k.title}</dt><dd>{k.value ?? '—'}</dd></div>
            ))}
          </dl>
        ) : tile.kpis.length > 0 ? <p className="wk-appcard-muted" data-testid="apps-card-nonumbers">Its numbers show when you open it.</p> : null}
        <p className="wk-appcard-meta">
          <span data-testid="apps-card-version">{tile.version}</span>{tile.changedAt !== null && <> · changed {ago(tile.changedAt)}</>}
        </p>
        {tile.sources.length > 0 && <p className="wk-appcard-meta" data-testid="apps-card-sources">Reads {tile.sources.join(', ')}</p>}
        <div className="wk-appcard-actions">
          <a href={appPath(tile.slug, 'edit')} className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-card-edit" onClick={(e) => { e.preventDefault(); navigate(appPath(tile.slug, 'edit')); }}>Edit</a>
          {/* Share says whether a published copy exists, which only the app's detail tells. */}
          {tile.detail !== null && <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-card-share" onClick={onShare}>Share</button>}
        </div>
      </div>
    </article>
  );
}

export function AppsPage({ navigate }: { navigate: (path: string) => void }): React.ReactElement {
  const [dir, setDir] = useState<AppsDirectory | null>(null);
  const [editor, setEditor] = useState<EditorEntry | null>(null);
  const [sharing, setSharing] = useState<AppTileData | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setDir(null);
    void (async () => {
      // A daemon that can't be reached is an error to retry, never "no app store" (codex r9: samples stood in for
      // crew's apps when health failed).
      let hasStore: boolean;
      try { hasStore = (await api.getHealth()).capabilities?.apps !== undefined; } catch (e) {
        if (!cancelled) setDir({ source: 'error', message: `the daemon did not answer (${e instanceof Error ? e.message : String(e)})` });
        return;
      }
      const [d, editors] = await Promise.all([loadAppsDirectory(hasStore), listEditors().catch(() => null)]);
      if (cancelled) return;
      setDir(d);
      const e = editors?.find((x) => x.id === APPS_EDITOR && x.enabled !== false) ?? null;
      if (e === null) return;
      const decided = await fetchGrants(e.id, e.version, e.sha256, null);
      if (!cancelled) setEditor({ version: e.version, sha: e.sha256, grants: decided.grants });
    })();
    return () => { cancelled = true; };
  }, [attempt]);
  const apps = dir !== null && dir.source !== 'error' ? dir.apps : [];
  const skipped = dir !== null && dir.source !== 'error' ? dir.skipped : 0;
  return (
    <PageFrame data-testid="apps-page" title={PAGE_NAMES.apps}
      intro="Dashboards and tools over your data, built by chat and by hand. Open one to use it, or Edit to change it in place.">
      {dir === null && <div className="wk-apps-grid" data-testid="apps-loading">{[0, 1, 2].map((i) => <div key={i} className="wk-appcard wk-appcard--ghost" />)}</div>}
      {dir !== null && dir.source === 'error' && (
        <p className="wk-apps-dash-line wk-apps-dash-line--fail" data-testid="apps-error">
          The apps could not be read: {dir.message}. <button type="button" className="wk-btn wk-btn--link" data-testid="apps-retry" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </p>
      )}
      {apps.length > PREVIEW_LIMIT && (
        <p className="wk-apps-dash-line" data-testid="apps-preview-limit">The first {PREVIEW_LIMIT} of {apps.length} apps show a preview; open any app to see it.</p>
      )}
      {skipped > 0 && (
        <p className="wk-apps-dash-line" data-testid="apps-skipped">{skipped === 1 ? 'One app crew lists has' : `${skipped} apps crew lists have`} an address studio can’t open, so {skipped === 1 ? 'it is' : 'they are'} not shown.</p>
      )}
      {dir !== null && dir.source === 'sample' && (
        <p className="wk-apps-dash-line" data-testid="apps-samples-note">This daemon has no app store yet: these are two sample apps, with made-up rows. Nothing reaches a source.</p>
      )}
      {dir !== null && dir.source !== 'error' && apps.length === 0 && (
        <div className="wk-apps-grid" data-testid="apps-empty">
          <div className="wk-appcard wk-appcard--ghost wk-appcard--empty">
            <div className="wk-appcard-prev wk-appcard-prev--ghost"><i /><i /><i /><i /></div>
            <p className="wk-appcard-desc">Apps are dashboards and tools over your data: ask for one in chat, then change it by hand.</p>
          </div>
        </div>
      )}
      {apps.length > 0 && (
        <div className="wk-apps-grid" data-testid="apps-grid">
          {apps.map((t) => <AppCard key={t.slug} tile={t} editor={editor} navigate={navigate} onShare={() => setSharing(t)} />)}
        </div>
      )}
      {sharing !== null && <ShareSheet name={sharing.name} slug={sharing.slug} published={sharing.published} onClose={() => setSharing(null)} />}
    </PageFrame>
  );
}
