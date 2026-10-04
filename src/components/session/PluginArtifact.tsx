import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiBase } from '../../api/client.js';
import type { EditorView } from '../../api/editors.js';
import { getVersions, interactiveDocUrl } from '../../api/interactive.js';
import { editedLine, notUndoneLine, shrink, undoneLine, writtenWords, type ArtifactSize, type WriteVerb } from '../../board/artifactMorph.js';
import { focusBeside } from '../../editors/focus.js';
import { EditorHost, type HostLogEntry } from '../../editors/host.js';
import { InteractiveDocAdapter } from '../../editors/interactiveDocAdapter.js';
import { bundleUrl, fetchGrants } from '../../editors/model.js';
import { readThemeTokens } from '../../editors/theme.js';
import { addAboutChip } from '../../store/composerChips.js';
import { useSessionDrafts } from '../../store/sessionDrafts.js';
import { ChecksPanel } from './ChecksPanel.js';

/**
 * EP-P2 — the kind slot hosting an editor PLUGIN (DES-EDITOR-PLUGINS-001 §4, §5, §9.3): `wicked-page`
 * for a page, from crew's registry (hash-pinned bundle route, the engine's decided grants), over the
 * `interactive-doc` adapter. Everything around the frame is the host's: the composer chips (its own
 * words for the element), the first typed character landing in the session composer with the focus,
 * Esc / ⌘K / the navigation chords, the thread line under the page with its Undo, the status, and
 * "Reload it". The frame is one element at every size — pane ↔ full never re-parents it (EP-D2).
 */

/** Idle: how often the head is re-read, so a version a helper lands shows up in the page. */
const IDLE_MS = 5_000;

type Line =
  | { kind: 'edited'; version: number; base: number; what: string; verb: WriteVerb }
  | { kind: 'undone'; version: number }
  | { kind: 'not-undone'; head: number }
  | { kind: 'working' | 'failed' | 'status'; text: string }
  | { kind: 'drafted'; editor: string; text: string };

/** The session composer this artifact's chips go to: the typed character lands there, with the focus. */
function focusComposer(composerKey: string): void {
  const el = document.querySelector<HTMLTextAreaElement>(`[data-testid="composer"][data-composer="${composerKey}"] textarea`);
  if (el === null) return;
  el.focus();
  requestAnimationFrame(() => { const n = el.value.length; el.setSelectionRange(n, n); });
}

/** A forwarded chord, re-pressed in the host's own document so its registered shortcut runs. */
function pressInHost(init: KeyboardEventInit): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

