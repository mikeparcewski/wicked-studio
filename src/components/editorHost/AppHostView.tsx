import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiBase } from '../../api/client.js';
import type { AppDetail, AppsCapabilities, SessionView } from '../../api/types.js';
import { EditorHost, SPEC_EDIT_AFTER_FOCUS_MS } from '../../editors/host.js';
import { bundleUrl, fetchGrants, type Chip } from '../../editors/model.js';
import { readThemeTokens } from '../../editors/theme.js';
import { AppAdapter, type AppHostPort, type AppMode } from '../../editors/apps/appAdapter.js';
import { appDataFor, sampleAppData, type ActionCard, type ActionOutcome, type AppDataPort, type PreparedAction } from '../../editors/apps/appData.js';
import { AppSession } from '../../editors/apps/appSession.js';
import { CrewAppStore, SampleAppStore, type AppStorePort } from '../../editors/apps/appStore.js';
import { sampleApp } from '../../editors/apps/samples.js';
import { isAppSlug, publishedOf } from '../../editors/apps/appsDirectory.js';
import { ShareSheet } from '../apps/ShareSheet.js';
import { AppChat, appComposerKey } from '../apps/AppChat.js';
import { addAboutChip, chipsOf, removeAboutChip, useComposerChips } from '../../store/composerChips.js';

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

