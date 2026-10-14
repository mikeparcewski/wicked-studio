import { useEffect, useMemo, useRef, useState } from 'react';
import { apiBase } from '../../api/client.js';
import { EditorHost, sizeOfSurface, type HostLogEntry, type Surface } from '../../editors/host.js';
import type { FullMode } from '../../editors/surfaces.js';
import { FakeDocAdapter, SAMPLE_DECK, SAMPLE_PAGE } from '../../editors/fakeAdapter.js';
import { bundleUrl, fetchGrants, type Chip } from '../../editors/model.js';
import { PERMISSIONS, SIZES, type PermissionId, type Size } from '../../editors/protocol.js';
import { readThemeTokens } from '../../editors/theme.js';
import { EditorTestPagePicker } from './EditorPluginsSettings.js';
import { EditorSurfacesView } from '../editorHost/EditorSurfacesView.js';

/**
 * THE EDITOR HOST PAGE (DES-EDITOR-PLUGINS-001 §10 step 2, §12.1; slice EP-P1): one editor plugin in
 * its sandboxed frame, behind a dev route, with no user surface yet (EP-P2 places the first plugin).
 *
 *  - `/editors/dev?editor=&version=&sha=` loads a plugin from crew's bundle route (EP-C1, or a
 *    fixture of it) over the scripted in-memory page adapter, with grants from crew's decided set.
 *  - `/editors/conformance?…&grants=a,b` is the conformance host the harness drives (§12.1): the same
 *    host, with the grant set given in the address and `window.__wickedEditor` exposing the log,
 *    the adapter and host-side controls (size, theme, an agent version, raw messages for fuzzing).
 *
 * Everything around the frame is host-drawn: the header, the size controls, the composer the chips
 * and typing land in, the thread lines, and "Reload it".
 */

interface Page {
  editor: string;
  version: string;
  sha: string;
  title: string;
  grants: PermissionId[] | null;
  firstParty: boolean;
  /** The kind the sample is (P-D1: `deck` opens a sample deck; anything else the sample page). */
  kind: string;
  /** Protocol 2 (conformance only): the surface this instance is, its options tab, its full-screen mode. */
  surface: Surface | null;
  tab: string | null;
  mode: FullMode | null;
}

function readPage(search: string, mode: 'dev' | 'conformance'): Page {
  const q = new URLSearchParams(search);
  // Grants in the address are the CONFORMANCE host's scripted set only; the dev host always asks
  // crew for its decided set (codex).
  const grants = mode === 'conformance' ? q.get('grants') : null;
  const editor = q.get('editor') ?? '';
  return {
    editor,
    version: q.get('version') ?? '',
    sha: q.get('sha') ?? '',
    title: q.get('title') ?? (editor === '' ? 'Editor' : editor),
    grants: grants === null ? null : grants.split(',').filter((g): g is PermissionId => PERMISSIONS.includes(g as PermissionId)),
    firstParty: editor.startsWith('wicked-'),
    kind: q.get('kind') === 'deck' ? 'deck' : 'page',
    surface: mode === 'conformance' && ['card', 'options', 'full'].includes(q.get('surface') ?? '') ? q.get('surface') as Surface : null,
    // A tab only for an options instance; the host checks it against the declared plugin tabs (codex h3-seam r1 P3).
    tab: mode === 'conformance' && q.get('surface') === 'options' ? q.get('tab') : null,
    mode: mode === 'conformance' && (q.get('mode') === 'simple' || q.get('mode') === 'advanced') ? q.get('mode') as FullMode : null,
  };
}

declare global {
  interface Window {
    __wickedEditor?: {
      log: HostLogEntry[];
      adapter: FakeDocAdapter;
      host: () => EditorHost | null;
      setSize: (s: Size) => void;
      setTheme: (t: Record<string, string>) => void;
      agentVersion: () => void;
      inject: (msg: unknown) => void;
      composer: () => { text: string; chips: Chip[]; drafted: { text: string; chips: Chip[] }[]; keys: string[]; thread: string[]; status: string | null; notes: number };
      /** Protocol 2: the newest accepted options values per controls tab (conformance case 15). */
      optionsValues: () => Record<string, Record<string, unknown>>;
    };
  }
}

