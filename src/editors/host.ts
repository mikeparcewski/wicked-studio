import { judgeKey, judgeTyped } from './keys.js';
import type { WriteVerb } from '../board/artifactMorph.js';
import { changedBy, chipsFor, elementLabel, type Chip, type VersionKind } from './model.js';
import { checkOps, inventoryOf, themeTokensOf, type Inventory, type WireItem } from './ops.js';
import {
  EVENTS, LIMITS, MCP_METHODS, REQUESTS, event, negotiate, parseInbound, parseReady, refuse, reply, request, sizeOf,
  type AnchorRef, type ErrorCode, type PermissionId, type Size,
} from './protocol.js';
import { clampCardHeight, parseSurfaces, sameSurfaces, v1Surfaces, valuesOk, controlValueOk, type FullMode, type Surfaces } from './surfaces.js';

/** Protocol 2's three surfaces (DES-EDITOR-PLUGIN-CONTRACT-001 §4). */
export type Surface = 'card' | 'options' | 'full';
/** The v1 size a surface is told as, to a protocol-1 plugin. */
export function sizeOfSurface(s: Surface): Size { return s === 'card' ? 'inline' : s === 'options' ? 'pane' : 'full'; }
/** Per options tab (§6): the newest confirmed `rev`, whether a change is in flight, and the queue behind it. */
interface TabState { rev: number; busy: boolean; queue: Map<string, { value: unknown; waiters: Array<(applied: boolean) => void> }> }
/** How long a plugin has to answer a host request (`host.action`, `host.mode`, `options.changed`). */
export const HOST_REPLY_MS = 2_000;

/**
 * THE PLUGIN HOST (DES-EDITOR-PLUGINS-001 §5.3-§5.10, §6, §8; slice EP-P1). One controller per
 * editor frame, framework-free so the conformance harness and the React wrapper drive the same code.
 *
 *  - The frame is created with EXACTLY `sandbox="allow-scripts"` (an opaque origin, no forms, popups,
 *    top navigation, downloads or modals) and no `allow=` features.
 *  - The handshake happens AT MOST ONCE per frame element: the one `plugin.ready` window message is
 *    accepted only from that frame's own window, for the editor/version the host loaded, with a
 *    protocol overlap. The host then transfers a MessagePort and ignores every window message from
 *    the frame. A second `load` of the frame (it navigated) is a teardown; an element is never re-used.
 *  - No `plugin.ready` within 3 s of the frame's document loading: teardown, "didn't start" (a document that never
 *    loads: "didn't load" at 90 s). `host.ping` every 10 s, 2 s to answer.
 *  - Every message is strictly parsed; every request is checked against the host's grant set (crew's
 *    decided set) and answered within 10 s; 200 messages/s, then `rate_limited`, teardown after 5 s.
 *  - Edits: one write in flight; ops checked against the HOST's inventory of the current version,
 *    text escaped, colours by grammar; the thread line and its Undo are the host's.
 *  - Chips carry host-written labels; drafted text is a separate block; forwarded keys are allowlisted
 *    and activation-bound; `ui.typed` is one grapheme with focus in the frame. Three drops tear down.
 *  - Full screen is the host's own container, never the frame.
 *  - MCP (DES-MCP-INSPECTOR-001 §4): `mcp.request` reaches only the server the operator connected in
 *    the host's own chrome (`HostOptions.mcp`), a `tools/call` only under the operator's click, and
 *    every call is reported to the host's call line. `mcp.state` / `mcp.log` reach only a frame that
 *    holds `mcp.session`; the session id, command, URL, env and headers never reach it at all.
 */

export interface ArtifactRef {
  kind: string;
  title: string;
  version: number;
  head: number;
  readonly: boolean;
  lockedParts: AnchorRef[];
}

/** The head moved to a version the reply itself does not make the plugin's current one (EP-P2, codex
 *  r2/r3): a write that landed while a helper's later version was already the head, a match that could
 *  not be told apart, a stale edit's new head, the fork an undo made. The host strips it from the reply
 *  and posts `artifact.changed` for it right after — or alone, when the reply already timed out — so the
 *  plugin shows the head and never stays on the version it wrote or was looking at. */
export interface MovedOn { head: number; kind: VersionKind }

/** The result of one `mcp.request` the host's page made for the plugin: the server's answer, or the
 *  protocol code the plugin is told with the host's own words. */
export type McpBridgeResult = { response: unknown; ms: number; truncated: boolean } | { error: ErrorCode; message: string };

/** What the inspector page gives the host (DES-MCP-INSPECTOR-001 §4): the one connected session, held
 *  by the page, never by the plugin. Absent (the dev and conformance hosts) = no session: `unavailable`. */
export interface McpHostBridge {
  request(method: string, params: Record<string, unknown> | undefined): Promise<McpBridgeResult>;
}

/** One `mcp.request`, as the host's call line counts it: `sent` when it leaves, `done` with its outcome. */
export type McpCall =
  | { phase: 'sent'; method: string; tool: string | null }
  /** `sent: false` = the host refused it before it left (no click, not connected, not a listed method). */
  | { phase: 'done'; method: string; tool: string | null; sent: boolean; ms: number | null; outcome: 'ok' | 'server-error' | ErrorCode };

export type AdapterResult<T> = (T & { moved?: MovedOn }) | { error: ErrorCode; message: string; head?: number; moved?: MovedOn };

/** What the host can do with the artifact. A method an artifact does not support answers `unsupported`. */
export interface HostAdapter {
  artifact(): ArtifactRef;
  read(version?: number): Promise<AdapterResult<{ version: number; content: { type: 'html'; html: string } | Record<string, unknown> }>>;
  versions(): Promise<AdapterResult<{ versions: { version: number; parent: number | null; createdAt: string }[]; head: number }>>;
  write(base: number, items: WireItem[], summary: string): Promise<AdapterResult<{ version: number }>>;
  undo(version: number): Promise<AdapterResult<{ undone: true }>>;
  fork(from: number): Promise<AdapterResult<{ version: number }>>;
  exportAs?(format: string): Promise<AdapterResult<{ started: true }>>;
  /** Protocol 2 `theme.set` (§6): write the artifact's theme tokens on `base`, as a new version. */
  theme?(base: number, tokens: Record<string, unknown>): Promise<AdapterResult<{ version: number }>>;
}