export function AppHostView({ editor, version, sha, app: slug, sample, initialMode, navigate, caps: given, runs = NO_RUNS }: AppHostProps): React.ReactElement {
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
  const shown = narrow ? 'preview' : mode;
  // When Edit was left: a field typed in Edit commits as the person clicks Preview, and that op is still Edit's.
  const editLeftRef = useRef(Number.NEGATIVE_INFINITY);
  if (modeRef.current === 'edit' && shown !== 'edit') editLeftRef.current = Date.now();
  modeRef.current = shown;
  // The host page decides framing, once, and never relaxes it (§7.1): studio refuses to be framed (S8), so a framed
  // studio is a page someone else put it in.
  const framed = useMemo(() => { try { return window.top !== window.self; } catch { return true; } }, []);
  const [detail, setDetail] = useState<AppDetail | null>(null);
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
      const picked = sampleApp(sample);
      const store: AppStorePort = slug !== null && caps !== undefined ? new CrewAppStore(slug) : new SampleAppStore(picked.slug, picked.spec);
      const session = new AppSession(store);
      let loaded: AppDetail;
      try { loaded = await session.load(); } catch (e) { if (!cancelled) setError(`This app could not be read: ${e instanceof Error ? e.message : String(e)}`); return; }
      const data: AppDataPort = appDataFor(store.kind === 'crew' ? caps : undefined, store.kind === 'crew' ? store.slug : null, () => sampleAppData(() => session.landedSpec ?? loaded.spec, store.kind === 'sample' ? picked.data : null));
      const decided = await fetchGrants(editor, version, sha, null);
      if (cancelled || frameBox.current === null) { session.dispose(); return; }
      sessionRef.current = session;
      setKind({ store: store.kind, ...data.kind });
      setTurnsOn(store.kind === 'crew' && caps?.turns === true);
      setDetail(loaded);
      off = session.on((e) => {
        if (e.kind === 'head') { setDetail(e.app); if (e.by === 'this-session') setStatus(`Saved as v${e.app.head.version}`); }
        if (e.kind === 'pending') setPending(e.count);
        if (e.kind === 'failed') setStatus(e.message);
      });
      const who = data.viewer().email ?? 'you';
      setViewer(who);
      const port: AppHostPort = {
        session, data,
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
          chips: (c) => { setChips(c); if (store.kind === 'crew') mirrorSelection(store.slug, c); }, draft: () => {}, typed: () => {}, key: () => {}, morph: () => {},
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

  const history = detail?.history;
  const busy = detail?.turn != null;
  // (K5) Chat is how an app changes: open on every crew app's page, in Preview and in Edit alike.
  const chatOn = turnsOn && kind?.store === 'crew' && slug !== null && detail !== null;
  const idle = asking === null && link === null && outcome === null;

  return (
    <div className="wk-apps-host" data-testid="apps-host" data-mode={shown} data-framed={framed}>
      <header className="wk-apps-head">
        {navigate !== undefined
          ? <a href="/apps" className="wk-apps-crumb wk-link" data-testid="apps-crumb" onClick={(ev) => { ev.preventDefault(); navigate('/apps'); }}>Apps /</a>
          : <span className="wk-apps-crumb">Apps /</span>}
        <span className="wk-apps-title" data-testid="apps-title">{detail?.name ?? 'App'}</span>
        {detail !== null && (
          <span className="wk-apps-pill" data-testid="apps-version"><span className="wk-apps-dot" aria-hidden="true" />v{detail.head.version} · {receiptWords(detail)}</span>
        )}
        <span className="wk-apps-history" role="group" aria-label="History">
          <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-undo" disabled={history?.canUndo !== true || busy || framed} onClick={() => void move('undo')} aria-label="Undo">Undo</button>
          <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-redo" disabled={history?.canRedo !== true || busy || framed} onClick={() => void move('redo')} aria-label="Redo">Redo</button>
        </span>
        {shown === 'edit' && <span className="wk-apps-hint" data-testid="apps-edit-hint">{chatOn ? 'Fine-tune by hand: changes save as you make them · for anything bigger, ask in the chat' : 'Changes save as you make them · Undo to go back'}</span>}
        <span className="wk-apps-spacer" />
        {shown === 'preview' && viewer !== null && <span className="wk-apps-pill" data-testid="apps-viewer">Viewing as {viewer}</span>}
        <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-share-open" disabled={detail === null} onClick={() => setSharing(true)}>Share</button>
        <span className="wk-seg" role="group" aria-label="Mode">
          <button type="button" className={`wk-seg-btn${shown === 'edit' ? ' wk-seg-btn--on' : ''}`} data-testid="apps-mode-edit" aria-pressed={shown === 'edit'} disabled={narrow || framed} title={framed ? 'Open studio on its own to change the app' : narrow ? 'Edit on a larger screen' : undefined} onClick={() => setMode('edit')}>Edit</button>
          <button type="button" className={`wk-seg-btn${shown === 'preview' ? ' wk-seg-btn--on' : ''}`} data-testid="apps-mode-preview" aria-pressed={shown === 'preview'} onClick={() => setMode('preview')}>Preview</button>
        </span>
      </header>
      {narrow && <p className="wk-apps-line" data-testid="apps-phone-note">Edit on a larger screen. This is the app as a viewer sees it.</p>}
      {kind !== null && (kind.store === 'sample' || kind.queries === 'sample' || kind.actions === 'sample') && (
        <p className="wk-apps-line wk-apps-line--note" data-testid="apps-sample-note">
          {kind.store === 'sample'
            ? `${slug !== null ? `This daemon has no app store, so the app “${slug}” could not be opened: this is a sample app instead. ` : 'A sample app: '}its rows are made up and nothing reaches a source.`
            : kind.queries === 'sample' ? 'This daemon does not run app queries and actions yet: the rows are samples and actions write nothing.'
              : 'The rows are live. This daemon does not run app actions yet: an action shows a sample card and writes nothing.'}
        </p>
      )}
      {(status !== null || pending > 0) && <p className="wk-apps-line" data-testid="apps-status" aria-live="polite">{pending > 0 ? `Saving ${pending} change${pending === 1 ? '' : 's'}…` : status}</p>}
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
      <div className="wk-apps-body" data-mode={shown} data-chat={chatOn}>
        <div className="wk-apps-frame" ref={frameWrap}>
          {torn !== null && (
            <p className="wk-apps-line wk-apps-line--fail" data-testid="apps-torn">{torn} · <button type="button" className="wk-btn wk-btn--link" onClick={() => setMountKey((k) => k + 1)}>Reload it</button></p>
          )}
          <div ref={frameBox} key={mountKey} className="wk-apps-frame-box" data-testid="apps-frame-box" />
        </div>
        <div className="wk-apps-side">
        <aside className={`wk-apps-dock${narrow && asking === null && link === null ? ' wk-apps-dock--quiet' : ''}${chatOn && idle ? ' wk-apps-dock--idle' : ''}`} aria-label="Needs you" data-testid="apps-dock">
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
        </aside>
        {chatOn && (
          <AppChat slug={slug} detail={detail} runs={runs} framed={framed} navigate={navigate ?? ((p) => { window.location.assign(p); })}
            onSent={() => { void sessionRef.current?.refresh(); }} onUndo={() => void move('undo')} />
        )}
        </div>
      </div>
      {sharing && detail !== null && (
        <ShareSheet name={detail.name} slug={detail.slug} published={publishedOf(detail)} onClose={() => setSharing(false)} />
      )}
    </div>
  );
}

