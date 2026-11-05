import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../api/client.js';
import { listEditors } from '../../api/editors.js';
import { reportOrigin, withOrigin } from '../../editors/apps/appOrigin.js';
import { loadAppTiles, type ShownTile } from '../../editors/apps/appsDirectory.js';
import { TileScheduler, TILE_TICK_MS } from '../../editors/apps/liveTiles.js';
import { fetchGrants } from '../../editors/model.js';
import { APPS_EDITOR } from '../../editors/protocol.js';
import { ADMIN_WHY, FRAMED_WHY, framing, REPORT_MAX, UNREAD_WHY, useReportShown } from '../../store/reportShown.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { AppCard, appPath, type EditorEntry } from '../apps/AppCard.js';
import { PAGE_CHAT_SKIP } from '../chat/PageChat.js';
import { useShownSwitch, verdictWords } from '../apps/ShowOnReport.js';

/**
 * YOUR DASHBOARDS (DES-REPORT-DASHBOARDS-001 §2 Reading 1, §3 item 4): the apps whose Show on Report switch is on, in
 * this Report's scope (an app shows on its own project's Report and on Insight → Report), as their Apps cards: the
 * picture of their last render in this tab and their live headline numbers, under ONE scheduler for the whole section
 * (reads only while a card is on screen and the tab visible, at most 3 at once, cards started 400 ms apart). Each card
 * has Open and Unpin (Unpin is the switch, turned off). Report reads nothing but the `shown` list: never "every app of
 * the project".
 *
 * The section is marked `data-page-chat-skip`: Report's chat reads Report's own figures, never a dashboard's numbers.
 */

/** What crew offers for apps, and the App editor: the Build button's gates and the cards' previews. */
export interface AppsGates {
  state: 'loading' | 'ok' | 'failed';
  /** crew serves the app store (`capabilities.apps`). */
  store: boolean;
  turns: boolean;
  query: boolean;
  editor: EditorEntry | null;
  /** Read them again (a crew that did not answer). */
  retry?: () => void;
}

const NO_GATES: AppsGates = { state: 'loading', store: false, turns: false, query: false, editor: null };

/** Read crew's apps capabilities and the App editor once. A crew that does not answer offers nothing (no button). */
export function useAppsGates(): AppsGates {
  const [g, setG] = useState<AppsGates>(NO_GATES);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setG(NO_GATES);
    void (async () => {
      try {
        const [h, editors] = await Promise.all([api.getHealth(), listEditors().catch(() => null)]);
        const caps = h?.capabilities?.apps;
        const e = editors?.find((x) => x.id === APPS_EDITOR && x.enabled !== false) ?? null;
        const editor = e === null ? null : { version: e.version, sha: e.sha256, grants: (await fetchGrants(e.id, e.version, e.sha256, null)).grants };
        if (live) setG({ state: 'ok', store: caps !== undefined, turns: caps?.turns === true, query: caps?.query === true, editor });
      } catch {
        if (live) setG({ ...NO_GATES, state: 'failed' });
      }
    })();
    return () => { live = false; };
  }, [attempt]);
  return useMemo(() => ({ ...g, retry: () => setAttempt((n) => n + 1) }), [g]);
}

/** The Build button shows only with all of: crew runs app turns AND queries, the App editor installed, studio not framed. */
export function canBuild(g: AppsGates, framed: boolean): boolean {
  return g.state === 'ok' && g.store && g.turns && g.query && g.editor !== null && !framed;
}

/** "Choose what shows here": the Apps page, filtered to this project, with the way back. */
export function choosePath(projectId: string | undefined): string {
  return withOrigin(projectId === undefined ? '/apps' : `/apps?project=${encodeURIComponent(projectId)}`, reportOrigin(projectId));
}

