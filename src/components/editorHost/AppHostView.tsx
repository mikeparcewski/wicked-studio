import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiBase } from '../../api/client.js';
import type { AppDetail, AppsCapabilities, SessionView } from '../../api/types.js';
import { EditorHost, SPEC_EDIT_AFTER_FOCUS_MS } from '../../editors/host.js';
import { bundleUrl, fetchGrants, type Chip } from '../../editors/model.js';
import { readThemeTokens } from '../../editors/theme.js';
import { AppAdapter, type AppHostPort, type AppMode } from '../../editors/apps/appAdapter.js';
import { appDataFor, sampleAppData, type ActionCard, type ActionOutcome, type AppDataPort, type PreparedAction } from '../../editors/apps/appData.js';
import { AppSession, drainForSend } from '../../editors/apps/appSession.js';
import { CrewAppStore, SampleAppStore, type AppStorePort } from '../../editors/apps/appStore.js';
import { sampleApp } from '../../editors/apps/samples.js';
import { archivedOf, isAppSlug, publishedOf, setArchived } from '../../editors/apps/appsDirectory.js';
import { AppVersions } from '../apps/AppVersions.js';
import { ShareSheet } from '../apps/ShareSheet.js';
import { AppChat, appComposerKey } from '../apps/AppChat.js';
import { AppProperties } from '../apps/AppProperties.js';
import { AppSidePanel, readCollapsed, readSeen, writeSeen, type PanelTab } from '../apps/AppSidePanel.js';
import { turnsOf } from '../../editors/apps/appTurns.js';
import { addAboutChip, chipsOf, removeAboutChip, useComposerChips } from '../../store/composerChips.js';
import { recordingPort } from '../../editors/apps/previewSnapshots.js';
import { ShowOnReport } from '../apps/ShowOnReport.js';

/**
 * THE APP HOST (DES-APPS-001 §6.1, §7.1, §7.3; slice K4): one app in the `wicked-apps` runtime's sandboxed frame, and
 * everything around it the HOST draws — never the frame:
 *
 *  - the header: the app's name, its version and receipt, Undo and Redo (crew's pointer), Edit | Preview, and
 *    "Viewing as";
 *  - the "Needs you" dock: the CARD for an action the app asked to run (from the resolved operation; Run is armed
 *    after a moment and runs only on the person's click here), the full URL of a link before it opens, and what the
 *    last action did;
 *  - the edit line: what landed (one version per edit burst), or why it did not.
 *
 * On a daemon that serves crew's app store, `?app=<slug>` opens that app ({@link CrewAppStore}); otherwise a sample app
 * opens in memory ({@link SampleAppStore}). Live rows and actions come through the data seam (`appDataFor`), which is
 * the stub until crew says it runs them. Below 640 px the builder is Preview only: "Edit on a larger screen".
 *
 * (plugins G16, operator ruling D5) Versions lists every version and restores an earlier accepted one. An archived app
 * opens read-only, saying so, with Restore (out of Archived). On a phone (a window under 640 px) the app is view + chat
 * only, the approved exception: no Edit, no Undo or Redo, no Versions.
 */

const ARM_MS = 600;
const PHONE_PX = 640;

export interface AppHostProps {
  editor: string; version: string; sha: string; app: string | null; sample: string | null;
  /** Where it opens (the `/apps/<slug>?mode=` route); Preview by default. */
  initialMode?: AppMode;
  /** The Apps route's navigation: the "Apps /" crumb goes back to the dashboard. */
  navigate?: (path: string) => void;
  /** crew's apps capabilities, when the caller has already read health (the Apps route): ONE store decision, so a
   *  second read failing can't turn crew's app into a sample (codex r9). Absent: this view reads health itself. */
  caps?: { apps: AppsCapabilities | undefined };
  /** (K5) The runs studio holds: a turn in the app's chat shows its run's live steps from here. */
  runs?: readonly SessionView[];
  /** (DES-REPORT-DASHBOARDS-001 §2) Opened from a Report (`appOrigin.ts`): the crumb leads back there ("Report /"). */
  back?: { path: string; label: string } | null;
}

const NO_RUNS: readonly SessionView[] = [];

/** (K5) The composer mirrors the selection: the component chips on the app's chat are exactly the selected ones. */
function mirrorSelection(slug: string, chips: readonly Chip[]): void {
  const key = appComposerKey(slug);
  for (const c of chipsOf(useComposerChips.getState(), key)) if (c.key.startsWith('cmp:')) removeAboutChip(key, c.key);
  for (const c of chips) {
    if (c.anchor.kind !== 'element') continue;
    addAboutChip(key, { kind: 'about', key: `cmp:${c.anchor.id}`, label: c.label });
  }
}