/** What the host shows or does in its own chrome — never the plugin's words as the operator's. */
export interface HostUi {
  chips(chips: Chip[]): void;
  draft(text: string, chips: Chip[]): void;
  typed(grapheme: string): void;
  key(key: string): void;
  morph(to: Size): void;
  status(line: string): void;
  notes(count: number): void;
  thread(line: string): void;
  /** A write this editor made, structured, so a host can draw its own line and Undo (EP-P2). `anchors`
   *  are the HOST-checked ids the write touched — the words of the line come from them, never from
   *  the plugin's `summary` (codex r1). */
  written?(w: { version: number; base: number; summary: string; anchors: string[]; verb: WriteVerb; words?: string }): void;
  /** EP-P3 (codex r1): the version the plugin read — the one it shows, which the checks panel describes. */
  shown?(version: number): void;
  fullscreen(): Promise<boolean>;
  torn(reason: string): void;
  log(entry: HostLogEntry): void;
  /** Every `mcp.request` the plugin made, for the host-drawn call line (no call is quiet). */
  mcpCall?(call: McpCall): void;
  /** Protocol 2 (DES-EDITOR-PLUGIN-CONTRACT-001): the surfaces the host renders this plugin's three surfaces from,
   *  the protocol negotiated, and why it fell back to the v1 mapping, if it did. Called once, at the handshake. */
  surfaces?(s: Surfaces, protocol: number, note: string | null): void;
  /** A confirmed values snapshot for a host-rendered controls tab (newest `rev` only). */
  optionsValues?(tab: string, values: Record<string, unknown>): void;
  /** A card with `aspect:"auto"` asked for this height (already clamped). */
  cardHeight?(px: number): void;
  /** Another instance of this artifact's group pointed at these anchors: relay them (`host.selection`). */
  selected?(anchors: AnchorRef[]): void;
}

export type HostLogEntry =
  | { at: number; kind: 'handshake'; editor: string; version: string }
  | { at: number; kind: 'ignored-window-message'; why: string }
  | { at: number; kind: 'in'; type: string; ok: boolean; why?: string }
  | { at: number; kind: 'refused'; type: string; code: ErrorCode; why: string }
  | { at: number; kind: 'dropped'; type: string; why: string }
  | { at: number; kind: 'written'; version: number; items: WireItem[] }
  | { at: number; kind: 'teardown'; reason: string }
  | { at: number; kind: 'load'; count: number };

export interface HostOptions {
  container: HTMLElement;
  src: string;
  editor: string;
  version: string;
  /** The editor's own name ("Terms checker"): third-party thread lines start with it. */
  name: string;
  /** The frame's accessible title ("Terms checker: Library proposal, version 3"). */
  title: string;
  size: Size;
  grants: readonly PermissionId[];
  theme: Record<string, string>;
  prefs: { reducedMotion: boolean; techDetails: boolean; locale: string };
  /** Third-party editors' thread lines are prefixed with their title. */
  firstParty: boolean;
  adapter: HostAdapter;
  ui: HostUi;
  /** The inspector page's session (DES-MCP-INSPECTOR-001); absent = `mcp.request` answers `unavailable`. */
  mcp?: McpHostBridge;
  /** Protocol 2: the surface this instance is (default: from `size`), its options tab, its full-screen mode. */
  surface?: Surface;
  tab?: string;
  mode?: FullMode;
  /** The registry's copy of the surfaces (§5.1). When given, `plugin.ready`'s copy must be the same. */
  declared?: unknown;
  /** The registry's sizes, for the v1 mapping. */
  sizes?: readonly string[];
  /** The host's real user activation at receipt (`navigator.userActivation.isActive`). */
  activation?: () => boolean;
  /** Whether focus is in this editor's frame (`document.activeElement === frame`). */
  focusInFrame?: (frame: HTMLIFrameElement) => boolean;
  now?: () => number;
}

const NO_ACTIVATION = (): boolean => (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive === true;

/** The written line (EP-P3): what the write did, in one verb — every item a remove is "removed", every
 *  item a colour "restyled", anything else (text, or a mix) "changed". */
export function writeVerb(items: readonly WireItem[]): WriteVerb {
  const [first] = items;
  if (items.length === 1 && first?.type === 'deck') {
    return first.op.type === 'slide-insert' ? 'added' : first.op.type === 'slide-duplicate' ? 'duplicated' : first.op.type === 'slide-move' ? 'moved' : 'changed';
  }
  return items.every((it) => it.type === 'remove') ? 'removed' : items.every((it) => it.type === 'style-edit') ? 'restyled' : 'changed';
}

/**
 * The host's own words for a write on a deck (P-D1), from ITS inventory of the version the write was
 * made on — slide numbers are places in the deck, never anchor indexes — or null when the write is not
 * a slide's (an element edit keeps the anchor words).
 */
export function deckWords(items: readonly WireItem[], inv: Inventory): string | null {
  const [first] = items;
  if (first === undefined || inv.slides.size === 0) return null;
  const n = (id: string | null | undefined): number | null => (id == null ? null : inv.slides.get(id)?.n ?? null);
  if (first.type === 'deck') {
    const at = n(first.op.slide);
    if (at === null) return null;
    if (first.op.type === 'slide-insert') {
      const after = n(first.op.after);
      return after === null ? 'a slide at the start' : `a slide after slide ${after}`;
    }
    if (first.op.type === 'slide-move') {
      const after = n(first.op.after);
      return after === null ? `slide ${at} to the start` : `slide ${at} to after slide ${after}`;
    }
    if (first.op.type === 'notes-set') return `slide ${at}’s notes`;
    return `slide ${at}`;
  }
  if (items.length === 1 && first.type === 'remove') {
    for (const s of inv.slides.values()) if (s.wid === first.selector) return `slide ${s.n}`;
  }
  // An element edit on a deck: named by the slide it sits in, by place (codex-proofing the order bug —
  // an anchor's own index stays what it was when the slide was first seen).
  const places = [...new Set(items.map((it) => inv.wids.get(it.selector)?.deckN))];
  if (places.length === 1 && places[0] !== undefined) {
    return items.every((it) => it.type === 'content-edit') ? `slide ${places[0]}’s text` : `a part of slide ${places[0]}`;
  }
  return null;
}

export function threadLine(firstParty: boolean, name: string, items: readonly WireItem[], summary: string, version: number): string {
  return `${firstParty ? 'You' : name} ${writeVerb(items)} ${summary} · Version ${version}`;
}

/** Write refusals the host or adapter makes before anything is sent: nothing was written. */
const UNSENT: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['not_granted', 'bad_request', 'too_large', 'unsupported', 'rate_limited', 'refused', 'head_moved']);

