import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiBase } from '../../api/client.js';
import type { EditorView } from '../../api/editors.js';
import { editedLine, notUndoneLine, undoneLine, writtenWords, type EditorKind, type WriteVerb } from '../../board/artifactMorph.js';
import { EditorHost, type HostLogEntry } from '../../editors/host.js';
import {
  LIVE_FRAME_CAP, adapterFor, dropLive, firstTabOf, setGroupShown, groupKey, hostTabsFor, isLive, joinGroup, relay, touchLive, useHostChrome, useHostPanel, useLiveCards,
  type ExportOutcome, type ExportedFile, type PluginCardProps, type SurfaceAdapter,
} from '../../editors/hostApi.js';
import { bundleUrl, fetchGrants } from '../../editors/model.js';
import type { PermissionId } from '../../editors/protocol.js';
import type { CardAction, FullMode, Surfaces } from '../../editors/surfaces.js';
import { readThemeTokens } from '../../editors/theme.js';
import { artifactSizeOf, registerArtifact, setArtifactSize, useArtifactSizes } from '../../store/artifactSizes.js';
import { useArtifactAddress } from '../session/ArtifactAddress.js';
import { VersionLens } from '../session/ArtifactVersions.js';
import { useEditorFor } from '../../store/editors.js';
import '../../editors/adapters/index.js';
import './hostTabs.js';
import { chipsToComposer, focusComposer, forwardedKey, typedToComposer } from './composerBridge.js';
import { FullShell } from './FullShell.js';
import { useRunHost } from './RunHostContext.js';

/**
 * THE CARD (DES-EDITOR-PLUGIN-CONTRACT-001 §7.1; HOST-API §5): one plugin's artifact in the thread, in host chrome on
 * every side — the plugin tag, the title, host pills, the plugin's declared actions as HOST buttons, the gate's host
 * controls, Options and Full screen. The frame inside is the card/full instance: Full screen morphs this same
 * section into {@link FullShell} (the iframe never re-parents). Rendered from the declaration; no kind branches.
 */

/** Idle: how often the head is re-read, so a version a helper lands reaches every instance. */
const IDLE_MS = 5_000;

type Line =
  | { kind: 'edited'; version: number; base: number; what: string; verb: WriteVerb }
  | { kind: 'undone'; version: number }
  | { kind: 'not-undone'; head: number }
  | { kind: 'working' | 'failed' | 'status'; text: string }
  | { kind: 'drafted'; editor: string; text: string }
  | { kind: 'export'; out: ExportOutcome };

/** A plugin's own request to change a host surface (`ui.morph`, `ui.fullscreen`) is honoured only under the
 *  operator's real click INSIDE that plugin's frame (codex h2a-r1 P1): never a scripted morph. */
export function clickedIn(frame: HTMLIFrameElement | null | undefined): boolean {
  const active = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive === true;
  return active && frame != null && document.activeElement === frame;
}

export function PluginCard(props: PluginCardProps): React.ReactElement {
  const fromRegistry = useEditorFor(props.binding.kind);
  const editor = props.editor ?? fromRegistry;
  if (editor === undefined) return <section data-testid="plugin-card" data-state="opening" className="wk-pcard wk-pcard--opening" aria-busy="true" />;
  if (editor === null) {
    return (
      <section data-testid="plugin-card" data-state="no-editor" className="wk-pcard">
        <p className="wk-host-note" data-testid="plugin-card-no-editor">No editor is installed for {props.binding.kind}.</p>
      </section>
    );
  }
  return <CappedCard {...props} editor={editor} />;
}

/** The cards whose Options group an address opened: Back closes it (codex h2-r8/r9 P2). Kept outside the live card,
 *  which may rest (unmount) while its group stays open; the mounted wrapper does the closing. */
const openedByAddress = new Set<string>();

/** Only the newest cards on the page run a frame (§7.1, §8.1): an older one shows its title and "Show it live". A
 *  full-screen card is always live. */
