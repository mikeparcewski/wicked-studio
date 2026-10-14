import type { ReactNode } from 'react';
import { create } from 'zustand';
import type { EditorView } from '../api/editors.js';
import type { HostAdapter, McpHostBridge } from './host.js';
import type { VersionKind } from './model.js';
import type { AnchorRef, PermissionId } from './protocol.js';
import type { FullMode, Surfaces } from './surfaces.js';

/**
 * THE HOST API (DES-EDITOR-PLUGIN-CONTRACT-001 §4, §7; slice H2): the seam the run page (H3), the plugin ports
 * (H4–H6) and the editor test page (H7) build against. Lane doc: `lanes/editors-v2/HOST-API.md`.
 *
 *  - A caller places an artifact with an {@link ArtifactBinding}. The host picks the editor from crew's
 *    registry by `kind`, the adapter by `source` ({@link registerAdapter}), and renders the three surfaces
 *    from the plugin's declaration: `PluginCard` (the card, which morphs into `FullShell`), and the options
 *    group in `HostPanel`. No caller branches on kind.
 *  - The run page supplies what only it knows through {@link RunHostContext}: the Run tab, the chat drawer,
 *    the phase and the open gate's host controls.
 *  - Instances of one artifact (card/full and options) form a GROUP keyed by {@link groupKey}; selection is
 *    relayed inside a group only ({@link relay}).
 */

// ── what a caller passes ────────────────────────────────────────────────────────────────────────────

/** The data plane an artifact lives in. It picks the ADAPTER, never the plugin or the UI (§7.4). */
export type AdapterSource = 'interactive-doc' | 'demo' | 'walkthrough' | 'mcp' | 'fake';

/** One artifact, placed. Everything the host needs to choose an editor and an adapter. */
export interface ArtifactBinding {
  /** Unique per placement (`artifactKey(projectId, docId, runId)` in `store/artifactSizes.ts`). */
  artifactKey: string;
  title: string;
  /** The artifact kind (`page`, `deck`, `document`, `demo-video`, `mcp-server`, …): picks the editor from the registry. */
  kind: string;
  source: AdapterSource;
  projectId: string;
  /** The session composer the chips, the typed character and `host:ask` land in. */
  composerKey: string;
  docId?: string;
  runId?: string;
  repoId?: string | null;
  /** Who produced the version shown ("Claude Code", "You", "crew"), drawn on the turn above the card. */
  producedBy?: string | null;
}

// ── adapters (one per data plane) ───────────────────────────────────────────────────────────────────

/** What an adapter can do; the host verbs and host tabs follow from it (§7.2, §7.4). */
export type AdapterCapability = 'read' | 'write' | 'versions' | 'parts' | 'media' | 'export' | 'theme' | 'mcp' | 'review' | 'checks';

export interface ExportOption { format: string; label: string }
export type ExportOutcome = { ok: true; text: string; href: string; file: string } | { ok: false; text: string };
/** A file already exported for a version, on disk (studio#234): the host lists it on the card so a download made in an
 *  earlier session survives a reload. */
export interface ExportedFile { format: string; label: string; name: string; href: string }
/** A host status pill on the card ("Version 3", "2 changed", "Ready to watch"). Host words, from adapter state. */
export interface StatusPill { id: string; text: string; tone: 'neutral' | 'good' | 'warn' | 'bad' }
/** A reviewable part (slide, chapter, section): what the host review capability approves (§7.4). */
export interface ArtifactPart { id: string; label: string; state: 'pending' | 'approved' | 'changed' }

/** The protocol-1 {@link HostAdapter} plus what the host chrome reads. */
export interface SurfaceAdapter extends HostAdapter {
  readonly source: AdapterSource;
  capabilities(): readonly AdapterCapability[];
  /** Formats offered by Export (replaces ArtifactMorph's per-kind EXPORTS table). Needs `export`. */
  exports?(): readonly ExportOption[];
  pills?(): readonly StatusPill[];
  /** Needs `parts`. */
  parts?(): Promise<readonly ArtifactPart[]>;
  /** Re-read the head; a moved head is posted to every instance as `artifact.changed`. Polled at idle (5 s). */
  refresh?(): Promise<{ head: number; kind: VersionKind } | null>;
  /** Make an export file of `version` (needs `export`): the host draws the working line and the Download link. */
  exportFile?(format: string, version: number): Promise<ExportOutcome>;
  /** The files already exported for `version` (needs `export`), read from the data plane's own listing; a failed
   *  listing rejects and the host shows nothing — never a guessed link. */
  exported?(version: number): Promise<readonly ExportedFile[]>;
  /** The MCP session the operator connected in host chrome, for an `mcp` artifact (H5): handed to the card's host
   *  as `HostOptions.mcp`. Absent = `mcp.request` answers `unavailable`. */
  mcpBridge?(): McpHostBridge | undefined;
  /** Host chrome re-renders on a change of pills/parts/head. */
  subscribe?(onChange: () => void): () => void;
}

