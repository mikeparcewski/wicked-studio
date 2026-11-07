import { useEffect, useRef, useState } from 'react';
import { apiBase, apiFetch } from '../../api/client.js';
import { listEditors } from '../../api/editors.js';
import type { AppDetail, AppDetailResponse, AppSpec } from '../../api/types.js';
import { AppAdapter } from '../../editors/apps/appAdapter.js';
import { FixedAppStore, tileHostPort, type AppTileData } from '../../editors/apps/appsDirectory.js';
import { AppSession } from '../../editors/apps/appSession.js';
import { changeLine, endedLine, turnsOf, type AppTurnRecord } from '../../editors/apps/appTurns.js';
import { snapshotAt, snapshotPort } from '../../editors/apps/previewSnapshots.js';
import { fetchGrants, bundleUrl } from '../../editors/model.js';
import { EditorHost } from '../../editors/host.js';
import { APPS_EDITOR } from '../../editors/protocol.js';
import { readThemeTokens } from '../../editors/theme.js';
import { useRoute } from '../../hooks/useRoute.js';
import { appPath } from '../apps/AppCard.js';

/** An `apps-turn` run's app: crew names the run `apps-<slug>-<12 hex>` (crew `apps/store.ts`, the turn launch). */
export function appSlugOfRun(runId: string): string | null {
  const m = /^apps-([a-z][a-z0-9]*(?:-[a-z0-9]+){0,3})-[0-9a-f]{12}$/.exec(runId);
  return m === null ? null : m[1]!;
}

/** The app as it was at `version`: crew#1396's version read laid over the detail (spec, lock, query text, head), so a
 *  preview draws THAT version. `null` when the read is not served (an older crew) or failed: no picture then. */
async function detailAt(slug: string, detail: AppDetail, version: number): Promise<AppDetail | null> {
  if (detail.head.version === version) return detail;
  try {
    const r = await apiFetch<{ version?: { spec?: AppSpec; lock?: AppDetail['lock']; queryText?: Record<string, string>; tree?: string; receipt?: { kind?: unknown } } }>(
      `/apps/${encodeURIComponent(slug)}/versions/${version}`);
    const v = r.version;
    if (v?.spec === undefined || v.lock === undefined || v.queryText === undefined || typeof v.tree !== 'string') return null;
    const kind = detail.versions.find((x) => x.version === version)?.receipt?.kind ?? null;
    return { ...detail, spec: v.spec, lock: v.lock, queryText: v.queryText, head: { version, tree: v.tree, receipt: kind }, turn: null };
  } catch {
    return null;
  }
}

type Load =
  | { kind: 'loading' }
  | { kind: 'failed'; text: string }
  | { kind: 'ready'; detail: AppDetail; turn: AppTurnRecord | null; pinned: AppDetail | null };

/**
 * G3 (PLAN S1; operator default D8): the App card in an app's change-run thread. Read-only: the app's name, what THIS
 * turn did in crew's words (the version it made and crew's change line, or why nothing landed), a picture of the app's
 * first page at the version the turn made (no source is read: the snapshot of its last render in this tab, else its
 * shape with no rows, as a dashboard tile), and **Open the app**. Editing and the app's chat are on the app's page.
 */