export function EditorHostPage({ mode, navigate }: { mode: 'dev' | 'conformance'; navigate?: (path: string) => void }): React.ReactElement {
  // The page is its address: a different query (back/forward between two editors) is a different page.
  const search = window.location.search;
  const page = useMemo(() => readPage(search, mode), [search, mode]);
  const container = useRef<HTMLDivElement | null>(null);
  const frameBox = useRef<HTMLDivElement | null>(null);
  const composerBox = useRef<HTMLTextAreaElement | null>(null);
  const [mountKey, setMountKey] = useState(0);
  const [showProtocol, setShowProtocol] = useState(false);
  const [size, setSize] = useState<Size>(page.surface !== null ? sizeOfSurface(page.surface) : 'pane');
  // A new address (another surface, or the dev page) starts at its own size, not the last one's (codex h3-seam r1 P2).
  // Keyed by the address itself (`page` is memoized on the search and the route mode): any new address, even one with
  // the same default, starts at its own size (codex h3-seam r2 P2).
  const [sizeFor, setSizeFor] = useState(page);
  if (sizeFor !== page) { setSizeFor(page); setSize(page.surface !== null ? sizeOfSurface(page.surface) : 'pane'); }
  const [torn, setTorn] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [chips, setChips] = useState<Chip[]>([]);
  const [drafted, setDrafted] = useState<{ text: string; chips: Chip[] }[]>([]);
  const [thread, setThread] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [notes, setNotes] = useState(0);
  const [text, setText] = useState('');
  const keys = useRef<string[]>([]);
  const log = useRef<HostLogEntry[]>([]);
  const optionsSeen = useRef<Record<string, Record<string, unknown>>>({});
  const hostRef = useRef<EditorHost | null>(null);
  const adapter = useMemo(() => (page.kind === 'deck'
    ? new FakeDocAdapter(SAMPLE_DECK, 'Library room booking (deck)', { kind: 'deck' })
    : new FakeDocAdapter(SAMPLE_PAGE)), [page.kind]);
  const live = useRef({ text, chips, drafted, thread, status, notes });
  live.current = { text, chips, drafted, thread, status, notes };

  useEffect(() => {
    if (page.editor === '' || page.version === '' || page.sha === '' || frameBox.current === null) return;
    let cancelled = false;
    setTorn(null);
    const start = async (): Promise<void> => {
      const decided = page.grants !== null ? { grants: page.grants, note: null } : await fetchGrants(page.editor, page.version, page.sha, null);
      if (cancelled || frameBox.current === null) return;
      setNote(decided.note);
      const host = new EditorHost({
        container: frameBox.current,
        src: bundleUrl(apiBase(), page.editor, page.version, page.sha),
        editor: page.editor,
        version: page.version,
        name: page.title,
        title: `${page.title}: ${adapter.artifact().title}, version ${adapter.artifact().version}`,
        size,
        grants: decided.grants,
        theme: readThemeTokens(),
        prefs: { reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, techDetails: false, locale: navigator.language },
        firstParty: page.firstParty,
        adapter,
        ...(page.surface !== null ? { surface: page.surface } : {}),
        ...(page.tab !== null ? { tab: page.tab } : {}),
        ...(page.mode !== null ? { mode: page.mode } : {}),
        ui: {
          chips: (c) => setChips(c),
          draft: (t, c) => setDrafted((d) => [...d, { text: t, chips: c }]),
          typed: (g) => {
            setText((t) => t + g);
            // Focus moves NOW, so the rest of the typing goes straight to the composer.
            composerBox.current?.focus();
          },
          key: (k) => {
            keys.current.push(k);
            if (k === 'Escape') setSize((s) => (s === 'full' ? 'pane' : s));
          },
          morph: (to) => setSize(to),
          status: (line) => setStatus(line),
          notes: (n) => setNotes(n),
          thread: (line) => setThread((t) => [...t, line]),
          fullscreen: async () => {
            const el = container.current;
            if (el === null || document.fullscreenEnabled === false) return false;
            try { await el.requestFullscreen(); return true; } catch { return false; }
          },
          torn: (reason) => setTorn(reason),
          log: (e) => { log.current.push(e); },
          optionsValues: (tab, values) => { optionsSeen.current[tab] = values; },
        },
      });
      hostRef.current = host;
      host.mount();
    };
    void start();
    return () => {
      cancelled = true;
      hostRef.current?.teardown('The editor was closed');
      hostRef.current = null;
    };
    // Size changes are posted to the live frame below; a remount is only "Reload it".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, adapter, mountKey]);

  useEffect(() => { hostRef.current?.setSize(size); }, [size]);

  useEffect(() => {
    window.__wickedEditor = {
      log: log.current,
      adapter,
      host: () => hostRef.current,
      setSize: (s) => setSize(s),
      setTheme: (t) => hostRef.current?.setTheme(t),
      agentVersion: () => { const v = adapter.agentEdit(); hostRef.current?.artifactChanged(v, 'generated'); },
      inject: (msg) => hostRef.current?.inject(msg),
      composer: () => ({ ...live.current, keys: [...keys.current] }),
      optionsValues: () => ({ ...optionsSeen.current }),
    };
    return () => { delete window.__wickedEditor; };
  }, [adapter]);

  if (page.editor === '' || page.version === '' || page.sha === '') {
    // UX audit row 39: with no editor named, the test page lists the installed ones to open (X3).
    return (
      // A single scrolling column (codex): not the two-column host frame, which reserves the host's side panel.
      <div data-testid="editor-host-page" data-mode={mode} className="flex-1 min-w-0 overflow-y-auto">
        <EditorTestPagePicker navigate={navigate ?? ((p) => { history.pushState(null, '', p); window.dispatchEvent(new PopStateEvent('popstate')); })} />
      </div>
    );
  }

  return (
    <div data-testid="editor-host-page" data-mode={mode} className="wk-editor-page">
      {/* H7: the three surfaces, drawn by the run page's own host components from the plugin's declaration. */}
      {mode === 'dev' && (
        <>
          <EditorSurfacesView editor={page.editor} version={page.version} sha={page.sha} title={page.title} kind={page.kind} />
          {/* The one-frame protocol view stays for debugging, folded away (operator: it sat below the surfaces). */}
          <p className="wk-editor-protocol-toggle">
            <button type="button" data-testid="editor-protocol-toggle" aria-expanded={showProtocol} className="wk-since-toggle"
              onClick={() => { setShowProtocol((v) => !v); setMountKey((k) => k + 1); }}>
              {showProtocol ? 'Hide the one-frame protocol view' : 'Show the one-frame protocol view (sizes, log)'}
            </button>
          </p>
        </>
      )}
      {(mode === 'conformance' || showProtocol) && (<>
      <div ref={container} data-testid="editor-artifact-frame" data-size={size} className={`wk-editor-artifact wk-editor-artifact--${size}`}>
        <header className="wk-editor-head">
          <span className="wk-editor-title">{page.title}</span>
          {status !== null && <span data-testid="editor-status" className="wk-editor-status">{status}</span>}
          <span className="wk-editor-sizes" role="group" aria-label="Size">
            {SIZES.map((s) => (
              <button key={s} type="button" data-testid={`editor-size-${s}`} aria-pressed={size === s} onClick={() => setSize(s)} className="wk-editor-size">{s}</button>
            ))}
          </span>
        </header>
        {note !== null && <p data-testid="editor-grants-note" className="wk-session-grey">{note}</p>}
        {torn !== null ? (
          <p data-testid="editor-torn" className="wk-editor-torn">
            {torn} ·{' '}
            <button type="button" data-testid="editor-reload" onClick={() => setMountKey((k) => k + 1)} className="wk-since-toggle">Reload it</button>
          </p>
        ) : null}
        <div ref={frameBox} key={mountKey} className="wk-editor-frame-box" />
      </div>

      <section className="wk-editor-side" aria-label="Host">
        {thread.length > 0 && (
          <ul data-testid="editor-thread" className="wk-editor-thread">{thread.map((t, i) => <li key={i}>{t}</li>)}</ul>
        )}
        {notes > 0 && <p data-testid="editor-notes" className="wk-session-grey">{notes} note{notes === 1 ? '' : 's'} from this editor (its own, not a check)</p>}
        <div className="wk-editor-composer">
          {chips.length > 0 && (
            <p data-testid="editor-chips" className="wk-editor-chips">
              {chips.map((c, i) => <span key={i} data-testid="editor-chip" className="wk-source-chip">about: {c.label}</span>)}
            </p>
          )}
          {drafted.map((d, i) => (
            <p key={i} data-testid="editor-drafted" className="wk-editor-drafted">Suggested by {page.title}: {d.text}</p>
          ))}
          <textarea
            ref={composerBox}
            data-testid="editor-composer"
            aria-label="Ask or tell studio what to do"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="wk-desk-input"
          />
        </div>
      </section>
      </>)}
    </div>
  );
}
