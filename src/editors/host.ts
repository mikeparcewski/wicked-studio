import { judgeKey, judgeTyped } from './keys.js';
import { changedBy, chipsFor, elementLabel, type Chip, type VersionKind } from './model.js';
import { checkOps, inventoryOf, themeTokensOf, type Inventory, type WireItem } from './ops.js';
import {
  EVENTS, LIMITS, PROTOCOL_VERSION, REQUESTS, event, parseInbound, parseReady, refuse, reply, request,
  type AnchorRef, type ErrorCode, type PermissionId, type Size,
} from './protocol.js';

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
 *  - No `plugin.ready` within 3 s: teardown, "didn't start". `host.ping` every 10 s, 2 s to answer.
 *  - Every message is strictly parsed; every request is checked against the host's grant set (crew's
 *    decided set) and answered within 10 s; 200 messages/s, then `rate_limited`, teardown after 5 s.
 *  - Edits: one write in flight; ops checked against the HOST's inventory of the current version,
 *    text escaped, colours by grammar; the thread line and its Undo are the host's.
 *  - Chips carry host-written labels; drafted text is a separate block; forwarded keys are allowlisted
 *    and activation-bound; `ui.typed` is one grapheme with focus in the frame. Three drops tear down.
 *  - Full screen is the host's own container, never the frame.
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
  written?(w: { version: number; base: number; summary: string; anchors: string[] }): void;
  fullscreen(): Promise<boolean>;
  torn(reason: string): void;
  log(entry: HostLogEntry): void;
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
  /** The host's real user activation at receipt (`navigator.userActivation.isActive`). */
  activation?: () => boolean;
  /** Whether focus is in this editor's frame (`document.activeElement === frame`). */
  focusInFrame?: (frame: HTMLIFrameElement) => boolean;
  now?: () => number;
}

const NO_ACTIVATION = (): boolean => (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive === true;

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
    this.frame.src = this.o.src;
    this.o.container.appendChild(this.frame);
    this.readyTimer = setTimeout(() => { if (!this.handshaken) this.teardown('This editor didn’t start'); }, LIMITS.readyMs);
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
    if (!ready.protocol.includes(PROTOCOL_VERSION)) { this.teardown('This editor speaks a protocol studio does not'); return; }
    this.handshaken = true;
    if (this.readyTimer !== null) clearTimeout(this.readyTimer);
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = (m) => this.portMessage(m.data);
    const a = this.o.adapter.artifact();
    this.frame.contentWindow?.postMessage(event('host.hello', {
      protocol: PROTOCOL_VERSION, artifact: a, size: this.o.size, grants: [...this.grants],
      theme: this.o.theme, artifactTheme: null, prefs: this.o.prefs,
      limits: { messageBytes: LIMITS.messageBytes, writeOps: LIMITS.writeOps, writeBytes: LIMITS.writeBytes },
    }), '*', [channel.port2]);
    this.log({ kind: 'handshake', editor: ready.editor, version: ready.version });
    this.pingTimer = setInterval(() => this.ping(), LIMITS.pingEveryMs);
  }

  private frameLoaded(): void {
    this.loads += 1;
    this.log({ kind: 'load', count: this.loads });
    // The window survives navigation; a second document is never trusted with a port or a grant.
    if (this.loads >= 2) this.teardown('This editor reloaded itself');
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
    const parsed = parseInbound(data);
    if (!parsed.ok) {
      this.log({ kind: 'in', type: String((data as { type?: unknown })?.type ?? '?'), ok: false, why: parsed.reason });
      if (parsed.id !== undefined) this.post(refuse(parsed.id, parsed.reason === 'too large' ? 'too_large' : 'bad_request', parsed.reason));
      return;
    }
    const msg = parsed.msg;
    if (msg.kind === 'reply') { this.pingReply(msg.re); return; }
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
      this.post(refuse(id, 'timeout', 'no answer in 10 s'));
    }, LIMITS.replyMs);
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
   *  shown. Only a code that means nothing was written says "Not changed"; `unavailable` (sent, but what
   *  landed cannot be told) is said in its own words, and a throw says the outcome is not known (codex r6). */
  private lateEnd(id: string, code: ErrorCode | null, why: string): void {
    if (this.torn || this.timeoutLine !== id) return;
    this.timeoutLine = null;
    const line = code === null ? `Whether it changed is not known: ${why}` : code === 'unavailable' ? why : `Not changed: ${why}`;
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
            this.o.ui.thread(`${this.o.firstParty ? 'You changed' : `${this.o.name} changed`} ${summary} · Version ${r.version}`);
            this.o.ui.written?.({ version: r.version, base: p['base'] as number, summary, anchors: [...new Set(checked.items.map((it) => it.selector))] });
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
      case 'export.request':
        return a.exportAs !== undefined ? a.exportAs(String(p['format'])) : { error: 'unsupported', message: 'no export for this artifact' };
      default:
        return { error: 'unsupported', message: `${type} is not available for this artifact` };
    }
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
        return;
      case 'checks.contribute':
        this.o.ui.notes((p['checks'] as unknown[]).length);
        return;
      case 'ui.morph':
        this.o.ui.morph(p['to'] as Size);
        return;
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
  setTheme(theme: Record<string, string>): void { this.post(event('host.theme', { theme, artifactTheme: null })); }
  setGrants(grants: readonly PermissionId[]): void { this.grants = new Set(grants); }
  selectionCleared(): void { this.post(event('selection.cleared', {})); }

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
