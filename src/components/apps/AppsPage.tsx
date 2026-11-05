import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { listEditors } from '../../api/editors.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import { originOf, useOriginTarget } from '../../editors/apps/appOrigin.js';
import { PREVIEW_LIMIT, loadAppsDirectory, type AppTileData, type AppsDirectory } from '../../editors/apps/appsDirectory.js';
import { fetchGrants } from '../../editors/model.js';
import { APPS_EDITOR } from '../../editors/protocol.js';
import { TileScheduler, TILE_TICK_MS } from '../../editors/apps/liveTiles.js';
import { useProjectsStore } from '../../store/projects.js';
import { useReportShown } from '../../store/reportShown.js';
import { PageFrame } from '../ui/index.js';
import { AppCard, appPath, type EditorEntry } from './AppCard.js';
import { NewAppChat } from './NewAppChat.js';
import { ShareSheet } from './ShareSheet.js';
import { ShowOnReport } from './ShowOnReport.js';

export { appPath } from './AppCard.js';

/**
 * APPS (operator 2026-11-03: "a dashboard itself, just of the available apps"): one card per app — its name and line,
 * a live preview of its first page drawn by the `wicked-apps` runtime at card size (read-only: nothing inside reacts),
 * its headline KPI values, its version and receipt, when it last changed and what it reads. The card opens the app
 * in Preview; Edit and Share sit on it, and its ⋯ menu holds Show on Report (DES-REPORT-DASHBOARDS-001 §2). With crew's
 * app store the cards are crew's apps; without it, the two sample apps, labelled as samples, with their own rows.
 *
 * `?project=<id>` lists one project's apps (crew's `GET /apps?project=`), saying so with "Show all apps"; a Report's
 * "Choose what shows here" opens it with its origin, and the page then offers "Back to Report".
 */

/** The `?project=` filter, when it is an id-shaped value (anything else lists every app). */
export function projectFilterOf(search: string): string | null {
  const v = new URLSearchParams(search).get('project');
  return v !== null && /^[A-Za-z0-9_-]{1,128}$/u.test(v) ? v : null;
}

