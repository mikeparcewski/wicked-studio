import { anchorWords } from '../../board/artifactMorph.js';
import { overlayBox, type OverlayBox, type ScrollState } from '../../interactive/anchoring.js';
import {
  REQUEST_INVENTORY, makeScrollToWid, parseInbound as parseBridge, type WidBlock, type WidRect,
} from '../../interactive/instrument-protocol.js';
import { appendInstrumentBridge, hasInstrumentBridge } from '../../interactive/instrumented.js';

/**
 * `wicked-page` — the built-in page element editor as a `wicked.editor/1` plugin (DES-EDITOR-PLUGINS-001
 * §7.1, slice EP-P2). S8's PageEditor, moved inside the plugin frame: the rendered page in a NESTED
 * `sandbox="allow-scripts"` frame (`srcdoc` from `artifact.read`'s HTML with the `data-wid` bridge
 * appended), so pointing at an element highlights it, a click picks it (`selection.set` — the host
 * writes the chip's words from its own inventory), typing on the picked element edits it in place
 * (ONE `version.write` with `before` as the staleness guard; the host escapes the text, posts the
 * batch and draws the thread line with Undo), and what the operator types is text, never markup.
 *
 * The plugin never learns a URL, an id's mount or a run root: it reads the artifact through the host,
 * and every write, chip and key goes through the host's checks (§5.6, §5.7, §5.10). Framework-free,
 * bundled by `scripts/build-editors.mjs` into ONE self-contained HTML file beside its `editor.json`.
 */

const PROTOCOL = 'wicked.editor';
const PROTOCOL_VERSION = 1;
const EDITOR = 'wicked-page';

/** The bridge script runs on the nested frame's load; ask a few times before giving up. */
const ASK_AT_MS = [0, 250, 750, 1500];

type Size = 'inline' | 'pane' | 'full';
type Envelope = { p: string; v: number; type?: string; id?: string; re?: string; ok?: boolean; payload?: unknown; error?: { code: string; message: string }; ports?: unknown };
type Reply = { ok: true; payload: Record<string, unknown> } | { ok: false; error: { code: string; message: string }; payload?: Record<string, unknown> };

interface Inventory {
  widMap: Record<string, WidRect>;
  blocks: Record<string, WidBlock>;
  measured: ScrollState;
}

const MARKUP = `
<div data-testid="page-editor" id="editor" class="editor" data-kind="page" data-head="" data-pickable="false" data-selected="" data-size="pane" tabindex="0" role="application" aria-label="The page">
  <iframe data-testid="page-frame" id="frame" class="frame" sandbox="allow-scripts" title="The page"></iframe>
  <div data-testid="page-hover-box" id="hover" class="box box--hover" hidden></div>
  <div data-testid="page-selected-box" id="selected" class="box" data-wid="" hidden></div>
  <textarea data-testid="page-edit-input" id="input" class="input" rows="1" aria-label="New text" hidden></textarea>
  <div data-testid="page-handle" id="handle" class="handle" tabindex="-1"></div>
  <p data-testid="page-hint" id="hint" class="hint" hidden></p>
  <p data-testid="page-note" id="note" class="note" hidden></p>
</div>`;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`wicked-page: no #${id}`);
  return node as T;
}

/** Whether typing can replace this element's text — and when not, why (S8/S9: a container holds
 *  other parts, a cut text is not the whole `before` the engine checks). */
function typingOn(inv: Inventory | null, wid: string): 'yes' | 'unmeasured' | 'container' | 'cut' {
  const block = inv?.blocks[wid];
  if (inv === null || inv.widMap[wid] === undefined || block === undefined) return 'unmeasured';
  if (block.composite) return 'container';
  return block.cut === true ? 'cut' : 'yes';
}

function capital(s: string): string {
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}

