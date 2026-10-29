/**
 * wicked-phase-report v0 (program DES-POWER-MODE §8, DES-PLUGIN-EVENTS §4 step 1): the first plugin that OBSERVES
 * events it doesn't own. It speaks `wicked.editor` protocol 3 only: the host hands it the run's event rows on its
 * granted topics (`events.batch`: the replay first, then live), and whether its block is folded (`host.fold`). It
 * asks for nothing and writes nothing: it renders one summary line, and a compact dashboard when unfolded.
 *
 * Its own requests are limited to its own view: `ui.height` (the block's height) and `ui.fold` (a click on its summary
 * asks the host to fold or unfold it; the host decides and answers with `host.fold`).
 */

import { PROTOCOL, ENVELOPE, type Envelope } from '../_shared/v2.js';
import surfaces from './surfaces.json';
import { dashboard, emptyReport, foldRows, openGates, summaryLine, type Report, type Row } from './model.js';

const ID = 'wicked-phase-report';

export function start(): void {
  let port: MessagePort | null = null;
  let folded = true;
  let gap = false;
  const report: Report = emptyReport();
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
      dash.append(now, checks, decisions, helpers, time);
    }
    reportHeight();
  }

  function hello(e: MessageEvent): void {
    const d = e.data as Envelope | null;
    if (port !== null || d?.p !== PROTOCOL || d.v !== ENVELOPE || d.type !== 'host.hello' || !e.ports[0]) return;
    const p = (d.payload ?? {}) as Record<string, unknown>;
    applyTheme(p['theme']);
    port = e.ports[0];
    port.onmessage = (event: MessageEvent) => {
      const msg = event.data as Envelope | null;
      if (msg?.p !== PROTOCOL || msg.v !== ENVELOPE) return;
      const pl = (msg.payload ?? {}) as Record<string, unknown>;
      switch (msg.type) {
        case 'host.ping': if (msg.id) port?.postMessage({ p: PROTOCOL, v: ENVELOPE, re: msg.id, ok: true, payload: {} }); break;
        case 'host.theme': applyTheme(pl['theme']); draw(); break;
        case 'host.fold': folded = pl['folded'] === true; draw(); break;
        case 'events.batch': {
          if (pl['gap'] === 'history-unavailable') gap = true;
          const rows = Array.isArray(pl['rows']) ? (pl['rows'] as Row[]) : [];
          // Any batch means the replay has been read (it always comes first, even when empty).
          const first = !report.loaded;
          report.loaded = true;
          if (foldRows(report, rows) || first) draw();
          break;
        }
        case 'host.teardown': port?.close(); port = null; break;
        default: break;
      }
    };
    port.start();
    draw();
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