function CappedCard(props: PluginCardProps & { editor: EditorView }): React.ReactElement {
  const key = props.binding.artifactKey;
  const cap = useRunHost()?.liveFrameCap ?? LIVE_FRAME_CAP;
  const live = useLiveCards((s) => isLive(s.order, key, cap));
  const full = useHostChrome((s) => s.full === key);
  useEffect(() => { touchLive(key); return () => dropLive(key); }, [key]);
  // The artifact address sees every mounted card, live or resting; a deep link to a resting one wakes it (codex h2-r7 P2).
  useEffect(() => registerArtifact(key), [key]);
  const asked = useArtifactSizes((st) => artifactSizeOf(st, key) !== 'inline');
  const routeKey = useArtifactAddress()?.routeKey ?? null;
  useEffect(() => {
    if (!openedByAddress.has(key) || routeKey === key) return;
    openedByAddress.delete(key);
    const panel = useHostPanel.getState();
    if (panel.group?.key === groupKey(props.editor.id, key)) panel.closeGroup();
  }, [routeKey, key, props.editor.id]);
  useEffect(() => { if (asked && !live) touchLive(key); }, [asked, live, key]);
  if (live || full) return <LiveCard {...props} />;
  return (
    <section data-testid="plugin-card" data-state="still" data-editor={props.editor.id} className="wk-pcard">
      <header className="wk-pcard-head">
        <span className="wk-card-tag" data-testid="plugin-card-tag">{props.editor.title}</span>
        <span className="wk-pcard-title">{props.binding.title}</span>
      </header>
      <div className="wk-pcard-frame wk-pcard-still" data-testid="plugin-card-thumb">
        <button type="button" className="wk-host-btn" onClick={() => touchLive(key)}>Show it live</button>
      </div>
      <p className="wk-host-note">Older cards rest so the newest stay quick.</p>
    </section>
  );
}

