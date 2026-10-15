import { anchorWords, coverageOf, coverageLine, type BlockText, type CoverageRow } from '../../board/artifactMorph.js';
import { isForwardable } from '../../editors/keys.js';
import { overlayBox, type OverlayBox, type ScrollState } from '../../interactive/anchoring.js';
import {
  REQUEST_INVENTORY, makeScrollToWid, parseInbound as parseBridge, type WidBlock, type WidRect,
} from '../../interactive/instrument-protocol.js';
import { appendInstrumentBridge, hasInstrumentBridge } from '../../interactive/instrumented.js';
import { DEFAULT_COLOUR, themeSwatches, type Swatch } from '../../editors/swatches.js';
import { V2Port, announceReady, helloOf, sizeOfSurface, type Mode, type Surface } from './v2.js';
import { mountStyle, tokensFromHtml, type ThemeTokens } from './style.js';

/**
 * Shared page/document element editor as a `wicked.editor/1` plugin (DES-EDITOR-PLUGINS-001
 * §7.1, slice EP-P2). S8's PageEditor, moved inside the plugin frame: the rendered page in a NESTED
 * `sandbox="allow-scripts"` frame (`srcdoc` from `artifact.read`'s HTML with the `data-wid` bridge
 * appended), so pointing at an element highlights it, a click picks it (`selection.set` — the host
 * writes the chip's words from its own inventory), typing on the picked element edits it in place
 * (ONE `version.write` with `before` as the staleness guard; the host escapes the text, posts the
 * batch and draws the thread line with Undo), and what the operator types is text, never markup.
 *
 * EP-P3 (§7.1 R-a…R-d), each act-first with the host's Undo: a picked element's peek offers Remove
 * (also ⌘⌫ / Ctrl+Backspace — bare Backspace never removes), a fill and a text colour from the page's
 * own theme plus Default, and the whole section (also ⌥↑, or a second click); the header sets the
 * page's width (Phone 390 / Tablet 820 / Desktop 1280) — only the nested frame's width changes.
 *
 * Protocol 2 (DES-EDITOR-PLUGIN-CONTRACT-001 §9): the CARD is the page preview (scrollable; a click points at an
 * element, so the host's "Ask about this" has a subject); the OPTIONS instance draws the Style tab (themes,
 * colours, fonts: one `theme.set` each, Undo from the host); FULL is this editor, where Simple edits words and
 * Advanced adds the element style (fill, text colour) and Remove. A protocol-1 host sees the v1 editor unchanged.
 *
 * The plugin never learns a URL, an id's mount or a run root: it reads the artifact through the host,
 * and every write, chip and key goes through the host's checks (§5.6, §5.7, §5.10). Framework-free,
 * bundled by `scripts/build-editors.mjs` into ONE self-contained HTML file beside its `editor.json`.
 */

const PROTOCOL = 'wicked.editor';
const PROTOCOL_VERSION = 1;

/** EP-P3 (R-d): the device widths the header offers; `null` = the page fills the editor. */
const WIDTHS: readonly (readonly [number, string])[] = [[390, 'Phone'], [820, 'Tablet'], [1280, 'Desktop']];
/** The header's height at pane and full size: the stage sits below it. */
const TOOLS_H = 34;

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
<div data-testid="page-style" id="style" class="style-pane" hidden></div>
<div data-testid="page-editor" id="editor" class="editor" data-kind="page" data-head="" data-pickable="false" data-selected="" data-size="pane" data-width="" tabindex="0" role="application" aria-label="The page">
  <div data-testid="page-tools" id="tools" class="tools" role="toolbar" aria-label="Page width">
    ${WIDTHS.map(([w, word]) => `<button type="button" data-testid="page-width" data-width="${w}" aria-pressed="false" title="${word} · ${w} px wide">${word} ${w}</button>`).join('')}
  </div>
  <div id="stage" class="stage"></div>
  <div data-testid="page-hover-box" id="hover" class="box box--hover" hidden></div>
  <div data-testid="page-selected-box" id="selected" class="box" data-wid="" hidden></div>
  <textarea data-testid="page-edit-input" id="input" class="input" rows="1" aria-label="New text" hidden></textarea>
  <div data-testid="page-handle" id="handle" class="handle" tabindex="-1"></div>
  <p data-testid="page-hint" id="hint" class="hint" hidden></p>
  <p data-testid="page-note" id="note" class="note" hidden></p>
  <div data-testid="page-peek" id="peek" class="peek" role="group" aria-label="The picked element" hidden>
    <button type="button" data-testid="page-section" id="to-section" hidden>Whole section</button>
    <button type="button" data-testid="page-remove" id="remove" class="danger" title="Remove it (⌘⌫ / Ctrl+Backspace) — Undo puts it back">Remove</button>
    <span class="swatches" data-testid="page-swatches" data-prop="background" id="fills"><span class="word">Fill</span></span>
    <span class="swatches" data-testid="page-swatches" data-prop="color" id="inks"><span class="word">Text</span></span>
  </div>
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

