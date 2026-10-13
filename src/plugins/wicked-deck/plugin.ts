import { deckOf, topSlideElements, type DeckSlide } from '../../board/deck.js';
import { overlayBox, type OverlayBox, type ScrollState } from '../../interactive/anchoring.js';
import { REQUEST_INVENTORY, parseInbound as parseBridge, type WidBlock, type WidRect } from '../../interactive/instrument-protocol.js';
import { appendInstrumentBridge, hasInstrumentBridge } from '../../interactive/instrumented.js';

/**
 * `wicked-deck` — the built-in slide editor as a `wicked.editor/1` plugin (DES-PRESENTATION-EDITOR-001
 * §3, slice P-D1; the editor-plugin contract DES-EDITOR-PLUGINS-001 §5). A separate plugin from
 * `wicked-page` (operator decision D1), so the page editor stays untouched.
 *
 *  - THE FILMSTRIP is the deck's slides in DOCUMENT ORDER, named by their `data-slide-id` and numbered
 *    by their place (`board/deck.ts` reads them the engine's way) — never by the index inside a kept
 *    positional anchor, which is what made the old strip show a moved slide in its old place.
 *    Each thumbnail is the slide itself in a script-less sandboxed frame, scaled down.
 *  - THE SLIDE is the current one, large, in a NESTED `sandbox="allow-scripts"` frame with the `data-wid`
 *    bridge: a click points at an element (`selection.set`; the host writes the chip's words), Enter or
 *    typing on it edits its text (one `version.write` with `before`, Undo from the host).
 *  - SLIDE OPS, each ONE version through the host (its Undo): add a slide like an existing one, duplicate,
 *    move (drag in the strip, or ⌥↑/⌥↓), delete (⌘⌫, never bare Backspace); speaker notes under the slide,
 *    saved when the field is left. Present fills the host's own container with the slide.
 *  - Keys (§5.10): ←/→, PgUp/PgDn, Home/End and a number then Enter move between slides; ⌘⇧N adds, ⌘D
 *    duplicates; Esc, ⌘K, Tab at the edges and the ⌥ letter chords go to the host; the first printable key
 *    with nothing picked goes to the composer. No printable key without a modifier is an action.
 *
 * Approvals, the audience and the slide compare are the HOST's (a person's decision is never a plugin
 * message — DES-EDITOR-PLUGINS-001 §8.4): this editor only edits. Framework-free; bundled by
 * `scripts/build-editors.mjs` into ONE self-contained HTML file beside its `editor.json`.
 */

const PROTOCOL = 'wicked.editor';
const PROTOCOL_VERSION = 1;
const EDITOR = 'wicked-deck';
/** A slide's logical size: what the deck lays out at before it is scaled into the editor. */
const SLIDE_W = 1280;
const SLIDE_H = 720;
const ASK_AT_MS = [0, 250, 750, 1500];
/** How long typed digits wait for Enter ("3 Enter" goes to slide 3). */
const GOTO_MS = 1500;

type Size = 'inline' | 'pane' | 'full';
type Envelope = { p: string; v: number; type?: string; id?: string; re?: string; ok?: boolean; payload?: unknown; error?: { code: string; message: string } };
type Reply = { ok: true; payload: Record<string, unknown> } | { ok: false; error: { code: string; message: string }; payload?: Record<string, unknown> };
interface Inventory { widMap: Record<string, WidRect>; blocks: Record<string, WidBlock>; measured: ScrollState }
type Op =
  | { op: 'text'; anchor: string; value: string; before: string }
  | { op: 'remove'; anchor: string }
  | { op: 'slide-insert'; slide: string; after: string | null }
  | { op: 'slide-duplicate'; slide: string }
  | { op: 'slide-move'; slide: string; after: string | null }
  | { op: 'notes-set'; slide: string; text: string };