export type AdapterFactory = (binding: ArtifactBinding) => SurfaceAdapter;
const adapters = new Map<AdapterSource, AdapterFactory>();
/** A data plane's adapter. `interactive-doc` and `fake` are the host's; `demo`, `walkthrough`, `mcp` are the ports'. */
export function registerAdapter(source: AdapterSource, factory: AdapterFactory): void { adapters.set(source, factory); }
export function adapterFor(binding: ArtifactBinding): SurfaceAdapter | null { return adapters.get(binding.source)?.(binding) ?? null; }
/** Whether a data plane has an adapter yet: a caller keeps its old body until one is registered (codex h2-r6). */
export function hasAdapter(source: AdapterSource): boolean { return adapters.has(source); }

// ── host tabs (host-drawn, from capabilities) ───────────────────────────────────────────────────────

/** The host's own tabs appended after a plugin group's tabs, at most 3, not counted against the plugin's 5. */
export type HostTabId = 'review' | 'versions' | 'checks';
export interface HostTabContext {
  binding: ArtifactBinding;
  adapter: SurfaceAdapter;
  /** The version the plugin shows (its last `artifact.read`), or the head. */
  shown: number | null;
  /** A finding becomes a composer chip in the host's words; false = not on this version. */
  pointAt(wid: string): Promise<boolean>;
  /** A version the tab made (a review fork, a restore): every instance hears `artifact.changed`. */
  changed(head: number, kind: VersionKind): void;
}
export interface HostTabSpec { id: HostTabId; label: string; needs: AdapterCapability; render(ctx: HostTabContext): ReactNode }
const hostTabs = new Map<HostTabId, HostTabSpec>();
/** `versions` and `checks` are registered by the host; `review` by H4 (deck review becomes the host capability). */
export function registerHostTab(spec: HostTabSpec): void { hostTabs.set(spec.id, spec); }
const HOST_TAB_ORDER: readonly HostTabId[] = ['review', 'versions', 'checks'];
/** The host tabs an adapter earns, in order. */
export function hostTabsFor(adapter: SurfaceAdapter): HostTabSpec[] {
  const caps = adapter.capabilities();
  return HOST_TAB_ORDER.map((id) => hostTabs.get(id)).filter((t): t is HostTabSpec => t !== undefined && caps.includes(t.needs));
}

/** Host chrome under one plugin tab (ev2-ports: "Match a website / PDF" under a Style tab — a frame has no
 *  network, so the fetch is the host's). Shown when the open group has a plugin or controls tab with this id and the
 *  adapter has `needs`. */
export interface TabFooterSpec { tab: string; needs: AdapterCapability; render(ctx: HostTabContext): ReactNode }
const tabFooters: TabFooterSpec[] = [];
export function registerTabFooter(spec: TabFooterSpec): void {
  const i = tabFooters.findIndex((f) => f.tab === spec.tab && f.needs === spec.needs);
  if (i >= 0) tabFooters[i] = spec; else tabFooters.push(spec);
}
export function tabFootersFor(tab: string, adapter: SurfaceAdapter): TabFooterSpec[] {
  const caps = adapter.capabilities();
  return tabFooters.filter((f) => f.tab === tab && caps.includes(f.needs));
}

// ── groups and the selection relay (§4) ─────────────────────────────────────────────────────────────

/** One group per (editor id, artifact key): relays never cross groups. */
export function groupKey(editorId: string, artifactKey: string): string { return `${editorId}::${artifactKey}`; }

/** What one instance of a group tells the others: a pointing (`host.selection`), or a head that moved
 *  (`artifact.changed`), so every instance shows the same version. */
export type GroupEvent =
  | { type: 'selection'; anchors: readonly AnchorRef[] }
  | { type: 'changed'; head: number; kind: VersionKind }
  /** The host's own chrome wrote this version (Match a website): the card instance adopts it and draws its Undo. */
  | { type: 'wrote'; version: number; base: number | null; words: string };