export function RunAppCard({ runId, runStatus }: { runId: string; runStatus: string }): React.ReactElement | null {
  const slug = appSlugOfRun(runId);
  const { navigate } = useRoute();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  useEffect(() => {
    if (slug === null) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { app } = await apiFetch<AppDetailResponse>(`/apps/${encodeURIComponent(slug)}`);
        const turn = turnsOf(app).find((t) => t.runId === runId) ?? null;
        const pinned = turn !== null && turn.state === 'landed' && turn.version !== null ? await detailAt(slug, app, turn.version) : null;
        if (!cancelled) setLoad({ kind: 'ready', detail: app, turn, pinned });
      } catch (e) {
        if (!cancelled) setLoad({ kind: 'failed', text: `The app could not be read: ${e instanceof Error ? e.message : String(e)}` });
      }
    })();
    return () => { cancelled = true; };
  }, [slug, runId, runStatus]);
  if (slug === null) return null;
  const name = load.kind === 'ready' ? load.detail.name : slug;
  const turn = load.kind === 'ready' ? load.turn : null;
  const line = load.kind === 'loading' ? 'Reading the app…'
    : load.kind === 'failed' ? load.text
      : turn === null ? `This turn is not in ${name}’s recent turns.`
        : turn.state === 'running' ? 'This turn is still working on the app.'
          : turn.state === 'landed' ? changeLine(turn)
            : endedLine(turn);
  return (
    <section data-testid="run-app-card" data-app={slug} data-state={turn?.state ?? load.kind} aria-label={`App: ${name}`} className="wk-pcard wk-run-app">
      <header className="wk-pcard-head">
        <span className="wk-card-tag">App</span>
        <span className="wk-pcard-title">{name}</span>
        {load.kind === 'ready' && load.pinned !== null && <span className="wk-pill wk-pill--neutral" data-testid="run-app-version">Version {load.pinned.head.version}</span>}
      </header>
      {load.kind === 'ready' && load.pinned !== null && <PinnedPreview slug={slug} detail={load.pinned} />}
      <p data-testid="run-app-line" className="wk-artifact-line">{line}</p>
      <footer className="wk-pcard-foot">
        <button type="button" data-testid="run-app-open" className="wk-host-btn wk-host-btn--primary" onClick={() => navigate(appPath(slug))}>Open the app</button>
      </footer>
    </section>
  );
}

/** The app's first page at the pinned version, in a read-only runtime frame (the dashboard tile's mechanism). */
function PinnedPreview({ slug, detail }: { slug: string; detail: AppDetail }): React.ReactElement {
  const box = useRef<HTMLDivElement | null>(null);
  const [torn, setTorn] = useState(false);
  useEffect(() => {
    if (box.current === null) return undefined;
    let cancelled = false;
    let host: EditorHost | null = null;
    const session = new AppSession(new FixedAppStore(slug, detail, 'crew'));
    void (async () => {
      const editors = await listEditors().catch(() => null);
      const e = editors?.find((x) => x.id === APPS_EDITOR && x.enabled !== false) ?? null;
      if (e === null || cancelled) return;
      const [decided] = await Promise.all([fetchGrants(e.id, e.version, e.sha256, null), session.load()]);
      if (cancelled || box.current === null) return;
      const version = detail.head.version;
      const live = snapshotAt(slug, version) !== null ? snapshotPort(slug, version) : null;
      const tile: AppTileData = { slug, name: detail.name, description: '', sample: false, sampleKey: null, detail, note: null, version: `v${version}`, changedAt: null, sources: [], kpis: [], published: null };
      host = new EditorHost({
        container: box.current, src: bundleUrl(apiBase(), APPS_EDITOR, e.version, e.sha256), editor: APPS_EDITOR, version: e.version,
        name: 'App', title: `${detail.name} at version ${version}`, size: 'inline', surface: 'card', grants: decided.grants, theme: readThemeTokens(),
        prefs: { reducedMotion: true, techDetails: false, locale: navigator.language }, firstParty: true,
        adapter: new AppAdapter(session, detail.name), app: tileHostPort(session, tile, live),
        ui: { chips: () => {}, draft: () => {}, typed: () => {}, key: () => {}, morph: () => {}, status: () => {}, notes: () => {}, thread: () => {}, fullscreen: async () => false, torn: () => setTorn(true), log: () => {} },
      });
      host.mount();
      host.frame.tabIndex = -1;
      host.frame.setAttribute('aria-hidden', 'true');
    })();
    const theme = typeof MutationObserver === 'function' ? new MutationObserver(() => host?.setTheme(readThemeTokens())) : null;
    theme?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    return () => { cancelled = true; theme?.disconnect(); host?.teardown('The run was left'); session.dispose(); };
  }, [slug, detail]);
  return (
    <div className="wk-appcard-prev wk-run-app-prev" data-testid="run-app-preview" aria-hidden="true">
      {torn ? <p className="wk-host-note">The picture could not be drawn.</p> : <div ref={box} className="wk-appcard-frame" />}
    </div>
  );
}
