import { useEffect, useMemo, useRef, useState } from 'react';
import { api, apiBase } from '../../api/client.js';
import type { AppSpec } from '../../api/types.js';
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
import { cellText } from '../../plugins/wicked-apps/runtime/format.js';
import { crewQuery, TileScheduler, TILE_TICK_MS, tileKpis, type TileState } from '../../editors/apps/liveTiles.js';
import type { AppDataPort } from '../../editors/apps/appData.js';
import { createByChat } from '../../editors/apps/appTurns.js';
import { useProjectsStore } from '../../store/projects.js';
import { Composer, type ComposerSuggestion } from '../session/Composer.js';

/** The preview of a crew app redraws on live data at most this often (when its numbers change). */
export const PREVIEW_REDRAW_MS = 120_000;

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

function agoWords(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1_000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return new Date(at).toLocaleDateString();
}

interface EditorEntry { version: string; sha: string; grants: PermissionId[] }

/**
 * A card's preview: the app's first page in a read-only runtime frame, scaled down by this page's own stylesheet. For
 * crew's apps `live` is the card's read path (the dashboard's limiter, only while the card is seen): the preview is a
 * LIVE render, made when the card first comes on screen and again when its numbers change, at most every
 * {@link PREVIEW_REDRAW_MS}. Between redraws it is the last real render, never re-queried.
 */
function TilePreview({ tile, editor, live }: { tile: AppTileData; editor: EditorEntry | null; live: AppDataPort | null }): React.ReactElement {
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
      const port = tileHostPort(session, tile, live);
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
  }, [tile, editor, live]);
  return (
    <div className="wk-appcard-prev" data-testid="apps-card-preview" aria-hidden="true">
      <div ref={box} className="wk-appcard-frame" />
      {(editor === null || torn || tile.detail === null) && (
        <p className="wk-appcard-noprev">{tile.detail === null ? 'Open it to see it' : editor === null ? 'The App editor is not installed here' : 'Preview not shown'}</p>
      )}
    </div>
  );
}

function ago(at: number, now: number): string {
  const sec = Math.max(0, Math.round((now - at) / 1000));
  return sec < 60 ? `${sec}s ago` : `${Math.round(sec / 60)} min ago`;
}