interface Asking { prepared: PreparedAction; resolve: (yes: boolean) => void; at: number }
interface LinkAsk { url: string; resolve: (yes: boolean) => void }

function receiptWords(app: AppDetail): string {
  const v = app.versions.find((x) => x.version === app.head.version);
  const r = v?.receipt;
  if (r == null) return 'not accepted';
  if (r.kind === 'restored') return `restored from v${r.restoredFrom?.version ?? '?'}`;
  return r.kind;
}

function outcomeWords(o: ActionOutcome, card: ActionCard): string {
  const what = `“${card.action}”`;
  const why = o.reason !== null && o.reason !== '' ? `: ${o.reason}` : '';
  if (o.state === 'succeeded') return `Ran ${what}${why}`;
  if (o.state === 'failed') return `${what} failed${why}`;
  return `Not known whether ${what} ran${why}`;
}

/** The page's own `url.<name>=value` parameters, the app's `url.<name>` bindings (at most 30, names like crew's). */
export function urlParamsOf(search: string): Record<string, string> {
  const out = Object.create(null) as Record<string, string>;
  let n = 0;
  for (const [k, v] of new URLSearchParams(search)) {
    const name = k.startsWith('url.') ? k.slice(4) : null;
    if (name === null || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(name) || v.length > 1_000 || Object.hasOwn(out, name) || n >= 30) continue;
    out[name] = v;
    n += 1;
  }
  return out;
}

/** Edit needs room: the runtime's frame (not the window) at least this wide, or the builder is Preview only. */
export function editable(windowWide: boolean, frameWidth: number | null): boolean {
  return windowWide && (frameWidth === null || frameWidth >= PHONE_PX);
}

function useNarrow(): boolean {
  const q = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(`(max-width: ${PHONE_PX - 1}px)`) : null;
  const [narrow, setNarrow] = useState(q?.matches ?? false);
  useEffect(() => {
    if (q === null) return;
    const on = (): void => setNarrow(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, [q]);
  return narrow;
}

export function ActionCardView({ asking, onAnswer }: { asking: Asking; onAnswer: (yes: boolean) => void }): React.ReactElement {
  const { card, expiresAt } = asking.prepared;
  const [armed, setArmed] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    // Run is armed only after the card has been on screen a moment: a click aimed at the app can't land on it.
    const arm = setTimeout(() => setArmed(true), ARM_MS);
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => { clearTimeout(arm); clearInterval(tick); };
  }, [asking]);
  const left = Math.max(0, Math.round((expiresAt - now) / 1_000));
  useEffect(() => { if (left === 0) onAnswer(false); }, [left, onAnswer]);
  return (
    <section className="wk-apps-card" data-testid="apps-card" aria-label={`Run ${card.action}?`} role="dialog">
      <header className="wk-apps-card-head">Run “{card.action}”?</header>
      <p className="wk-apps-card-lock">Drawn by studio, outside the app: the app can’t change or click it.</p>
      {card.sample && <p className="wk-apps-card-sample" data-testid="apps-card-sample">Sample: nothing is written to a source.</p>}
      <dl className="wk-apps-card-rows">
        <dt>Source</dt><dd data-testid="apps-card-source">{card.source}</dd>
        <dt>Operation</dt><dd data-testid="apps-card-operation">{card.operation}</dd>
        {card.rows.map((r, i) => (
          <div key={i} className="wk-apps-card-row" data-testid="apps-card-row">
            <dt>{r.label}</dt><dd>{r.value}{r.from !== null && <span className="wk-apps-card-from"> ({r.from})</span>}</dd>
          </div>
        ))}
        {card.key !== null && (<><dt>Row</dt><dd data-testid="apps-card-key">{card.key}</dd></>)}
      </dl>
      {card.checks !== null && <p className="wk-apps-card-checks">{card.checks}</p>}
      <pre className="wk-apps-card-request" data-testid="apps-card-request">{card.request}</pre>
      {card.says !== null && <p className="wk-apps-card-says">The app says: “{card.says}”</p>}
      <p className="wk-apps-card-note">Asked every time. If anything else would change, nothing is written.</p>
      <footer className="wk-apps-card-foot">
        <button type="button" className="wk-btn wk-btn--primary" data-testid="apps-card-run" data-armed={armed} disabled={!armed} onClick={() => onAnswer(true)}>Run it</button>
        <button type="button" className="wk-btn wk-btn--secondary" data-testid="apps-card-cancel" onClick={() => onAnswer(false)}>Cancel</button>
        <span className="wk-apps-card-expiry">expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>
      </footer>
    </section>
  );
}