export class EditorHost {
  readonly frame: HTMLIFrameElement;
  private port: MessagePort | null = null;
  private handshaken = false;
  private torn = false;
  /** The write request whose timeout line the host is showing, while no later line replaced it (codex r5). */
  private timeoutLine: string | null = null;
  private loads = 0;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingWait: ReturnType<typeof setTimeout> | null = null;
  private pingSeq = 0;
  private drops = 0;
  /** Tool calls refused for want of the operator's click; three tear the frame down. */
  private mcpRefusals = 0;
  /** `mcp.state` / `mcp.log` the page posted before the handshake: delivered right after `host.hello`. */
  private pendingMcpState: Record<string, unknown> | null = null;
  private pendingMcpLog: unknown[] = [];
  /** Window messages after the handshake: counted against the flood limit, logged only the first few. */
  private ignoredWindow = 0;
  /** One typed character per gesture (§5.10): spent by an accepted `ui.typed`, re-armed only when
   *  focus enters the frame again — transient activation lasts seconds and is not consumed (Copilot). */
  private typingSpent = false;
  private readonly onHostBlur = (): void => { if (document.activeElement === this.frame) this.typingRearm(); };
  private writing = false;
  private grants: Set<PermissionId>;
  private ownVersions = new Set<number>();
  private inventory: { version: number; inv: Inventory; tokens: Set<string> } | null = null;
  private rate = { second: 0, count: 0, overSince: null as number | null };
  private readonly now: () => number;
  private readonly onWindow = (e: MessageEvent): void => this.windowMessage(e);
  private readonly onLoad = (): void => this.frameLoaded();
  /** The protocol the handshake negotiated (1 until then), and the surfaces rendered from it. */
  private protocol = 1;
  private decl: Surfaces | null = null;
  /** Host → plugin requests in flight (`host.action`, `host.mode`, `options.changed`). */
  private pending = new Map<string, { resolve: (r: { ok: boolean; payload: unknown }) => void; timer: ReturnType<typeof setTimeout> }>();
  private hostSeq = 0;
  /** Per options tab: the newest confirmed `rev`, the change in flight, and the queue behind it (§6). */
  private tabs = new Map<string, TabState>();

  constructor(private readonly o: HostOptions) {
    this.now = o.now ?? Date.now;
    this.grants = new Set(o.grants);
    const f = document.createElement('iframe');
    // A props-style object, so the testid scanner (scripts/testid-inventory.mjs) sees `editor-frame`.
    const attrs: Record<string, string> = {
      sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', title: o.title, 'data-testid': 'editor-frame', 'data-editor': o.editor,
    };
    for (const [k, v] of Object.entries(attrs)) f.setAttribute(k, v);
    f.className = 'wk-editor-frame';
    this.frame = f;
  }

  mount(): void {
    window.addEventListener('message', this.onWindow);
    window.addEventListener('blur', this.onHostBlur);
    this.frame.addEventListener('load', this.onLoad);
    // The 3 s for plugin.ready start when the frame's document has loaded (frameLoaded): a slow daemon serving the
    // bundle is not a plugin that failed to start (orchestrator 2026-10-14: :7701 took 20-59 s to serve the deck's
    // entry, and the card tore down at 3 s). A document that never loads is torn down at loadMs. Armed before the
    // frame is inserted: an insertion may fire its first load synchronously (codex h2 r22 P3).
    this.readyTimer = setTimeout(() => { if (!this.handshaken) this.teardown('This editor didn’t load'); }, LIMITS.loadMs);
    this.frame.src = this.o.src;
    this.o.container.appendChild(this.frame);
  }

  get alive(): boolean { return !this.torn; }
  get connected(): boolean { return this.handshaken && !this.torn; }

  // ── handshake ─────────────────────────────────────────────────────────────────────────────