export function PluginArtifact({ projectId, docId, title, composerKey, size, morph, editor, onHead }: {
  projectId: string;
  docId: string;
  title: string;
  composerKey: string;
  size: ArtifactSize;
  morph: (to: ArtifactSize) => void;
  /** The registry record the host loads: id, version and the pinned hash. */
  editor: EditorView;
  onHead?: (head: number) => void;
}): React.ReactElement {
  const frameBox = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<EditorHost | null>(null);
  const logRef = useRef<HostLogEntry[]>([]);
  const [line, setLine] = useState<Line | null>(null);
  const [torn, setTorn] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [mountKey, setMountKey] = useState(0);
  const [busy, setBusy] = useState(false);
  // The version on screen, for the checks panel (EP-P3): the reviews read for this version.
  const [head, setHead] = useState<number | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const morphRef = useRef(morph);
  morphRef.current = morph;
  const onHeadRef = useRef(onHead);
  onHeadRef.current = onHead;
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const adapter = useMemo(
    () => new InteractiveDocAdapter(projectId, docId, title, 'page', (h) => { if (live.current) { onHeadRef.current?.(h); setHead(h); } }),
    [projectId, docId, title],
  );

  // One host per mount: the frame is created once and only its box changes with the size. "Reload it"
  // is the one remount.
  useEffect(() => {
    if (frameBox.current === null) return undefined;
    let cancelled = false;
    setTorn(null);
    const start = async (): Promise<void> => {
      const decided = await fetchGrants(editor.id, editor.version, editor.sha256, projectId);
      await adapter.refresh().catch(() => null);
      if (cancelled || frameBox.current === null) return;
      setNote(decided.note);
      const host = new EditorHost({
        container: frameBox.current,
        src: bundleUrl(apiBase(), editor.id, editor.version, editor.sha256),
        editor: editor.id,
        version: editor.version,
        name: editor.title,
        title: `${editor.title}: ${title}`,
        size: sizeRef.current,
        grants: decided.grants,
        theme: readThemeTokens(),
        prefs: { reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, techDetails: false, locale: navigator.language },
        firstParty: editor.first_party,
        adapter,
        ui: {
          // The host writes every chip's words from its own inventory; the plugin only points.
          chips: (chips) => { for (const c of chips) if (c.anchor.kind === 'element') addAboutChip(composerKey, { kind: 'about', key: `el:${docId}/${c.anchor.id}`, label: c.label }); },
          // Drafted words stay the editor's, visibly: never merged into what the operator typed.
          draft: (text, chips) => { if (live.current) setLine({ kind: 'drafted', editor: editor.title, text: chips.length > 0 ? `${text} (about ${chips.map((c) => c.label).join(', ')})` : text }); },
          typed: (g) => {
            const s = useSessionDrafts.getState();
            s.setDraft(composerKey, `${s.drafts[composerKey] ?? ''}${g}`);
            focusComposer(composerKey);
          },
          key: (k) => {
            if (k === 'Escape') morphRef.current(shrink(sizeRef.current));
            else if (k === 'Mod+K') pressInHost({ key: 'k', code: 'KeyK', metaKey: true, ctrlKey: true });
            else if (k.startsWith('Alt+')) pressInHost({ key: k.slice(4).toLowerCase(), code: `Key${k.slice(4)}`, altKey: true });
            else if (k === 'Tab' || k === 'Shift+Tab') focusBeside(hostRef.current?.frame ?? null, k === 'Shift+Tab');
          },
          morph: (to) => morphRef.current(to),
          status: (l) => { if (live.current) setLine({ kind: 'status', text: l }); },
          notes: () => undefined,
          // The structured `written` draws the line with its Undo; the plain line is the dev page's.
          thread: () => undefined,
          // The line's words are the host's: the anchors it checked, named by it — a third-party editor's
          // line also says who changed it. The plugin's summary never reaches the thread.
          written: (w) => { if (live.current) setLine({ kind: 'edited', version: w.version, base: w.base, what: writtenWords(w.anchors), verb: w.verb }); },
          fullscreen: async () => { morphRef.current('full'); return true; },
          torn: (reason) => { if (live.current) setTorn(reason); },
          log: (e) => { logRef.current.push(e); if (logRef.current.length > 200) logRef.current.shift(); },
        },
      });
      hostRef.current = host;
      host.mount();
    };
    void start();
    return () => {
      cancelled = true;
      hostRef.current?.teardown('The page was closed');
      hostRef.current = null;
    };
  }, [adapter, editor.id, editor.version, editor.sha256, editor.title, editor.first_party, composerKey, docId, projectId, title, mountKey]);

  // The size is posted to the live frame: the same element, a different box (EP-D2).
  useEffect(() => { hostRef.current?.setSize(size); }, [size]);

  // The theme follows studio's: a switch (or a learned theme) re-sends the resolved tokens.
  useEffect(() => {
    if (typeof MutationObserver !== 'function') return undefined;
    const seen = new MutationObserver(() => hostRef.current?.setTheme(readThemeTokens()));
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-skin', 'style', 'class'] });
    return () => seen.disconnect();
  }, []);

  // A live page: a version a helper lands moves the head, and the plugin hears who wrote it.
  const busyRef = useRef(false);
  busyRef.current = busy;
  useEffect(() => {
    const timer = setInterval(() => {
      if (busyRef.current) return;
      void adapter.refresh().then((moved) => { if (moved !== null && live.current) hostRef.current?.artifactChanged(moved.head, moved.kind); }).catch(() => undefined);
    }, IDLE_MS);
    return () => clearInterval(timer);
  }, [adapter]);

  const pointAt = useCallback(async (wid: string): Promise<boolean> => (await hostRef.current?.pointAt(wid)) ?? false, []);

  const undo = async (): Promise<void> => {
    const host = hostRef.current;
    if (line === null || line.kind !== 'edited' || host === null || busy) return;
    setBusy(true);
    const { version } = line;
    setLine({ kind: 'working', text: 'Undoing…' });
    const r = await host.undo(version);
    if (!live.current) return;
    if ('error' in r) setLine(r.error === 'head_moved' ? { kind: 'not-undone', head: r.head ?? adapter.head } : { kind: 'failed', text: `Could not undo: ${r.message}` });
    else setLine({ kind: 'undone', version: adapter.head });
    setBusy(false);
  };

  return (
    <>
      <div className="wk-artifact-body wk-plugin-body" data-testid="plugin-artifact" data-editor={editor.id} data-size={size}>
        <div ref={frameBox} key={mountKey} className="wk-plugin-frame-box" />
        {torn !== null && (
          <p data-testid="plugin-torn" className="wk-artifact-hint wk-plugin-note">
            {torn} · <button type="button" data-testid="plugin-reload" onClick={() => setMountKey((k) => k + 1)} className="wk-since-toggle">Reload it</button>
          </p>
        )}
        {torn === null && note !== null && <p data-testid="plugin-grants-note" className="wk-artifact-hint wk-plugin-note">{note}</p>}
      </div>
      {line !== null && (
        <p data-testid="page-line" data-kind={line.kind} className={`wk-artifact-line${line.kind === 'not-undone' || line.kind === 'failed' ? ' wk-artifact-line--bad' : ''}`}>
          {line.kind === 'edited' && (
            <>
              {editor.first_party ? editedLine(line.version, line.what, line.verb) : `${editor.title} ${line.verb} ${line.what} — version ${line.version}.`}{' '}
              <button type="button" data-testid="page-undo" disabled={busy} onClick={() => void undo()} className="wk-since-toggle">Undo</button>
            </>
          )}
          {line.kind === 'undone' && undoneLine(line.version)}
          {line.kind === 'not-undone' && notUndoneLine(line.head)}
          {(line.kind === 'working' || line.kind === 'failed' || line.kind === 'status') && line.text}
          {line.kind === 'drafted' && <>Suggested by {line.editor}: {line.text}</>}
        </p>
      )}
      {size !== 'inline' && head !== null && (
        <ChecksPanel projectId={projectId} docId={docId} head={head} pointAt={pointAt} />
      )}
    </>
  );
}

/**
 * The kind slot when no installed editor claims the kind (§3.1): the page as served, in the same
 * sandboxed frame, read-only — and the plain sentence saying so. Nothing is guessed, nothing edits.
 */
export function NoEditorPage({ projectId, docId, size, reason, onHead }: {
  projectId: string;
  docId: string;
  size: ArtifactSize;
  reason: string | null;
  onHead?: (head: number) => void;
}): React.ReactElement {
  const [head, setHead] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getVersions(projectId, docId).then((m) => { if (!cancelled) { setHead(m.head); onHead?.(m.head); } }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [projectId, docId, onHead]);
  return (
    <div className="wk-artifact-body" data-testid="artifact-no-editor" data-size={size} data-head={head ?? ''}>
      {head !== null && <iframe title={`${docId} version ${head}`} className="wk-artifact-frame" sandbox="allow-scripts" src={interactiveDocUrl(projectId, docId, head)} />}
      <p className="wk-artifact-hint" data-testid="artifact-no-editor-note">No editor is installed for pages{reason === null ? '' : ` — ${reason}`}</p>
    </div>
  );
}