export function AppHostView({ editor, version, sha, app: slug, sample, initialMode, navigate, caps: given, runs = NO_RUNS, back = null }: AppHostProps): React.ReactElement {
  const narrowWindow = useNarrow();
  // The runtime lays itself out by ITS frame's width (its media queries), so Edit is offered only when the frame
  // itself is wide enough, whatever the window is (codex r1: a 1000 px window leaves the frame under 640 px).
  const frameWrap = useRef<HTMLDivElement | null>(null);
  const [frameWidth, setFrameWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = frameWrap.current;
    if (el === null || typeof ResizeObserver !== 'function') return undefined;
    const measure = (): void => setFrameWidth(Math.round(el.getBoundingClientRect().width));
    measure(); // before the first observation, so Edit is never offered for a moment on a frame too narrow for it
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  const narrow = !editable(!narrowWindow, frameWidth);
  const [mode, setMode] = useState<AppMode>(initialMode ?? 'preview');
  const modeRef = useRef<AppMode>(initialMode ?? 'preview');
  const [sharing, setSharing] = useState(false);
  const [publishRunId, setPublishRunId] = useState<string | null>(null);
  const [publishEnabled, setPublishEnabled] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  /** A restore on its way: the panel cannot be closed under it (its progress would vanish). */
  const [restoring, setRestoring] = useState(false);
  const versionsBtn = useRef<HTMLButtonElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const [unarchiving, setUnarchiving] = useState(false);
  // Read before `shown`: an archived app is Preview only (crew refuses every change until it is restored).
  const [detail, setDetail] = useState<AppDetail | null>(null);
  const archived = archivedOf(detail) != null;
  const shown = narrow || archived ? 'preview' : mode;
  // When Edit was left: a field typed in Edit commits as the person clicks Preview, and that op is still Edit's.
  const editLeftRef = useRef(Number.NEGATIVE_INFINITY);
  // Only the person's own switch to Preview gets that grace; Edit taken away (a phone, an archived app) ends at once.
  if (modeRef.current === 'edit' && shown !== 'edit') editLeftRef.current = mode === 'preview' ? Date.now() : Number.NEGATIVE_INFINITY;
  // ...and a grace already running ends the moment Edit is taken away (Preview, then a phone within it: codex r3).
  if (narrow || archived) editLeftRef.current = Number.NEGATIVE_INFINITY;
  modeRef.current = shown;
  // The host page decides framing, once, and never relaxes it (§7.1): studio refuses to be framed (S8), so a framed
  // studio is a page someone else put it in.
  const framed = useMemo(() => { try { return window.top !== window.self; } catch { return true; } }, []);
  const [status, setStatus] = useState<string | null>(null);
  const [torn, setTorn] = useState<string | null>(null);
  const [chips, setChips] = useState<Chip[]>([]);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [link, setLink] = useState<LinkAsk | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [kind, setKind] = useState<{ store: 'crew' | 'sample'; queries: 'crew' | 'sample'; actions: 'crew' | 'sample' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  /** (K5) crew runs chat turns for this app (health `capabilities.apps.turns`). */
  const [turnsOn, setTurnsOn] = useState(false);
  /** (K5) The side panel: Chat (the default) or Properties; collapsed is remembered across sessions. */
  const [panelTab, setPanelTab] = useState<PanelTab>('chat');
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed());
  // Bumped when the working spec changes (a Properties edit, a burst): the panel reads the session again.
  const [, setSpecTick] = useState(0);
  const [mountKey, setMountKey] = useState(0);
  const frameBox = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<EditorHost | null>(null);
  const sessionRef = useRef<AppSession | null>(null);
  const askingRef = useRef<Asking | null>(null);
  askingRef.current = asking;

  const linkRef = useRef<LinkAsk | null>(null);
  linkRef.current = link;

  const answer = useCallback((yes: boolean) => {
    const a = askingRef.current;
    if (a === null) return;
    askingRef.current = null;
    setAsking(null);
    a.resolve(yes);
  }, []);
  /** Settle an open link question (closing, reloading, or leaving Preview): it never opens on its own. */
  const settleLink = useCallback(() => {
    const l = linkRef.current;
    linkRef.current = null;
    setLink(null);
    l?.resolve(false);
  }, []);

  useEffect(() => {
    if (frameBox.current === null) return;
    let cancelled = false;
    let off: (() => void) | undefined;
    const start = async (): Promise<void> => {
      // A replacement session starts clean: nothing of the last one's lines, count or outcome shows for this one.
      setError(null);
      setTorn(null);
      setPending(0);
      setOutcome(null);
      setStatus(null);
      if (slug !== null && !isAppSlug(slug)) { if (!cancelled) setError(`“${slug}” is not an app’s address.`); return; }
      let caps: AppsCapabilities | undefined;
      if (given !== undefined) caps = given.apps;
      else {
        try { caps = (await api.getHealth()).capabilities?.apps; } catch (e) {
          // A named app needs crew: a daemon that did not answer is an error, never a reason to show a sample instead.
          if (slug !== null) { if (!cancelled) setError(`The daemon did not answer, so this app could not be opened: ${e instanceof Error ? e.message : String(e)}`); return; }
          caps = undefined;
        }
      }
      if (!cancelled) setPublishEnabled(caps?.publish === true);
      const picked = sampleApp(sample);
      const store: AppStorePort = slug !== null && caps !== undefined ? new CrewAppStore(slug) : new SampleAppStore(picked.slug, picked.spec);
      const session = new AppSession(store);
      let loaded: AppDetail;
      try { loaded = await session.load(); } catch (e) { if (!cancelled) setError(`This app could not be read: ${e instanceof Error ? e.message : String(e)}`); return; }
      const live: AppDataPort = appDataFor(store.kind === 'crew' ? caps : undefined, store.kind === 'crew' ? store.slug : null, () => sampleAppData(() => session.landedSpec ?? loaded.spec, store.kind === 'sample' ? picked.data : null));
      // (K5) What this page shows is kept, in memory, for the dashboard's preview of the app (it reads nothing itself).
      const data: AppDataPort = store.kind === 'crew' && live.kind.queries === 'crew' ? recordingPort(store.slug, live) : live;
      const decided = await fetchGrants(editor, version, sha, null);
      if (cancelled || frameBox.current === null) { session.dispose(); return; }
      sessionRef.current = session;
      setKind({ store: store.kind, ...data.kind });
      setTurnsOn(store.kind === 'crew' && caps?.turns === true);
      setDetail(loaded);
      off = session.on((e) => {
        if (e.kind === 'head') { setDetail(e.app); if (e.by === 'this-session') setStatus(`Saved as v${e.app.head.version}`); }
        if (e.kind === 'pending') { setPending(e.count); setSpecTick((n) => n + 1); }
        if (e.kind === 'failed') setStatus(e.message);
      });
      const who = data.viewer().email ?? 'you';
      setViewer(who);
      // The host draws Properties for every crew app (DES-REPORT-DASHBOARDS-001 §2: its App group holds Show on Report,
      // which is not a spec op), with the Chat tab only where crew runs turns.
      const hostProps = store.kind === 'crew';
      const port: AppHostPort = {
        session, data, ...(hostProps ? { propsHost: true } : {}),
        framed: () => framed,
        mode: () => modeRef.current,
        editing: () => modeRef.current === 'edit' || Date.now() - editLeftRef.current < SPEC_EDIT_AFTER_FOCUS_MS,
        viewer: () => who,
        url: () => urlParamsOf(window.location.search),
        confirm: (prepared) => new Promise<boolean>((resolve) => {
          setOutcome(null);
          setLink(null);
          setAsking({ prepared, resolve, at: Date.now() });
        }),
        openLink: (url) => new Promise<boolean>((resolve) => setLink({ url, resolve })),
        outcome: (o, card) => setOutcome(outcomeWords(o, card)),
      };
      const host = new EditorHost({
        container: frameBox.current,
        src: bundleUrl(apiBase(), editor, version, sha),
        editor, version,
        name: 'App',
        title: `App: ${loaded.name}, version ${loaded.head.version}`,
        size: 'full', surface: 'full',
        grants: decided.grants,
        theme: readThemeTokens(),
        prefs: { reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, techDetails: false, locale: navigator.language },
        firstParty: editor.startsWith('wicked-'),
        adapter: new AppAdapter(session, loaded.name),
        app: port,
        ui: {
          chips: (c) => {
            setChips(c);
            if (store.kind === 'crew') mirrorSelection(store.slug, c);
            // (K5) Selecting a component switches the side panel to Properties for it. A collapsed panel stays
            // collapsed (opening it would move the canvas under the pointer, and could close Edit): its Properties
            // icon shows the selection (xreview r4).
            if (c.some((x) => x.anchor.kind === 'element')) setPanelTab('properties');
          }, draft: () => {}, typed: () => {}, key: () => {}, morph: () => {},
          status: (line) => setStatus(line), notes: () => {}, thread: () => {},
          writeFailed: (m) => setStatus(m),
          fullscreen: async () => false,
          torn: (reason) => { setTorn(reason); answer(false); },
          log: () => {},
        },
      });
      hostRef.current = host;
      host.mount();
      if (decided.note !== null) setStatus(decided.note);
    };
    void start();
    return () => {
      cancelled = true;
      off?.();
      answer(false);
      settleLink();
      hostRef.current?.teardown('The app was closed');
      hostRef.current = null;
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [editor, version, sha, slug, sample, framed, answer, settleLink, mountKey, given]);

  // Changes the runtime was told are pending still land when the view closes (AppSession.dispose); a tab closed within
  // that second asks first, as a browser does for any unsaved change.
  useEffect(() => {
    if (pending === 0) return undefined;
    const warn = (e: BeforeUnloadEvent): void => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);

  // Every tab agrees because the pointer is crew's: read the head again on focus, on showing, and every 5 s.
  useEffect(() => {
    const again = (): void => { if (document.visibilityState === 'visible') void sessionRef.current?.refresh(); };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    const t = setInterval(again, 5_000);
    return () => { window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', again); clearInterval(t); };
  }, []);

  const publishStates = runs.filter((v) => v.session.id === publishRunId || (detail !== null && v.session.workflow_id === 'apps-publish' && v.session.repo_ref === detail.repoId))
    .map((v) => `${v.session.id}:${v.session.status}`).join('|');
  useEffect(() => { void sessionRef.current?.refresh(); }, [publishStates]);

  useEffect(() => {
    hostRef.current?.setAppMode(shown);
    if (shown === 'preview') setChips([]);
    // A card or a link question belongs to the Preview it was asked in: leaving it cancels them (nothing runs).
    else { answer(false); settleLink(); }
  }, [shown, answer, settleLink]);

  // The person switches theme (or the accent) while the app is open: the runtime takes the new tokens (as PluginCard).
  useEffect(() => {
    if (typeof MutationObserver !== 'function') return undefined;
    const seen = new MutationObserver(() => hostRef.current?.setTheme(readThemeTokens()));
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    return () => seen.disconnect();
  }, []);

  const move = async (direction: 'undo' | 'redo'): Promise<void> => {
    const s = sessionRef.current;
    // A framed studio changes nothing, from the frame or from its own chrome (§7.1, S8; codex r2 P1).
    if (s === null || framed) return;
    const r = await s.move(direction, s.head);
    setStatus(r.ok ? `${direction === 'undo' ? 'Undone' : 'Redone'}: now v${r.version}` : r.message);
  };

  /** (K5) A chat message waits for the person's own edit burst to land, then names the head it made (null: not saved). */
  const prepareSend = async (): Promise<number | null> => {
    const s = sessionRef.current;
    if (s === null) return null;
    // Every edit made before Send lands first, those made while one landed included (xreview r2: one flush left
    // them for a later burst that the turn would then refuse).
    return drainForSend(s);
  };

  /** (G16) Restore the app out of Archived: crew's detail after it is taken at once, then the session re-reads. */
  const unarchive = async (): Promise<void> => {
    if (slug === null || framed || unarchiving) return;
    setUnarchiving(true);
    try {
      const r = await setArchived(slug, false);
      setStatus(r.ok ? 'Restored: the app is back on Apps and can be changed again.' : `Not restored: ${r.message}`);
      // Through the session, so its next read compares against this answer (one source for the view).
      if (r.ok) {
        sessionRef.current?.take(r.app);
        // The line and its button are gone: the status line that says so takes the focus.
        // ...only when the focus was lost with that button (never pulled from wherever the person has since gone).
        requestAnimationFrame(() => { if (document.activeElement === null || document.activeElement === document.body) statusRef.current?.focus(); });
      }
    } finally {
      setUnarchiving(false);
    }
  };

  const history = detail?.history;
  const busy = detail?.turn != null;
  // A phone is view + chat (operator ruling D5): none of the controls that change the app are drawn there.
  const phone = narrowWindow;
  const versionsWhy = framed ? 'This page is inside another page, so nothing can be restored here.'
    : archived ? 'This app is archived: restore it to Apps first.'
      : busy ? 'A chat turn is changing the app: restore after it lands.' : null;
  // (K5) Chat is how an app changes: open on every crew app's page, in Preview and in Edit alike. On an archived app it
  // stays (closed, saying why), so a message being typed when the archive is seen is kept (codex r3).
  const chatOn = turnsOn && kind?.store === 'crew' && slug !== null && detail !== null;
  // The side panel (Properties, and Chat when crew runs turns) is on every crew app's page: its Properties tab holds
  // the app's own settings (Show on Report), which need no chat (DES-REPORT-DASHBOARDS-001 §2).
  const sideOn = kind?.store === 'crew' && slug !== null && detail !== null;
  const tab: PanelTab = chatOn ? panelTab : 'properties';
  const crumb = back ?? { path: '/apps', label: 'Apps' };
  const idle = asking === null && link === null && outcome === null;

  return (
    <div className="wk-apps-host" data-testid="apps-host" data-mode={shown} data-framed={framed}>
      <header className="wk-apps-head">
        {navigate !== undefined
          ? <a href={crumb.path} className="wk-apps-crumb wk-link" data-testid="apps-crumb" onClick={(ev) => { ev.preventDefault(); navigate(crumb.path); }}>{crumb.label} /</a>
          : <span className="wk-apps-crumb">Apps /</span>}
        <span className="wk-apps-title" data-testid="apps-title">{detail?.name ?? 'App'}</span>
        {detail !== null && (
          <span className="wk-apps-pill" data-testid="apps-version"><span className="wk-apps-dot" aria-hidden="true" />v{detail.head.version} · {receiptWords(detail)}</span>
        )}
        {!phone && (
          <span className="wk-apps-history" role="group" aria-label="History">
            <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-undo" disabled={history?.canUndo !== true || busy || framed || archived} onClick={() => void move('undo')} aria-label="Undo">Undo</button>
            <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-redo" disabled={history?.canRedo !== true || busy || framed || archived} onClick={() => void move('redo')} aria-label="Redo">Redo</button>
            <button ref={versionsBtn} type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-versions-open" disabled={detail === null || restoring} aria-expanded={versionsOpen}
              onClick={() => setVersionsOpen((o) => !o)}>Versions</button>
          </span>
        )}
        {shown === 'edit' && <span className="wk-apps-hint" data-testid="apps-edit-hint">{chatOn ? 'Fine-tune by hand: changes save as you make them · for anything bigger, ask in the chat' : 'Changes save as you make them · Undo to go back'}</span>}
        <span className="wk-apps-spacer" />
        {shown === 'preview' && viewer !== null && <span className="wk-apps-pill" data-testid="apps-viewer">Viewing as {viewer}</span>}
        <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-share-open" disabled={detail === null} onClick={() => setSharing(true)}>Share</button>
        {!phone && (
          <span className="wk-seg" role="group" aria-label="Mode">
            <button type="button" className={`wk-seg-btn${shown === 'edit' ? ' wk-seg-btn--on' : ''}`} data-testid="apps-mode-edit" aria-pressed={shown === 'edit'} disabled={narrow || framed || archived} title={framed ? 'Open studio on its own to change the app' : archived ? 'Restore the app to change it' : narrow ? 'Edit on a larger screen' : undefined} onClick={() => setMode('edit')}>Edit</button>
            <button type="button" className={`wk-seg-btn${shown === 'preview' ? ' wk-seg-btn--on' : ''}`} data-testid="apps-mode-preview" aria-pressed={shown === 'preview'} onClick={() => setMode('preview')}>Preview</button>
          </span>
        )}
      </header>
      {archived && (
        <p className="wk-apps-line wk-apps-line--note" data-testid="apps-archived-note">
          This app is archived: it is hidden from Apps and can’t be changed.
          {!phone && !framed && <> · <button type="button" className="wk-btn wk-btn--link" data-testid="apps-unarchive" disabled={unarchiving} onClick={() => void unarchive()}>Restore it</button></>}
        </p>
      )}
      {versionsOpen && !phone && detail !== null && sessionRef.current !== null && (
        <AppVersions detail={detail} session={sessionRef.current} pending={pending} disabledWhy={versionsWhy} onDone={(line) => setStatus(line)} onBusy={setRestoring}
          onClose={() => { setVersionsOpen(false); versionsBtn.current?.focus(); }} />
      )}
      {narrow && (
        <p className="wk-apps-line" data-testid="apps-phone-note">
          {!phone ? 'Edit on a larger screen. This is the app as a viewer sees it.'
            : chatOn && !archived ? 'On a phone you can view the app and ask for changes in the chat. Edit, Undo and Versions are on a larger screen.'
              : 'On a phone you can view the app. Edit, Undo and Versions are on a larger screen.'}
        </p>
      )}
      {kind !== null && (kind.store === 'sample' || kind.queries === 'sample' || kind.actions === 'sample') && (
        <p className="wk-apps-line wk-apps-line--note" data-testid="apps-sample-note">
          {kind.store === 'sample'
            ? `${slug !== null ? `This daemon has no app store, so the app “${slug}” could not be opened: this is a sample app instead. ` : 'A sample app: '}its rows are made up and nothing reaches a source.`
            : kind.queries === 'sample' ? 'This daemon does not run app queries and actions yet: the rows are samples and actions write nothing.'
              : 'The rows are live. This daemon does not run app actions yet: an action shows a sample card and writes nothing.'}
        </p>
      )}
      {(status !== null || pending > 0) && <p ref={statusRef} tabIndex={-1} className="wk-apps-line" data-testid="apps-status" aria-live="polite">{pending > 0 ? `Saving ${pending} change${pending === 1 ? '' : 's'}…` : status}</p>}
      {error !== null && (
        <p className="wk-apps-line wk-apps-line--fail" data-testid="apps-error">
          {error} · <button type="button" className="wk-btn wk-btn--link" data-testid="apps-error-retry" onClick={() => setMountKey((k) => k + 1)}>Try again</button>
        </p>
      )}
      {/* Always there in Edit (selecting must never move the app under the pointer: a double-click's second press
          would land on another component). */}
      {shown === 'edit' && (
        <p className="wk-apps-line wk-apps-chips" data-testid="apps-chips">
          {chips.length > 0
            ? chips.map((c, i) => <span key={i} className="wk-source-chip" data-testid="apps-chip">about: {c.label}</span>)
            : <span className="wk-apps-line--note">{chatOn ? 'Select a component to ask the chat about just that one.' : 'Select a component to make it the subject of your next message.'}</span>}
        </p>
      )}
      <div className="wk-apps-body" data-mode={shown} data-chat={sideOn} data-panel={sideOn && collapsed && asking === null && link === null ? 'collapsed' : 'open'}>
        <div className="wk-apps-frame" ref={frameWrap}>
          {torn !== null && (
            <p className="wk-apps-line wk-apps-line--fail" data-testid="apps-torn">{torn} · <button type="button" className="wk-btn wk-btn--link" onClick={() => setMountKey((k) => k + 1)}>Reload it</button></p>
          )}
          <div ref={frameBox} key={mountKey} className="wk-apps-frame-box" data-testid="apps-frame-box" />
        </div>
        {(() => { const dock = (
        <aside className={`wk-apps-dock${narrow && asking === null && link === null ? ' wk-apps-dock--quiet' : ''}${sideOn && idle ? ' wk-apps-dock--idle' : ''}`} aria-label="Needs you" data-testid="apps-dock">
          <h2 className="wk-apps-dock-title">Needs you <span className="wk-apps-dock-count">{asking !== null || link !== null ? '1 waiting' : 'nothing waiting'}</span></h2>
          {asking !== null && <ActionCardView asking={asking} onAnswer={answer} />}
          {link !== null && (
            <section className="wk-apps-card" data-testid="apps-link-confirm" role="dialog" aria-label="Open this link?">
              <header className="wk-apps-card-head">Open this link?</header>
              <p className="wk-apps-card-lock">The app asks to open a page in a new tab. Studio shows the whole address first.</p>
              <pre className="wk-apps-card-request" data-testid="apps-link-url">{link.url}</pre>
              <footer className="wk-apps-card-foot">
                <button type="button" className="wk-btn wk-btn--primary" data-testid="apps-link-open" onClick={() => { const l = link; setLink(null); window.open(l.url, '_blank', 'noopener,noreferrer'); l.resolve(true); }}>Open</button>
                <button type="button" className="wk-btn wk-btn--secondary" data-testid="apps-link-cancel" onClick={() => { const l = link; setLink(null); l.resolve(false); }}>Cancel</button>
              </footer>
            </section>
          )}
          {asking === null && link === null && outcome !== null && <p className="wk-apps-outcome" data-testid="apps-outcome">{outcome}</p>}
          {asking === null && link === null && (
            <p className="wk-apps-dock-hint">
              {framed ? 'This page is inside another page, so the app cannot run actions here.'
                : shown === 'edit' ? 'Actions run in Preview. Studio asks you here before each one.'
                  : 'When the app asks to change something, studio shows exactly what here and waits for you.'}
            </p>
          )}
        </aside>);
          // A sample app has no side panel: the dock is the body's second column, exactly as K4 drew it (xreview r1 on
          // K5: a wrapper changed the canvas's size there); a crew app's dock sits above the panel in one side column.
          if (!sideOn) return dock;
          const turns = turnsOf(detail);
          const lastEnded = [...turns].reverse().find((t) => t.state !== 'running');
          const mark = lastEnded === undefined ? '' : `${lastEnded.runId}:${lastEnded.state}`;
          const chatSeen = chatOn && !collapsed && tab === 'chat';
          if (chatSeen && mark !== '' && readSeen(slug) !== mark) writeSeen(slug, mark);
          const unread = chatOn && !chatSeen && mark !== '' && readSeen(slug) !== mark;
          const selectedId = chips.find((x) => x.anchor.kind === 'element')?.anchor;
          const selId = selectedId !== undefined && selectedId.kind === 'element' ? selectedId.id : null;
          // A card or a link question waiting opens the panel: it must never wait unseen.
          const waiting = asking !== null || link !== null;
          return (
            <div className="wk-apps-side">
              <AppSidePanel slug={slug} tab={tab} setTab={setPanelTab} collapsed={collapsed && !waiting} setCollapsed={setCollapsed}
                busy={chatOn && detail.turn != null} unread={unread} dock={dock} phone={narrowWindow} selectedWhileCollapsed={collapsed && selId !== null}
                chat={!chatOn ? null : (
                  <AppChat slug={slug} detail={detail} runs={runs} publishRunId={publishRunId} framed={framed} navigate={navigate ?? ((p) => { window.location.assign(p); })}
                    onSent={() => { void sessionRef.current?.refresh(); }} prepareSend={prepareSend} pending={pending}
                    undoOff={phone || archived}
                    closedWhy={archived ? 'This app is archived: restore it to ask for changes.' : null}
                    onUndo={() => {
                      if (phone || archived) return; // view + chat on a phone (D5), nothing on an archived app: no Undo, whatever drew it
                      if ((sessionRef.current?.pending ?? 0) > 0) { setStatus('Your last edit is still saving: Undo after it lands.'); return; }
                      void move('undo');
                    }} />
                )}
                properties={(
                  <AppProperties key={selId ?? ''} spec={sessionRef.current?.spec ?? detail.spec} selected={selId}
                    app={phone ? null : <ShowOnReport slug={slug} name={detail.name} projectId={detail.projectId} variant="properties" framed={framed} {...(navigate !== undefined ? { navigate } : {})} />}
                    editable={shown === 'edit' && !framed && !narrow && !archived && detail.turn == null}
                    readOnlyWhy={framed ? 'This page is inside another page, so the app cannot be changed here.' : archived ? 'This app is archived: restore it to change it.' : narrow ? 'Edit on a larger screen: properties change in Edit.' : detail.turn != null ? 'A turn is changing the app: properties wait until it lands.' : shown !== 'edit' ? 'Open Edit, then select a component to change it here.' : null}
                    onOps={(ops) => {
                      const s = sessionRef.current;
                      if (s === null) return { ok: false, message: 'the app is not loaded yet' };
                      const r = s.edit(s.head, ops);
                      if (!r.ok) return { ok: false, message: r.message };
                      hostRef.current?.appChangedByHost();
                      setSpecTick((n) => n + 1);
                      return { ok: true };
                    }} />
                )} />
            </div>
          );
        })()}
      </div>
      {sharing && detail !== null && (
        <ShareSheet name={detail.name} slug={detail.slug} detail={detail} published={publishedOf(detail)} publishEnabled={publishEnabled}
          publishDisabledWhy={framed ? 'Open studio on its own to publish.' : archived ? 'Restore this app before publishing.' : kind?.store !== 'crew' ? 'Sample apps cannot be published.' : null}
          onStarted={(id) => { setPublishRunId(id); setPanelTab('chat'); setCollapsed(false); setStatus('Publish started. Its checks and your consent appear in the app’s thread.'); }}
          onClose={() => setSharing(false)} />
      )}
    </div>
  );
}