export function AppsPage({ navigate, search = '' }: { navigate: (path: string) => void; search?: string }): React.ReactElement {
  const filter = projectFilterOf(search);
  const origin = originOf(search);
  const back = useOriginTarget(search);
  const projects = useProjectsStore((s) => s.projects);
  useEffect(() => { const p = useProjectsStore.getState(); if (filter !== null && p.projects.length === 0 && !p.loading) void p.load(); }, [filter]);
  const shown = useReportShown((s) => s.shown);
  const [dir, setDir] = useState<AppsDirectory | null>(null);
  const [editor, setEditor] = useState<EditorEntry | null>(null);
  const [sharing, setSharing] = useState<AppTileData | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [turnsOn, setTurnsOn] = useState(false);
  const [queriesOn, setQueriesOn] = useState(false);
  // A framed studio changes nothing (§7.1, S8): no app is made from inside another page.
  const framed = useMemo(() => { try { return window.top !== window.self; } catch { return true; } }, []);
  // ONE scheduler for the page: every card's live reads share its limit (at most 3 at once) and its stagger.
  const scheduler = useMemo(() => new TileScheduler(), []);
  useEffect(() => {
    const tick = (): void => scheduler.tick();
    const t = setInterval(tick, TILE_TICK_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [scheduler]);
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
        if (!cancelled) { setTurnsOn(caps?.turns === true); setQueriesOn(caps?.query === true); }
      } catch (e) {
        if (!cancelled) setDir({ source: 'error', message: `the daemon did not answer (${e instanceof Error ? e.message : String(e)})` });
        return;
      }
      const [d, editors] = await Promise.all([loadAppsDirectory(hasStore, filter), listEditors().catch(() => null)]);
      if (cancelled) return;
      setDir(d);
      const e = editors?.find((x) => x.id === APPS_EDITOR && x.enabled !== false) ?? null;
      if (e === null) return;
      const decided = await fetchGrants(e.id, e.version, e.sha256, null);
      if (!cancelled) setEditor({ version: e.version, sha: e.sha256, grants: decided.grants });
    })();
    return () => { cancelled = true; };
  }, [attempt, filter]);
  // What shows on Report: the cards' "On Report" pill and their ⋯ menu's switch read it.
  const crewDir = dir !== null && dir.source === 'crew';
  useEffect(() => { if (crewDir) void useReportShown.getState().loadShown(); }, [crewDir]);
  const apps = dir !== null && dir.source !== 'error' ? dir.apps : [];
  const skipped = dir !== null && dir.source !== 'error' ? dir.skipped : 0;
  // Opened from a Report: the cards (and Edit) carry the way back on to the app, whose crumb then leads there.
  const carry = back !== null ? origin : null;
  const filterName = filter === null ? null : projects.find((p) => p.id === filter)?.name ?? filter;
  const keep = origin === null ? '' : `?from=${encodeURIComponent(origin.kind === 'report' ? 'report' : `project:${origin.id}`)}`;
  return (
    <PageFrame data-testid="apps-page" title={PAGE_NAMES.apps}
      intro="Dashboards and tools over your data and what your projects know, built by chat. Open one to use it and to ask for changes; Edit is for fine-tuning by hand.">
      {(filter !== null || back !== null) && (
        <p className="wk-apps-filterline" data-testid="apps-filter">
          {filter !== null && (
            <>
              <span data-testid="apps-filter-project">Showing <b>{filterName}</b></span>{' · '}
              <a href={`/apps${keep}`} className="wk-link" data-testid="apps-filter-all" onClick={(e) => { e.preventDefault(); navigate(`/apps${keep}`); }}>Show all apps</a>
            </>
          )}
          {back !== null && (
            <>
              {filter !== null && ' · '}
              <a href={back.path} className="wk-link" data-testid="apps-back-report" onClick={(e) => { e.preventDefault(); navigate(back.path); }}>Back to Report</a>
            </>
          )}
        </p>
      )}
      {turnsOn && dir !== null && dir.source === 'crew' && (
        <NewAppChat navigate={navigate} projectOfApps={filter ?? dir.apps.find((a) => a.detail !== null)?.detail?.projectId ?? null} framed={framed} />
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
            <p className="wk-appcard-desc">{filter !== null ? `${filterName ?? 'This project'} has no app yet.` : 'Apps are dashboards and tools over your data: describe one above and it is built for you.'}</p>
          </div>
        </div>
      )}
      {apps.length > 0 && (
        <div className="wk-apps-grid" data-testid="apps-grid">
          {apps.map((t) => (
            <AppCard key={t.slug} tile={t} editor={editor} navigate={navigate} scheduler={dir?.source === 'crew' && queriesOn ? scheduler : null} origin={carry}
              badge={!t.sample && shown.includes(t.slug) ? <span className="wk-pill wk-pill--good" data-testid="apps-card-onreport">On Report</span> : null}
              menu={dir?.source === 'crew' && !t.sample ? <ShowOnReport slug={t.slug} name={t.name} projectId={t.projectId ?? null} variant="menu" navigate={navigate} framed={framed} /> : null}
              actions={(
                <>
                  <a href={appPath(t.slug, 'edit', carry)} className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-card-edit" onClick={(e) => { e.preventDefault(); navigate(appPath(t.slug, 'edit', carry)); }}>Edit</a>
                  {/* Share says whether a published copy exists, which only the app's detail tells. */}
                  {t.detail !== null && <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-card-share" onClick={() => setSharing(t)}>Share</button>}
                </>
              )} />
          ))}
        </div>
      )}
      {sharing !== null && <ShareSheet name={sharing.name} slug={sharing.slug} published={sharing.published} onClose={() => setSharing(null)} />}
    </PageFrame>
  );
}