function LiveCard({ binding, editor, adapter: adapterProp, src: srcProp, grants: grantsProp, declared }: PluginCardProps & { editor: EditorView }): React.ReactElement {
  const run = useRunHost();
  const frameBox = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<EditorHost | null>(null);
  const logRef = useRef<HostLogEntry[]>([]);
  const [decl, setDecl] = useState<Surfaces | null>(null);
  const [protocol, setProtocol] = useState(1);
  const [note, setNote] = useState<string | null>(null);
  const [torn, setTorn] = useState<string | null>(null);
  const [line, setLine] = useState<Line | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [mode, setMode] = useState<FullMode | undefined>(undefined);
  const [mountKey, setMountKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  /** The plugin asked to grow: a host button offers it; nothing grows until the operator presses it. */
  const [offer, setOffer] = useState<'full' | 'options' | null>(null);
  const [, bump] = useState(0);
  const loaded = useRef<{ src: string; grants: readonly PermissionId[] } | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  // One adapter per artifact, not per render: a caller's binding object is a fresh literal every render.
  const bindingRef = useRef(binding);
  bindingRef.current = binding;
  const adapter = useMemo<SurfaceAdapter | null>(
    () => adapterProp ?? adapterFor(bindingRef.current),
    // Not the title: renaming an artifact must not tear its frame down (codex h2a-r1 P2).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the artifact's identity; the binding is read through its ref
    [adapterProp, binding.artifactKey, binding.source, binding.projectId, binding.docId, binding.kind],
  );
  const group = groupKey(editor.id, binding.artifactKey);
  const full = useHostChrome((s) => s.full === binding.artifactKey);
  const enterFull = useHostChrome((s) => s.enterFull);
  const exitFull = useHostChrome((s) => s.exitFull);
  const openGroup = useHostPanel((s) => s.openGroup);
  const optionsOpen = useHostPanel((s) => s.group?.key === group);
  const fullRef = useRef(full);
  fullRef.current = full;
  /** Leave full screen — only this card's own. */
  const leaveFull = useCallback((): void => { if (useHostChrome.getState().full === binding.artifactKey) exitFull(); }, [binding.artifactKey, exitFull]);

  useEffect(() => adapter?.subscribe?.(() => bump((n) => n + 1)), [adapter]);

  const openOptions = useCallback((): void => {
    if (adapter === null || decl === null || loaded.current === null) return;
    const panel = useHostPanel.getState();
    // Already open: reveal it (unfold, back to its tabs) without remounting its options instance (codex h2-r11 P3).
    if (panel.group?.key === group) {
      panel.reveal();
      if (panel.tab.owner === 'run') panel.setTab(firstTabOf(panel.group));
      return;
    }
    openGroup({ key: group, binding, editor, surfaces: decl, protocol, src: loaded.current.src, grants: loaded.current.grants, adapter });
  }, [adapter, decl, group, binding, editor, protocol, openGroup]);
  const openOptionsRef = useRef(openOptions);
  /** Every host-approved Options opener (button, the plugin's accepted offer, the options-only catch) goes through the
   *  address (codex h2-r11 P2). */
  const pressOptionsRef = useRef<() => void>(() => undefined);
  openOptionsRef.current = openOptions;

  // One host per mount (EP-D2): the frame is made once; card ↔ full is the same element. "Reload it" remounts.
  useEffect(() => {
    if (frameBox.current === null || adapter === null) return undefined;
    let cancelled = false;
    setTorn(null);
    const start = async (): Promise<void> => {
      const decided = grantsProp !== undefined ? { grants: grantsProp, note: null } : await fetchGrants(editor.id, editor.version, editor.sha256, binding.projectId === '' ? null : binding.projectId);
      await adapter.refresh?.().catch(() => null);
      // Nothing counts as announced yet: the first idle re-read tells every instance of the group (an open Options
      // frame included) the head as it stands, however it moved meanwhile (codex h2-r16/r17 P2).
      announced.current = null;
      if (cancelled || frameBox.current === null) return;
      setNote(decided.note);
      const src = srcProp ?? bundleUrl(apiBase(), editor.id, editor.version, editor.sha256);
      loaded.current = { src, grants: decided.grants };
      const kind = binding.kind as EditorKind;
      const bridge = adapter.mcpBridge?.();
      const startedFull = fullRef.current;
      const host = new EditorHost({
        container: frameBox.current,
        src,
        editor: editor.id,
        version: editor.version,
        name: editor.title,
        title: `${editor.title}: ${binding.title}`,
        size: startedFull ? 'full' : 'inline',
        surface: startedFull ? 'full' : 'card',
        grants: decided.grants,
        theme: readThemeTokens(),
        prefs: { reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, techDetails: false, locale: navigator.language },
        firstParty: editor.first_party,
        adapter,
        declared: declared ?? (editor as EditorView & { surfaces?: unknown }).surfaces,
        ...(bridge !== undefined ? { mcp: bridge } : {}),
        sizes: editor.sizes,
        ui: {
          // The binding is read through its ref: a composer that changes while the card stays mounted gets the chips.
          chips: (chips) => chipsToComposer(bindingRef.current, chips),
          draft: (text, chips) => { if (live.current) setLine({ kind: 'drafted', editor: editor.title, text: chips.length > 0 ? `${text} (about ${chips.map((c) => c.label).join(', ')})` : text }); },
          typed: (g) => typedToComposer(bindingRef.current.composerKey, g),
          key: (k) => {
            // Escape is honoured only with the focus in this frame (codex h2a-r3 P1), like every plugin-made shrink.
            if (k === 'Escape') { if (clickedIn(hostRef.current?.frame) || document.activeElement === hostRef.current?.frame) leaveFull(); }
            else forwardedKey(k, hostRef.current?.frame ?? null);
          },
          // v1 sizes: pane is the Options group (the "Editor" tab), full is full screen, inline is the card.
          // A plugin never changes a host surface itself (codex h2a-r1/r2 P1): its ask to grow becomes a host-drawn
          // offer the operator presses; its ask to shrink is honoured only under a click in its own frame, and only
          // for this card's own full screen.
          morph: (to) => {
            if (to === 'inline') { if (clickedIn(hostRef.current?.frame)) leaveFull(); return; }
            if (live.current) setOffer(to === 'full' ? 'full' : 'options');
          },
          status: (l) => { if (live.current) setLine({ kind: 'status', text: l }); },
          notes: () => undefined,
          // A theme write (the only `thread` line without `written`) reaches the group's options instance too.
          thread: () => { const h = adapter.artifact().head; relay(group, 'card', { type: 'changed', head: h, kind: 'theme' }); },
          written: (w) => {
            announced.current = w.version;
            relay(group, 'card', { type: 'changed', head: w.version, kind: 'deterministic' });
            if (live.current) setLine({ kind: 'edited', version: w.version, base: w.base, what: w.words ?? writtenWords(w.anchors, kind), verb: w.verb });
          },
          shown: (v) => setGroupShown(group, v),
          fullscreen: async () => { if (live.current) setOffer('full'); return false; },
          torn: (reason) => { if (live.current) setTorn(reason); },
          log: (e) => { logRef.current.push(e); if (logRef.current.length > 200) logRef.current.shift(); },
          surfaces: (s, p, n) => {
            // A morph made before the handshake had no port: say the surface now shown (codex h2-r8 P2).
            const now = fullRef.current ? 'full' : 'card';
            if (now !== (startedFull ? 'full' : 'card')) queueMicrotask(() => hostRef.current?.setSurface(fullRef.current ? 'full' : 'card'));
            if (!live.current) return;
            setDecl(s); setProtocol(p); if (n !== null) setNote(n);
            if (s.full?.modes != null) setMode((m) => m ?? s.full?.default);
          },
          cardHeight: (px) => { if (live.current) setHeight(px); },
          selected: (anchors) => relay(group, 'card', { type: 'selection', anchors }),
          // Every MCP call is the host's line (DES-MCP-INSPECTOR-001 §4: no call is quiet; codex h2-r6 P2).
          mcpCall: (c) => {
            if (!live.current) return;
            const what = c.tool ?? c.method;
            if (c.phase === 'sent') setLine({ kind: 'working', text: `Calling ${what}…` });
            else setLine({ kind: c.outcome === 'ok' ? 'status' : 'failed', text: `${what}: ${c.outcome === 'ok' ? 'answered' : c.outcome}${c.ms !== null ? ` · ${c.ms} ms` : ''}${c.sent ? '' : ' (not sent)'}` });
          },
        },
      });
      hostRef.current = host;
      host.mount();
    };
    void start();
    const leave = joinGroup(group, 'card', (e) => {
      if (e.type === 'selection') hostRef.current?.relaySelection(e.anchors);
      else if (e.type === 'changed') hostRef.current?.artifactChanged(e.head, e.kind);
      else {
        // A version the host's own chrome wrote for this artifact (Match a website): this card owns its Undo — offered
        // only once the adapter has re-read the manifest, so Undo knows the version's parent (codex h2-r11 P2).
        const v = e.version;
        // The plugin hears it once the adapter's head is the new version (codex h2-r13 P2).
        void Promise.resolve(adapter?.refresh?.()).then(
          () => {
            hostRef.current?.adopt(v);
            announced.current = v;
            hostRef.current?.artifactChanged(v, 'theme');
            if (live.current) setLine({ kind: 'edited', version: v, base: e.base ?? v, what: e.words, verb: 'restyled' });
          },
          // The manifest could not be re-read: say what changed, with no Undo that could not find its parent (codex h2-r12 P2).
          // No announcement either: the head has not moved here yet; the idle re-read announces it when it does
          // (codex h2-r14 P2).
          () => { if (live.current) setLine({ kind: 'status', text: `The theme changed · version ${v}` }); },
        );
      }
    });
    return () => {
      cancelled = true;
      leave();
      hostRef.current?.teardown('The card was closed');
      hostRef.current = null;
    };
    // The frame is made once per editor and artifact; size/mode changes are posted, never remounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, editor.id, editor.version, editor.sha256, mountKey, group]);

  // Card ↔ full: the same instance hears `host.surface` (v1: `host.size`).
  useEffect(() => { hostRef.current?.setSurface(full ? 'full' : 'card', mode); }, [full]); // eslint-disable-line react-hooks/exhaustive-deps
  // Every way out of full screen also leaves the browser's own fullscreen of this card (codex h2a-r3 P2).
  const sectionRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (full) return;
    const fs = document.fullscreenElement;
    if (fs !== null && sectionRef.current !== null && (fs === sectionRef.current || sectionRef.current.contains(fs))) void document.exitFullscreen?.().catch(() => undefined);
  }, [full]);

  // The artifact address (S16a-4a) keeps working (codex h2-r6 P2): the card registers while mounted, a deep link or
  // Back that sizes it opens or closes full screen (a pane is the Options group), and its own full screen is written
  // to the size store and the address.
  // (Registration is the mounted wrapper's, CappedCard: a resting card is still on the page.)
  const address = useArtifactAddress();
  const key = binding.artifactKey;
  const size = useArtifactSizes((st) => artifactSizeOf(st, key));
  const ready = decl !== null;
  const lensVersion = address !== null && address.routeKey === key ? address.routeVersion : null;
  useEffect(() => {
    const owner = useHostChrome.getState().full;
    if (size === 'full' && owner !== key) enterFull(key);
    else if (size === 'pane') {
      // A pane is this card's Options group: wait for the handshake's declaration, then leave full screen (Back from
      // full lands here) and open the group (codex h2-r7 P2).
      if (!ready) return;
      setArtifactSize(key, 'inline');
      if (owner === key) exitFull();
      openOptionsRef.current();
      openedByAddress.add(key);
    }
    // Only this card's own full screen: another card's deep link may already own it (codex h2-r7 P2).
    else if (size === 'inline' && owner === key) exitFull();
  }, [size, key, ready, enterFull, exitFull]);
  // The address says "pane" exactly while this card's Options group is open (operator: it said pane with nothing open):
  // the Options button pushes it, closing the group (×) takes it back.
  const pressOptions = (): void => {
    openOptions();
    if (address !== null && address.routeKey !== key && !fullRef.current) address.write(key, 'inline', 'pane');
  };
  pressOptionsRef.current = pressOptions;
  const wasOpen = useRef(optionsOpen);
  useEffect(() => {
    const closed = wasOpen.current && !optionsOpen;
    wasOpen.current = optionsOpen;
    if (closed && address !== null && address.routeKey === key && !fullRef.current) address.write(key, 'pane', 'inline');
  }, [optionsOpen, address, key]);
  const wasFull = useRef(full);
  useEffect(() => {
    if (wasFull.current === full) return;
    wasFull.current = full;
    const from = artifactSizeOf(useArtifactSizes.getState(), key);
    const to = full ? 'full' : 'inline';
    if (from === to) return;
    setArtifactSize(key, to);
    // Leaving full screen with this card's Options group open lands on its pane address, so the group (and a
    // Versions tab in it) stays (desk_artifact_versions: the lens's own Back, then Restore in the panel).
    address?.write(key, from, !full && useHostPanel.getState().group?.key === group ? 'pane' : to);
  }, [full, key, address, group]);

  // Leaving the page while full restores the shell.
  useEffect(() => () => { if (useHostChrome.getState().full === binding.artifactKey) useHostChrome.getState().exitFull(); }, [binding.artifactKey]);

  useEffect(() => {
    if (typeof MutationObserver !== 'function') return undefined;
    const seen = new MutationObserver(() => hostRef.current?.setTheme(readThemeTokens()));
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    return () => seen.disconnect();
  }, []);

  // A version a helper lands: this instance hears it, and so does the group's options instance.
  /** The head every instance was last told about (the card's own writes and host-chrome writes included). */
  const announced = useRef<number | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  useEffect(() => {
    if (adapter?.refresh === undefined) return undefined;
    const timer = setInterval(() => {
      if (busyRef.current) return;
      void adapter.refresh?.().then((moved) => {
        if (!live.current) return;
        // Announced by head, not only by a move this re-read saw: another read (an options frame's
        // artifact.versions) may have moved the shared adapter's head first (codex h2-r15 P2).
        const head = adapter.artifact().head;
        if (moved === null && head === announced.current) return;
        announced.current = head;
        const kind = moved?.kind ?? 'generated';
        hostRef.current?.artifactChanged(head, kind);
        relay(group, 'card', { type: 'changed', head, kind });
      }).catch(() => undefined);
    }, IDLE_MS);
    return () => clearInterval(timer);
  }, [adapter, group]);

  const chooseMode = async (m: FullMode): Promise<void> => {
    const shown = await hostRef.current?.setMode(m);
    // The plugin's echo is the mode now shown; no answer leaves the toggle where it was.
    if (live.current && shown !== null && shown !== undefined) setMode(shown);
  };

  const undo = async (): Promise<void> => {
    const host = hostRef.current;
    if (line === null || line.kind !== 'edited' || host === null || busy || adapter === null) return;
    setBusy(true);
    const { version } = line;
    setLine({ kind: 'working', text: 'Undoing…' });
    const r = await host.undo(version);
    if (!live.current) return;
    const head = adapter.artifact().head;
    if ('error' in r) setLine(r.error === 'head_moved' ? { kind: 'not-undone', head: r.head ?? head } : { kind: 'failed', text: `Could not undo: ${r.message}` });
    else { setLine({ kind: 'undone', version: head }); relay(group, 'card', { type: 'changed', head, kind: 'fork' }); }
    setBusy(false);
  };

  // Export needs the adapter's capability AND the editor's decided artifact.export grant (ev2-ports codex h4b-r2).
  const exportGranted = loaded.current?.grants.includes('artifact.export') === true;
  const exports = exportGranted && adapter?.capabilities().includes('export') === true ? (adapter.exports?.() ?? []) : [];
  const head = adapter?.artifact().head ?? 0;
  const exportAs = async (format: string): Promise<void> => {
    setExportOpen(false);
    if (adapter?.exportFile === undefined || head < 1) return;
    const label = exports.find((x) => x.format === format)?.label ?? format;
    setLine({ kind: 'working', text: `Making the ${label} of version ${head}…` });
    const out = await adapter.exportFile(format, head);
    if (live.current) { setLine({ kind: 'export', out }); if (out.ok) setDiskReads((n) => n + 1); }
  };
  // studio#234: the files already exported for the version shown, from the adapter's listing — re-read on a new head
  // and after an export, so a download made in an earlier session is still offered after a reload.
  // The rows belong to the (artifact, version) they were read for: after a head or document change they are not shown
  // until the new listing lands (codex h4-fix r1 P2).
  const [onDisk, setOnDisk] = useState<{ of: string; rows: readonly ExportedFile[] } | null>(null);
  const [diskReads, setDiskReads] = useState(0);
  const listsExports = exports.length > 0 && head >= 1 && adapter?.exported !== undefined;
  const diskOf = `${binding.artifactKey}@${head}`;
  useEffect(() => {
    if (!listsExports || adapter?.exported === undefined) { setOnDisk(null); return undefined; }
    let cancelled = false;
    adapter.exported(head).then((rows) => { if (!cancelled) setOnDisk({ of: diskOf, rows }); }, () => { if (!cancelled) setOnDisk(null); });
    return () => { cancelled = true; };
  }, [listsExports, adapter, head, diskReads, diskOf]);
  const linkedFile = line?.kind === 'export' && line.out.ok ? line.out.file : null;
  const filesOnDisk = listsExports && onDisk !== null && onDisk.of === diskOf ? onDisk.rows.filter((x) => x.name !== linkedFile) : [];

  const runAction = async (a: CardAction): Promise<void> => {
    if (a.verb === 'host:export') { setExportOpen((o) => !o); return; }
    if (a.verb === 'host:ask') { focusComposer(binding.composerKey); return; }
    const r = await hostRef.current?.action(a.id);
    if (!live.current) return;
    if (r === null || r === undefined) setLine({ kind: 'status', text: `${a.label}: no answer from ${editor.title}` });
    else if (r.status !== null) setLine({ kind: 'status', text: r.status });
  };

  const hostTabs = adapter === null ? [] : hostTabsFor(adapter);
  const hasOptions = (decl?.options?.tabs.length ?? 0) > 0 || hostTabs.length > 0;
  const hasFull = decl?.full != null;
  const interactive = decl?.card.interactive === true && protocol >= 2;
  const aspect = decl?.card.aspect ?? '16:9';
  const pills = adapter?.pills?.() ?? [];
  const actions = decl?.card.actions ?? [];
  const gate = run?.gateActions?.(binding) ?? null;
  const onExit = leaveFull;

  const frameStyle: React.CSSProperties = full ? {} : aspect === 'auto' ? { height: `${height ?? 240}px` } : { aspectRatio: aspect === '4:3' ? '4 / 3' : '16 / 9' };

  return (
    <section
      ref={sectionRef}
      data-testid="plugin-card"
      data-editor={editor.id}
      data-protocol={protocol}
      data-surface={full ? 'full' : 'card'}
      data-artifact={binding.artifactKey}
      aria-label={`${editor.title}: ${binding.title}`}
      className={`wk-pcard${full ? ' wk-pcard--full' : ''}${optionsOpen ? ' wk-pcard--options' : ''}`}
    >
      {!full && binding.producedBy != null && binding.producedBy !== '' && (
        <p className="wk-pcard-who" data-testid="plugin-card-who">{binding.producedBy}</p>
      )}
      {!full && (
        <header className="wk-pcard-head">
          <span className="wk-card-tag" data-testid="plugin-card-tag">{editor.title}</span>
          <span className="wk-pcard-title">{binding.title}</span>
          {pills.map((p) => <span key={p.id} data-testid="plugin-card-pill" data-tone={p.tone} className={`wk-pill wk-pill--${p.tone}`}>{p.text}</span>)}
        </header>
      )}
      <FullShell
        open={full}
        tag={editor.title}
        title={binding.title}
        phase={run?.phase ?? null}
        modes={decl?.full?.modes ?? null}
        mode={mode}
        onMode={(m) => void chooseMode(m)}
        gateActions={gate}
        chat={run?.renderChat?.()}
        onExit={onExit}
      >
        <div className="wk-pcard-frame" data-testid="plugin-card-frame" data-interactive={interactive ? 'true' : 'false'} style={frameStyle}>
          {/* Under the read-only lens the live editor is inert: no Tab or typing reaches it (codex h2-r19 P2). */}
          <div ref={frameBox} key={mountKey} className="wk-plugin-frame-box" {...(full && lensVersion !== null ? { inert: '' as unknown as boolean, 'aria-hidden': true } : {})} />
          {/* A version lens from the address (`?v=N`): read-only, over the live frame, which stays mounted. */}
          {full && lensVersion !== null && binding.docId !== undefined && binding.docId !== '' && (
            <div className="wk-pcard-lens">
              <VersionLens projectId={binding.projectId} docId={binding.docId} version={lensVersion} onBack={() => { leaveFull(); }} />
            </div>
          )}
          {!interactive && !full && torn === null && (
            // The v1 hit layer (and `interactive:false`): a click is the host's — it opens, never reaches the frame.
            <button type="button" data-testid="plugin-card-catch" aria-label={`Open ${binding.title}`} className="wk-artifact-catch"
              onClick={() => { if (hasFull) enterFull(binding.artifactKey); else if (hasOptions) pressOptionsRef.current(); }} />
          )}
          {torn !== null && (
            <p data-testid="plugin-torn" className="wk-host-note">
              This part didn’t start · {torn} · <button type="button" data-testid="plugin-reload" onClick={() => setMountKey((k) => k + 1)} className="wk-since-toggle">Reload it</button>
            </p>
          )}
        </div>
      </FullShell>
      {line !== null && (
        <p data-testid="page-line" data-kind={line.kind} className={`wk-artifact-line${line.kind === 'not-undone' || line.kind === 'failed' || (line.kind === 'export' && !line.out.ok) ? ' wk-artifact-line--bad' : ''}`}>
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
          {line.kind === 'export' && <>{line.out.text}{line.out.ok && <> <a data-testid="artifact-export-download" href={line.out.href} download={line.out.file} className="wk-since-toggle">Download</a></>}</>}
        </p>
      )}
      {!full && filesOnDisk.length > 0 && (
        <p data-testid="artifact-exports" className="wk-artifact-line">
          Exported version {head}:{' '}
          {filesOnDisk.map((x, i) => (
            <span key={x.name}>
              {i > 0 && ' · '}
              <a data-testid="artifact-export-file" data-format={x.format} href={x.href} download={x.name} className="wk-since-toggle">{x.label}</a>
            </span>
          ))}
        </p>
      )}
      {offer !== null && !full && (
        <p data-testid="plugin-card-offer" className="wk-artifact-line">
          {editor.title} asks to open {offer === 'full' ? 'full screen' : 'its options'}.{' '}
          <button type="button" data-testid="plugin-card-offer-accept" className="wk-host-btn wk-host-btn--primary"
            onClick={() => { setOffer(null); if (offer === 'full') enterFull(binding.artifactKey); else pressOptionsRef.current(); }}>{offer === 'full' ? 'Open full screen' : 'Open options'}</button>{' '}
          <button type="button" className="wk-since-toggle" onClick={() => setOffer(null)}>Not now</button>
        </p>
      )}
      {torn === null && note !== null && <p data-testid="plugin-card-note" className="wk-host-note">{note}</p>}
      {!full && (
        <footer className="wk-pcard-foot">
          {actions.map((a) => (
            <span key={a.id} className="wk-pcard-action-wrap"
              // Esc with the Export menu open closes the menu, not what the card sits in (the Made list's close), and
              // gives Export its focus back (codex h4-fix r1 P2).
              onKeyDown={(e) => {
                if (e.key !== 'Escape' || a.verb !== 'host:export' || !exportOpen) return;
                e.preventDefault();
                setExportOpen(false);
                (e.currentTarget.querySelector('[data-verb="host:export"]') as HTMLButtonElement | null)?.focus();
              }}>
              <button type="button" data-testid="plugin-card-action" data-action={a.id} data-verb={a.verb}
                disabled={a.verb === 'host:export' && (exports.length === 0 || head < 1)}
                className={a.primary ? 'wk-host-btn wk-host-btn--primary' : 'wk-host-btn'} onClick={() => void runAction(a)}>
                {a.label}{a.verb === 'host:export' ? ' ▾' : ''}
              </button>
              {a.verb === 'host:export' && exportOpen && (
                <span role="menu" aria-label="Export as" data-testid="artifact-export-menu" className="wk-artifact-menu">
                  {exports.map((x) => (
                    <button key={x.format} type="button" role="menuitem" data-testid="artifact-export-format" data-format={x.format} onClick={() => void exportAs(x.format)} className="wk-artifact-menu-item">{x.label}</button>
                  ))}
                </span>
              )}
            </span>
          ))}
          {gate}
          <span className="wk-pcard-gap" />
          {hasOptions && (
            <button type="button" data-testid="plugin-card-options" aria-pressed={optionsOpen} className="wk-host-btn" onClick={pressOptions} disabled={decl === null}>Options</button>
          )}
          {hasFull && (
            <button type="button" data-testid="plugin-card-full" className="wk-host-btn" onClick={() => enterFull(binding.artifactKey)}>⤢ Full screen</button>
          )}
        </footer>
      )}
    </section>
  );
}