const MARKUP = `
<div data-testid="deck-editor" id="deck" class="deck" data-kind="deck" data-head="" data-current="" data-count="0" data-size="pane" data-present="false" data-selected="" tabindex="0" role="application" aria-label="The deck">
  <nav id="strip" class="strip" aria-label="Slides" data-testid="deck-strip"><ol id="thumbs"></ol></nav>
  <div class="main">
    <div data-testid="deck-tools" id="tools" class="tools" role="toolbar" aria-label="Slide actions">
      <span id="count" class="count" data-testid="deck-count"></span>
      <button type="button" id="add" data-testid="deck-add" aria-haspopup="menu" aria-expanded="false" title="Add a slide laid out like one of the deck’s own (⌘⇧N: like this one)">Add ▾</button>
      <button type="button" id="dup" data-testid="deck-duplicate" title="Duplicate this slide (⌘D)">Duplicate</button>
      <button type="button" id="up" data-testid="deck-move-up" title="Move this slide up (⌥↑)" aria-label="Move up">↑ Up</button>
      <button type="button" id="down" data-testid="deck-move-down" title="Move this slide down (⌥↓)" aria-label="Move down">↓ Down</button>
      <button type="button" id="del" class="danger" data-testid="deck-delete" title="Delete this slide (⌘⌫) — Undo puts it back">Delete</button>
      <button type="button" id="present" data-testid="deck-present" title="Show the slide on its own; ← → move, Esc leaves">Present</button>
    </div>
    <div data-testid="deck-add-menu" id="menu" class="menu" role="menu" aria-label="Add a slide like" hidden></div>
    <div data-testid="deck-stage" id="stage" class="stage">
      <div data-testid="deck-hover-box" id="hover" class="box box--hover" hidden></div>
      <div data-testid="deck-selected-box" id="selected" class="box" data-wid="" hidden></div>
      <textarea data-testid="deck-edit-input" id="input" class="input" rows="1" aria-label="New text" hidden></textarea>
      <span data-testid="deck-inline-count" id="badge" class="badge" hidden></span>
      <span data-testid="deck-present-bar" id="present-bar" class="present-bar" hidden></span>
    </div>
    <p data-testid="deck-hint" id="hint" class="hint" hidden></p>
    <p data-testid="deck-note" id="note" class="note" hidden></p>
    <div id="notes-box" class="notes">
      <label for="notes" id="notes-label" data-testid="deck-notes-label">Speaker notes</label>
      <textarea id="notes" data-testid="deck-notes" placeholder="What to say on this slide. Saved when you leave the field; Undo puts the old notes back."></textarea>
    </div>
  </div>
  <div data-testid="deck-handle" id="handle" class="handle" tabindex="-1"></div>
</div>`;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`wicked-deck: no #${id}`);
  return node as T;
}

const keyOf = (s: DeckSlide): string => s.id ?? `#${s.n}`;

/**
 * The deck's HTML showing one slide only (every other top-level slide hidden), for the stage or a
 * thumbnail. `scripts: false` drops every script (a thumbnail's frame runs none anyway).
 */
export function oneSlideHtml(html: string, index: number, opts: { thumbnail: boolean }): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  topSlideElements(doc).forEach((s, i) => { if (i !== index) s.setAttribute('data-wi-deck-off', ''); });
  const style = doc.createElement('style');
  style.textContent = `[data-wi-deck-off]{display:none!important}${opts.thumbnail ? 'html,body{overflow:hidden!important}' : ''}`;
  doc.head.append(style);
  if (opts.thumbnail) for (const s of Array.from(doc.querySelectorAll('script'))) s.remove();
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