type GroupListener = (e: GroupEvent) => void;
const relays = new Map<string, Map<string, GroupListener>>();
/** An instance joins its group's relay; the returned function leaves it. */
export function joinGroup(group: string, instance: string, on: GroupListener): () => void {
  let m = relays.get(group);
  if (m === undefined) { m = new Map(); relays.set(group, m); }
  m.set(instance, on);
  return () => { const g = relays.get(group); g?.delete(instance); if (g?.size === 0) relays.delete(group); };
}
/** An event from `from` reaches every OTHER instance of the group, never another group. */
export function relay(group: string, from: string, e: GroupEvent): void {
  for (const [id, fn] of relays.get(group) ?? []) if (id !== from) fn(e);
}

// ── the host panel (run page option B, §7.2) ────────────────────────────────────────────────────────

/** A plugin's options group, opened in the host panel by the card's Options button. */
export interface OptionsGroup {
  key: string;
  binding: ArtifactBinding;
  editor: EditorView;
  /** The surfaces the card's handshake rendered from (the v1 mapping for a protocol-1 plugin). */
  surfaces: Surfaces;
  protocol: number;
  /** Bundle URL and grants the card instance used: the options instance is the same pinned bundle. */
  src: string;
  grants: readonly PermissionId[];
  adapter: SurfaceAdapter;
}

/** A panel tab, by owner, so a plugin tab id can never be mistaken for the Run tab or a host tab (codex api-r1 P1). */
export type PanelTab = { owner: 'run' } | { owner: 'plugin'; id: string } | { owner: 'host'; id: HostTabId };
export const RUN_TAB: PanelTab = { owner: 'run' };
export function sameTab(a: PanelTab, b: PanelTab): boolean {
  return a.owner === b.owner && (a.owner === 'run' || (a as { id: string }).id === (b as { id: string }).id);
}

/** The tab Options focuses: the group's first plugin tab, else its first host tab (codex api-r1 P2). */
export function firstTabOf(group: OptionsGroup): PanelTab {
  const p = group.surfaces.options?.tabs[0];
  if (p !== undefined) return { owner: 'plugin', id: p.id };
  const h = hostTabsFor(group.adapter)[0];
  return h !== undefined ? { owner: 'host', id: h.id } : RUN_TAB;
}

export interface HostPanelState {
  group: OptionsGroup | null;
  tab: PanelTab;
  /** The operator folded the panel (wide screens); below 1200 px it is the ribbon regardless. */
  folded: boolean;
  /** Another plugin's Options REPLACES the group (one plugin group at a time) and focuses its first tab. The
   *  group's ONE options instance mounts on open — controls-only groups too — and is disposed on close. */
  openGroup(group: OptionsGroup, tab?: PanelTab): void;
  closeGroup(): void;
  setTab(tab: PanelTab): void;
  setFolded(folded: boolean): void;
  /** Bumped to show the panel again (unfold, and open the overlay below 1200 px) without touching the group. */
  revealed: number;
  reveal(): void;
}

export const useHostPanel = create<HostPanelState>((set, get) => ({
  group: null,
  tab: RUN_TAB,
  folded: false,
  openGroup: (group, tab) => set({ group, tab: tab ?? firstTabOf(group), folded: false }),
  closeGroup: () => set({ group: null, tab: RUN_TAB }),
  setTab: (tab) => { if (tab.owner === 'run' || get().group !== null) set({ tab }); },
  setFolded: (folded) => set({ folded }),
  revealed: 0,
  reveal: () => set((s) => ({ folded: false, revealed: s.revealed + 1 })),
}));

/** The panel is a ribbon below this width (css px). */
export const PANEL_RIBBON_BELOW_PX = 1200;
export const PANEL_WIDTH_PX = 400;

// ── full screen and the shell (§7.3) ────────────────────────────────────────────────────────────────

export interface HostChromeState {
  /** The app shell's left nav is collapsed (App.tsx reads it). Set on entering full screen, restored on exit. */
  navCollapsed: boolean;
  /** The artifact shown full screen, or null. One at a time. */
  full: string | null;
  /** The chat drawer in full screen (closed by default, operator decision 8). */
  chatOpen: boolean;
  /** What navCollapsed was before full screen, so exit restores it rather than forcing it open. */
  navBefore: boolean;
  enterFull(artifactKey: string): void;
  exitFull(): void;
  setChatOpen(open: boolean): void;
}

export const useHostChrome = create<HostChromeState>((set, get) => ({
  navCollapsed: false,
  full: null,
  chatOpen: false,
  navBefore: false,
  enterFull: (artifactKey) => {
    const s = get();
    set({ full: artifactKey, navBefore: s.full === null ? s.navCollapsed : s.navBefore, navCollapsed: true, chatOpen: false });
  },
  exitFull: () => { const s = get(); if (s.full !== null) set({ full: null, navCollapsed: s.navBefore, chatOpen: false }); },
  setChatOpen: (chatOpen) => set({ chatOpen }),
}));

