/**
 * wicked-phase-report v0 (program DES-POWER-MODE §8, DES-PLUGIN-EVENTS §4 step 1): the first plugin that OBSERVES
 * events it doesn't own. It speaks `wicked.editor` protocol 3 only: the host hands it the run's event rows on its
 * granted topics (`events.batch`: the replay first, then live), and whether its block is folded (`host.fold`). It
 * asks for nothing and writes nothing: it renders one summary line, and a compact dashboard when unfolded.
 *
 * Its own requests are limited to its own view: `ui.height` (the block's height) and `ui.fold` (a click on its summary
 * asks the host to fold or unfold it; the host decides and answers with `host.fold`).
 *
 * Spike 3: unfolded, the dashboard is followed by the run's WORKING DOCUMENT (`doc.read`). A person edits a section
 * here and saves it with their own click or key: the plugin offers it as `typed` (`doc.propose_edit`), and the host
 * records it as the person's only because the gesture was real. The Decisions lines this plugin writes for answered
 * decisions are offered as `generated`: the host records them as the plugin's own, and they never steer.
 */

import { PROTOCOL, ENVELOPE, type Envelope } from '../_shared/v2.js';
import surfaces from './surfaces.json';
import { dashboard, emptyReport, foldRows, gateWord, openGates, summaryLine, type Report, type Row } from './model.js';
import { SECTION_EFFECT, SECTION_LABELS, SECTIONS, STEER_NOTE, sectionAuthor, trailLines, withDecisionLine, type DocView, type SectionId } from './workingDoc.js';

const ID = 'wicked-phase-report';

