import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { KNOWLEDGE_SOURCE } from '../../editors/apps/knowledgeSeeds.js';
import { MoreHorizontal } from 'lucide-react';
import { apiBase, apiFetch } from '../../api/client.js';
import type { AppDetail, AppDetailResponse, AppSpec } from '../../api/types.js';
import { AppAdapter } from '../../editors/apps/appAdapter.js';
import type { AppDataPort } from '../../editors/apps/appData.js';
import { withOrigin, type AppOrigin } from '../../editors/apps/appOrigin.js';
import { AppSession } from '../../editors/apps/appSession.js';
import { FixedAppStore, tileHostPort, type AppTileData } from '../../editors/apps/appsDirectory.js';
import { tileKpis, type TileScheduler, type TileState } from '../../editors/apps/liveTiles.js';
import { dropSnapshot, isRefusal, snapshotAt, snapshotPort } from '../../editors/apps/previewSnapshots.js';
import { EditorHost } from '../../editors/host.js';
import { bundleUrl } from '../../editors/model.js';
import { APPS_EDITOR, type PermissionId } from '../../editors/protocol.js';
import { readThemeTokens } from '../../editors/theme.js';
import { cellText } from '../../plugins/wicked-apps/runtime/format.js';

/**
 * ONE APP'S CARD (K4/K5, moved out of the Apps page for DES-REPORT-DASHBOARDS-001 §2 "Your dashboards"): its name and
 * line, a picture of its first page (the snapshot of its last render in this tab, never a read of its own), up to 3
 * live headline numbers (read through the page's ONE scheduler, only while the card is on screen and the tab visible),
 * its version and receipt, and what it reads. The page that draws it gives its buttons (Apps: Edit and Share; Report:
 * Open and Unpin), the origin its links carry (a Report's), and the content of its ⋯ menu (Show on Report).
 */

export interface EditorEntry { version: string; sha: string; grants: PermissionId[] }

/** An app's address; `origin` (a Report) rides along so the app's crumb leads back there. */
export function appPath(slug: string, mode: 'preview' | 'edit' = 'preview', origin: AppOrigin | null = null): string {
  return withOrigin(`/apps/${encodeURIComponent(slug)}${mode === 'edit' ? '?mode=edit' : ''}`, origin);
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

/**
 * A card's preview: the app's first page in a read-only runtime frame, scaled down by the page's own stylesheet. For
 * crew's apps `live` is the SNAPSHOT of the app's last real render in this tab (`previewSnapshots.ts`): the preview
 * reads nothing from a source; without a snapshot it is the app's shape with no rows. The card's headline numbers are
 * the live part.
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

/** The card's ⋯ menu: a small popover drawn by studio (Show on Report). Escape or a click outside closes it. */
function CardMenu({ name, children }: { name: string; children: React.ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  // Opening moves the focus to the menu's first control (its switch), so a keyboard lands on it (xreview r1).
  useEffect(() => {
    if (!open) return;
    const pop = wrap.current?.querySelector<HTMLElement>('.wk-appcard-pop') ?? null;
    (pop?.querySelector<HTMLElement>('button:not([disabled]), a[href]') ?? pop)?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent): void => { if (wrap.current !== null && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  return (
    <div className="wk-appcard-menu" ref={wrap} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); btn.current?.focus(); } }}>
      <button ref={btn} type="button" className="wk-btn wk-btn--secondary wk-btn--sm wk-appcard-menu-btn" data-testid="apps-card-menu" aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? id : undefined} aria-label={`More for ${name}`} title="More" onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal size={16} aria-hidden />
      </button>
      {open && <div id={id} tabIndex={-1} className="wk-appcard-pop" role="dialog" aria-label={`${name}: Show on Report`} data-testid="apps-card-menu-pop">{children}</div>}
    </div>
  );
}

