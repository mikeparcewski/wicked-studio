import { useEffect, useMemo, useRef, useState } from 'react';
import { apiBase } from '../../api/client.js';
import { EditorHost, type HostLogEntry } from '../../editors/host.js';
import { FakeDocAdapter } from '../../editors/fakeAdapter.js';
import { bundleUrl, fetchGrants, type Chip } from '../../editors/model.js';
import { PERMISSIONS, SIZES, type PermissionId, type Size } from '../../editors/protocol.js';
import { readThemeTokens } from '../../editors/theme.js';

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
    };
  }
}

export function EditorHostPage({ mode }: { mode: 'dev' | 'conformance' }): React.ReactElement {
  const page = useMemo(() => readPage(window.location.search, mode), [mode]);
  const container = useRef<HTMLDivElement | null>(null);
  const frameBox = useRef<HTMLDivElement | null>(null);
  const composerBox = useRef<HTMLTextAreaElement | null>(null);
  const [mountKey, setMountKey] = useState(0);
  const [size, setSize] = useState<Size>('pane');
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
  const hostRef = useRef<EditorHost | null>(null);
  const adapter = useMemo(() => new FakeDocAdapter(), []);
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
        ui: {
          chips: (c) => setChips(c),
          draft: (t, c) => setDrafted((d) => [...d, { text: t, chips: c }]),
          typed: (g) => {
            setText((t) => t + g);
            requestAnimationFrame(() => composerBox.current?.focus());
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
    };
    return () => { delete window.__wickedEditor; };
  }, [adapter]);

  if (page.editor === '' || page.version === '' || page.sha === '') {
    return (
      <div data-testid="editor-host-page" className="wk-editor-page">
        <p className="wk-session-grey">Name an editor: <code>?editor=&lt;id&gt;&amp;version=&lt;v&gt;&amp;sha=&lt;sha256&gt;</code>.</p>
      </div>
    );
  }

  return (
    <div data-testid="editor-host-page" data-mode={mode} className="wk-editor-page">
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
    </div>
  );
}