  private windowMessage(e: MessageEvent): void {
    if (this.torn || e.source !== this.frame.contentWindow) return; // not this frame: not ours
    if (this.handshaken) {
      // The window is not a second channel: it counts toward the flood limit, and a flood of it
      // cannot grow the host log without bound (Copilot).
      this.ignoredWindow += 1;
      if (this.ignoredWindow <= 50) this.log({ kind: 'ignored-window-message', why: 'after the handshake every message rides the port' });
      this.overRate();
      return;
    }
    const ready = parseReady(e.data);
    if (ready === null) { this.log({ kind: 'ignored-window-message', why: 'not a plugin.ready' }); return; }
    if (ready.editor !== this.o.editor || ready.version !== this.o.version) {
      this.log({ kind: 'ignored-window-message', why: `plugin.ready for ${ready.editor}@${ready.version}, loaded ${this.o.editor}@${this.o.version}` });
      return;
    }
    const negotiated = negotiate(ready.protocol);
    if (negotiated === null) { this.teardown('This editor speaks a protocol studio does not'); return; }
    // Protocol 2 needs a surfaces declaration that parses, and that is the registry's own when crew lists one
    // (§5.1); otherwise the host falls back to the v1 mapping and says why.
    let note: string | null = null;
    let decl: Surfaces | null = null;
    if (negotiated >= 2) {
      const mine = parseSurfaces(ready.surfaces);
      if (!mine.ok) note = `This editor's surfaces were refused (${mine.reason}); shown the protocol-1 way.`;
      else if (this.o.declared !== undefined) {
        const reg = parseSurfaces(this.o.declared);
        if (!reg.ok || !sameSurfaces(reg.value, mine.value)) note = 'This editor declares other surfaces than its manifest; shown the protocol-1 way.';
        else decl = mine.value;
      } else decl = mine.value;
    }
    this.protocol = decl === null ? 1 : negotiated;
    if (this.protocol === 1 && !ready.protocol.includes(1)) { this.teardown(note ?? 'This editor speaks a protocol studio does not'); return; }
    this.decl = decl ?? v1Surfaces(this.o.sizes ?? ['inline', 'pane', 'full']);
    this.handshaken = true;
    if (this.readyTimer !== null) clearTimeout(this.readyTimer);
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = (m) => this.portMessage(m.data);
    const a = this.o.adapter.artifact();
    const surface = this.o.surface ?? (this.o.size === 'inline' ? 'card' : this.o.size === 'pane' ? 'options' : 'full');
    // A tab picked before the handshake (the operator clicked Coverage while the frame was loading) is the tab the
    // instance starts on: host.tab before the port existed went nowhere.
    const wanted = this.tabWanted;
    const tab = wanted !== undefined && this.decl.options?.tabs.some((t) => t.id === wanted && t.render === 'plugin') ? wanted : this.o.tab;
    const v2 = this.protocol >= 2
      ? { surface, ...(tab !== undefined ? { tab } : {}), ...(surface === 'full' && this.decl.full?.modes != null ? { mode: this.o.mode ?? this.decl.full.default } : {}) }
      : {};
    this.frame.contentWindow?.postMessage(event('host.hello', {
      protocol: this.protocol, ...v2, artifact: a, size: this.o.size, grants: [...this.grants],
      theme: this.o.theme, artifactTheme: null, prefs: this.o.prefs,
      limits: { messageBytes: LIMITS.messageBytes, writeOps: LIMITS.writeOps, writeBytes: LIMITS.writeBytes },
    }), '*', [channel.port2]);
    this.log({ kind: 'handshake', editor: ready.editor, version: ready.version });
    this.o.ui.surfaces?.(this.decl, this.protocol, note);
    this.pingTimer = setInterval(() => this.ping(), LIMITS.pingEveryMs);
    if (this.pendingMcpState !== null) this.post(event('mcp.state', this.pendingMcpState));
    this.pendingMcpState = null;
    const backlog = this.pendingMcpLog;
    this.pendingMcpLog = [];
    if (backlog.length > 0) this.mcpLog(backlog);
  }

  private frameLoaded(): void {
    this.loads += 1;
    this.log({ kind: 'load', count: this.loads });
    // The window survives navigation; a second document is never trusted with a port or a grant.
    if (this.loads >= 2) { this.teardown('This editor reloaded itself'); return; }
    if (this.handshaken || this.torn) return;
    if (this.readyTimer !== null) clearTimeout(this.readyTimer);
    this.readyTimer = setTimeout(() => { if (!this.handshaken) this.teardown('This editor didn’t start'); }, LIMITS.readyMs);
  }

  // ── the port ──────────────────────────────────────────────────────────────────────────────

  private post(msg: Record<string, unknown>): void {
    if (!this.torn) this.port?.postMessage(msg);
  }

  private overRate(): boolean {
    const sec = Math.floor(this.now() / 1000);
    if (sec !== this.rate.second) {
      // A flood is "sustained" across seconds: only a whole second spent under the limit ends it (codex).
      if (this.rate.count <= LIMITS.ratePerSec || sec - this.rate.second > 1) this.rate.overSince = null;
      this.rate.second = sec;
      this.rate.count = 0;
    }
    this.rate.count += 1;
    if (this.rate.count <= LIMITS.ratePerSec) return false;
    this.rate.overSince ??= this.now();
    if (this.now() - this.rate.overSince >= 5_000) this.teardown('This editor sent too many messages');
    return true;
  }

