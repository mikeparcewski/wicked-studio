/** First-party video editor: all data and media arrive through the granted port. */
import { announceReady, helloOf, V2Port, PROTOCOL, ENVELOPE, surfaceOfSize, type Envelope, type Mode, type Surface } from '../_shared/v2.js';
import surfaces from './surfaces.json';
import { changedVideoStyle, videoValues, type ChapterOp, type DemoChapter, type DemoCut } from '../../editors/demoCutModel.js';
import { controlValueOk, parseSurfaces } from '../../editors/surfaces.js';

interface Reply { ok: boolean; payload?: Record<string, unknown>; error?: { code: string; message: string } }
const parsed = parseSurfaces(surfaces);
if (!parsed.ok) throw new Error(parsed.reason);
const declaration = parsed.value;
export function start(): void {
  // Static markup only; every artifact string is assigned as text or an input value below.
  document.body.insertAdjacentHTML('afterbegin', `<main id="video-editor" class="video-editor" data-testid="video-editor" tabindex="0">
    <aside id="chapters" class="chapters"><h2>Chapters</h2><ol id="chapter-list"></ol><div id="editor-fields" class="editor-fields"></div><p id="hint" class="hint"></p></aside>
    <section id="work" class="work"><div class="player"><video id="player" data-testid="video-player" playsinline preload="metadata" aria-label="Video"></video><div id="unavailable" class="unavailable">The video isn't available here</div><div id="caption" class="caption"></div></div>
    <div class="transport"><button id="play" data-testid="video-play" type="button">Play</button><span id="count"></span></div><div id="chips" class="chips" aria-label="Chapter chips"></div><div id="timeline" class="timeline" aria-label="Chapter timeline"></div><p id="status" class="status" role="status"></p></section>
    <aside id="inspectors" class="inspectors"><h2>Text</h2><textarea id="say" aria-label="Chapter caption text" readonly></textarea><h2>Theme</h2><p id="theme-summary" class="summary"></p></aside></main>`);
  const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const root = el('video-editor'), list = el('chapter-list'), fields = el('editor-fields');
  const player = el<HTMLVideoElement>('player'), chips = el('chips'), timeline = el('timeline'), caption = el('caption');
  let port: MessagePort | null = null, v2: V2Port | null = null;
  let surface: Surface = 'card', mode: Mode = 'simple', tab = 'chapters', protocol = 1;
  let grants: string[] = [], cut: DemoCut | null = null, selected: string | null = null;
  let seq = 0, busy = false, disposed = false, dragged: string | null = null;
  let mediaUrl: string | null = null, mediaGeneration = 0, readingGeneration = 0, takePreview = false;
  const pending = new Map<string, { resolve: (r: Reply) => void; timer: ReturnType<typeof setTimeout> }>();
  const send = (type: string, payload: unknown): void => port?.postMessage({ p: PROTOCOL, v: ENVELOPE, type, payload });
  const req = (type: string, payload: unknown): Promise<Reply> => new Promise(resolve => {
    if (port === null || disposed) { resolve({ ok: false, error: { code: 'unavailable', message: 'No host here.' } }); return; }
    const id = `wv-${++seq}`;
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: { code: 'timeout', message: 'The host has not answered; check Versions.' } }); }, 10000);
    pending.set(id, { resolve, timer }); port.postMessage({ p: PROTOCOL, v: ENVELOPE, type, id, payload });
  });
  const current = (): DemoChapter | undefined => cut?.chapters.find(c => c.id === selected);
  const chapterAt = (sec: number): DemoChapter | undefined => cut?.chapters.find(c => sec >= c.startSec && (c.durationSec < 0 || sec < c.startSec + c.durationSec));
  const overlayOn = (c: DemoChapter | undefined): boolean => c !== undefined && cut !== null && cut.style.captions.on && (takePreview || !(cut.style.captions.burnIn && cut.ffmpeg?.burnIn));
  const editable = (): boolean => grants.includes('artifact.write') && !busy && !disposed;
  const advanced = (): boolean => surface === 'options' || mode === 'advanced';
  const status = (line: string): void => { el('status').textContent = line; send('ui.status', { line: line.replace(/[\r\n]/g, ' ').slice(0, 120) }); };
  const publish = (): void => { if (protocol === 2 && cut !== null) for (const tab of ['captions', 'theme']) v2?.values(tab, videoValues(cut.style, tab)); };
  const applyTheme = (raw: unknown): void => {
    if (typeof raw !== 'object' || raw === null) return;
    // The host's tokens arrive named as CSS custom properties (`--surface-base`); a value is never a URL.
    for (const [key, value] of Object.entries(raw)) if (typeof value === 'string' && /^--[a-z0-9-]+$/.test(key) && value.length <= 200 && !/url\(/i.test(value)) document.documentElement.style.setProperty(key, value);
  };
  const revoke = (): void => { if (mediaUrl !== null) URL.revokeObjectURL(mediaUrl); mediaUrl = null; player.removeAttribute('src'); };
  async function media(ref: 'video' | { chapter: string } = 'video'): Promise<void> {
    const generation = ++mediaGeneration;
    if (!grants.includes('media.read')) { revoke(); el('unavailable').hidden = false; return; }
    const r = await req('artifact.media', { ref });
    if (disposed || generation !== mediaGeneration) return;
    revoke();
    const blob = r.payload?.['blob'], type = r.payload?.['type'];
    if (!r.ok || !(blob instanceof Blob) || typeof type !== 'string' || !type.startsWith('video/') || typeof URL.createObjectURL !== 'function') { el('unavailable').hidden = false; return; }
    mediaUrl = URL.createObjectURL(blob); player.src = mediaUrl;
    el('unavailable').hidden = true;
    drawCaption();
    player.onloadedmetadata = () => {
      if (!takePreview && cut !== null && Number.isFinite(player.duration)) {
        for (const c of cut.chapters) if (c.durationSec < 0) {
          c.durationSec = Math.max(0, player.duration - c.startSec); c.outSec = c.inSec + c.durationSec;
        }
        draw();
      }
      player.currentTime = takePreview ? current()?.inSec ?? 0 : current()?.startSec ?? 0;
    };
  }
  const button = (text: string, fn: () => void, testid?: string): HTMLButtonElement => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = fn;
    if (testid !== undefined) b.dataset['testid'] = testid;
    return b;
  };
  function go(id: string, point = true): void {
    if (!cut?.chapters.some(c => c.id === id)) return;
    selected = id;
    if (takePreview) { takePreview = false; void media(); }
    player.currentTime = current()?.startSec ?? 0;
    draw();
    if (point && grants.includes('selection.chip')) send('selection.set', { anchors: [{ kind: 'chapter', id }] });
  }
  function move(id: string, delta: number): void {
    const chapters = cut?.chapters ?? [], i = chapters.findIndex(c => c.id === id), to = i + delta;
    if (to < 0 || to >= chapters.length) return;
    const rest = chapters.filter(c => c.id !== id);
    void write({ op: 'chapter-move', chapter: id, after: to === 0 ? null : rest[to - 1]!.id });
  }
  async function read(): Promise<boolean> {
    const generation = ++readingGeneration;
    const r = await req('artifact.read', {});
    if (disposed || generation !== readingGeneration) return false;
    const content = r.payload?.['content'] as DemoCut | undefined;
    if (!r.ok || content?.type !== 'demo-cut' || !Array.isArray(content.chapters)) { status(r.error?.message ?? 'No cut is available here.'); return false; }
    if (cut !== null && content.version < cut.version) return false;
    const oldVersion = cut?.version;
    cut = content;
    if (oldVersion !== cut.version) takePreview = false;
    if (!cut.chapters.some(c => c.id === selected)) selected = cut.chapters[0]?.id ?? null;
    draw(); publish();
    if (surface !== 'options' && oldVersion !== cut.version) void media();
    return true;
  }
  async function write(op: ChapterOp, base = cut?.version): Promise<void> {
    if (!editable() || cut === null || base === undefined) return;
    busy = true; draw();
    try {
      const r = await req('version.write', { base, ops: [op], summary: `chapter ${cut.chapters.findIndex(c => c.id === op.chapter) + 1}` });
      if (r.ok) { await read(); if (op.op === 'chapter-take' && surface !== 'options') { takePreview = true; void media({ chapter: op.chapter }); } }
      else { status(r.error?.message ?? 'The chapter could not be saved.'); if (r.error?.code === 'head_moved') await read(); }
    } finally { busy = false; draw(); }
  }
  function rename(c: DemoChapter): void {
    if (!editable() || cut === null) return;
    const base = cut.version;
    const input = document.createElement('input'); input.value = c.title; input.maxLength = 80; input.setAttribute('aria-label', 'Chapter title'); input.dataset['testid'] = 'video-rename-input';
    fields.prepend(input); input.focus(); input.select();
    input.onkeydown = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); draw(); }
      else if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        if (input.value.trim() && !/[\r\n]/.test(input.value) && input.value !== c.title) void write({ op: 'chapter-rename', chapter: c.id, title: input.value }, base);
        else draw();
      }
    };
  }
  function drawCaption(): void {
    if (cut === null) return;
    const style = cut.style, c = current();
    caption.hidden = !overlayOn(c);
    caption.dataset['position'] = style.captions.position; caption.dataset['look'] = style.captions.style;
    const lines: string[] = []; let line = '';
    for (const word of (c?.say ?? '').split(/\s+/)) {
      if (line && (line + ' ' + word).length > style.captions.wrapChars) { lines.push(line); line = word; } else line += (line ? ' ' : '') + word;
    }
    if (line) lines.push(line);
    caption.textContent = lines.slice(0, style.captions.maxLines).join('\n');
    // E1's size is px at 1080p: at the player's width W that is size × W / 1920, i.e. size / 19.2 cqw.
    caption.style.fontSize = `max(9px, ${style.captions.size / 19.2}cqw)`;
    caption.style.maxHeight = `${style.captions.maxLines * 1.3 + 0.8}em`;
    const vars = { background: style.theme.background, foreground: style.theme.foreground, accent: style.theme.accent, font: style.theme.font };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--video-${k}`, v);
  }
  function trimHandle(c: DemoChapter, edge: 'in' | 'out'): HTMLButtonElement {
    const handle = button('', () => undefined, `video-trim-${edge}`); handle.className = 'trim-handle'; handle.dataset['edge'] = edge;
    handle.setAttribute('role', 'slider'); handle.setAttribute('aria-label', `${edge === 'in' ? 'In' : 'Out'} trim`);
    const duration = cut?.takes[c.id]?.find(t => t.file === c.take)?.durationSec ?? c.outSec;
    handle.setAttribute('aria-valuemin', '0'); handle.setAttribute('aria-valuemax', String(duration)); handle.setAttribute('aria-valuenow', String(edge === 'in' ? c.inSec : c.outSec));
    handle.disabled = !editable();
    handle.onpointerdown = e => {
      if (!editable() || cut === null) return;
      e.preventDefault(); e.stopPropagation();
      const base = cut.version, x = e.clientX, width = handle.parentElement!.getBoundingClientRect().width || 1;
      let inSec = c.inSec, outSec = c.outSec;
      const update = (clientX: number): void => {
        const delta = (clientX - x) / width * c.durationSec;
        if (edge === 'in') inSec = Math.max(0, Math.min(c.outSec - 0.5, c.inSec + delta));
        else outSec = Math.max(c.inSec + 0.5, Math.min(duration, c.outSec + delta));
        handle.setAttribute('aria-valuenow', (edge === 'in' ? inSec : outSec).toFixed(2));
        const input = fields.querySelector<HTMLInputElement>(`[data-testid="video-${edge}"]`); if (input) input.value = (edge === 'in' ? inSec : outSec).toFixed(2);
      };
      const drag = (m: PointerEvent): void => update(m.clientX);
      const end = (m: PointerEvent): void => { update(m.clientX); clean(); if (inSec !== c.inSec || outSec !== c.outSec) void write({ op: 'chapter-trim', chapter: c.id, inSec, outSec }, base); };
      const clean = (): void => { window.removeEventListener('pointermove', drag); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel); };
      const cancel = (): void => { clean(); draw(); };
      window.addEventListener('pointermove', drag); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel, { once: true });
    };
    handle.onkeydown = e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); const delta = e.key === 'ArrowLeft' ? -0.1 : 0.1;
      const inSec = edge === 'in' ? Math.max(0, Math.min(c.outSec - 0.5, c.inSec + delta)) : c.inSec;
      const outSec = edge === 'out' ? Math.max(c.inSec + 0.5, Math.min(duration, c.outSec + delta)) : c.outSec;
      if (inSec !== c.inSec || outSec !== c.outSec) void write({ op: 'chapter-trim', chapter: c.id, inSec, outSec });
    };
    return handle;
  }
  function draw(): void {
    const active = document.activeElement as HTMLElement | null;
    const focusedChapter = active?.dataset['chapter'];
    const focusedControl = active?.dataset['testid'];
    root.dataset['surface'] = surface; root.dataset['mode'] = mode; root.dataset['head'] = String(cut?.version ?? 0); root.dataset['current'] = selected ?? '';
    el('chapters').hidden = surface === 'card' || (surface === 'options' && tab !== 'chapters');
    el('work').hidden = surface === 'options'; el('inspectors').hidden = surface !== 'full' || mode !== 'advanced';
    timeline.hidden = surface !== 'full'; chips.hidden = surface !== 'card';
    list.replaceChildren(); chips.replaceChildren(); timeline.replaceChildren(); fields.replaceChildren();
    if (cut === null) return;
    cut.chapters.forEach((c, i) => {
      const row = document.createElement('li');
      const b = button('', () => go(c.id), 'video-chapter'); b.className = 'chapter'; b.dataset['chapter'] = c.id;
      const n = document.createElement('span'); n.className = 'number'; n.textContent = String(i + 1);
      const title = document.createElement('span'); title.textContent = c.title;
      const duration = document.createElement('span'); duration.className = 'duration'; duration.textContent = c.durationSec < 0 ? '—' : `${c.durationSec.toFixed(1)}s`;
      b.append(n, title, duration); b.setAttribute('aria-current', String(c.id === selected)); b.setAttribute('aria-label', `Chapter ${i + 1}: ${c.title}`);
      b.ondblclick = () => { if (advanced()) rename(c); };
      row.draggable = advanced() && editable();
      row.ondragstart = e => { dragged = c.id; e.dataTransfer?.setData('text/plain', c.id); };
      row.ondragover = e => { if (advanced() && editable()) e.preventDefault(); };
      row.ondrop = e => {
        e.preventDefault(); if (dragged === null || dragged === c.id || !advanced()) return;
        const rest = cut!.chapters.filter(x => x.id !== dragged), at = rest.findIndex(x => x.id === c.id);
        const rect = row.getBoundingClientRect();
        const after = e.clientY >= rect.top + rect.height / 2 ? c.id : at === 0 ? null : rest[at - 1]!.id;
        void write({ op: 'chapter-move', chapter: dragged, after }); dragged = null;
      };
      row.ondragend = () => { dragged = null; };
      row.append(b); list.append(row);
      const chip = button(`${i + 1} · ${c.title}`, () => go(c.id), 'video-chip'); chip.className = 'chip'; chip.setAttribute('aria-current', String(c.id === selected)); chips.append(chip);
      const segment = document.createElement('div'); segment.className = 'segment-box'; segment.style.flex = String(c.durationSec < 0 ? 1 : c.durationSec);
      const seg = button(`${i + 1} · ${c.title}`, () => go(c.id), 'video-segment'); seg.className = 'segment'; seg.setAttribute('aria-current', String(c.id === selected)); segment.append(seg);
      if (mode === 'advanced' && c.id === selected) segment.append(trimHandle(c, 'in'), trimHandle(c, 'out'));
      timeline.append(segment);
    });
    const c = current();
    el('hint').textContent = c === undefined ? '' : "Re-record this chapter: the host's button";
    el('count').textContent = c === undefined ? 'No chapters' : `${cut.chapters.findIndex(x => x.id === c.id) + 1} of ${cut.chapters.length}`;
    el<HTMLTextAreaElement>('say').value = c?.say ?? '';
    const t = cut.style.theme;
    el('theme-summary').textContent = `${t.font}\nBackground ${t.background}\nText ${t.foreground}\nAccent ${t.accent}\nTitle card: ${t.titleCard.on ? t.titleCard.title : 'Off'}\nEnd card: ${t.endCard.on ? t.endCard.title : 'Off'}`;
    drawCaption();
    if (focusedChapter !== undefined) list.querySelector<HTMLElement>(`[data-chapter="${focusedChapter}"]`)?.focus();
    if (!advanced() || surface === 'card' || c === undefined) return;
    const buttons = document.createElement('div'); buttons.className = 'buttons';
    const renameBtn = button('Rename', () => rename(c), 'video-rename'), up = button('Move up', () => move(c.id, -1), 'video-move-up'), down = button('Move down', () => move(c.id, 1), 'video-move-down');
    renameBtn.disabled = !editable(); up.disabled = !editable() || cut.chapters[0]?.id === c.id; down.disabled = !editable() || cut.chapters.at(-1)?.id === c.id;
    buttons.append(renameBtn, up, down); fields.append(buttons);
    const base = cut.version, trim = document.createElement('div'); trim.className = 'trim-fields';
    const input = (text: string, value: number, id: string): HTMLInputElement => {
      const label = document.createElement('label'); label.textContent = text;
      const node = document.createElement('input'); node.type = 'number'; node.step = '0.1'; node.min = '0'; node.value = String(value); node.dataset['testid'] = id; node.setAttribute('aria-label', text); node.disabled = !editable();
      node.max = String(cut!.takes[c.id]?.find(t => t.file === c.take)?.durationSec ?? c.outSec); label.append(node); trim.append(label); return node;
    };
    const inInput = input('In (seconds)', c.inSec, 'video-in'), outInput = input('Out (seconds)', c.outSec, 'video-out');
    const save = (): void => {
      const inSec = inInput.valueAsNumber, outSec = outInput.valueAsNumber;
      if (inSec === c.inSec && outSec === c.outSec) return;
      if (!Number.isFinite(inSec) || !Number.isFinite(outSec) || inSec < 0 || outSec - inSec < 0.5 || outSec > Number(outInput.max)) { status('Keep at least 0.5 seconds within this take.'); return; }
      void write({ op: 'chapter-trim', chapter: c.id, inSec, outSec }, base);
    };
    inInput.onchange = save; outInput.onchange = save; fields.append(trim);
    const takes = cut.takes[c.id] ?? [];
    if (takes.length > 1) {
      const label = document.createElement('label'); label.textContent = 'Take';
      const select = document.createElement('select'); select.setAttribute('aria-label', 'Take'); select.dataset['testid'] = 'video-take'; select.disabled = !editable();
      takes.forEach((t, i) => { const o = document.createElement('option'); o.value = t.file; o.textContent = `Take ${i + 1} · ${t.durationSec.toFixed(1)}s`; select.append(o); });
      select.value = c.take; select.onchange = () => { if (select.value !== c.take) void write({ op: 'chapter-take', chapter: c.id, take: select.value }, base); }; label.append(select); fields.append(label);
      if (surface !== 'options') fields.append(button('Preview take', () => { takePreview = true; void media({ chapter: c.id }); }, 'video-preview-take'));
    }
    if (focusedControl !== undefined && !focusedControl.includes('rename-input')) {
      const focus = root.querySelector<HTMLElement>(`[data-testid="${focusedControl}"]`);
      if (focus && !(focus as HTMLButtonElement).disabled && !focus.closest('[hidden]')) focus.focus();
    }
  }
  async function optionsChanged(tab: string, id: string, value: unknown) {
    const control = declaration.options?.tabs.find(t => t.id === tab)?.controls?.find(c => c.id === id);
    if (cut === null || control === undefined || !controlValueOk(control, value) || !grants.includes('artifact.theme') || (typeof value === 'string' && /[\r\n]/.test(value))) return { applied: false, values: cut === null ? {} : videoValues(cut.style, tab), reason: 'That style change is not available.' };
    if (busy) return { applied: false, values: videoValues(cut.style, tab), reason: 'A cut is being saved.' };
    busy = true; draw();
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const style = changedVideoStyle(cut.style, tab, id, value);
        const r = await req('theme.set', { base: cut.version, tokens: { kind: 'video-style', style } });
        if (r.ok) { const confirmed = await read(); return { applied: confirmed, values: videoValues(cut.style, tab), ...(confirmed ? {} : { reason: 'The saved style could not be read.' }) }; }
        if (r.error?.code === 'head_moved' && attempt === 0 && await read()) continue;
        publish(); return { applied: false, values: videoValues(cut.style, tab), reason: r.error?.message ?? 'Style was not changed.' };
      }
      return { applied: false, values: videoValues(cut.style, tab) };
    } finally { busy = false; draw(); }
  }
  const playing = (): void => { el('play').textContent = player.paused ? 'Play' : 'Pause'; };
  player.onplay = playing; player.onpause = playing;
  el('play').onclick = () => { if (mediaUrl === null) return; if (player.paused) void player.play().catch(() => status("The video isn't available here")); else player.pause(); };
  player.onerror = () => { el('unavailable').hidden = false; };
  player.ontimeupdate = () => {
    if (cut === null || takePreview) return;
    const c = chapterAt(player.currentTime);
    if (c !== undefined && c.id !== selected) { selected = c.id; draw(); }
    caption.hidden = !overlayOn(c);
  };
  root.onkeydown = e => {
    const target = e.target as HTMLElement;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); send('ui.key', { key: 'Mod+K' }); return; }
    if (target.closest('input,textarea,select')) return;
    if (e.key === 'Escape') { e.preventDefault(); send('ui.key', { key: 'Escape' }); return; }
    if (e.key === 'Tab') {
      const ring = Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea')).filter(n => !n.closest('[hidden]'));
      const at = ring.indexOf(document.activeElement as HTMLElement), next = at + (e.shiftKey ? -1 : 1);
      if (next < 0 || next >= ring.length) { e.preventDefault(); send('ui.key', { key: e.shiftKey ? 'Shift+Tab' : 'Tab' }); }
      return;
    }
    if (e.altKey && !mod && ['ArrowUp', 'ArrowDown'].includes(e.key) && advanced() && selected !== null) { e.preventDefault(); move(selected, e.key === 'ArrowUp' ? -1 : 1); return; }
    if (mod || e.altKey) return;
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && cut !== null) {
      e.preventDefault(); const at = cut.chapters.findIndex(c => c.id === selected);
      const i = e.key === 'Home' ? 0 : e.key === 'End' ? cut.chapters.length - 1 : Math.max(0, Math.min(cut.chapters.length - 1, at + (e.key === 'ArrowRight' ? 1 : -1)));
      const c = cut.chapters[i]; if (c) go(c.id); return;
    }
    if (target.closest('button') && [' ', 'Enter'].includes(e.key)) return;
    if (e.key.length === 1) { e.preventDefault(); send('ui.typed', { grapheme: e.key }); }
  };
  function dispose(): void {
    disposed = true; ++mediaGeneration; ++readingGeneration; revoke();
    for (const { timer, resolve } of pending.values()) { clearTimeout(timer); resolve({ ok: false, error: { code: 'unavailable', message: 'Editor closed.' } }); }
    pending.clear(); port?.close(); window.removeEventListener('message', hello);
  }
  function hello(e: MessageEvent): void {
    const d = e.data as Envelope | null;
    if (port !== null || d?.p !== PROTOCOL || d.v !== ENVELOPE || d.type !== 'host.hello' || !e.ports[0]) return;
    const h = helloOf(d.payload), p = d.payload as Record<string, unknown>;
    surface = h.surface; mode = h.mode ?? 'simple'; tab = h.tab ?? 'chapters'; protocol = h.protocol;
    grants = Array.isArray(p['grants']) ? p['grants'].filter((x): x is string => typeof x === 'string') : [];
    applyTheme(p['theme']); port = e.ports[0];
    v2 = new V2Port(port, {
      surface(s, m) { const was = surface; surface = s; if (m !== null) mode = m; draw(); if (was === 'options' && s !== 'options') void media(); },
      mode(m) { mode = m; draw(); return mode; },
      action(id) {
        if (!['next', 'prev'].includes(id) || cut === null || cut.chapters.length === 0) return { handled: false };
        const at = cut.chapters.findIndex(c => c.id === selected), next = Math.max(0, Math.min(cut.chapters.length - 1, at + (id === 'next' ? 1 : -1)));
        const c = cut.chapters[next]!; go(c.id);
        return { handled: true, status: `Chapter ${next + 1} of ${cut.chapters.length} · ${c.title}` };
      },
      tab(t) { tab = t; draw(); },
      selection(anchors) { const a = anchors.find(x => typeof x === 'object' && x !== null && (x as { kind: unknown }).kind === 'chapter') as { id?: unknown } | undefined; if (typeof a?.id === 'string') go(a.id, false); },
      optionsChanged,
    });
    port.onmessage = (event: MessageEvent) => {
      const msg = event.data as Envelope | null;
      if (msg?.p !== PROTOCOL || msg.v !== ENVELOPE) return;
      if (typeof msg.re === 'string') {
        const entry = pending.get(msg.re); if (entry === undefined) return;
        clearTimeout(entry.timer); pending.delete(msg.re); entry.resolve({ ok: msg.ok === true, ...(msg.payload !== undefined ? { payload: msg.payload as Record<string, unknown> } : {}), ...(msg.error === undefined ? {} : { error: msg.error }) }); return;
      }
      if (protocol === 2 && v2?.dispatch(msg)) return;
      const p = (msg.payload ?? {}) as Record<string, unknown>;
      switch (msg.type) {
        case 'host.ping': if (msg.id) port?.postMessage({ p: PROTOCOL, v: ENVELOPE, re: msg.id, ok: true, payload: {} }); break;
        case 'host.size': if (p['size'] === 'inline' || p['size'] === 'pane' || p['size'] === 'full') { surface = surfaceOfSize(p['size']); draw(); } break;
        case 'host.theme': applyTheme(p['theme']); break;
        case 'artifact.changed': if (typeof p['head'] !== 'number' || cut === null || p['head'] > cut.version) void read(); break;
        case 'host.teardown': dispose(); break;
        case 'selection.cleared': selected = null; draw(); break;
      }
    };
    port.start(); draw(); void read();
  }
  window.addEventListener('message', hello); window.addEventListener('pagehide', dispose, { once: true });
  draw(); announceReady('wicked-video', surfaces);
}
start();