/** Unpin: the card's switch, turned off, through the one writer. */
function Unpin({ slug, name, framed }: { slug: string; name: string; framed: boolean }): React.ReactElement {
  const sw = useShownSwitch(slug, framed);
  return (
    <>
      <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="report-dash-unpin" disabled={sw.busy || sw.readOnlyWhy !== null}
        title={sw.readOnlyWhy ?? undefined} aria-busy={sw.busy ? 'true' : undefined} onClick={() => sw.change(false)}>
        {sw.busy ? 'Unpinning…' : 'Unpin'}
      </button>
      {sw.verdict !== null && (
        <span className="wk-rep-dash-why" data-testid="report-dash-verdict" data-verdict={sw.verdict.kind} role="status">
          {verdictWords(sw.verdict, name, (s) => [...s])}
          {(sw.verdict.kind === 'failed' || sw.verdict.kind === 'dropped') && <>{' '}<button type="button" className="wk-btn wk-btn--link" data-testid="report-dash-retry" onClick={sw.retry}>Try again</button></>}
        </span>
      )}
    </>
  );
}

/** A gone app on the list (Insight → Report): said, with Remove (the same writer). */
function Gone({ slug, framed }: { slug: string; framed: boolean }): React.ReactElement {
  const sw = useShownSwitch(slug, framed);
  return (
    <li className="wk-rep-dash-gone" data-testid="report-dash-gone" data-slug={slug}>
      <span>“{slug}” is on Report, but crew no longer has this app.</span>
      <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="report-dash-remove" disabled={sw.busy || sw.readOnlyWhy !== null}
        title={sw.readOnlyWhy ?? undefined} onClick={() => sw.change(false)}>{sw.busy ? 'Removing…' : 'Remove'}</button>
      {sw.verdict !== null && <span className="wk-rep-dash-why" data-testid="report-dash-verdict" role="status">{verdictWords(sw.verdict, slug, (s) => [...s])}</span>}
    </li>
  );
}