/** The version each group's card/full instance shows (its last `artifact.read`): host tabs read checks and reviews
 *  for THAT version, not a head the plugin has not loaded (codex h2b-r2 P2). */
export const useGroupShown = create<{ shown: Record<string, number> }>(() => ({ shown: {} }));
export function setGroupShown(group: string, version: number): void {
  useGroupShown.setState((s) => ({ shown: { ...s.shown, [group]: version } }));
}

// ── live frames (§7.1, §8.1) ────────────────────────────────────────────────────────────────────────

/** Live frames on a page, by default (DES §8.1). The newest cards run a frame; older ones show a still. */
export const LIVE_FRAME_CAP = 6;
interface LiveCardsState { order: string[] }
/** The cards on the page, oldest first: placing or pressing "Show it live" moves a card to the newest end. */
export const useLiveCards = create<LiveCardsState>(() => ({ order: [] }));
export function touchLive(key: string): void {
  useLiveCards.setState((s) => ({ order: [...s.order.filter((k) => k !== key), key] }));
}
export function dropLive(key: string): void {
  useLiveCards.setState((s) => ({ order: s.order.filter((k) => k !== key) }));
}
/** Is this card among the newest `cap`? (A full-screen card is always live: the caller checks that.) */
export function isLive(order: readonly string[], key: string, cap: number): boolean {
  const i = order.indexOf(key);
  return i >= 0 && i >= order.length - cap;
}

// ── what the run page supplies (H3) ─────────────────────────────────────────────────────────────────

/**
 * Provided by the page that hosts artifacts (the run page; the test page provides a mock). Read with
 * `useRunHost()` from `components/editorHost/RunHostContext.tsx`; absent = no drawer, no phase, no gate actions.
 */
export interface RunHostContext {
  runId: string | null;
  /** The run's current phase, shown in the full-screen header. */
  phase?: string | null;
  /** The run's own thread and composer, compact (360 px), for the full-screen chat drawer. */
  renderChat?: () => ReactNode;
  /** Host controls for the artifact's OPEN GATE (Approve, Send back, Re-record…), drawn from run state —
   *  never from the plugin. Shown in the card footer and the full-screen header. */
  gateActions?: (binding: ArtifactBinding) => ReactNode;
  /** Live frames on the page (DES §8.1: 6); older cards fall back to a thumbnail. */
  liveFrameCap?: number;
}

// ── component props (implemented in components/editorHost/) ────────────────────────────────────────

export interface PluginCardProps {
  binding: ArtifactBinding;
  /** Test page / conformance: load this registry record instead of the registry's choice for `kind`. */
  editor?: EditorView;
  /** Test page: use this adapter instead of the registered one for `source`. */
  adapter?: SurfaceAdapter;
  /** Test page: the bundle URL (otherwise crew's hash-pinned bundle route). */
  src?: string;
  /** Test page / conformance: the grant set (otherwise crew's decided set). */
  grants?: readonly PermissionId[];
  /** The registry's copy of the surfaces, when crew lists it (§5.1). Defaults to `editor.surfaces` if present. */
  declared?: unknown;
}

export interface HostPanelProps {
  /** The Run tab's body (H3 owns it: workflow, repos, phases, agents, checks, spend, assurance, actions). Absent
   *  where no run is in view (a document opened on the Made list): the panel is then only the open group's tabs. */
  runTab?: ReactNode;
  /** The ribbon's one line below 1200 px ("Building · phase 3 of 5 · $1.20"); without a run, the open group's name. */
  ribbon?: ReactNode;
}

export interface FullShellProps {
  open: boolean;
  /** Plugin tag (manifest title), artifact title, the run's phase. */
  tag: string;
  title: string;
  phase?: string | null;
  /** Present only when the plugin declared modes. */
  modes?: readonly FullMode[] | null;
  mode?: FullMode | undefined;
  onMode?(mode: FullMode): void;
  /** The open gate's host controls (from RunHostContext.gateActions). */
  gateActions?: ReactNode | undefined;
  /** The drawer's body (RunHostContext.renderChat); no Chat button without it. */
  chat?: ReactNode | undefined;
  onExit(): void;
  /** The morphing frame: kept in the SAME tree position open or closed, so the iframe never re-parents. */
  children: ReactNode;
}