export function startPageEditor(cfg: { editor: string; surfaces: unknown; kind: 'page' | 'document'; coverage: boolean }): void {
  document.body.insertAdjacentHTML('afterbegin', MARKUP);
  const editor = el<HTMLDivElement>('editor');
  editor.dataset['kind'] = cfg.kind;
  editor.setAttribute('aria-label', cfg.kind === 'document' ? 'The document' : 'The page');
  const stage = el<HTMLDivElement>('stage');
  // The nested frame for the version on screen. Every version gets a NEW element (never a srcdoc swap on
  // the old one): a message is accepted only from the current element's own window, so a late load or a
  // forged message from a previous document has no element to speak for (codex r1).
  let frame: HTMLIFrameElement | null = null;
  const hoverBox = el<HTMLDivElement>('hover');
  const selBox = el<HTMLDivElement>('selected');
  const input = el<HTMLTextAreaElement>('input');
  const handle = el<HTMLDivElement>('handle');
  const hint = el<HTMLParagraphElement>('hint');
  const note = el<HTMLParagraphElement>('note');
  const tools = el<HTMLDivElement>('tools');
  const peek = el<HTMLDivElement>('peek');
  const toSection = el<HTMLButtonElement>('to-section');
  const removeBtn = el<HTMLButtonElement>('remove');
  const fills = el<HTMLSpanElement>('fills');
  const inks = el<HTMLSpanElement>('inks');

  // ── the port ────────────────────────────────────────────────────────────────────────
  let port: MessagePort | null = null;
  let grants: string[] = [];
  let size: Size = 'pane';
  /** Protocol 2: the surface this instance is and the full-screen mode (Simple edits words; Advanced adds style). */
  let protocol = 1;
  let surface: Surface = 'options';
  let tab = 'style';
  let mode: Mode = 'simple';
  let v2: V2Port | null = null;
  const canEditText = (): boolean => protocol === 1 ? size !== 'inline' : surface === 'full';
  const canRestyle = (): boolean => canEditText() && (protocol === 1 || mode === 'advanced');
  /** The theme the page wears (its `--wi-*`), the Style panel's starting point. */
  let themeTokens: ThemeTokens | null = null;
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
  let coverageBlocks: Record<string, BlockText> = Object.create(null) as Record<string, BlockText>;
  let checks: { id: string; text: string }[] | null = null;
  let checksTotal = 0;
  let checksFailed = false;
  let checksLoading = false;
  let bufferedSelection: string | null = null;
  const coverageRoot = cfg.coverage ? document.createElement('aside') : null;
  if (coverageRoot !== null) {
    coverageRoot.id = 'coverage';
    coverageRoot.dataset['testid'] = 'doc-coverage';
    coverageRoot.setAttribute('aria-label', 'Requirements');
    coverageRoot.hidden = true;
    document.body.append(coverageRoot);
    const css = document.createElement('style');
    css.textContent = `#coverage{box-sizing:border-box;height:100%;overflow:auto;padding:16px;color:var(--ink-high);background:var(--surface-base);font:13px var(--font-sans,system-ui)}
#coverage h2{font-size:16px;margin:0 0 12px}#coverage p{color:var(--ink-muted);line-height:1.5}
#coverage button{display:block;width:100%;padding:10px 8px;text-align:left;font:inherit;color:var(--ink-high);background:var(--surface-card);border:1px solid var(--border);border-radius:4px;margin:6px 0;cursor:pointer}
#coverage button:disabled{cursor:default}#coverage button:focus-visible{outline:2px solid var(--accent)}
#coverage p button{display:inline;width:auto;padding:0;margin:0;border:0;background:transparent;color:var(--accent);text-decoration:underline}
body[data-coverage="side"] .editor{width:calc(100% - min(300px,38%))}
body[data-coverage="side"] #coverage{position:absolute;right:0;top:0;width:min(300px,38%);border-left:1px solid var(--border)}`;
    document.body.append(css);
  }
  const drawCoverage = (): void => {
    if (coverageRoot === null) return;
    coverageRoot.replaceChildren();
    delete coverageRoot.dataset['total'];
    delete coverageRoot.dataset['rows'];
    delete coverageRoot.dataset['named'];
    if (checksFailed) {
      const line = document.createElement('p'); line.textContent = "Couldn't read the requirements · ";
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Try again';
      retry.addEventListener('click', () => { void readChecks(); });
      line.append(retry); coverageRoot.append(line);
      return;
    }
    if (checks === null) {
      const line = document.createElement('p'); line.textContent = 'Reading requirements…'; coverageRoot.append(line);
      return;
    }
    if (checks.length === 0) {
      const line = document.createElement('p'); line.textContent = "No requirements for this document's repository"; coverageRoot.append(line);
      return;
    }
    const rows = coverageOf(checks.map((r) => ({ key: r.id, reqId: r.id, title: r.text, risk: false })), coverageBlocks);
    const named = rows.filter((r) => r.wid !== null);
    const missing = rows.filter((r) => r.wid === null);
    coverageRoot.dataset['total'] = String(checksTotal);
    coverageRoot.dataset['rows'] = String(rows.length);
    coverageRoot.dataset['named'] = String(named.length);
    const title = document.createElement('h2'); title.textContent = 'Requirements'; coverageRoot.append(title);
    const line = document.createElement('p'); line.dataset['testid'] = 'doc-coverage-line'; line.textContent = coverageLine(rows, checksTotal); coverageRoot.append(line);
    const group = (label: string, items: CoverageRow[]): void => {
      if (items.length === 0) return;
      const heading = document.createElement('p'); heading.textContent = `${label} (${items.length})`; coverageRoot.append(heading);
      for (const r of items) {
        const button = document.createElement('button'); button.type = 'button';
        button.dataset['testid'] = 'doc-coverage-row'; button.dataset['req'] = r.reqId;
        button.dataset['named'] = String(r.wid !== null); button.disabled = r.wid === null;
        button.textContent = `${r.reqId} · ${r.title}${r.wid === null ? '' : ` · ${anchorWords(r.wid, cfg.kind)}`}`;
        button.addEventListener('click', () => {
          if (r.wid === null) return;
          // From the Coverage list the focus stays on the row (agy h4b-r1): Tab walks the rows, keys go where they did.
          // In the options tab the editor is hidden: only the host hears the selection.
          if (surface === 'options') { if (grants.includes('selection.chip')) send('selection.set', { anchors: [{ kind: 'element', id: r.wid }] }); return; }
          select(r.wid, true);
          scrollTo(r.wid);
        });
        coverageRoot.append(button);
      }
    };
    group('Not named', missing); group('Named', named);
  };
  const readChecks = async (): Promise<void> => {
    if (!cfg.coverage || checks !== null || checksLoading) return;
    checksLoading = true;
    checksFailed = false;
    drawCoverage();
    try {
      const r = await req('checks.read', {});
      const raw = r.ok ? r.payload['checks'] : null;
      if (!r.ok || !Array.isArray(raw)) { checksFailed = true; return; }
      checks = raw.filter((c): c is { id: string; text: string } =>
        typeof c === 'object' && c !== null && typeof (c as { id?: unknown }).id === 'string' && typeof (c as { text?: unknown }).text === 'string');
      checksTotal = typeof r.payload['total'] === 'number' ? r.payload['total'] : checks.length;
    } catch {
      checksFailed = true;
    } finally { checksLoading = false; drawCoverage(); }
  };
  /** Parse the current version without running its scripts; containers do not name requirements. */
  const readCoverageBlocks = (html: string): void => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    coverageBlocks = Object.create(null) as Record<string, BlockText>;
    const nodes = Array.from(doc.querySelectorAll('[data-wid]'));
    const counts = new Map<string, number>();
    for (const node of nodes) { const id = node.getAttribute('data-wid') ?? ''; counts.set(id, (counts.get(id) ?? 0) + 1); }
    for (const node of nodes) {
      const id = node.getAttribute('data-wid') ?? '';
      if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(id) || counts.get(id) !== 1) continue;
      coverageBlocks[id] = { text: (node.textContent ?? '').replace(/\s+/g, ' ').trim(), composite: node.querySelector('[data-wid]') !== null };
    }
    drawCoverage();
  };
  let inventory: Inventory | null = null;
  let current: ScrollState = { scrollX: 0, scrollY: 0 };
  let hover: string | null = null;
  let selected: string | null = null;
  let editing: { wid: string; before: string; base: number } | null = null;
  // A host refresh must not replace the draft's document. Keep only the newest read until the edit ends.
  let deferredRead: Record<string, unknown> | null = null;
  let busy = false;
  /** EP-P3: the page's own theme colours (this version's `--wi-*`), and the width the page is shown at. */
  let swatches: Swatch[] = [];
  let width: number | null = null;
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
  /** The version the render in flight is reading (`null` = the head). */
  let reading: number | null = null;
  // A version asked for while another is being read: the newest wins, once that read is done.
  let queued: { version?: number } | null = null;

  const postToFrame = (msg: unknown): void => { frame?.contentWindow?.postMessage(msg, '*'); };
  /** The current element loaded its document: ask it for the inventory a few times. */
  const askInventory = (loaded: HTMLIFrameElement): void => {
    if (loaded !== frame) return; // a previous version's element, finishing late: not this document
    readyGen = gen;
    for (const t of timers) clearTimeout(t);
    timers = ASK_AT_MS.map((ms) => setTimeout(() => postToFrame(REQUEST_INVENTORY), ms));
  };
  const mountFrame = (srcdoc: string): void => {
    const next = document.createElement('iframe');
    for (const [k, v] of Object.entries({ 'data-testid': 'page-frame', sandbox: 'allow-scripts', title: cfg.kind === 'document' ? 'The document' : 'The page', class: 'frame' })) next.setAttribute(k, v);
    next.addEventListener('load', () => askInventory(next));
    const old = frame;
    frame = next;
    for (const t of timers) clearTimeout(t);
    next.srcdoc = srcdoc;
    stage.appendChild(next);
    old?.remove();
    applyWidth();
  };

  /** Where the page's frame sits in the editor, and its scale (a width wider than the editor is shown
   *  whole, scaled down — the page still lays out at that width). Boxes map through it. */
  const geom = (): { x: number; y: number; s: number } => {
    const y = size === 'inline' ? 0 : TOOLS_H;
    if (width === null) return { x: 0, y, s: 1 };
    const avail = stage.clientWidth;
    const s = avail > 0 ? Math.min(1, avail / width) : 1;
    return { x: Math.max(0, (avail - width * s) / 2), y, s };
  };
  const applyWidth = (): void => {
    stage.style.top = `${size === 'inline' ? 0 : TOOLS_H}px`;
    editor.dataset['width'] = width === null ? '' : String(width);
    for (const b of Array.from(tools.querySelectorAll<HTMLButtonElement>('[data-width]'))) b.setAttribute('aria-pressed', String(Number(b.dataset['width']) === width));
    if (frame === null) return;
    if (width === null) {
      frame.style.cssText = '';
      return;
    }
    const g = geom();
    const h = stage.clientHeight > 0 ? stage.clientHeight / g.s : 0;
    frame.style.cssText = `position:absolute;left:${g.x}px;top:0;width:${width}px;${h > 0 ? `height:${h}px;` : ''}transform:scale(${g.s});transform-origin:0 0`;
  };

  const box = (wid: string | null): OverlayBox | null => {
    if (wid === null || inventory === null) return null;
    const rect = inventory.widMap[wid];
    if (rect === undefined) return null;
    const b = overlayBox(rect, inventory.measured, current);
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

  const pickable = (): boolean => (size !== 'inline' || (protocol >= 2 && surface === 'card')) && inventory !== null;

  const draw = (): void => {
    editor.dataset['head'] = head === null ? '' : String(head);
    editor.dataset['pickable'] = String(pickable());
    editor.dataset['selected'] = selected ?? '';
    editor.dataset['size'] = size;
    place(hoverBox, hover !== selected && editing === null ? box(hover) : null);
    selBox.dataset['wid'] = selected ?? '';
    place(selBox, editing === null ? box(selected) : null);
    if (editing !== null) place(input, box(editing.wid), 160, 30); else input.hidden = true;
    tools.hidden = size === 'inline';
    editor.dataset['mode'] = protocol >= 2 ? mode : '';
    // The element's peek, style and Remove are Advanced in full screen (§9).
    removeBtn.hidden = !canRestyle();
    fills.hidden = !canRestyle();
    inks.hidden = !canRestyle();
    drawPeek();
    // The hint: what the pick lets you do (S8 words), or why typing cannot change this element.
    if (!canEditText() || !pickable() || editing !== null) { hint.hidden = true; return; }
    hint.hidden = false;
    if (selected === null) { hint.removeAttribute('data-editable'); hint.textContent = 'Click an element to make it the subject · type on it to change it'; return; }
    const words = anchorWords(selected, cfg.kind);
    const typing = typingOn(inventory, selected);
    hint.dataset['editable'] = String(typing === 'yes');
    hint.textContent = typing === 'yes' ? `Type to change ${words} · Enter to edit its text · Esc to let go`
      : typing === 'container' ? `${capital(words)} holds other parts — click a line of text inside it to change the words · Esc to let go`
        : typing === 'cut' ? `${capital(words)} is too long to change by typing — say what to change in the message box · Esc to let go`
          : `${capital(words)} can’t be changed by typing — say what to change in the message box · Esc to let go`;
  };

  /** The picked element's peek: below its box (above when there is no room), at pane and full size. */
  const drawPeek = (): void => {
    const b = canRestyle() && pickable() && editing === null && !busy ? box(selected) : null;
    if (b === null || selected === null) { peek.hidden = true; return; }
    peek.hidden = false;
    toSection.hidden = inventory?.blocks[selected]?.section === undefined;
    const h = peek.offsetHeight || 30;
    const below = b.top + b.height + 6;
    const room = editor.clientHeight === 0 || below + h <= editor.clientHeight - 4;
    // Kept inside the editor (codex r1): an element at the right edge opens its peek leftwards.
    const w = peek.offsetWidth;
    const maxLeft = editor.clientWidth > 0 ? editor.clientWidth - w - 4 : Infinity;
    peek.style.left = `${Math.max(4, Math.min(b.left, maxLeft))}px`;
    peek.style.top = `${room ? below : Math.max(TOOLS_H + 2, b.top - h - 6)}px`;
  };

  /** One row of swatches: the page's theme colours, then Default. */
  const fillSwatches = (row: HTMLSpanElement, prop: 'background' | 'color'): void => {
    for (const old of Array.from(row.querySelectorAll('button'))) old.remove();
    const add = (value: string, label: string): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = value === DEFAULT_COLOUR ? 'swatch swatch--default' : 'swatch';
      for (const [k, v] of Object.entries({ 'data-testid': 'page-swatch' })) b.setAttribute(k, v);
      b.dataset['prop'] = prop;
      b.dataset['value'] = value;
      b.title = `${prop === 'background' ? 'Fill' : 'Text'}: ${label}`;
      b.setAttribute('aria-label', b.title);
      if (value === DEFAULT_COLOUR) b.textContent = 'Default';
      else b.style.setProperty('--swatch', value);
      b.addEventListener('click', () => { if (selected !== null) void restyle(selected, prop, value, label); });
      row.appendChild(b);
    };
    for (const sw of swatches) add(sw.value, sw.label);
    add(DEFAULT_COLOUR, 'Default');
  };

  const cancelEdit = (): void => {
    if (editing === null) return;
    editing = null;
    input.hidden = true;
    input.value = '';
    const next = deferredRead;
    deferredRead = null;
    if (next !== null) acceptRead(next);
    draw();
  };

  /** An element becomes the subject: picked, a chip on the composer (the host writes its words), and
   *  typing reaches this document — never the frame the click focused. */
  const select = (wid: string | null, keepFocus = false): void => {
    bufferedSelection = null;
    selected = wid;
    cancelEdit();
    draw();
    if (wid !== null) {
      if (grants.includes('selection.chip')) send('selection.set', { anchors: [{ kind: 'element', id: wid }] });
      if (!keepFocus) handle.focus();
    }
  };

  const scrollTo = (wid: string): void => { asks += 1; postToFrame(makeScrollToWid(wid, asks)); };

  const acceptRead = (payload: Record<string, unknown>): void => {
    const version = payload['version'];
    if (typeof version === 'number' && head !== null && version < head) return;
    if (editing !== null) {
      const deferredVersion = deferredRead?.['version'];
      if (typeof version === 'number' && version > editing.base
        && (typeof deferredVersion !== 'number' || version >= deferredVersion)) deferredRead = payload;
      return;
    }
    note.hidden = true;
    const content = payload['content'] as { type?: unknown; html?: unknown } | undefined;
    const html = typeof content?.html === 'string' ? content.html : '';
    if (cfg.coverage) readCoverageBlocks(html);
    head = typeof version === 'number' ? version : head;
    swatches = themeSwatches(html);
    themeTokens = tokensFromHtml(html) ?? themeTokens;
    style?.refresh();
    fillSwatches(fills, 'background');
    fillSwatches(inks, 'color');
    gen += 1;
    armed = returnTo;
    returnTo = null;
    inventory = null;
    hover = null;
    selected = null;
    cancelEdit();
    draw();
    mountFrame(hasInstrumentBridge(html) ? html : appendInstrumentBridge(html));
  };

  /** Render one version: the host's HTML, the bridge appended, in the nested sandboxed frame. */
  const render = async (version?: number): Promise<void> => {
    // The same version announced twice (a stale reply names it AND `moved` carries it; the idle refresh
    // crossing a result) is read and mounted once: a second mount would throw away what was typed
    // meanwhile (codex r3). A version on its way is never queued; a queued one already shown never runs.
    if (rendering) {
      if (version !== undefined && version === reading) return;
      queued = version === undefined ? {} : { version };
      return;
    }
    rendering = true;
    reading = version ?? null;
    try {
      const r = await req('artifact.read', version === undefined ? {} : { version });
      if (!r.ok) { note.hidden = false; note.textContent = r.error.code === 'not_granted' ? `This editor may not read the ${cfg.kind} here.` : `The ${cfg.kind} could not be read (${r.error.code}).`; return; }
      acceptRead(r.payload);
    } finally {
      rendering = false;
      reading = null;
      if (queued !== null) {
        const next = queued;
        queued = null;
        if (next.version === undefined || next.version !== head) void render(next.version);
      }
    }
  };

  // ── bridge → plugin (the nested frame's own window, this document's generation only) ──
  window.addEventListener('message', (e: MessageEvent) => {
    if (frame === null || frame.contentWindow === null || e.source !== frame.contentWindow || readyGen !== gen) return;
    const msg = parseBridge(e.data);
    if (msg === null) return;
    if (msg.type === 'wid-inventory') {
      for (const t of timers) clearTimeout(t);
      inventory = { widMap: msg.widMap, blocks: msg.blocks ?? {}, measured: { scrollX: msg.scrollX, scrollY: msg.scrollY } };
      current = { scrollX: msg.scrollX, scrollY: msg.scrollY };
      const back = armed;
      armed = null;
      if (back !== null && msg.widMap[back] !== undefined) scrollTo(back);
      // The anchor another instance pointed at survives a new version's frame (codex h4-r3): it is resolved
      // against each new inventory until the operator picks something else here or the chip is removed.
      if (bufferedSelection !== null && msg.widMap[bufferedSelection] !== undefined) {
        selected = bufferedSelection;
        if (cfg.coverage) scrollTo(bufferedSelection);
      }
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
      if (protocol === 1 && size === 'inline') return; // v1's host hit layer owns the preview
      if (protocol === 2 && surface === 'card') { select(msg.wid); return; }
      // R-c: a second click on the picked element picks its section.
      const up = msg.wid === selected ? inventory?.blocks[msg.wid]?.section : undefined;
      select(up !== undefined && inventory?.widMap[up] !== undefined ? up : msg.wid);
    }
  });

  // ── edit by touching ──────────────────────────────────────────────────────────────────
  const beginEdit = (wid: string, typed: string | null): void => {
    if (!canEditText() || busy || head === null || inventory === null || typingOn(inventory, wid) !== 'yes') return;
    const before = inventory.blocks[wid]?.text ?? '';
    // The field exists and holds the focus before this key event returns: the characters typed right
    // behind it land in the field (no frame is awaited — S8 lost them to the frame once).
    editing = { wid, before, base: head };
    input.value = typed ?? before;
    draw();
    input.focus();
    if (typed === null) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
  };

  /** One write — a text edit, a remove, a restyle — and what its answer means for the page on screen.
   *  `back` is the element the next version opens scrolled to. */
  const write = async (ops: unknown[], summary: string, saying: string, back: string | null, base = head): Promise<void> => {
    if (head === null || busy) return;
    busy = true;
    draw();
    status(saying);
    const wid = back;
    try {
      const r = await req('version.write', { base, ops, summary });
      if (r.ok) {
        returnTo = wid;
        await render(typeof r.payload['version'] === 'number' ? r.payload['version'] : undefined);
      } else if (r.error.code === 'stale' || r.error.code === 'head_moved') {
        // head_moved is refused before sending; stale comes after (codex r7): the adapter's words, then.
        status(r.error.code === 'stale' && r.error.message ? r.error.message : 'Not changed: it moved while you typed');
        returnTo = wid;
        const moved = r.payload?.['head'];
        if (r.error.code === 'head_moved') await render(typeof moved === 'number' ? moved : undefined);
        else if (typeof moved === 'number' && moved !== head) await render(moved);
      } else if (r.error.code === 'timeout') {
        // The host said it when its timer fired, before any late landing's line (codex r4): no echo here.
      } else if (r.error.code === 'refused') {
        status(r.error.message || 'Nothing changed');
      } else {
        status(`Not changed: ${r.error.message || r.error.code}`);
      }
    } finally {
      busy = false;
      draw();
    }
  };

  const commit = async (): Promise<void> => {
    if (editing === null || head === null || busy) return;
    const { wid, before, base } = editing;
    // One line of text: a pasted line break is a space, as the page would render it.
    const value = input.value.replace(/\s*\n\s*/g, ' ');
    cancelEdit();
    handle.focus();
    if (value === before) return;
    const words = anchorWords(wid, cfg.kind);
    await write([{ op: 'text', anchor: wid, value, before }], words, `Changing ${words}…`, wid, base);
  };

  /** R-a: remove the picked element — one version; the host's Undo puts it back. */
  const remove = async (wid: string): Promise<void> => {
    // Removing is Advanced in full screen (and v1's editor); never from the card's preview (codex h4-r1).
    if (!canRestyle()) return;
    if (busy || inventory?.widMap[wid] === undefined) return;
    const words = anchorWords(wid, cfg.kind);
    const section = inventory.blocks[wid]?.section ?? null;
    handle.focus();
    await write([{ op: 'remove', anchor: wid }], words, `Removing ${words}…`, section);
  };

  /** R-b: one colour on the picked element — one version, with Undo. */
  const restyle = async (wid: string, prop: 'background' | 'color', value: string, label: string): Promise<void> => {
    if (!canRestyle()) return;
    if (busy || inventory?.widMap[wid] === undefined) return;
    const words = anchorWords(wid, cfg.kind);
    handle.focus();
    await write([{ op: 'style', anchor: wid, style: { [prop]: value } }], words, `${prop === 'background' ? 'Filling' : 'Colouring the text of'} ${words}: ${label.toLowerCase()}…`, wid);
  };

  /** R-c: the picked element's section becomes the subject. */
  const toSectionOf = (wid: string): boolean => {
    const up = inventory?.blocks[wid]?.section;
    if (up === undefined || inventory?.widMap[up] === undefined) return false;
    select(up);
    return true;
  };

  toSection.addEventListener('click', () => { if (selected !== null) toSectionOf(selected); });
  removeBtn.addEventListener('click', () => { if (selected !== null) void remove(selected); });
  for (const b of Array.from(tools.querySelectorAll<HTMLButtonElement>('[data-width]'))) {
    b.addEventListener('click', () => {
      const w = Number(b.dataset['width']);
      // The pressed width again: the page fills the editor.
      width = width === w ? null : w;
      applyWidth();
      draw();
    });
  }
  window.addEventListener('resize', () => { applyWidth(); draw(); });

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); void commit(); } else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); handle.focus(); }
  });
  input.addEventListener('blur', () => { cancelEdit(); });

  // ── keys on the page (not in the field): S8's grammar + the contract's forwarding (§5.10) ──
  /** The plugin's own controls, in order, that can take focus now (§5.10 rule 5). */
  const ring = (): HTMLElement[] => [
    ...Array.from(tools.querySelectorAll<HTMLButtonElement>('button')),
    handle,
    ...Array.from(peek.querySelectorAll<HTMLButtonElement>('button')),
    ...Array.from(coverageRoot?.querySelectorAll<HTMLButtonElement>('button') ?? []),
  ].filter((b) => b.closest('[hidden]') === null && !(b instanceof HTMLButtonElement && b.disabled));

  const onKey = (e: KeyboardEvent, onCoverage: boolean): void => {
    if (e.target === input) return;
    const onButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON';
    // A button's own keys are the button's (Enter / Space press it).
    if (onButton && (e.key === 'Enter' || e.key === ' ')) return;
    if (e.key === 'Escape') {
      // Something of our own to dismiss first; else the host's (one step smaller).
      if (!onCoverage && selected !== null) { e.preventDefault(); select(null); return; }
      e.preventDefault();
      send('ui.key', { key: 'Escape' });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); send('ui.key', { key: 'Mod+K' }); return; }
    // R-a: ⌘⌫ / Ctrl+Backspace removes the picked element (bare Backspace never does).
    if (!onCoverage && (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      if (selected !== null && !busy) void remove(selected);
      return;
    }
    // R-c: ⌥↑ picks the section the picked element is in.
    if (!onCoverage && e.altKey && !e.metaKey && !e.ctrlKey && e.key === 'ArrowUp') {
      e.preventDefault();
      if (selected !== null) toSectionOf(selected);
      return;
    }
    // Only the host's navigation chords: the host drops any other Alt chord and tears the frame down after three (agy h4b-r1).
    if (e.altKey && !e.metaKey && !e.ctrlKey && /^Key[A-Z]$/.test(e.code) && isForwardable(`Alt+${e.code.slice(3)}`)) { e.preventDefault(); send('ui.key', { key: `Alt+${e.code.slice(3)}` }); return; }
    if (e.key === 'Tab') {
      // Tab moves through the plugin's own controls; past either end it returns to the host (§5.10 rule 5).
      e.preventDefault();
      const r = ring();
      const at = r.indexOf(document.activeElement as HTMLElement);
      // From the root (where a Tab into the frame lands), forward Tab enters the first control (codex r1).
      const next = at === -1 && document.activeElement === editor && !e.shiftKey ? 0 : at + (e.shiftKey ? -1 : 1);
      if ((at === -1 && next !== 0) || next < 0 || next >= r.length) { send('ui.key', { key: e.shiftKey ? 'Shift+Tab' : 'Tab' }); return; }
      r[next]!.focus();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (onButton && e.key.length !== 1) return;
    if (e.key === 'Enter') { if (!onCoverage && selected !== null && !busy && canEditText()) { e.preventDefault(); beginEdit(selected, null); } return; }
    // Bare Backspace / Delete never remove anything (§7.1 R-a).
    if (e.key.length !== 1) return;
    e.preventDefault();
    if (!onCoverage && selected !== null && !busy && canEditText()) { beginEdit(selected, e.key); return; }
    // Rule 2: the first printable key outside an editable goes to the composer — never an action.
    send('ui.typed', { grapheme: e.key });
  };
  editor.addEventListener('keydown', (e) => onKey(e, false));
  coverageRoot?.addEventListener('keydown', (e) => onKey(e, true));

  // ── host → plugin ──────────────────────────────────────────────────────────────────────
  const setSize = (to: Size): void => {
    size = to;
    document.body.dataset['size'] = to;
    if (to === 'inline') { cancelEdit(); if (protocol < 2) select(null); (document.activeElement as HTMLElement | null)?.blur?.(); }
    applyWidth();
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
      if (v2 !== null && v2.dispatch(d)) return;
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
          if (checksFailed) void readChecks();
          // A version landed — the operator's own (the host already told us the number, or announces it
          // now: a landing after the write's 10 s reply window), a helper's or another tab's: the page
          // shows the newest, scrolled back to what was being looked at. No `ui.status` here: the words
          // about an own version are the host's written line (with Undo), which a status would replace.
          const v = p['version'];
          if (typeof v === 'number' && v !== head) { returnTo = returnTo ?? selected; void render(v); }
          return;
        }
        case 'selection.cleared':
          bufferedSelection = null;
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
    const hello = helloOf(p);
    protocol = hello.protocol;
    if (protocol >= 2) {
      // An explicitly requested options surface defaults to Style; only a legacy pane uses the
      // helper's no-tab fallback to the full editor.
      surface = p['surface'] === 'options' ? 'options' : hello.surface;
      tab = hello.tab ?? 'style';
      mode = hello.mode ?? 'simple';
      v2 = new V2Port(port, {
        surface: (s, m) => { surface = s; if (m !== null) mode = m; showSurface(); },
        mode: (m) => { mode = m; if (cfg.coverage) showSurface(); else draw(); return mode; },
        tab: (t) => { if (cfg.coverage) { tab = t; showSurface(); } },
        selection: (anchors) => {
          // Another instance pointed at an element: show it picked here too (ids only; the host checked them).
          const a = anchors.find((x): x is { kind: 'element'; id: string } => typeof x === 'object' && x !== null && (x as { kind?: unknown }).kind === 'element' && typeof (x as { id?: unknown }).id === 'string');
          if (surface === 'options' && a !== undefined) return;
          bufferedSelection = a?.id ?? null;
          selected = a !== undefined && inventory?.widMap[a.id] !== undefined ? a.id : null;
          if (selected !== null && cfg.coverage) scrollTo(selected);
          cancelEdit();
          draw();
        },
      });
      showSurface();
    } else setSize(hello.size);
    void render();
  });

  /** Protocol 2: options draws Style or document Coverage; full Advanced adds the coverage side list. */
  const styleRoot = el<HTMLDivElement>('style');
  let style: { refresh(): void } | null = null;
  const showSurface = (): void => {
    const options = surface === 'options';
    const coverageTab = cfg.coverage && options && tab === 'coverage';
    const coverageSide = cfg.coverage && surface === 'full' && mode === 'advanced';
    if (cfg.coverage) {
      document.body.dataset['coverage'] = coverageSide ? 'side' : '';
      if (coverageRoot !== null) coverageRoot.hidden = !coverageTab && !coverageSide;
      if (coverageTab || coverageSide) { drawCoverage(); void readChecks(); }
    }
    styleRoot.hidden = !options || coverageTab;
    editor.hidden = options;
    if (options && !coverageTab && style === null) {
      style = mountStyle(styleRoot, {
        tokens: () => themeTokens,
        key: (key) => send('ui.key', { key }),
        apply: async (tokens) => {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            if (head === null) return { ok: false, reason: `The ${cfg.kind} is not loaded yet` };
            const r = await req('theme.set', { base: head, tokens });
            if (r.ok) {
              const v = r.payload['version'];
              themeTokens = { name: tokens.name, colors: { ...tokens.colors }, fonts: { ...tokens.fonts } };
              if (typeof v === 'number') await render(v);
              return { ok: true };
            }
            if (r.error.code !== 'head_moved') return { ok: false, reason: r.error.message };
            const read = await req('artifact.read', {});
            if (!read.ok) return { ok: false, reason: read.error.message || read.error.code };
            const nextHead = read.payload['version'];
            if (typeof nextHead !== 'number' || (head !== null && nextHead < head)) return { ok: false, reason: `The current ${cfg.kind} version could not be read.` };
            acceptRead(read.payload);
            if (attempt === 1) return { ok: false, reason: r.error.message || r.error.code };
          }
          return { ok: false, reason: `The ${cfg.kind} changed again: try once more` };
        },
      });
    }
    setSize(sizeOfSurface(surface));
  };

  announceReady(cfg.editor, cfg.surfaces);
}