export function ReportDashboards({ projectId, navigate, gates, onBuild }: {
  /** A project's Report; undefined = Insight → Report (every project). */
  projectId?: string | undefined;
  navigate: Navigate;
  gates: AppsGates;
  /** Open the Build sheet (only when the button's gates hold). */
  onBuild: (() => void) | null;
}): React.ReactElement | null {
  const load = useReportShown((s) => s.load);
  const loadError = useReportShown((s) => s.loadError);
  const shown = useReportShown((s) => s.shown);
  const refused = useReportShown((s) => s.refused);
  const framed = useMemo(() => framing.framed(), []);
  const crew = gates.state === 'ok' && gates.store;
  useEffect(() => { if (crew) void useReportShown.getState().loadShown(); }, [crew]);

  // The cards for the listed apps, read once per slug (a slug turned on later is read when it is added).
  const [tiles, setTiles] = useState<ReadonlyMap<string, ShownTile>>(() => new Map());
  const [tilesError, setTilesError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const gen = useRef(0);
  const missing = shown.filter((s) => !tiles.has(s));
  const missingKey = missing.join(',');
  useEffect(() => {
    if (!crew || missingKey === '') return undefined;
    const g = ++gen.current;
    let live = true;
    void loadAppTiles(missingKey.split(',')).then((r) => {
      if (!live || g !== gen.current) return;
      if (!r.ok) { setTilesError(r.message); return; }
      setTilesError(null);
      setTiles((cur) => { const next = new Map(cur); for (const t of r.tiles) next.set(t.slug, t); return next; });
    });
    return () => { live = false; };
  }, [crew, missingKey, attempt]);

  // ONE scheduler for every card here: one limit (at most 3 queries at once) and one stagger.
  const scheduler = useMemo(() => new TileScheduler(), []);
  useEffect(() => {
    const tick = (): void => scheduler.tick();
    const t = setInterval(tick, TILE_TICK_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [scheduler]);

  // crew did not answer (xreview r1): said, with Try again, never a section that silently is not there.
  if (gates.state === 'failed') {
    return (
      <section className="wk-rep-sec wk-rep-dash" aria-labelledby="report-h-dash" data-testid="report-dashboards" {...{ [PAGE_CHAT_SKIP]: '' }}>
        <div className="wk-rep-sec-head"><h2 id="report-h-dash" className="wk-rep-label">Your dashboards</h2></div>
        <p className="wk-rep-quiet" data-tone="fail" data-testid="report-dash-failed">
          {UNREAD_WHY}: crew didn’t answer. <button type="button" className="wk-rep-link" data-testid="report-dash-reload" onClick={gates.retry}>Try again</button>
        </p>
      </section>
    );
  }
  if (!crew) return null;
  const origin = reportOrigin(projectId);
  // Only the listed apps, in the order they were turned on; on a project's Report only that project's.
  const listed = shown.map((s) => tiles.get(s)).filter((t): t is ShownTile => t !== undefined);
  const here = listed.filter((t) => t.tile !== null && (projectId === undefined || t.projectId === projectId));
  const gone = projectId === undefined ? listed.filter((t) => t.tile === null) : [];
  const reading = load === 'idle' || load === 'loading' || (missing.length > 0 && tilesError === null);
  const failed = load === 'failed' ? (loadError ?? 'no answer') : tilesError;
  const meta = here.length === shown.length ? `${shown.length} of ${REPORT_MAX} shown` : `${here.length} here · ${shown.length} of ${REPORT_MAX} shown`;
  const choose = choosePath(projectId);
  const chooseLink = (
    <a href={choose} className="wk-rep-link wk-rep-dash-choose" data-testid="report-dash-choose" onClick={(e) => { e.preventDefault(); navigate(choose); }}>Choose what shows here</a>
  );
  return (
    <section id="desk-focus-dashboards" className="wk-rep-sec wk-rep-dash" aria-labelledby="report-h-dash" data-testid="report-dashboards" {...{ [PAGE_CHAT_SKIP]: '' }}>
      <div className="wk-rep-sec-head">
        <h2 id="report-h-dash" className="wk-rep-label">Your dashboards</h2>
        {here.length > 0 && <span className="wk-rep-meta wk-rep-dash-meta"><span><span data-testid="report-dash-count">{meta}</span> · live while on screen</span>{chooseLink}</span>}
      </div>
      {(refused || framed) && <p className="wk-rep-note" data-testid="report-dash-readonly">{framed ? FRAMED_WHY : ADMIN_WHY}</p>}
      {load === 'malformed' && <p className="wk-rep-note" data-testid="report-dash-malformed">The stored list of dashboards isn’t in a shape studio reads, so none shows here; turning one on starts a new list.</p>}
      {failed !== null && (
        <p className="wk-rep-quiet" data-tone="fail" data-testid="report-dash-failed">
          {UNREAD_WHY}: {failed}. <button type="button" className="wk-rep-link" data-testid="report-dash-reload"
            onClick={() => { if (load === 'failed') void useReportShown.getState().loadShown(true); else setAttempt((n) => n + 1); }}>Try again</button>
        </p>
      )}
      {failed === null && reading && shown.length > 0 && here.length === 0 && (
        <div className="wk-rep-dash-grid" data-testid="report-dash-loading" aria-busy="true"><div className="wk-appcard wk-appcard--ghost" /><div className="wk-appcard wk-appcard--ghost" /></div>
      )}
      {here.length > 0 && (
        <div className="wk-rep-dash-grid" data-testid="report-dash-grid">
          {here.map(({ tile }) => (
            <AppCard key={tile!.slug} tile={tile!} editor={gates.editor} navigate={navigate} scheduler={gates.query ? scheduler : null} origin={origin}
              actions={(
                <>
                  <a href={appPath(tile!.slug, 'preview', origin)} className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="report-dash-open"
                    onClick={(e) => { e.preventDefault(); navigate(appPath(tile!.slug, 'preview', origin)); }}>Open</a>
                  <Unpin slug={tile!.slug} name={tile!.name} framed={framed} />
                </>
              )} />
          ))}
        </div>
      )}
      {gone.length > 0 && <ul className="wk-rep-dash-gonelist">{gone.map((g) => <Gone key={g.slug} slug={g.slug} framed={framed} />)}</ul>}
      {failed === null && !reading && here.length === 0 && (
        <div className="wk-rep-dash-empty" data-testid="report-dash-empty">
          <p className="wk-rep-dash-empty-text">
            Turn on <b>Show on Report</b> in an app’s Properties, or in its card’s ⋯ menu on Apps, and it shows here with its live numbers.
            {onBuild !== null && ' Or describe a new one and an agent builds it.'}
          </p>
          <div className="wk-rep-dash-empty-actions">
            {chooseLink}
            {onBuild !== null && (
              <button type="button" className="wk-btn wk-btn--primary" data-testid="report-dash-build" onClick={onBuild}><Plus size={16} aria-hidden /> Build a dashboard</button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