  private portMessage(data: unknown): void {
    if (this.torn) return;
    if (this.overRate()) {
      const id = typeof (data as { id?: unknown })?.id === 'string' ? (data as { id: string }).id : null;
      if (id !== null) this.post(refuse(id, 'rate_limited', 'too many messages'));
      return;
    }
    const parsed = parseInbound(data, this.protocol);
    if (!parsed.ok) {
      this.log({ kind: 'in', type: String((data as { type?: unknown })?.type ?? '?'), ok: false, why: parsed.reason });
      if (parsed.id !== undefined) this.post(refuse(parsed.id, parsed.reason === 'too large' ? 'too_large' : 'bad_request', parsed.reason));
      return;
    }
    const msg = parsed.msg;
    if (msg.kind === 'reply') {
      const p = this.pending.get(msg.re);
      if (p !== undefined) { this.pending.delete(msg.re); clearTimeout(p.timer); p.resolve({ ok: msg.ok, payload: msg.payload }); return; }
      this.pingReply(msg.re);
      return;
    }
    this.log({ kind: 'in', type: msg.type, ok: true });
    if (msg.kind === 'event') { this.handleEvent(msg.type, msg.payload); return; }
    const need = REQUESTS[msg.type];
    if (!this.grants.has(need)) {
      this.log({ kind: 'refused', type: msg.type, code: 'not_granted', why: `needs ${need}` });
      this.post(refuse(msg.id, 'not_granted', `needs ${need}`));
      return;
    }
    const id = msg.id;
    let settled = false;
    const limitMs = msg.type === 'mcp.request' ? LIMITS.mcpReplyMs : LIMITS.replyMs;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // A write's timeout is the host's line, said NOW, in the host's own order (codex r4): a landing just
      // after the timer puts its written line (with Undo) after this one. Were the plugin to say it on
      // hearing the reply, its status could arrive after that written line and replace it.
      // A torn host says nothing: its replacement owns the line now (codex r5).
      if (msg.type === 'version.write' && !this.torn) {
        this.o.ui.status('Not changed yet: no answer in 10 s — it may still land');
        this.timeoutLine = id;
      }
      this.post(refuse(id, 'timeout', `no answer in ${Math.round(limitMs / 1000)} s`));
    }, limitMs);
    this.handleRequest(msg.type, msg.payload)
      .then((r) => {
        // Settled by the timer: the plugin heard "timeout" and no second reply follows — but what the
        // adapter did meanwhile is real (a write's landing window is 20 s, the reply's 10 s; codex r3), so
        // a version it made, and any head it moved to, still reach the plugin as `artifact.changed`.
        const late = settled;
        settled = true;
        clearTimeout(timer);
        // A head that moved on is the host's to announce, after the reply, never a field of it (codex r2).
        let moved: MovedOn | undefined;
        if (r !== null && typeof r === 'object' && 'moved' in r) {
          const { moved: m, ...rest } = r as { moved?: MovedOn };
          moved = m;
          r = rest;
        }
        const failed = r !== null && typeof r === 'object' && 'error' in r && typeof (r as { error: unknown }).error === 'string';
        if (late) {
          const made = (msg.type === 'version.write' || msg.type === 'version.fork') && !failed && typeof (r as { version?: unknown }).version === 'number';
          if (made) this.artifactChanged((r as { version: number }).version, msg.type === 'version.fork' ? 'fork' : 'deterministic');
          // A definite "no" after the timer replaces "it may still land" — while that line is still shown.
          else if (failed) this.lateEnd(id, (r as { error: ErrorCode }).error, (r as { message: string }).message);
        } else if (failed) {
          const e = r as { error: ErrorCode; message: string; head?: number };
          this.log({ kind: 'refused', type: msg.type, code: e.error, why: e.message });
          this.post({ ...refuse(id, e.error, e.message), ...(e.head !== undefined ? { payload: { head: e.head } } : {}) });
        } else {
          this.post(reply(id, r));
          // EP-P3 (codex r1/r2): the version the plugin now shows is the one a read answered IN TIME —
          // a late read's reply is suppressed above, so the plugin never shows it.
          if (msg.type === 'artifact.read' && !this.torn && typeof (r as { version?: unknown }).version === 'number') this.o.ui.shown?.((r as { version: number }).version);
        }
        if (moved !== undefined) this.artifactChanged(moved.head, moved.kind);
      })
      .catch((e: unknown) => {
        if (settled) { this.lateEnd(id, null, e instanceof Error ? e.message : String(e)); return; }
        settled = true;
        clearTimeout(timer);
        this.post(refuse(id, 'unavailable', e instanceof Error ? e.message : String(e)));
      });
  }

  /** The timed-out write `id` ended without a version: say how, if its timeout line is still the one
   *  shown. Only a refusal made BEFORE the write was sent says "Not changed" (codex r6/r7); what follows
   *  sending (`stale`, `unavailable`: what landed cannot be fully told) is said in the adapter's own
   *  words, and a throw says the outcome is not known. */
  private lateEnd(id: string, code: ErrorCode | null, why: string): void {
    if (this.torn || this.timeoutLine !== id) return;
    this.timeoutLine = null;
    const line = code === null ? `Whether it changed is not known: ${why}` : UNSENT.has(code) ? `Not changed: ${why}` : why;
    this.o.ui.status(line.slice(0, LIMITS.statusChars));
  }

  private async currentInventory(): Promise<{ inv: Inventory; tokens: Set<string>; version: number } | { error: ErrorCode; message: string }> {
    const head = this.o.adapter.artifact().head;
    if (this.inventory?.version === head) return this.inventory;
    const r = await this.o.adapter.read(head);
    if ('error' in r) return { error: r.error as ErrorCode, message: String(r.message) };
    const content = r.content as { type?: unknown; html?: unknown };
    if (content.type !== 'html' || typeof content.html !== 'string') return { error: 'unsupported', message: 'this artifact has no element edits' };
    this.inventory = { version: head, inv: inventoryOf(content.html), tokens: themeTokensOf(content.html) };
    return this.inventory;
  }

  private async handleRequest(type: keyof typeof REQUESTS, p: Record<string, unknown>): Promise<unknown> {
    const a = this.o.adapter;
    switch (type) {
      case 'artifact.read': return a.read(typeof p['version'] === 'number' ? p['version'] : undefined);
      case 'artifact.versions': return a.versions();
      case 'version.write': {
        if (this.writing) return { error: 'rate_limited', message: 'one write at a time' };
        if (a.artifact().readonly) return { error: 'refused', message: 'this artifact is read-only here' };
        if (p['base'] !== a.artifact().head) return { error: 'head_moved', message: 'the artifact changed since', head: a.artifact().head };
        // The lock is taken BEFORE the first await (the inventory read): one write in flight (Copilot).
        this.writing = true;
        try {
          const inv = await this.currentInventory();
          if ('error' in inv) return inv;
          const checked = checkOps(p['ops'] as unknown[], inv.inv, inv.tokens);
          if (!checked.ok) return { error: checked.code, message: checked.message };
          const r = await a.write(p['base'] as number, checked.items, String(p['summary']));
          if (!('error' in r)) {
            this.ownVersions.add(r.version);
            this.log({ kind: 'written', version: r.version, items: checked.items });
            const summary = String(p['summary']).slice(0, LIMITS.summaryChars);
            this.timeoutLine = null;
            this.o.ui.thread(threadLine(this.o.firstParty, this.o.name, checked.items, summary, r.version));
            const words = deckWords(checked.items, inv.inv);
            this.o.ui.written?.({ version: r.version, base: p['base'] as number, summary, anchors: [...new Set(checked.items.map((it) => it.selector))], verb: writeVerb(checked.items), ...(words === null ? {} : { words }) });
          }
          return r;
        } finally {
          this.writing = false;
        }
      }
      case 'version.undo': {
        const v = p['version'] as number;
        if (!this.ownVersions.has(v)) return { error: 'refused', message: 'only a version this editor wrote, this session' };
        const r = await a.undo(v);
        // The fork an undo makes is this editor's (as the host-side Undo counts it); it reaches the plugin
        // as `moved`, since the reply itself names no version.
        if (!('error' in r) && r.moved !== undefined) this.ownVersions.add(r.moved.head);
        return r;
      }
      case 'version.fork': {
        const r = await a.fork(p['from'] as number);
        if (!('error' in r)) this.ownVersions.add(r.version);
        return r;
      }
      case 'composer.draft': {
        const chips = await this.chipsOf(p['anchors'] as AnchorRef[]);
        this.o.ui.draft(String(p['text']), chips);
        return { placed: true };
      }
      case 'ui.fullscreen': return { entered: await this.o.ui.fullscreen() };
      case 'mcp.request': return this.mcpRequest(p);
      case 'export.request':
        return a.exportAs !== undefined ? a.exportAs(String(p['format'])) : { error: 'unsupported', message: 'no export for this artifact' };
      case 'theme.set': {
        if (a.theme === undefined) return { error: 'unsupported', message: 'this artifact has no theme' };
        if (a.artifact().readonly) return { error: 'refused', message: 'this artifact is read-only here' };
        // The same optimistic rule as a write (§6): a theme set on a head that moved is refused with the head.
        if (p['base'] !== a.artifact().head) return { error: 'head_moved', message: 'the artifact changed since', head: a.artifact().head };
        if (this.writing) return { error: 'rate_limited', message: 'one write at a time' };
        this.writing = true;
        try {
          const r = await a.theme(p['base'] as number, p['tokens'] as Record<string, unknown>);
          if (!('error' in r)) { this.ownVersions.add(r.version); this.inventory = null; this.o.ui.thread(`${this.o.firstParty ? 'You' : this.o.name} changed the theme · Version ${r.version}`); }
          return r;
        } finally {
          this.writing = false;
        }
      }
      default:
        return { error: 'unsupported', message: `${type} is not available for this artifact` };
    }
  }

  /**
   * `mcp.request` (DES-MCP-INSPECTOR-001 §4). Judged at receipt, before any await: the method must be
   * on the bridge's list, and a `tools/call` needs the operator's real activation (a click or Enter in
   * the frame activates the host) — three calls nobody clicked for tear the frame down. Every call that
   * gets this far is reported to the host's call line, sent and done.
   */
  private async mcpRequest(p: Record<string, unknown>): Promise<unknown> {
    const method = String(p['method']);
    const params = p['params'] as Record<string, unknown> | undefined;
    const tool = method === 'tools/call' && typeof params?.['name'] === 'string' ? params['name'].slice(0, 80) : null;
    if (!MCP_METHODS.has(method)) {
      this.o.ui.mcpCall?.({ phase: 'done', method: method.slice(0, 80), tool: null, sent: false, ms: null, outcome: 'bad_request' });
      return { error: 'bad_request', message: `${method} is not a method the inspector sends` };
    }
    // A click in the host's own chrome (Connect, Copy log) also activates the page, so the click must
    // be in THIS frame: real activation with focus still in it (codex r1).
    const clicked = (this.o.activation ?? NO_ACTIVATION)() && (this.o.focusInFrame ?? ((f) => document.activeElement === f))(this.frame);
    if (method === 'tools/call' && !clicked) {
      this.mcpRefusals += 1;
      this.o.ui.mcpCall?.({ phase: 'done', method, tool, ms: null, sent: false, outcome: 'refused' });
      if (this.mcpRefusals >= LIMITS.mcpRefusalsBeforeTeardown) this.teardown('This editor called tools nobody clicked for');
      return { error: 'refused', message: 'a tool call needs your click in the editor' };
    }
    if (this.o.mcp === undefined) {
      this.o.ui.mcpCall?.({ phase: 'done', method, tool, ms: null, sent: false, outcome: 'unavailable' });
      return { error: 'unavailable', message: 'not connected' };
    }
    this.o.ui.mcpCall?.({ phase: 'sent', method, tool });
    const r = await this.o.mcp.request(method, params);
    if (!this.torn) {
      const outcome = 'error' in r ? r.error : (r.response as { error?: unknown } | null)?.error !== undefined ? 'server-error' : 'ok';
      this.o.ui.mcpCall?.({ phase: 'done', method, tool, sent: true, ms: 'error' in r ? null : r.ms, outcome });
    }
    return r;
  }

  /** EP-P3: the host's own "point at it" — a finding in the checks panel becomes a composer chip, in
   *  the host's words, only when the element is in the version's inventory. False = not on this page. */
  async pointAt(wid: string): Promise<boolean> {
    if (this.torn) return false;
    const chips = await this.chipsOf([{ kind: 'element', id: wid }]);
    if (chips.length === 0) return false;
    this.o.ui.chips(chips);
    return true;
  }

  private async chipsOf(anchors: readonly AnchorRef[]): Promise<Chip[]> {
    const inv = await this.currentInventory();
    const wids = 'error' in inv ? new Map<string, { text: string }>() : inv.inv.wids;
    // Only anchors the HOST can resolve get a chip: elements in its own inventory. A page has no
    // chapters or times; a plugin-chosen chapter id is never echoed as a label (Copilot). The
    // demo-video adapter resolves those against its own chapter list (EP-P5).
    return chipsFor(anchors, (x) => (x.kind === 'element' && wids.has(x.id) ? elementLabel(wids.get(x.id)?.text, x.id) : null));
  }

  private drop(type: string, why: string): void {
    this.drops += 1;
    this.log({ kind: 'dropped', type, why });
    if (this.drops >= LIMITS.dropsBeforeTeardown) this.teardown('This editor sent keys it may not');
  }

  private handleEvent(type: keyof typeof EVENTS, p: Record<string, unknown>): void {
    const need = EVENTS[type];
    if (need !== null && !this.grants.has(need)) { this.log({ kind: 'dropped', type, why: `needs ${need}` }); return; }
    const activation = (this.o.activation ?? NO_ACTIVATION)();
    switch (type) {
      case 'selection.set':
        void this.chipsOf(p['anchors'] as AnchorRef[]).then((c) => this.o.ui.chips(c));
        // Protocol 2: the other instances of this artifact's group hear it as `host.selection` (§4).
        if (this.protocol >= 2) this.o.ui.selected?.(p['anchors'] as AnchorRef[]);
        return;
      case 'options.values': {
        const tab = this.decl?.options?.tabs.find((t) => t.id === p['tab'] && t.render === 'controls');
        if (tab === undefined || !valuesOk(tab, p['values'])) { this.log({ kind: 'dropped', type, why: 'values outside the tab\'s controls' }); return; }
        this.snapshot(tab.id, p['rev'] as number, p['values'] as Record<string, unknown>);
        return;
      }
      case 'ui.height':
        if (this.decl?.card.aspect !== 'auto') { this.log({ kind: 'dropped', type, why: 'the card is not aspect:auto' }); return; }
        this.o.ui.cardHeight?.(clampCardHeight(p['px'] as number));
        return;
      case 'checks.contribute':
        this.o.ui.notes((p['checks'] as unknown[]).length);
        return;
      case 'ui.morph': {
        const to = String(p['to']);
        this.o.ui.morph(to === 'card' ? 'inline' : (to as Size));
        return;
      }
      case 'ui.key': {
        const key = String(p['key']);
        const v = judgeKey(key, activation);
        if (v.ok) this.o.ui.key(key);
        else this.drop(type, v.why);
        return;
      }
      case 'ui.typed': {
        const focus = (this.o.focusInFrame ?? ((f) => document.activeElement === f))(this.frame);
        const v = judgeTyped(String(p['grapheme']), activation, focus);
        if (!v.ok) { this.drop(type, v.why); return; }
        if (this.typingSpent) { this.drop(type, 'one typed character per gesture'); return; }
        this.typingSpent = true;
        this.o.ui.typed(String(p['grapheme']));
        return;
      }
      case 'ui.status':
        this.timeoutLine = null;
        this.o.ui.status(String(p['line']).slice(0, LIMITS.statusChars));
        return;
      default:
        return; // evidence.open, plugin.error: recorded by the log above, never shown verbatim
    }
  }

  // ── liveness ──────────────────────────────────────────────────────────────────────────────

  private ping(): void {
    if (!this.connected || this.pingWait !== null) return;
    this.pingSeq += 1;
    this.post(request('host.ping', `ping-${this.pingSeq}`, {}));
    this.pingWait = setTimeout(() => this.teardown('This editor stopped responding'), LIMITS.pingReplyMs);
  }

  private pingReply(re: string): void {
    if (re === `ping-${this.pingSeq}` && this.pingWait !== null) { clearTimeout(this.pingWait); this.pingWait = null; }
  }

  // ── host → plugin ─────────────────────────────────────────────────────────────────────────

  /** Focus entered the frame again (a new gesture there): one more typed character may pass. */
  typingRearm(): void { this.typingSpent = false; }

  setSize(size: Size): void { this.post(event('host.size', { size })); }

  // ── protocol 2: surfaces (DES-EDITOR-PLUGIN-CONTRACT-001 §6) ─────────────────────────────────────

  /** The protocol this frame speaks, and the surfaces the host renders it from (v1 mapping for protocol 1). */
  get negotiated(): number { return this.protocol; }
  get surfaces(): Surfaces | null { return this.decl; }

  private hostRequest(type: string, payload: Record<string, unknown>): Promise<{ ok: boolean; payload: unknown } | null> {
    if (!this.connected || this.protocol < 2) return Promise.resolve(null);
    this.hostSeq += 1;
    const id = `h-${this.hostSeq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve(null); }, HOST_REPLY_MS);
      this.pending.set(id, { resolve, timer });
      this.post(request(type, id, payload));
    });
  }

  /** The card ↔ full morph of this one instance (`host.surface`); v1 hears `host.size`. */
  setSurface(surface: Surface, mode?: FullMode): void {
    if (this.protocol < 2) { this.setSize(sizeOfSurface(surface)); return; }
    const m = surface === 'full' && this.decl?.full?.modes != null ? (mode ?? this.decl.full.default) : undefined;
    this.post(event('host.surface', { surface, ...(m !== undefined ? { mode: m } : {}) }));
  }

  /** Simple/Advanced (`host.mode`): the plugin's echo is the mode it now shows; null = no answer, or no modes. */
  async setMode(mode: FullMode): Promise<FullMode | null> {
    if (this.decl?.full?.modes == null) return null;
    const r = await this.hostRequest('host.mode', { mode });
    const raw = r?.ok === true ? r.payload : null;
    const shown = typeof raw === 'object' && raw !== null ? (raw as { mode?: unknown }).mode : null;
    return shown === 'simple' || shown === 'advanced' ? shown : null;
  }

  /** A declared `verb:"plugin"` card action, after the operator's click on the HOST's button. It grants no
   *  activation (§6): a `tools/call` still needs a click inside the frame. */
  async action(id: string): Promise<{ handled: boolean; status: string | null } | null> {
    const a = this.decl?.card.actions.find((x) => x.id === id && x.verb === 'plugin');
    if (a === undefined) return null;
    const r = await this.hostRequest('host.action', { id });
    if (r === null || !r.ok) return null;
    const pl = typeof r.payload === 'object' && r.payload !== null ? (r.payload as { handled?: unknown; status?: unknown }) : null;
    const status = typeof pl?.status === 'string' ? pl.status.replace(/[\r\n]+/gu, ' ').slice(0, LIMITS.statusChars) : null;
    return { handled: pl?.handled === true, status };
  }

  /** The tab asked for before the handshake: `host.hello` carries it (there is no port to send `host.tab` on yet). */
  private tabWanted: string | undefined = undefined;

  /** The options instance's plugin tab now shown (`host.tab`). */
  setTab(tab: string): void {
    if (!this.handshaken) { this.tabWanted = tab; return; }
    if (this.protocol >= 2 && this.decl?.options?.tabs.some((t) => t.id === tab && t.render === 'plugin')) this.post(event('host.tab', { tab }));
  }

  /** Another instance of this artifact's group pointed (`host.selection`; ids only). */
  relaySelection(anchors: readonly AnchorRef[]): void {
    if (this.protocol >= 2) this.post(event('host.selection', { anchors }));
  }

  private snapshot(tab: string, rev: number, values: Record<string, unknown>): boolean {
    const t = this.tabState(tab);
    // Newest wins, whenever it arrives (§6): a snapshot with a lower or equal rev is discarded.
    if (rev <= t.rev) return false;
    t.rev = rev;
    this.o.ui.optionsValues?.(tab, values);
    return true;
  }

  /**
   * A host-rendered control changed (`options.changed`). Serialized per tab: one change in flight, later ones
   * queued, the newest value per control kept (an earlier queued value for the same control shares the newer
   * one's outcome). Resolves `true` only when the plugin applied it AND confirmed it with a valid snapshot (an
   * integer `rev`, values the tab's controls can hold); on `false`, a timeout or a refusal the caller shows the
   * last confirmed values again (from `optionsValues`).
   */
  changeOption(tab: string, id: string, value: unknown): Promise<boolean> {
    const decl = this.decl?.options?.tabs.find((t) => t.id === tab && t.render === 'controls');
    const control = decl?.controls?.find((c) => c.id === id);
    if (decl === undefined || control === undefined || !controlValueOk(control, value)) return Promise.resolve(false);
    const t = this.tabState(tab);
    return new Promise<boolean>((resolve) => {
      const queued = t.queue.get(id);
      if (queued !== undefined) { queued.value = value; queued.waiters.push(resolve); }
      else t.queue.set(id, { value, waiters: [resolve] });
      if (!t.busy) void this.pump(tab);
    });
  }

  private tabState(tab: string): TabState {
    let t = this.tabs.get(tab);
    if (t === undefined) { t = { rev: -1, busy: false, queue: new Map() }; this.tabs.set(tab, t); }
    return t;
  }

  private async pump(tab: string): Promise<void> {
    const t = this.tabState(tab);
    const decl = this.decl?.options?.tabs.find((x) => x.id === tab && x.render === 'controls');
    t.busy = true;
    try {
      for (let next = t.queue.entries().next(); !next.done; next = t.queue.entries().next()) {
        const [id, entry] = next.value;
        t.queue.delete(id);
        let applied = false;
        if (decl !== undefined && !this.torn) {
          const r = await this.hostRequest('options.changed', { tab, id, value: entry.value });
          // Any reply shape is read defensively: a missing or non-object payload is "not confirmed" (codex h1-r2).
          const raw = r?.ok === true ? r.payload : null;
          const pl = typeof raw === 'object' && raw !== null ? (raw as { applied?: unknown; rev?: unknown; values?: unknown }) : null;
          const confirmed = pl !== null && Number.isInteger(pl.rev) && valuesOk(decl, pl.values);
          if (confirmed) this.snapshot(tab, pl.rev as number, pl.values as Record<string, unknown>);
          applied = confirmed && pl.applied === true;
        }
        for (const w of entry.waiters) w(applied);
      }
    } finally {
      t.busy = false;
    }
  }
  setTheme(theme: Record<string, string>): void { this.post(event('host.theme', { theme, artifactTheme: null })); }
  setGrants(grants: readonly PermissionId[]): void { this.grants = new Set(grants); }
  selectionCleared(): void { this.post(event('selection.cleared', {})); }

  /** `mcp.state` (DES-MCP-INSPECTOR-001 §4): only to a frame holding `mcp.session`; the latest one is
   *  kept until the handshake. Never carries the session id, command, URL, env or headers. */
  mcpState(payload: Record<string, unknown>): void {
    if (this.torn || !this.grants.has('mcp.session')) return;
    if (!this.handshaken) { this.pendingMcpState = payload; return; }
    this.post(event('mcp.state', payload));
  }

  /** `mcp.log {entries}`: the bridge's entries as polled, in batches that fit one message. Kept until the
   *  handshake (at most the bridge's ring, 1000). */
  mcpLog(entries: readonly unknown[]): void {
    if (this.torn || !this.grants.has('mcp.session') || entries.length === 0) return;
    if (!this.handshaken) { this.pendingMcpLog = [...this.pendingMcpLog, ...entries].slice(-1000); return; }
    const budget = LIMITS.messageBytes - 1_024;
    let batch: unknown[] = [];
    let bytes = 0;
    for (const e of entries) {
      const size = sizeOf(e);
      if (batch.length > 0 && bytes + size > budget) { this.post(event('mcp.log', { entries: batch })); batch = []; bytes = 0; }
      batch.push(e);
      bytes += size;
    }
    if (batch.length > 0) this.post(event('mcp.log', { entries: batch }));
  }

  /**
   * The host's own Undo (the thread line's button, EP-P2): the same rule as `version.undo` — only a
   * version this editor wrote this session — and the plugin hears the outcome as `artifact.changed`
   * either way: the fork as its own, or the head that moved under it.
   */
  async undo(version: number): Promise<AdapterResult<{ undone: true }>> {
    if (!this.ownVersions.has(version)) return { error: 'refused', message: 'only a version this editor wrote, this session' };
    const was = this.o.adapter.artifact().head;
    const r = await this.o.adapter.undo(version);
    if (this.torn) return r;
    const head = this.o.adapter.artifact().head;
    // Only a head that moved is news (the fork, or what moved under it); a refused or failed undo
    // changed nothing, so the inventory and the plugin's page stand (codex r1).
    if (head === was) return r;
    this.inventory = null;
    if (!('error' in r)) {
      this.ownVersions.add(head);
      this.post(event('artifact.changed', { version: head, head, by: 'this-editor', kind: 'fork' }));
    } else {
      this.post(event('artifact.changed', { version: head, head, by: 'other', kind: 'generated' }));
    }
    return r;
  }

  /** A version the host's own chrome wrote for this artifact (Match a website, HOST-API §4 tab footers): this editor's
   *  session owns it, so the thread line's Undo (`undo`) may fork back from it. */
  adopt(version: number): void { if (!this.torn) this.ownVersions.add(version); }

  /** A new version landed (interactive `version.created`): the plugin hears who wrote it. */
  artifactChanged(version: number, kind: VersionKind): void {
    const by = changedBy(version, kind, this.ownVersions);
    if (by === null) return;
    this.inventory = null;
    this.post(event('artifact.changed', { version, head: this.o.adapter.artifact().head, by, kind }));
  }

  /** Conformance only: post an arbitrary host message (fuzzing, a scripted case). */
  inject(msg: unknown): void { if (!this.torn) this.port?.postMessage(msg); }

  teardown(reason: string): void {
    if (this.torn) return;
    this.post(event('host.teardown', { reason }));
    this.torn = true;
    window.removeEventListener('message', this.onWindow);
    window.removeEventListener('blur', this.onHostBlur);
    this.frame.removeEventListener('load', this.onLoad);
    if (this.readyTimer !== null) clearTimeout(this.readyTimer);
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    if (this.pingWait !== null) clearTimeout(this.pingWait);
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.resolve({ ok: false, payload: null }); }
    this.pending.clear();
    this.port?.close();
    this.port = null;
    this.frame.remove();
    this.log({ kind: 'teardown', reason });
    this.o.ui.torn(reason);
  }

  private log(entry: Omit<HostLogEntry, 'at'> & Record<string, unknown>): void {
    this.o.ui.log({ ...entry, at: this.now() } as HostLogEntry);
  }
}