export function AppCard({ tile, editor, navigate, scheduler, origin = null, actions, menu = null, badge = null }: {
  tile: AppTileData;
  editor: EditorEntry | null;
  navigate: (p: string) => void;
  scheduler: TileScheduler | null;
  /** The Report this card is on: its title (and the page's own Open) carry it. */
  origin?: AppOrigin | null;
  /** The card's buttons. */
  actions: React.ReactNode;
  /** The ⋯ menu's content, or null for no menu. */
  menu?: React.ReactNode;
  /** A pill beside the name (Apps: "On Report"). */
  badge?: React.ReactNode;
}): React.ReactElement {
  const el = useRef<HTMLElement | null>(null);
  const [live, setLive] = useState<TileState | null>(null);
  const [seen, setSeen] = useState(false);
  const now = useNow(5_000);
  // A card past the preview limit has no detail from the list: it reads it when it first comes on screen, so its
  // headline numbers are live too (xreview r2 on K5).
  const [lazy, setLazy] = useState<AppDetail | null>(null);
  const detail = tile.detail ?? lazy;
  const crew = !tile.sample && detail !== null && scheduler !== null;
  const spec: AppSpec | null = detail?.spec ?? null;
  useEffect(() => {
    if (tile.sample || tile.detail !== null || scheduler === null || lazy !== null) return undefined;
    const node = el.current;
    if (node === null || typeof IntersectionObserver !== 'function') return undefined;
    let live = true;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void apiFetch<AppDetailResponse>(`/apps/${encodeURIComponent(tile.slug)}`).then((r) => { if (live && r?.app?.slug === tile.slug && Array.isArray(r.app.spec?.pages)) setLazy(r.app); }, () => undefined);
    });
    io.observe(node);
    return () => { live = false; io.disconnect(); };
  }, [tile, scheduler, lazy]);
  const kpiDefs = useMemo(() => (spec === null ? [] : tileKpis(spec)), [spec]);
  // Live numbers: only while the card is on screen (and the tab visible: the scheduler's rule).
  useEffect(() => {
    if (!crew || detail === null || scheduler === null) return undefined;
    const handle = scheduler.register(tile.slug, { slug: tile.slug, version: detail.head.version, spec: detail.spec }, (st) => {
      // A read crew refuses also drops the app's picture: rows it showed before are not shown here either (§2).
      if (st.refused === true || isRefusal(st.code)) dropSnapshot(tile.slug);
      setLive({ ...st });
    });
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
  }, [crew, tile.slug, detail, scheduler]);
  const snapAt = tile.detail === null ? null : snapshotAt(tile.slug, tile.detail.head.version);
  const livePort = useMemo<AppDataPort | null>(() => (tile.detail !== null && snapAt !== null ? snapshotPort(tile.slug, tile.detail.head.version) : null), [tile, snapAt]);
  const locale = typeof navigator !== 'undefined' ? navigator.language : 'en';
  const shownKpis = crew
    ? kpiDefs.map((k, i) => ({ title: k.title, value: live !== null && live.code === null && live.values[i]?.ok === true ? cellText(live.values[i]!.cell as never, k.format as never, locale) : null }))
    : tile.kpis;
  const open = appPath(tile.slug, 'preview', origin);
  return (
    <article ref={el} className="wk-appcard" data-testid="apps-card" data-slug={tile.slug} data-live={crew ? (live === null ? 'waiting' : live.code === null ? 'ok' : 'error') : 'none'}>
      {crew && !seen
        ? <div className="wk-appcard-prev" data-testid="apps-card-preview" aria-hidden="true"><p className="wk-appcard-noprev">Shown when it scrolls into view</p></div>
        : <TilePreview tile={tile} editor={editor} live={livePort} />}
      <div className="wk-appcard-body">
        <div className="wk-appcard-titlerow">
          <a href={open} className="wk-appcard-open" data-testid="apps-card-open" onClick={(e) => { e.preventDefault(); navigate(open); }}>
            <h2 className="wk-appcard-name" data-testid="apps-card-name">{tile.name}</h2>
          </a>
          {tile.sample && <span className="wk-pill" data-testid="apps-card-sample">Sample</span>}
          {tile.detail?.turn != null && <span className="wk-pill" data-testid="apps-card-turn">Changing…</span>}
          {badge}
          {menu !== null && <CardMenu name={tile.name}>{menu}</CardMenu>}
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
        {crew && <p className="wk-appcard-meta" data-testid="apps-card-preview-when">{snapAt !== null ? `Picture from when you last opened it, ${ago(snapAt, now)}` : 'Open it to see its charts here'}</p>}
        {tile.sources.length > 0 && <p className="wk-appcard-meta" data-testid="apps-card-sources">Reads {tile.sources.map((x) => (x === KNOWLEDGE_SOURCE ? "this project's knowledge" : x)).join(', ')}</p>}
        <div className="wk-appcard-actions">{actions}</div>
      </div>
    </article>
  );
}