export function start(): void {
  let port: MessagePort | null = null;
  let folded = true;
  let gap = false;
  const report: Report = emptyReport();
  // The working document: null until read; `unsupported` when the service keeps none (an older crew).
  let doc: DocView | null = null;
  let docState: 'reading' | 'ready' | 'unsupported' = 'reading';
  interface EditSession { section: SectionId; base: number; opened: string; saving: boolean; conflict: boolean }
  let edit: EditSession | null = null;
  let docLine: { text: string; bad: boolean } | null = null;
  let readSeq = 0;
  let readFailed = false;
  let writes: Promise<void> = Promise.resolve();
  let seq = 0;
  const pending = new Map<string, (r: { ok: boolean; payload?: Record<string, unknown>; error?: { code: string; message: string } }) => void>();
  const ask = (type: string, payload: unknown): Promise<{ ok: boolean; payload?: Record<string, unknown>; error?: { code: string; message: string } }> => {
    if (port === null) return Promise.resolve({ ok: false, error: { code: 'unavailable', message: 'not connected' } });
    seq += 1;
    const id = `r${seq}`;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      port?.postMessage({ p: PROTOCOL, v: ENVELOPE, type, id, payload });
      setTimeout(() => { if (pending.delete(id)) resolve({ ok: false, error: { code: 'timeout', message: 'no answer' } }); }, 25_000);
    });
  };
  const $ = (id: string): HTMLElement => document.getElementById(id)!;
  const send = (type: string, payload: unknown): void => port?.postMessage({ p: PROTOCOL, v: ENVELOPE, type, payload });

  const applyTheme = (theme: unknown): void => {
    if (typeof theme !== 'object' || theme === null) return;
    for (const [k, v] of Object.entries(theme as Record<string, unknown>)) {
      if (/^--[a-z0-9-]+$/.test(k) && typeof v === 'string' && v.length <= 200 && !/url\(/i.test(v)) document.documentElement.style.setProperty(k, v);
    }
  };

  const el = (tag: string, cls: string | null, text?: string): HTMLElement => {
    const e = document.createElement(tag);
    if (cls !== null) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  function tile(label: string, wide = false): HTMLElement {
    const t = el('div', wide ? 'tile wide' : 'tile');
    t.appendChild(el('span', 'label', label));
    return t;
  }

  let lastHeight = 0;
  function reportHeight(): void {
    const h = Math.ceil(document.getElementById('root')?.getBoundingClientRect().height ?? 0);
    if (h > 0 && h !== lastHeight) { lastHeight = h; send('ui.height', { px: h }); }
  }

  function draw(): void {
    const root = $('root');
    root.className = folded ? 'folded' : 'expanded';
    $('sum').setAttribute('aria-expanded', folded ? 'false' : 'true');
    $('sum').title = folded ? 'Show the phase report' : 'Fold the phase report';
    $('sum-text').textContent = summaryLine(report);
    const dot = $('dot');
    dot.className = `dot${report.finished !== null ? (report.finished.outcome === 'completed' ? ' done' : ' bad') : openGates(report).length > 0 ? ' wait' : ''}`;
    const dash = $('dash');
    dash.hidden = folded;
    dash.replaceChildren();
    if (!folded) {
      const d = dashboard(report, Date.now());
      if (gap) dash.appendChild(el('p', 'gap tile wide', 'The job’s earlier events could not be read; this shows what happened since.'));
      const now = tile('Now', true);
      now.append(el('p', 'value', d.now.value), el('p', 'sub', d.now.sub));
      const checks = tile('Checks', true);
      if (d.checks.length === 0) checks.appendChild(el('p', 'sub', 'No checks have run yet.'));
      for (const c of d.checks) {
        const run = el('div', 'run');
        run.appendChild(el('p', 'run-title', c.title));
        const chips = el('div', 'chips');
        for (const x of c.chips) {
          const chip = el('span', `chip ${x.ok ? 'ok' : 'bad'}`, `${x.name} ${x.ok ? '✓' : '✗'}`);
          if (x.reused) chip.appendChild(el('span', 're', 'reused'));
          else if (x.note !== null) chip.appendChild(el('span', 're', x.note));
          chips.appendChild(chip);
        }
        run.appendChild(chips);
        if (c.reused !== null) run.appendChild(el('p', 'sub', c.reused));
        checks.appendChild(run);
      }
      // Power mode: the rigor history (intake, then each change) and, once it starts, the hand-off.
      const rigor = d.rigor !== null ? tile('Rigor history', d.handoff === null) : null;
      if (rigor !== null && d.rigor !== null) {
        if (d.rigor.length === 0) rigor.appendChild(el('p', 'sub', 'Not set yet.'));
        for (const h of d.rigor) {
          const row = el('div', 'rg');
          if (h.arrow !== '') row.appendChild(el('span', 'rg-arrow', h.arrow));
          row.append(el('span', `rg-chip rg-${h.to}`, h.to), el('span', null, h.words));
          rigor.appendChild(row);
        }
      }
      const handoff = d.handoff !== null ? tile('Hand-off') : null;
      if (handoff !== null && d.handoff !== null) {
        const hl = el('ul', 'list');
        for (const s of d.handoff) { const li = el('li', s.status === 'running' || s.status === 'pending' ? 'open' : null); li.append(el('span', null, s.name), el('span', null, s.status)); hl.appendChild(li); }
        handoff.appendChild(hl);
      }
      const decisions = tile('Decisions');
      decisions.appendChild(el('p', 'value', `${d.decisions.open} open · ${d.decisions.answered} answered`));
      const dl = el('ul', 'list');
      if (d.decisions.items.length === 0) dl.appendChild(el('li', null, 'None yet'));
      for (const it of d.decisions.items) {
        const li = el('li', it.open ? 'open' : null);
        li.append(el('span', null, it.text), el('span', null, it.when));
        dl.appendChild(li);
      }
      decisions.appendChild(dl);
      const helpers = tile('Helpers');
      const hl = el('ul', 'list');
      if (d.helpers.length === 0) hl.appendChild(el('li', null, 'None yet'));
      for (const h of d.helpers) { const li = el('li', null); li.append(el('span', null, h.name), el('span', null, h.steps)); hl.appendChild(li); }
      helpers.appendChild(hl);
      const time = tile('Time and cost', true);
      time.append(el('p', 'value', d.time.value), el('p', 'sub', d.time.sub));
      dash.append(now, ...(rigor !== null ? [rigor] : []), ...(handoff !== null ? [handoff] : []), checks, decisions, helpers, time);
    }
    drawDoc();
    reportHeight();
  }

  // ── the working document (spike 3) ─────────────────────────────────────────────────────────────────
  //
  // One editor at a time, as a SESSION: the section, the version it was opened on (the save's base: a refresh never
  // moves it, so a change made meanwhile is a conflict, never an overwrite), the text it opened with, and whether a
  // save is in flight. Reads are numbered and only the newest answer is used. Document writes (a save, the plugin's
  // own Decisions line) run one after another.

  async function readDoc(): Promise<void> {
    readSeq += 1;
    const mine = readSeq;
    const r = await ask('doc.read', {});
    if (mine !== readSeq) return; // a newer read was started: this answer is stale
    if (r.ok && r.payload !== undefined) { doc = r.payload['view'] as DocView; docState = 'ready'; readFailed = false; }
    else if (r.error?.code === 'unsupported' || r.error?.code === 'not_granted') docState = 'unsupported';
    // A failed read keeps what was shown, says so, and offers a retry (the next change frame retries too).
    else readFailed = true;
    drawDoc();
    reportHeight();
  }

  /** Writes run one after another (two would race the same base). */
  function serial<T>(f: () => Promise<T>): Promise<T> {
    const next = writes.then(f, f);
    writes = next.then(() => undefined, () => undefined);
    return next;
  }

  /** A person's save from the open editor session. */
  function saveEdit(session: EditSession, text: string): void {
    if (session.saving) return;
    session.saving = true;
    drawDoc();
    void serial(async () => {
      const r = await ask('doc.propose_edit', { base: session.base, section: session.section, text, origin: 'typed' });
      session.saving = false;
      if (r.ok) {
        const v = r.payload?.['version'];
        docLine = { text: typeof v === 'number' ? `Saved as version ${v}. ${SECTION_EFFECT[session.section]}` : 'Nothing changed.', bad: false };
        // Close it only if it is still this session and nothing was typed while it saved; otherwise keep the newer text
        // as the draft, on the version just made.
        if (edit === session && currentDraft() === text) edit = null;
        else if (edit === session && typeof v === 'number') session.base = v;
      } else if (r.error?.code === 'head_moved') {
        docLine = { text: 'Someone changed the document meanwhile. Your text is kept: check the section’s new text above it, then save again.', bad: true };
        session.conflict = true;
      } else {
        docLine = { text: `Not saved: ${r.error?.message ?? 'no answer'}`, bad: true };
      }
      await readDoc();
      // After a conflict the new head is the base, now that the person can see what changed.
      if (edit === session && session.conflict && doc?.doc != null) session.base = doc.doc.head;
      drawDoc();
      reportHeight();
    });
  }

  /** A decision answered live: the plugin's own line under Decisions, written as itself, once (retried once after a
   *  conflict; it waits for the first read when the document is not read yet). */
  function decisionAnswered(kind: string, at: number): void {
    const d = new Date(at);
    const line = `${gateWord(kind)} · answered ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    void serial(async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (doc === null) await readDoc();
        if (doc === null || doc.doc === null || doc.sections === null) return;
        const next = withDecisionLine(doc.sections.decisions, line);
        if (next === null) return;
        const r = await ask('doc.propose_edit', { base: doc.doc.head, section: 'decisions', text: next, origin: 'generated' });
        await readDoc();
        if (r.ok || r.error?.code !== 'head_moved') return;
      }
    });
  }

  function currentDraft(): string | null {
    const ta = document.querySelector<HTMLTextAreaElement>('#wd textarea');
    return ta === null ? null : ta.value;
  }

  function openEditor(id: SectionId): void {
    if (edit !== null && edit.section !== id) {
      // An unsaved change is never thrown away by a click elsewhere.
      if (currentDraft() !== edit.opened) { docLine = { text: `Save or cancel ${SECTION_LABELS[edit.section]} first.`, bad: true }; drawDoc(); return; }
    }
    const text = doc?.sections?.[id] ?? '';
    edit = { section: id, base: doc?.doc?.head ?? -1, opened: text, saving: false, conflict: false };
    docLine = null;
    drawDoc();
    reportHeight();
    queueMicrotask(() => document.querySelector<HTMLTextAreaElement>('#wd textarea')?.focus());
  }

  function closeEditor(): void { edit = null; docLine = null; drawDoc(); reportHeight(); }

  function drawDoc(): void {
    const box = $('wd');
    box.hidden = folded;
    if (folded) return;
    // The open editor's own text area is kept (its text, caret and focus) and moved into the redrawn section.
    const keep = edit !== null ? box.querySelector<HTMLTextAreaElement>(`textarea[data-section="${edit.section}"]`) : null;
    const hadFocus = keep !== null && document.activeElement === keep;
    const caret = keep !== null ? [keep.selectionStart, keep.selectionEnd] as const : null;
    box.replaceChildren();
    const head = el('div', 'wd-head');
    head.append(el('h3', 'wd-title', 'Working document'));
    if (doc?.doc != null) head.append(el('span', 'wd-ver', `version ${doc.doc.head}`));
    box.append(head, el('p', 'wd-note', STEER_NOTE));
    if (docState === 'unsupported') { box.append(el('p', 'sub', 'This version of studio’s service keeps no working document.')); return; }
    if (readFailed) {
      const p = el('p', 'wd-status bad', 'The working document could not be read just now. ');
      const retry = el('button', 'wd-btn', 'Try again') as HTMLButtonElement;
      retry.type = 'button';
      retry.addEventListener('click', () => { void readDoc(); });
      p.append(retry);
      box.append(p);
    }
    if (docState === 'reading') { box.append(el('p', 'sub', 'Reading the working document…')); return; }
    for (const id of SECTIONS) {
      const sec = el('div', 'wd-sec');
      sec.dataset['section'] = id;
      const h = el('h4', null, SECTION_LABELS[id]);
      const who = doc !== null ? sectionAuthor(doc, id) : null;
      if (who !== null) h.append(el('span', 'wd-who', who));
      sec.append(h);
      const text = doc?.sections?.[id] ?? '';
      const session = edit;
      if (session !== null && session.section === id) {
        // After a conflict, what the section says now, above the person's own text.
        if (session.conflict && text !== session.opened) sec.append(el('p', 'wd-now', `Now: ${text.trim() === '' ? '(empty)' : text}`));
        const ta = keep ?? document.createElement('textarea');
        if (keep === null) {
          ta.className = 'wd-input';
          ta.dataset['section'] = id;
          ta.value = text;
          ta.setAttribute('aria-label', SECTION_LABELS[id]);
          ta.maxLength = 4_000;
          ta.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); if (edit !== null) saveEdit(edit, ta.value); }
            if (ev.key === 'Escape') { ev.preventDefault(); closeEditor(); }
          });
        }
        ta.rows = Math.min(10, Math.max(3, ta.value.split('\n').length + 1));
        const bar = el('div', 'wd-bar');
        const saveBtn = el('button', 'wd-btn primary', session.saving ? 'Saving…' : 'Save') as HTMLButtonElement;
        saveBtn.type = 'button';
        saveBtn.disabled = session.saving;
        saveBtn.addEventListener('click', () => { if (edit !== null) saveEdit(edit, ta.value); });
        const cancel = el('button', 'wd-btn', 'Cancel') as HTMLButtonElement;
        cancel.type = 'button';
        cancel.addEventListener('click', closeEditor);
        bar.append(saveBtn, cancel, el('span', 'wd-effect', SECTION_EFFECT[id]));
        sec.append(ta, bar);
        if (keep !== null && hadFocus) { ta.focus(); if (caret !== null) ta.setSelectionRange(caret[0], caret[1]); }
      } else {
        const t = el('div', `wd-text${text.trim() === '' ? ' empty' : ''}`, text.trim() === '' ? (id === 'goal' && doc?.doc == null ? 'Not started. Edit a section to start the working document.' : 'Nothing yet.') : text);
        t.tabIndex = 0;
        t.setAttribute('role', 'button');
        t.setAttribute('aria-label', `Edit ${SECTION_LABELS[id]}`);
        t.addEventListener('click', () => openEditor(id));
        t.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEditor(id); } });
        sec.append(t);
      }
      box.append(sec);
    }
    if (docLine !== null) {
      const st = el('p', `wd-status${docLine.bad ? ' bad' : ''}`, docLine.text);
      st.setAttribute('role', 'status');
      box.append(st);
    }
    if (doc !== null && doc.trail.length > 0) {
      const ol = el('ol', 'wd-trail');
      ol.setAttribute('aria-label', 'Versions');
      for (const line of trailLines(doc)) ol.append(el('li', null, line));
      box.append(ol);
    }
  }

  function hello(e: MessageEvent): void {
    const d = e.data as Envelope | null;
    if (port !== null || d?.p !== PROTOCOL || d.v !== ENVELOPE || d.type !== 'host.hello' || !e.ports[0]) return;
    const p = (d.payload ?? {}) as Record<string, unknown>;
    applyTheme(p['theme']);
    port = e.ports[0];
    // A height measured before the port existed was never sent: the first one on the port always goes.
    lastHeight = 0;
    port.onmessage = (event: MessageEvent) => {
      const msg = event.data as Envelope | null;
      if (msg?.p !== PROTOCOL || msg.v !== ENVELOPE) return;
      if (typeof msg.re === 'string') {
        const done = pending.get(msg.re);
        if (done !== undefined) {
          pending.delete(msg.re);
          done({ ok: msg.ok === true, ...(msg.payload !== undefined ? { payload: msg.payload as Record<string, unknown> } : {}), ...(msg.error !== undefined ? { error: msg.error } : {}) });
        }
        return;
      }
      const pl = (msg.payload ?? {}) as Record<string, unknown>;
      switch (msg.type) {
        case 'host.ping': if (msg.id) port?.postMessage({ p: PROTOCOL, v: ENVELOPE, re: msg.id, ok: true, payload: {} }); break;
        case undefined: break;
        case 'host.theme': applyTheme(pl['theme']); draw(); break;
        case 'host.fold': folded = pl['folded'] === true; draw(); break;
        case 'events.batch': {
          if (pl['gap'] === 'history-unavailable') gap = true;
          const rows = Array.isArray(pl['rows']) ? (pl['rows'] as Row[]) : [];
          // Any batch means the replay has been read (it always comes first, even when empty).
          const first = !report.loaded;
          report.loaded = true;
          if (foldRows(report, rows) || first) draw();
          // A decision answered while this block is open: the plugin's own line under Decisions (never on replay).
          if (pl['replay'] !== true) {
            for (const row of rows) {
              if (row.topic !== 'wicked.run.session.resumed') continue;
              const gate = report.gates.find((g) => g.ord === row.ord && g.answeredAt === row.at);
              if (gate !== undefined) decisionAnswered(gate.kind, row.at);
            }
          }
          break;
        }
        case 'doc.changed': void readDoc(); break;
        case 'host.teardown': port?.close(); port = null; break;
        default: break;
      }
    };
    port.start();
    draw();
    if (Array.isArray(p['grants']) && (p['grants'] as unknown[]).includes('doc.read')) void readDoc();
    else { docState = 'unsupported'; drawDoc(); }
  }

  $('sum').addEventListener('click', () => send('ui.fold', { folded: !folded }));
  new ResizeObserver(() => reportHeight()).observe(document.body);
  // The elapsed time moves while the job runs.
  setInterval(() => { if (!folded && report.finished === null && report.startedAt !== null) draw(); }, 30_000);
  window.addEventListener('message', hello);
  draw();
  const version = document.querySelector('meta[name="wicked-editor-version"]')?.getAttribute('content') ?? '0.0.0';
  parent.postMessage({ p: PROTOCOL, v: ENVELOPE, type: 'plugin.ready', payload: { editor: ID, version, protocol: [3], surfaces } }, '*');
}

if (typeof window !== 'undefined' && document.querySelector(`meta[name="wicked-editor"][content="${ID}"]`) !== null) start();