function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function AppCard({ tile, editor, navigate, onShare, scheduler }: { tile: AppTileData; editor: EditorEntry | null; navigate: (p: string) => void; onShare: () => void; scheduler: TileScheduler | null }): React.ReactElement {
  const el = useRef<HTMLElement | null>(null);
  const [live, setLive] = useState<TileState | null>(null);
  const [seen, setSeen] = useState(false);
  const [redraw, setRedraw] = useState(0);
  const lastDraw = useRef(0);
  const now = useNow(5_000);
  const crew = !tile.sample && tile.detail !== null && scheduler !== null;
  const spec: AppSpec | null = tile.detail?.spec ?? null;
  const kpiDefs = useMemo(() => (spec === null ? [] : tileKpis(spec)), [spec]);
  // Live numbers: only while the card is on screen (and the tab visible: the scheduler's rule).
  useEffect(() => {
    if (!crew || tile.detail === null || scheduler === null) return undefined;
    const handle = scheduler.register(tile.slug, { slug: tile.slug, version: tile.detail.head.version, spec: tile.detail.spec }, (st) => setLive({ ...st }));
    const node = el.current;
    let io: IntersectionObserver | null = null;
    if (node !== null && typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((entries) => {
        const on = entries.some((e) => e.isIntersecting);
        handle.seen(on);
        if (on) setSeen(true);
      });
      io.observe(node);
    } else { handle.seen(true); setSeen(true); }
    return () => { io?.disconnect(); handle.dispose(); };
  }, [crew, tile, scheduler]);
  // The preview redraws on live data when the numbers changed, at most every PREVIEW_REDRAW_MS.
  const changes = live?.changes ?? 0;
  useEffect(() => {
    if (changes === 0) return;
    const t = Date.now();
    if (t - lastDraw.current < PREVIEW_REDRAW_MS) return;
    lastDraw.current = t;
    setRedraw((n) => n + 1);
  }, [changes]);
  const livePort = useMemo<AppDataPort | null>(() => {
    if (!crew || scheduler === null) return null;
    return {
      kind: { queries: 'crew', actions: 'crew' },
      query: async (version, query) => {
        const o = await scheduler.limit(() => crewQuery(tile.slug, version, query));
        return o.ok ? { columns: o.answer.columns as never, rows: o.answer.rows as never, truncated: false, hasMore: false, ms: 0, cachedAt: o.answer.cachedAt ?? null, sample: false } : { error: 'unavailable', message: o.code };
      },
      prepare: async () => ({ error: 'refused', message: 'a tile runs nothing' }),
      run: async () => ({ state: 'failed', reason: 'a tile runs nothing', sample: false }),
      viewer: () => ({ email: null, sample: false }),
    };
  }, [crew, scheduler, tile.slug]);
  const locale = typeof navigator !== 'undefined' ? navigator.language : 'en';
  const shownKpis = crew
    ? kpiDefs.map((k, i) => ({ title: k.title, value: live !== null && live.code === null && live.values[i]?.ok === true ? cellText(live.values[i]!.cell as never, k.format as never, locale) : null }))
    : tile.kpis;
  return (
    <article ref={el} className="wk-appcard" data-testid="apps-card" data-slug={tile.slug} data-live={crew ? (live === null ? 'waiting' : live.code === null ? 'ok' : 'error') : 'none'}>
      {crew && !seen
        ? <div className="wk-appcard-prev" data-testid="apps-card-preview" aria-hidden="true"><p className="wk-appcard-noprev">Shown when it scrolls into view</p></div>
        : <TilePreview key={redraw} tile={tile} editor={editor} live={livePort} />}
      <div className="wk-appcard-body">
        <div className="wk-appcard-titlerow">
          <a href={appPath(tile.slug)} className="wk-appcard-open" data-testid="apps-card-open" onClick={(e) => { e.preventDefault(); navigate(appPath(tile.slug)); }}>
            <h2 className="wk-appcard-name" data-testid="apps-card-name">{tile.name}</h2>
          </a>
          {tile.sample && <span className="wk-pill" data-testid="apps-card-sample">Sample</span>}
          {tile.detail?.turn != null && <span className="wk-pill" data-testid="apps-card-turn">Changing…</span>}
        </div>
        {tile.description !== '' && <p className="wk-appcard-desc" data-testid="apps-card-desc">{tile.description}</p>}
        {tile.note !== null && <p className="wk-appcard-muted" data-testid="apps-card-note">{tile.note}</p>}
        {shownKpis.length > 0 && shownKpis.some((k) => k.value !== null) ? (
          <dl className="wk-appcard-kpis" data-testid="apps-card-kpis">
            {shownKpis.map((k, i) => (
              <div key={i} className="wk-appcard-kpi"><dt>{k.title}</dt><dd data-testid="apps-card-kpi-value">{k.value ?? '—'}</dd></div>
            ))}
          </dl>
        ) : crew && live !== null && live.code !== null ? (
          <p className="wk-appcard-muted wk-appcard-fail" data-testid="apps-card-nonumbers">No numbers: <span className="wk-appchat-code" data-testid="apps-card-code">{live.code}</span></p>
        ) : shownKpis.length > 0 ? <p className="wk-appcard-muted" data-testid="apps-card-nonumbers">{crew ? 'Reading its numbers…' : 'Its numbers show when you open it.'}</p> : null}
        <p className="wk-appcard-meta">
          <span data-testid="apps-card-version">{tile.version}</span>{tile.changedAt !== null && <> · changed {agoWords(tile.changedAt)}</>}
          {crew && live?.at != null && live.code === null && <> · <span data-testid="apps-card-updated">updated {ago(live.at, now)}</span></>}
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

const NEW_APP_KEY = 'apps:new';

/**
 * "Make a new app" by chat (DES-APPS-001 §6.2): the person says what they want; crew adds the app and the message is
 * its first turn. The app's page opens on that turn, busy, and the chat shows it land.
 */
function NewAppChat({ navigate, sources, projectOfApps }: { navigate: (p: string) => void; sources: readonly string[]; projectOfApps: string | null }): React.ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  useEffect(() => { if (useProjectsStore.getState().projects.length === 0) void useProjectsStore.getState().load(); }, []);
  const [text, setText] = useState('');
  const [project, setProject] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = project ?? projectOfApps ?? projects[0]?.id ?? null;
  const s0 = sources[0];
  const suggestions: ComposerSuggestion[] = (s0 !== undefined
    ? [`A dashboard of open tickets by region from ${s0}`, `KPIs for the main numbers in ${s0}, with a table of the latest rows`]
    : ['A dashboard of my main numbers with a table of the latest rows'])
    .concat(sources.length > 1 ? [`Compare a number from ${sources[0]} with one from ${sources[1]} side by side`] : [])
    .slice(0, 3).map((label, i) => ({ id: `new-app-${i}`, label, onPick: () => setText(label) }));
  const send = (): void => {
    const words = text.trim();
    if (words === '' || busy) return;
    if (chosen === null) { setNote('Make a project first: an app belongs to a project.'); return; }
    setBusy(true);
    setNote('Making the app and sending your message…');
    void createByChat(words, chosen).then((r) => {
      setBusy(false);
      if (r.ok) { navigate(appPath(r.slug)); return; }
      setText(words);
      setNote(r.slug !== undefined ? `The app ${r.slug} was made, but the message was not sent (${r.code}): ${r.message}` : `Not made (${r.code}): ${r.message}`);
    });
  };
  return (
    <section className="wk-newapp" data-testid="apps-new-chat" aria-label="Make a new app">
      <div className="wk-newapp-head">
        <h2 className="wk-newapp-title">Make a new app</h2>
        <span className="wk-newapp-sub">Say what it should show. An agent builds it from your data sources' structure, another reviews it, and it opens here.</span>
      </div>
      <Composer composerKey={NEW_APP_KEY} text={text} setText={(t) => { if (!busy) setText(t); }} onSend={() => send()} placeholder="Describe the app you want…" ariaLabel="Describe the app you want"
        variant="desk" className="wk-newapp-composer" suggestions={busy ? [] : suggestions} />
      <p className="wk-newapp-foot">
        {projects.length > 1 && (
          <label className="wk-newapp-project">In project{' '}
            <select data-testid="apps-new-project" value={chosen ?? ''} onChange={(e) => setProject(e.target.value)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        {projects.length === 1 && <span className="wk-newapp-project" data-testid="apps-new-project-one">In project {projects[0]!.name}</span>}
        {note !== null && <span className="wk-newapp-note" data-testid="apps-new-note" role="status">{note}</span>}
      </p>
    </section>
  );
}

export function AppsPage({ navigate }: { navigate: (path: string) => void }): React.ReactElement {
  const [dir, setDir] = useState<AppsDirectory | null>(null);
  const [editor, setEditor] = useState<EditorEntry | null>(null);
  const [sharing, setSharing] = useState<AppTileData | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [turnsOn, setTurnsOn] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  // ONE scheduler for the page: every card's live reads share its limit (at most 3 at once) and its stagger.
  const scheduler = useMemo(() => new TileScheduler(), []);
  useEffect(() => {
    const tick = (): void => scheduler.tick();
    const t = setInterval(tick, TILE_TICK_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [scheduler]);
  useEffect(() => {
    let live = true;
    void import('../../api/sources.js').then(({ sourcesApi }) => sourcesApi.list()).then((r) => {
      if (live) setSources((r.servers ?? []).filter((x) => x.kind === 'sql' || x.kind === 'graphql').map((x) => x.name).slice(0, 20));
    }, () => undefined);
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setDir(null);
    void (async () => {
      // A daemon that can't be reached is an error to retry, never "no app store" (codex r9: samples stood in for
      // crew's apps when health failed).
      let hasStore: boolean;
      try {
        const caps = (await api.getHealth()).capabilities?.apps;
        hasStore = caps !== undefined;
        if (!cancelled) setTurnsOn(caps?.turns === true);
      } catch (e) {
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
      intro="Dashboards and tools over your data, built by chat. Open one to use it and to ask for changes; Edit is for fine-tuning by hand.">
      {turnsOn && dir !== null && dir.source === 'crew' && (
        <NewAppChat navigate={navigate} sources={sources} projectOfApps={dir.apps.find((a) => a.detail !== null)?.detail?.projectId ?? null} />
      )}
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
            <p className="wk-appcard-desc">Apps are dashboards and tools over your data: describe one above and it is built for you.</p>
          </div>
        </div>
      )}
      {apps.length > 0 && (
        <div className="wk-apps-grid" data-testid="apps-grid">
          {apps.map((t) => <AppCard key={t.slug} tile={t} editor={editor} navigate={navigate} onShare={() => setSharing(t)} scheduler={dir?.source === 'crew' ? scheduler : null} />)}
        </div>
      )}
      {sharing !== null && <ShareSheet name={sharing.name} slug={sharing.slug} published={sharing.published} onClose={() => setSharing(null)} />}
    </PageFrame>
  );
}