export function start(): void {
  document.body.insertAdjacentHTML('afterbegin', MARKUP);
  const deck = el<HTMLDivElement>('deck');
  const strip = el<HTMLElement>('strip');
  const thumbs = el<HTMLOListElement>('thumbs');
  const count = el<HTMLSpanElement>('count');
  const tools = el<HTMLDivElement>('tools');
  const addBtn = el<HTMLButtonElement>('add');
  const dupBtn = el<HTMLButtonElement>('dup');
  const upBtn = el<HTMLButtonElement>('up');
  const downBtn = el<HTMLButtonElement>('down');
  const delBtn = el<HTMLButtonElement>('del');
  const presentBtn = el<HTMLButtonElement>('present');
  const menu = el<HTMLDivElement>('menu');
  const stage = el<HTMLDivElement>('stage');
  const hoverBox = el<HTMLDivElement>('hover');
  const selBox = el<HTMLDivElement>('selected');
  const input = el<HTMLTextAreaElement>('input');
  const badge = el<HTMLSpanElement>('badge');
  const presentBar = el<HTMLSpanElement>('present-bar');
  const hint = el<HTMLParagraphElement>('hint');
  const note = el<HTMLParagraphElement>('note');
  const notes = el<HTMLTextAreaElement>('notes');
  const notesLabel = el<HTMLLabelElement>('notes-label');
  const handle = el<HTMLDivElement>('handle');

  // ── the port ────────────────────────────────────────────────────────────────────────
  let port: MessagePort | null = null;
  let grants: string[] = [];
  let size: Size = 'pane';
  let seq = 0;
  const pending = new Map<string, (r: Reply) => void>();
  const send = (type: string, payload: unknown): void => { port?.postMessage({ p: PROTOCOL, v: PROTOCOL_VERSION, type, payload }); };
  const req = (type: string, payload: unknown): Promise<Reply> => new Promise((resolve) => {
    if (port === null) { resolve({ ok: false, error: { code: 'unavailable', message: 'no host yet' } }); return; }
    const id = `wd-${++seq}`;
    pending.set(id, resolve);
    port.postMessage({ p: PROTOCOL, v: PROTOCOL_VERSION, type, id, payload });
  });
  const status = (line: string): void => send('ui.status', { line: line.slice(0, 120) });
  const canWrite = (): boolean => grants.includes('artifact.write');

  // ── the deck ─────────────────────────────────────────────────────────────────────────
  let head: number | null = null;
  let html = '';
  let slides: DeckSlide[] = [];
  /** The current slide, by its key (`data-slide-id`), and by place for a write that adds one. */
  let current: string | null = null;
  let goIndexAfterRender: number | null = null;
  let present = false;
  let busy = false;
  let rendering = false;
  let queued: { version?: number } | null = null;
  let menuOpen = false;
  let gotoDigits = '';
  let gotoTimer: ReturnType<typeof setTimeout> | null = null;
  let dragging: string | null = null;

  // The stage's nested frame: a NEW element for every slide shown (a message is accepted only from the
  // current element's own window, so a previous document's late message has no element to speak for).
  let frame: HTMLIFrameElement | null = null;
  let gen = 0;
  let readyGen = -1;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let inventory: Inventory | null = null;
  let scroll: ScrollState = { scrollX: 0, scrollY: 0 };
  let hover: string | null = null;
  let selected: string | null = null;
  let editing: { wid: string; before: string } | null = null;

  const at = (): number => { const i = slides.findIndex((s) => keyOf(s) === current); return i < 0 ? 0 : i; };
  const cur = (): DeckSlide | null => slides[at()] ?? null;

  /** Where the slide sits in the stage, and its scale: the 16:9 slide fitted inside, centred. */
  const geom = (): { x: number; y: number; s: number } => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w === 0 || h === 0) return { x: 0, y: 0, s: 1 };
    const s = Math.min(w / SLIDE_W, h / SLIDE_H);
    return { x: Math.max(0, (w - SLIDE_W * s) / 2), y: Math.max(0, (h - SLIDE_H * s) / 2), s };
  };
  const placeFrame = (): void => {
    if (frame === null) return;
    const g = geom();
    frame.style.cssText = `left:${g.x}px;top:${g.y}px;width:${SLIDE_W}px;height:${SLIDE_H}px;transform:scale(${g.s})`;
  };

  const box = (wid: string | null): OverlayBox | null => {
    if (wid === null || inventory === null) return null;
    const rect = inventory.widMap[wid];
    if (rect === undefined || (rect.width === 0 && rect.height === 0)) return null;
    const b = overlayBox(rect, inventory.measured, scroll);
    const g = geom();
    return { left: g.x + b.left * g.s, top: g.y + b.top * g.s, width: b.width * g.s, height: b.height * g.s };
  };
  const place = (node: HTMLElement, b: OverlayBox | null, minW = 0, minH = 0): void => {
    if (b === null) { node.hidden = true; return; }
    node.hidden = false;
    node.style.left = `${b.left}px`;
    node.style.top = `${b.top}px`;
    node.style.width = `${Math.max(b.width, minW)}px`;
    node.style.height = `${Math.max(b.height, minH)}px`;
  };

  const editable = (wid: string): 'yes' | 'container' | 'cut' | 'unmeasured' => {
    const b = inventory?.blocks[wid];
    if (inventory === null || b === undefined || inventory.widMap[wid] === undefined) return 'unmeasured';
    if (b.composite) return 'container';
    return b.cut === true ? 'cut' : 'yes';
  };

  // ── drawing ──────────────────────────────────────────────────────────────────────────
  const draw = (): void => {
    const c = cur();
    const n = slides.length;
    deck.dataset['head'] = head === null ? '' : String(head);
    deck.dataset['current'] = c?.id ?? '';
    deck.dataset['currentN'] = c === null ? '' : String(c.n);
    deck.dataset['count'] = String(n);
    deck.dataset['size'] = size;
    deck.dataset['present'] = String(present);
    deck.dataset['selected'] = selected ?? '';
    document.body.dataset['present'] = String(present);
    count.textContent = n === 0 ? 'No slides yet' : `${c?.n ?? 1} of ${n}`;
    count.title = n === 0 ? '' : `Slide ${c?.n ?? 1} of ${n}`;
    const writable = canWrite() && !busy && c !== null;
    for (const b of [addBtn, dupBtn, delBtn]) b.disabled = !writable || c?.id === null;
    upBtn.disabled = !writable || at() === 0 || c?.id === null;
    downBtn.disabled = !writable || at() >= n - 1 || c?.id === null;
    presentBtn.disabled = n === 0;
    addBtn.setAttribute('aria-expanded', String(menuOpen));
    menu.hidden = !menuOpen || size === 'inline';
    badge.hidden = size !== 'inline' || n === 0;
    badge.textContent = `${n} slide${n === 1 ? '' : 's'}`;
    presentBar.hidden = !present;
    presentBar.textContent = `${c?.n ?? 0} / ${n} · ← → · Esc leaves`;
    for (const li of Array.from(thumbs.children)) {
      const b = li.querySelector<HTMLButtonElement>('button');
      if (b !== null) b.setAttribute('aria-current', String(b.dataset['key'] === current));
    }
    // Notes: the current slide's; a write in flight or no write grant leaves them read-only.
    notesLabel.textContent = c === null ? 'Speaker notes' : `Speaker notes · slide ${c.n}`;
    if (document.activeElement !== notes) notes.value = notesDraft !== null && notesDraft.key === current ? notesDraft.text : (c?.notes ?? '');
    notes.readOnly = !writable;
    const pickable = size !== 'inline' && !present && inventory !== null;
    place(hoverBox, pickable && hover !== selected && editing === null ? box(hover) : null);
    selBox.dataset['wid'] = selected ?? '';
    place(selBox, pickable && editing === null ? box(selected) : null);
    if (editing !== null) place(input, box(editing.wid), 160, 30); else input.hidden = true;
    tools.hidden = size === 'inline' || present;
    if (size === 'inline' || present || editing !== null) { hint.hidden = true; return; }
    hint.hidden = false;
    if (selected === null) { hint.removeAttribute('data-editable'); hint.textContent = n === 0 ? '' : '← → to move between slides · click a line to point at it · type on it to change it'; return; }
    const e = editable(selected);
    hint.dataset['editable'] = String(e === 'yes');
    hint.textContent = e === 'yes' ? 'Type to change it · Enter to edit its text · Esc to let go'
      : e === 'container' ? 'This part holds other parts: click a line inside it to change the words · Esc to let go'
        : 'This can’t be changed by typing: say what to change in the message box · Esc to let go';
  };

  // ── the filmstrip ────────────────────────────────────────────────────────────────────
  const thumbCache = new Map<string, { li: HTMLLIElement; srcdoc: string }>();
  const buildStrip = (): void => {
    const seen = new Set<string>();
    const order: HTMLLIElement[] = [];
    slides.forEach((s, i) => {
      const key = keyOf(s);
      seen.add(key);
      const srcdoc = oneSlideHtml(html, i, { thumbnail: true });
      let entry = thumbCache.get(key);
      if (entry === undefined) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'thumb';
        // A props-style object, so the testid scanner (scripts/testid-inventory.mjs) sees it.
        for (const [k, v] of Object.entries({ 'data-testid': 'deck-thumb' })) b.setAttribute(k, v);
        b.innerHTML = '<span class="n"></span><span class="mini"><iframe sandbox="" tabindex="-1" aria-hidden="true"></iframe></span><span class="t"></span>';
        b.addEventListener('click', () => { go(b.dataset['key'] ?? null); pointAtSlide(); handle.focus(); });
        b.draggable = true;
        b.addEventListener('dragstart', (e) => { dragging = b.dataset['key'] ?? null; e.dataTransfer?.setData('text/plain', dragging ?? ''); });
        b.addEventListener('dragover', (e) => {
          if (dragging === null || dragging === b.dataset['key']) return;
          e.preventDefault();
          const r = b.getBoundingClientRect();
          b.dataset['drop'] = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
        });
        b.addEventListener('dragleave', () => { delete b.dataset['drop']; });
        b.addEventListener('drop', (e) => {
          e.preventDefault();
          const where = b.dataset['drop'];
          delete b.dataset['drop'];
          const from = dragging;
          dragging = null;
          if (from === null || where === undefined) return;
          const to = slides.findIndex((x) => keyOf(x) === b.dataset['key']);
          const target = slides[to];
          if (target?.id == null) return;
          const after = where === 'after' ? target.id : (slides[to - 1]?.id ?? null);
          void moveSlide(from, after);
        });
        b.addEventListener('dragend', () => { dragging = null; });
        li.appendChild(b);
        entry = { li, srcdoc: '' };
        thumbCache.set(key, entry);
      }
      const b = entry.li.querySelector<HTMLButtonElement>('button')!;
      b.dataset['key'] = key;
      b.dataset['slideId'] = s.id ?? '';
      b.dataset['n'] = String(s.n);
      b.setAttribute('aria-label', s.title === '' ? `Slide ${s.n}` : `Slide ${s.n}: ${s.title}`);
      b.querySelector('.n')!.textContent = String(s.n);
      b.querySelector('.t')!.textContent = s.title === '' ? `Slide ${s.n}` : s.title;
      if (entry.srcdoc !== srcdoc) {
        entry.srcdoc = srcdoc;
        b.querySelector('iframe')!.srcdoc = srcdoc;
      }
      order.push(entry.li);
    });
    for (const [key, entry] of thumbCache) if (!seen.has(key)) { entry.li.remove(); thumbCache.delete(key); }
    thumbs.replaceChildren(...order);
  };

  // ── the stage ────────────────────────────────────────────────────────────────────────
  const askInventory = (loaded: HTMLIFrameElement): void => {
    if (loaded !== frame) return;
    readyGen = gen;
    for (const t of timers) clearTimeout(t);
    timers = ASK_AT_MS.map((ms) => setTimeout(() => frame?.contentWindow?.postMessage(REQUEST_INVENTORY, '*'), ms));
  };
  const showSlide = (): void => {
    gen += 1;
    inventory = null;
    hover = null;
    selected = null;
    cancelEdit();
    const i = size === 'inline' ? 0 : at();
    if (slides.length === 0) { frame?.remove(); frame = null; draw(); return; }
    const doc = oneSlideHtml(html, i, { thumbnail: false });
    const next = document.createElement('iframe');
    for (const [k, v] of Object.entries({ 'data-testid': 'deck-frame', sandbox: 'allow-scripts', title: `Slide ${i + 1}` })) next.setAttribute(k, v);
    frame = next;
    // The previous slide stays on screen until this one has loaded (no flash between slides). Every
    // frame that is not the current one goes then — however many slides were stepped past before any
    // of them loaded — or after 2 s, should this one never load.
    const prune = (): void => { for (const f of Array.from(stage.querySelectorAll('iframe'))) if (f !== frame) f.remove(); };
    next.addEventListener('load', () => { askInventory(next); if (frame === next) prune(); });
    next.srcdoc = hasInstrumentBridge(doc) ? doc : appendInstrumentBridge(doc);
    stage.insertBefore(next, stage.firstChild);
    placeFrame();
    setTimeout(() => { if (frame === next) prune(); }, 2000);
    draw();
  };

  const go = (key: string | null): void => {
    if (key === null || key === current || !slides.some((s) => keyOf(s) === key)) { draw(); return; }
    commitNotes();
    current = key;
    showSlide();
  };
  const step = (by: number): void => {
    const i = Math.max(0, Math.min(slides.length - 1, at() + by));
    const s = slides[i];
    if (s !== undefined) go(keyOf(s));
  };
  /** A click on a slide makes it the subject of the next message (the host writes the chip). */
  const pointAtSlide = (): void => {
    const w = cur()?.wid;
    if (w != null && grants.includes('selection.chip')) send('selection.set', { anchors: [{ kind: 'element', id: w }] });
  };

  // ── reading a version ────────────────────────────────────────────────────────────────
  // Versions only move forward here: a deck's head is always its newest version, so an older one asked
  // for (a write's reply arriving after a helper's newer version was announced) is never shown over
  // a newer one, and never becomes the base of the next write (codex r1).
  const newer = (a: { version?: number }, b: { version?: number }): { version?: number } =>
    (a.version === undefined || b.version === undefined ? {} : a.version >= b.version ? a : b);
  const render = async (version?: number): Promise<void> => {
    if (version !== undefined && head !== null && version <= head) return;
    if (rendering) { const want = version === undefined ? {} : { version }; queued = queued === null ? want : newer(queued, want); return; }
    rendering = true;
    try {
      const r = await req('artifact.read', version === undefined ? {} : { version });
      if (!r.ok) { note.hidden = false; note.textContent = r.error.code === 'not_granted' ? 'This editor may not read the deck here.' : `The deck could not be read (${r.error.code}).`; return; }
      const v = r.payload['version'];
      if (typeof v === 'number' && head !== null && v < head) return;
      note.hidden = true;
      const content = r.payload['content'] as { type?: unknown; html?: unknown } | undefined;
      html = typeof content?.html === 'string' ? content.html : '';
      head = typeof v === 'number' ? v : head;
      slides = deckOf(html);
      if (goIndexAfterRender !== null) {
        const s = slides[Math.max(0, Math.min(slides.length - 1, goIndexAfterRender))];
        current = s === undefined ? null : keyOf(s);
        goIndexAfterRender = null;
      } else if (!slides.some((s) => keyOf(s) === current)) {
        current = slides[0] === undefined ? null : keyOf(slides[0]);
      }
      buildStrip();
      showSlide();
    } finally {
      rendering = false;
      if (queued !== null) {
        const next = queued;
        queued = null;
        if (next.version === undefined || head === null || next.version > head) void render(next.version);
      }
    }
  };

  // ── bridge → plugin (the stage frame's own window, this document's generation only) ──
  window.addEventListener('message', (e: MessageEvent) => {
    if (frame === null || frame.contentWindow === null || e.source !== frame.contentWindow || readyGen !== gen) return;
    const msg = parseBridge(e.data);
    if (msg === null) return;
    if (msg.type === 'wid-inventory') {
      for (const t of timers) clearTimeout(t);
      inventory = { widMap: msg.widMap, blocks: msg.blocks ?? {}, measured: { scrollX: msg.scrollX, scrollY: msg.scrollY } };
      scroll = { scrollX: msg.scrollX, scrollY: msg.scrollY };
      draw();
    } else if (msg.type === 'scroll-state' || msg.type === 'scroll-ack') {
      if (msg.scrollX !== undefined && msg.scrollY !== undefined) { scroll = { scrollX: msg.scrollX, scrollY: msg.scrollY }; draw(); }
    } else if (msg.type === 'wid-hover') {
      hover = msg.wid;
      draw();
    } else if (msg.type === 'wid-click') {
      if (size === 'inline') return;
      if (present) { step(1); return; }
      select(msg.wid === cur()?.wid ? null : msg.wid);
      if (msg.wid === cur()?.wid) pointAtSlide();
    }
  });

  const select = (wid: string | null): void => {
    selected = wid;
    cancelEdit();
    draw();
    if (wid !== null) {
      if (grants.includes('selection.chip')) send('selection.set', { anchors: [{ kind: 'element', id: wid }] });
      handle.focus();
    }
  };

  // ── writes: each ONE version through the host, with its Undo ─────────────────────────
  /** `base` is the version the change was made on (the head, unless a draft began on an older one). */
  const write = async (ops: Op[], summary: string, saying: string, base: number | null = head, onMoved?: () => void): Promise<boolean> => {
    if (base === null || busy || !canWrite()) return false;
    busy = true;
    menuOpen = false;
    draw();
    status(saying);
    try {
      const r = await req('version.write', { base, ops, summary });
      if (r.ok) {
        await render(typeof r.payload['version'] === 'number' ? r.payload['version'] : undefined);
        return true;
      }
      goIndexAfterRender = null;
      if (r.error.code === 'stale' || r.error.code === 'head_moved') {
        if (onMoved !== undefined) onMoved();
        else status(r.error.code === 'stale' && r.error.message ? r.error.message : 'Not changed: the deck changed meanwhile');
        const moved = r.payload?.['head'];
        if (typeof moved === 'number' && moved !== head) await render(moved);
      } else if (r.error.code === 'timeout') {
        // The host said it when its timer fired (before any late landing's own line): no echo here.
      } else {
        status(r.error.message ? (r.error.code === 'refused' || r.error.message.startsWith('Not changed') ? r.error.message : `Not changed: ${r.error.message}`) : 'Nothing changed');
      }
      return false;
    } finally {
      busy = false;
      draw();
    }
  };

  const moveSlide = async (key: string, after: string | null): Promise<void> => {
    const s = slides.find((x) => keyOf(x) === key);
    if (s?.id == null) return;
    const from = slides.indexOf(s);
    const afterAt = after === null ? -1 : slides.findIndex((x) => x.id === after);
    if (after === s.id || afterAt === from - 1) return; // already there: nothing to write
    current = keyOf(s);
    await write([{ op: 'slide-move', slide: s.id, after }], `slide ${s.n}`, `Moving slide ${s.n}…`);
  };
  const moveBy = (by: -1 | 1): void => {
    const i = at();
    const s = slides[i];
    if (s?.id == null) return;
    if (by === -1 && i > 0) void moveSlide(keyOf(s), slides[i - 2]?.id ?? null);
    if (by === 1 && i < slides.length - 1) void moveSlide(keyOf(s), slides[i + 1]?.id ?? null);
  };
  const duplicate = (): void => {
    const s = cur();
    if (s?.id == null) return;
    goIndexAfterRender = at() + 1;
    void write([{ op: 'slide-duplicate', slide: s.id }], `slide ${s.n}`, `Duplicating slide ${s.n}…`);
  };
  /** Add a slide laid out like `layout` (one of the deck's own), right after the current one. */
  const addLike = (layout: DeckSlide): void => {
    const c = cur();
    if (layout.id === null || c?.id == null) return;
    goIndexAfterRender = at() + 1;
    void write([{ op: 'slide-insert', slide: layout.id, after: c.id }], `a slide after slide ${c.n}`, `Adding a slide after slide ${c.n}…`);
  };
  const deleteSlide = (): void => {
    const s = cur();
    if (s?.wid == null || slides.length === 0) return;
    goIndexAfterRender = Math.max(0, at() - (at() === slides.length - 1 ? 1 : 0));
    void write([{ op: 'remove', anchor: s.wid }], `slide ${s.n}`, `Deleting slide ${s.n}…`);
  };
  const removeElement = (wid: string): void => {
    if (inventory?.widMap[wid] === undefined) return;
    void write([{ op: 'remove', anchor: wid }], 'part of the slide', 'Removing it…');
  };

  /**
   * Notes are saved when the field is left (one version), only when they changed — against the version
   * they were BEGUN on (codex r1): a version that landed meanwhile (a helper, another tab) is a refusal,
   * never overwritten silently. The draft stays in the field, and leaving it again saves it over the
   * newer version, which the status says.
   */
  let notesFor: string | null = null;
  let notesBase: number | null = null;
  let notesDraft: { key: string; text: string } | null = null;
  const commitNotes = (): void => {
    const s = slides.find((x) => keyOf(x) === notesFor);
    const base = notesBase;
    notesFor = null;
    notesBase = null;
    if (s?.id == null || notes.readOnly) return;
    const text = notes.value.replace(/\r\n/g, '\n');
    const was = s.notes;
    const key = keyOf(s);
    // A kept draft belongs to ITS slide: only that slide's own commit or discard ends it (codex r2).
    const endDraft = (): void => { if (notesDraft?.key === key) notesDraft = null; };
    if (text.trim() === was.trim()) { endDraft(); return; }
    void write([{ op: 'notes-set', slide: s.id, text }], `slide ${s.n}’s notes`, `Saving slide ${s.n}’s notes…`, base, () => {
      notesDraft = { key, text };
      status(`Not saved: the deck changed while you typed slide ${s.n}’s notes. They are still in the field; leave it again to save them over the change.`);
      draw();
    }).then((ok) => { if (ok) endDraft(); });
  };
  notes.addEventListener('focus', () => { notesFor = current; notesBase = head; });
  notes.addEventListener('blur', () => commitNotes());
  notes.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); if (notesDraft?.key === current) notesDraft = null; notes.value = cur()?.notes ?? ''; notesFor = null; handle.focus(); return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handle.focus(); return; }
    // ⌘K is the host's, from inside the field too (codex r1); Tab past the last control leaves to the host.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); send('ui.key', { key: 'Mod+K' }); return; }
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); notes.blur(); send('ui.key', { key: 'Tab' }); return; }
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); handle.focus(); }
  });

  // ── typing on the slide ──────────────────────────────────────────────────────────────
  const cancelEdit = (): void => { if (editing === null) return; editing = null; input.hidden = true; input.value = ''; draw(); };
  const beginEdit = (wid: string, typed: string | null): void => {
    if (busy || !canWrite() || inventory === null || editable(wid) !== 'yes') return;
    const before = inventory.blocks[wid]?.text ?? '';
    editing = { wid, before };
    input.value = typed ?? before;
    draw();
    input.focus();
    if (typed === null) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
  };
  const commitEdit = async (): Promise<void> => {
    if (editing === null) return;
    const { wid, before } = editing;
    const value = input.value.replace(/\s*\n\s*/g, ' ');
    cancelEdit();
    handle.focus();
    if (value === before) return;
    await write([{ op: 'text', anchor: wid, value, before }], `slide ${cur()?.n ?? ''}`, 'Changing the text…');
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); cancelEdit(); send('ui.key', { key: 'Mod+K' }); return; }
    if (e.key === 'Enter') { e.preventDefault(); void commitEdit(); } else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); handle.focus(); }
  });
  input.addEventListener('blur', () => cancelEdit());

  // ── the add menu: the deck's own slides as layouts (no template library) ─────────────
  const openMenu = (): void => {
    menu.replaceChildren();
    const word = document.createElement('span');
    word.className = 'word';
    word.textContent = 'A blank slide laid out like';
    menu.appendChild(word);
    for (const s of slides) {
      if (s.id === null) continue;
      const b = document.createElement('button');
      b.type = 'button';
      for (const [k, v] of Object.entries({ role: 'menuitem', 'data-testid': 'deck-add-like' })) b.setAttribute(k, v);
      b.dataset['slideId'] = s.id;
      b.textContent = s.title === '' ? `Slide ${s.n}` : `Slide ${s.n} — ${s.title}`;
      b.addEventListener('click', () => addLike(s));
      menu.appendChild(b);
    }
    menuOpen = true;
    draw();
    menu.querySelector<HTMLButtonElement>('button')?.focus();
  };
  const closeMenu = (): void => { if (!menuOpen) return; menuOpen = false; draw(); addBtn.focus(); };
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('button'));
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length]?.focus();
  });

  addBtn.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()));
  dupBtn.addEventListener('click', () => duplicate());
  upBtn.addEventListener('click', () => moveBy(-1));
  downBtn.addEventListener('click', () => moveBy(1));
  delBtn.addEventListener('click', () => deleteSlide());
  presentBtn.addEventListener('click', () => void enterPresent());

  const enterPresent = async (): Promise<void> => {
    if (slides.length === 0) return;
    commitNotes();
    present = true;
    select(null);
    if (grants.includes('ui.fullscreen')) await req('ui.fullscreen', {});
    draw();
    placeFrame();
    deck.focus();
  };
  const leavePresent = (): void => { present = false; draw(); placeFrame(); deck.focus(); };

  window.addEventListener('resize', () => { placeFrame(); draw(); });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { placeFrame(); draw(); }).observe(stage);

  // ── keys (§5.10) ─────────────────────────────────────────────────────────────────────
  const ring = (): HTMLElement[] => [
    ...Array.from(thumbs.querySelectorAll<HTMLButtonElement>('button')).filter(() => size !== 'inline' && !present),
    ...Array.from(tools.querySelectorAll<HTMLButtonElement>('button')).filter((b) => !tools.hidden && !b.disabled),
    handle,
    ...(size === 'inline' || present ? [] : [notes]),
  ];
  const goto = (digit: string): void => {
    gotoDigits = `${gotoDigits}${digit}`.slice(-3);
    if (gotoTimer !== null) clearTimeout(gotoTimer);
    gotoTimer = setTimeout(() => { gotoDigits = ''; }, GOTO_MS);
    status(`Go to slide ${gotoDigits} — Enter`);
  };

  deck.addEventListener('keydown', (e) => {
    if (e.target === input || e.target === notes) return;
    const onButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON';
    const onThumb = (e.target as HTMLElement | null)?.dataset?.['testid'] === 'deck-thumb';
    // Enter after digits typed in the filmstrip goes to that slide; otherwise a button's keys are its own.
    const gotoEnter = e.key === 'Enter' && onThumb && gotoDigits !== '';
    if (onButton && !gotoEnter && (e.key === 'Enter' || e.key === ' ')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (menuOpen) { closeMenu(); return; }
      if (present) { leavePresent(); return; }
      if (selected !== null) { select(null); return; }
      send('ui.key', { key: 'Escape' });
      return;
    }
    if (mod && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); send('ui.key', { key: 'Mod+K' }); return; }
    if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); const c = cur(); if (c !== null) addLike(c); return; }
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
    // ⌘⌫ / Ctrl+Backspace: the picked part, else the slide (bare Backspace never deletes).
    if (mod && !e.altKey && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      if (selected !== null && selected !== cur()?.wid) removeElement(selected); else deleteSlide();
      return;
    }
    if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveBy(e.key === 'ArrowUp' ? -1 : 1); return; }
    if (e.altKey && !mod && /^Key[A-Z]$/.test(e.code)) { e.preventDefault(); send('ui.key', { key: `Alt+${e.code.slice(3)}` }); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const r = ring();
      const i = r.indexOf(document.activeElement as HTMLElement);
      const next = i === -1 && document.activeElement === deck && !e.shiftKey ? 0 : i + (e.shiftKey ? -1 : 1);
      if ((i === -1 && next !== 0) || next < 0 || next >= r.length) { send('ui.key', { key: e.shiftKey ? 'Shift+Tab' : 'Tab' }); return; }
      r[next]!.focus();
      return;
    }
    if (mod || e.altKey) return;
    // A composite control: the arrows, PgUp/PgDn, Home/End move between slides (rule 1 allows them).
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === 'ArrowDown' && !onButton)) { e.preventDefault(); step(1); return; }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === 'ArrowUp' && !onButton)) { e.preventDefault(); step(-1); return; }
    if (e.key === 'Home') { e.preventDefault(); const s = slides[0]; if (s !== undefined) go(keyOf(s)); return; }
    if (e.key === 'End') { e.preventDefault(); const s = slides[slides.length - 1]; if (s !== undefined) go(keyOf(s)); return; }
    // Presenting is a focused composite (§5.10 rule 1): Space advances, as in every slide viewer.
    if (present && e.key === ' ') { e.preventDefault(); step(1); return; }
    if (gotoEnter) {
      e.preventDefault();
      const s = slides[Number(gotoDigits) - 1];
      gotoDigits = '';
      if (s !== undefined) { go(keyOf(s)); thumbs.querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(keyOf(s))}"]`)?.focus(); }
      status(s === undefined ? 'There is no such slide' : `Slide ${s.n}`);
      return;
    }
    if (onButton && e.key.length !== 1) return;
    if (e.key === 'Enter') {
      if (selected !== null && !busy) { e.preventDefault(); beginEdit(selected, null); }
      return;
    }
    if (e.key.length !== 1) return;
    e.preventDefault();
    if (selected !== null && !busy) { beginEdit(selected, e.key); return; }
    // A digit is a slide number only while the FILMSTRIP has the focus — a focused composite's own key
    // (§5.10 rule 1). Anywhere else it is typing, and goes to the composer like any other (codex r1).
    if (/^[0-9]$/.test(e.key) && onThumb) { goto(e.key); return; }
    // Rule 2: any other printable key outside an editable goes to the composer — never an action.
    send('ui.typed', { grapheme: e.key });
  });

  // ── host → plugin ────────────────────────────────────────────────────────────────────
  const setSize = (to: Size): void => {
    const was = size;
    size = to;
    document.body.dataset['size'] = to;
    if (to === 'inline') { present = false; cancelEdit(); selected = null; menuOpen = false; (document.activeElement as HTMLElement | null)?.blur?.(); }
    if (to !== 'full' && present) present = false;
    // The inline preview always shows slide 1; leaving it shows the current slide again.
    if ((was === 'inline') !== (to === 'inline') && slides.length > 0) showSlide();
    placeFrame();
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
          // A version landed (ours announced late, a helper's, another tab's): the deck shows the newest,
          // on the slide being looked at. The words about our own are the host's written line.
          const v = p['version'];
          if (typeof v === 'number' && v !== head) void render(v);
          return;
        }
        case 'selection.cleared':
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

  void strip;
  const version = document.querySelector('meta[name="wicked-editor-version"]')?.getAttribute('content') ?? '0.0.0';
  parent.postMessage({ p: PROTOCOL, v: PROTOCOL_VERSION, type: 'plugin.ready', payload: { editor: EDITOR, version, protocol: [PROTOCOL_VERSION] } }, '*');
}

start();