export function start(): void {
  document.body.insertAdjacentHTML('afterbegin', MARKUP);
  const editor = el<HTMLDivElement>('editor');
  const frame = el<HTMLIFrameElement>('frame');
  const hoverBox = el<HTMLDivElement>('hover');
  const selBox = el<HTMLDivElement>('selected');
  const input = el<HTMLTextAreaElement>('input');
  const handle = el<HTMLDivElement>('handle');
  const hint = el<HTMLParagraphElement>('hint');
  const note = el<HTMLParagraphElement>('note');

  // ── the port ────────────────────────────────────────────────────────────────────────
  let port: MessagePort | null = null;
  let grants: string[] = [];
  let size: Size = 'pane';
  let seq = 0;
  const pending = new Map<string, (r: Reply) => void>();
  const send = (type: string, payload: unknown): void => { port?.postMessage({ p: PROTOCOL, v: PROTOCOL_VERSION, type, payload }); };
  const req = (type: string, payload: unknown): Promise<Reply> => new Promise((resolve) => {
    if (port === null) { resolve({ ok: false, error: { code: 'unavailable', message: 'no host yet' } }); return; }
    const id = `wp-${++seq}`;
    pending.set(id, resolve);
    port.postMessage({ p: PROTOCOL, v: PROTOCOL_VERSION, type, id, payload });
  });
  const status = (line: string): void => send('ui.status', { line: line.slice(0, 120) });

  // ── the page ─────────────────────────────────────────────────────────────────────────
  let head: number | null = null;
  let inventory: Inventory | null = null;
  let current: ScrollState = { scrollX: 0, scrollY: 0 };
  let hover: string | null = null;
  let selected: string | null = null;
  let editing: { wid: string; before: string } | null = null;
  let busy = false;
  // The frame's document generation: bumped for every new version, marked ready on that document's
  // load. A message from the previous document (the WindowProxy survives a navigation) is ignored.
  let gen = 0;
  let readyGen = -1;
  // The element the operator's last write touched: the frame for the new version opens scrolled to it.
  let returnTo: string | null = null;
  let armed: string | null = null;
  let asks = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let rendering = false;
  // A version asked for while another is being read: the newest wins, once that read is done.
  let queued: { version?: number } | null = null;

  const postToFrame = (msg: unknown): void => { frame.contentWindow?.postMessage(msg, '*'); };
  const askInventory = (): void => {
    readyGen = gen;
    for (const t of timers) clearTimeout(t);
    timers = ASK_AT_MS.map((ms) => setTimeout(() => postToFrame(REQUEST_INVENTORY), ms));
  };
  frame.addEventListener('load', askInventory);

  const box = (wid: string | null): OverlayBox | null => {
    if (wid === null || inventory === null) return null;
    const rect = inventory.widMap[wid];
    return rect === undefined ? null : overlayBox(rect, inventory.measured, current);
  };
  const place = (node: HTMLElement, b: OverlayBox | null, minW = 0, minH = 0): void => {
    if (b === null) { node.hidden = true; return; }
    node.hidden = false;
    node.style.left = `${b.left}px`;
    node.style.top = `${b.top}px`;
    node.style.width = `${Math.max(b.width, minW)}px`;
    node.style.height = `${Math.max(b.height, minH)}px`;
  };

  const pickable = (): boolean => size !== 'inline' && inventory !== null;

  const draw = (): void => {
    editor.dataset['head'] = head === null ? '' : String(head);
    editor.dataset['pickable'] = String(pickable());
    editor.dataset['selected'] = selected ?? '';
    editor.dataset['size'] = size;
    place(hoverBox, hover !== selected && editing === null ? box(hover) : null);
    selBox.dataset['wid'] = selected ?? '';
    place(selBox, editing === null ? box(selected) : null);
    if (editing !== null) place(input, box(editing.wid), 160, 30); else input.hidden = true;
    // The hint: what the pick lets you do (S8 words), or why typing cannot change this element.
    if (!pickable() || editing !== null) { hint.hidden = true; return; }
    hint.hidden = false;
    if (selected === null) { hint.removeAttribute('data-editable'); hint.textContent = 'Click an element to make it the subject · type on it to change it'; return; }
    const words = anchorWords(selected, 'page');
    const typing = typingOn(inventory, selected);
    hint.dataset['editable'] = String(typing === 'yes');
    hint.textContent = typing === 'yes' ? `Type to change ${words} · Enter to edit its text · Esc to let go`
      : typing === 'container' ? `${capital(words)} holds other parts — click a line of text inside it to change the words · Esc to let go`
        : typing === 'cut' ? `${capital(words)} is too long to change by typing — say what to change in the message box · Esc to let go`
          : `${capital(words)} can’t be changed by typing — say what to change in the message box · Esc to let go`;
  };

  const cancelEdit = (): void => { if (editing === null) return; editing = null; input.hidden = true; input.value = ''; draw(); };

  /** An element becomes the subject: picked, a chip on the composer (the host writes its words), and
   *  typing reaches this document — never the frame the click focused. */
  const select = (wid: string | null): void => {
    selected = wid;
    cancelEdit();
    draw();
    if (wid !== null) {
      if (grants.includes('selection.chip')) send('selection.set', { anchors: [{ kind: 'element', id: wid }] });
      handle.focus();
    }
  };

  const scrollTo = (wid: string): void => { asks += 1; postToFrame(makeScrollToWid(wid, asks)); };

  /** Render one version: the host's HTML, the bridge appended, in the nested sandboxed frame. */
  const render = async (version?: number): Promise<void> => {
    if (rendering) { queued = version === undefined ? {} : { version }; return; }
    rendering = true;
    try {
      const r = await req('artifact.read', version === undefined ? {} : { version });
      if (!r.ok) { note.hidden = false; note.textContent = r.error.code === 'not_granted' ? 'This editor may not read the page here.' : `The page could not be read (${r.error.code}).`; return; }
      note.hidden = true;
      const content = r.payload['content'] as { type?: unknown; html?: unknown } | undefined;
      const html = typeof content?.html === 'string' ? content.html : '';
      head = typeof r.payload['version'] === 'number' ? r.payload['version'] : head;
      gen += 1;
      armed = returnTo;
      returnTo = null;
      inventory = null;
      hover = null;
      selected = null;
      cancelEdit();
      draw();
      frame.srcdoc = hasInstrumentBridge(html) ? html : appendInstrumentBridge(html);
    } finally {
      rendering = false;
      if (queued !== null) {
        const next = queued;
        queued = null;
        void render(next.version);
      }
    }
  };

  // ── bridge → plugin (the nested frame's own window, this document's generation only) ──
  window.addEventListener('message', (e: MessageEvent) => {
    if (frame.contentWindow === null || e.source !== frame.contentWindow || readyGen !== gen) return;
    const msg = parseBridge(e.data);
    if (msg === null) return;
    if (msg.type === 'wid-inventory') {
      for (const t of timers) clearTimeout(t);
      inventory = { widMap: msg.widMap, blocks: msg.blocks ?? {}, measured: { scrollX: msg.scrollX, scrollY: msg.scrollY } };
      current = { scrollX: msg.scrollX, scrollY: msg.scrollY };
      const back = armed;
      armed = null;
      if (back !== null && msg.widMap[back] !== undefined) scrollTo(back);
      draw();
    } else if (msg.type === 'scroll-state') {
      current = { scrollX: msg.scrollX, scrollY: msg.scrollY };
      draw();
    } else if (msg.type === 'scroll-ack') {
      if (msg.scrollX !== undefined && msg.scrollY !== undefined) { current = { scrollX: msg.scrollX, scrollY: msg.scrollY }; draw(); }
    } else if (msg.type === 'wid-hover') {
      hover = msg.wid;
      draw();
    } else if (msg.type === 'wid-click') {
      if (size === 'inline') return; // the preview is one control: the host's catch opens it
      select(msg.wid);
    }
  });

  // ── edit by touching ──────────────────────────────────────────────────────────────────
  const beginEdit = (wid: string, typed: string | null): void => {
    if (busy || inventory === null || typingOn(inventory, wid) !== 'yes') return;
    const before = inventory.blocks[wid]?.text ?? '';
    // The field exists and holds the focus before this key event returns: the characters typed right
    // behind it land in the field (no frame is awaited — S8 lost them to the frame once).
    editing = { wid, before };
    input.value = typed ?? before;
    draw();
    input.focus();
    if (typed === null) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
  };

  const commit = async (): Promise<void> => {
    if (editing === null || head === null || busy) return;
    const { wid, before } = editing;
    // One line of text: a pasted line break is a space, as the page would render it.
    const value = input.value.replace(/\s*\n\s*/g, ' ');
    cancelEdit();
    handle.focus();
    if (value === before) return;
    busy = true;
    status(`Changing ${anchorWords(wid, 'page')}…`);
    try {
      const r = await req('version.write', { base: head, ops: [{ op: 'text', anchor: wid, value, before }], summary: anchorWords(wid, 'page') });
      if (r.ok) {
        returnTo = wid;
        await render(typeof r.payload['version'] === 'number' ? r.payload['version'] : undefined);
      } else if (r.error.code === 'stale' || r.error.code === 'head_moved') {
        status('Not changed: it moved while you typed');
        returnTo = wid;
        const moved = r.payload?.['head'];
        if (typeof moved === 'number' && moved !== head) await render(moved);
      } else if (r.error.code === 'refused') {
        status(r.error.message || 'Nothing changed');
      } else {
        status(`Not changed: ${r.error.message || r.error.code}`);
      }
    } finally {
      busy = false;
    }
  };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); void commit(); } else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); handle.focus(); }
  });
  input.addEventListener('blur', () => { cancelEdit(); });

  // ── keys on the page (not in the field): S8's grammar + the contract's forwarding (§5.10) ──
  editor.addEventListener('keydown', (e) => {
    if (e.target === input) return;
    if (e.key === 'Escape') {
      // Something of our own to dismiss first; else the host's (one step smaller).
      if (selected !== null) { e.preventDefault(); select(null); return; }
      e.preventDefault();
      send('ui.key', { key: 'Escape' });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); send('ui.key', { key: 'Mod+K' }); return; }
    if (e.altKey && !e.metaKey && !e.ctrlKey && /^Key[A-Z]$/.test(e.code)) { e.preventDefault(); send('ui.key', { key: `Alt+${e.code.slice(3)}` }); return; }
    if (e.key === 'Tab') {
      // The page is one control: Tab leaves it either way (§5.10 rule 5).
      e.preventDefault();
      send('ui.key', { key: e.shiftKey ? 'Shift+Tab' : 'Tab' });
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter') { if (selected !== null && !busy) { e.preventDefault(); beginEdit(selected, null); } return; }
    // Bare Backspace / Delete never remove anything (§7.1 R-a).
    if (e.key.length !== 1) return;
    e.preventDefault();
    if (selected !== null && !busy) { beginEdit(selected, e.key); return; }
    // Rule 2: the first printable key outside an editable goes to the composer — never an action.
    send('ui.typed', { grapheme: e.key });
  });

  // ── host → plugin ──────────────────────────────────────────────────────────────────────
  const setSize = (to: Size): void => {
    size = to;
    document.body.dataset['size'] = to;
    if (to === 'inline') { cancelEdit(); select(null); (document.activeElement as HTMLElement | null)?.blur?.(); }
    draw();
  };
  const applyTheme = (theme: unknown): void => {
    if (typeof theme !== 'object' || theme === null) return;
    for (const [k, v] of Object.entries(theme as Record<string, unknown>)) {
      if (/^--[a-z0-9-]+$/.test(k) && typeof v === 'string' && v.length <= 200 && !/url\(/i.test(v)) document.documentElement.style.setProperty(k, v);
    }
  };

  const onPort = (m: MessageEvent): void => {
    const d = m.data as Envelope | null;
    try {
      if (d === null || typeof d !== 'object' || d.p !== PROTOCOL || d.v !== PROTOCOL_VERSION) return;
      if (typeof d.re === 'string') {
        const r = pending.get(d.re);
        if (r === undefined) return;
        pending.delete(d.re);
        const payload = typeof d.payload === 'object' && d.payload !== null ? d.payload as Record<string, unknown> : {};
        if (d.ok === true) r({ ok: true, payload });
        else r({ ok: false, error: d.error ?? { code: 'unavailable', message: 'no answer' }, payload });
        return;
      }
      const p = typeof d.payload === 'object' && d.payload !== null ? d.payload as Record<string, unknown> : {};
      switch (d.type) {
        case 'host.ping':
          if (typeof d.id === 'string') port?.postMessage({ p: PROTOCOL, v: PROTOCOL_VERSION, re: d.id, ok: true, payload: {} });
          return;
        case 'host.size':
          if (p['size'] === 'inline' || p['size'] === 'pane' || p['size'] === 'full') setSize(p['size']);
          return;
        case 'host.theme':
          applyTheme(p['theme']);
          return;
        case 'artifact.changed': {
          // A version landed — the operator's own (the host already told us the number), a helper's or
          // another tab's: the page shows the newest, scrolled back to what was being looked at.
          const v = p['version'];
          if (typeof v === 'number' && v !== head) { returnTo = returnTo ?? selected; void render(v); }
          return;
        }
        case 'selection.cleared':
          // The chip was removed on the composer: the element is no longer the subject here either.
          if (selected !== null) { selected = null; cancelEdit(); draw(); }
          return;
        default:
          return; // unknown types are ignored (§5.4: additive within v1)
      }
    } catch {
      /* a malformed host message is ignored */
    }
  };

  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as Envelope | null;
    if (port !== null || d === null || typeof d !== 'object' || d.p !== PROTOCOL || d.type !== 'host.hello' || e.ports[0] === undefined) return;
    port = e.ports[0];
    port.onmessage = onPort;
    const p = typeof d.payload === 'object' && d.payload !== null ? d.payload as Record<string, unknown> : {};
    grants = Array.isArray(p['grants']) ? (p['grants'] as unknown[]).filter((g): g is string => typeof g === 'string') : [];
    applyTheme(p['theme']);
    setSize(p['size'] === 'inline' || p['size'] === 'full' ? p['size'] : 'pane');
    void render();
  });

  const version = document.querySelector('meta[name="wicked-editor-version"]')?.getAttribute('content') ?? '0.0.0';
  parent.postMessage({ p: PROTOCOL, v: PROTOCOL_VERSION, type: 'plugin.ready', payload: { editor: EDITOR, version, protocol: [PROTOCOL_VERSION] } }, '*');
}

start();
