/**
 * First-party Run insights plugin (crew DES-RUNS-REVIEW-001 §7): every past review of recent work, what got better,
 * its recommendations and what happened to each, the watching list, and trend lines with their interval bands.
 *
 * It only READS (`artifact.read`) and POINTS (`selection.set`, under `selection.chip`). Deciding is the host's
 * (editor-defaults ED-2): pointing at a recommendation lets the host draw Accept / Dismiss in its own chrome. All
 * data arrives through the granted port as content with no ids or paths (ED-3); every string is set as text.
 */

import { announceReady, helloOf, V2Port, PROTOCOL, ENVELOPE, type Envelope } from '../_shared/v2.js';
import surfaces from './surfaces.json';
import type { InsightsView, InsightsViewReview } from '../../editors/insightsAdapter.js';

interface Reply { ok: boolean; payload?: Record<string, unknown>; error?: { code: string; message: string } }

/** The five trend lines the operator asked for, in order. */
export const TREND_METRICS = ['spend', 'pass_rate', 'override_rate', 'wait_on_people', 'unresolved_rate'] as const;
const KIND_WORDS: Record<string, string> = {
  'steering-rule': 'Steering rule',
  memory: 'Memory',
  setting: 'Setting',
  issue: 'Issue to file',
  'resolve-stale': 'Resolve runs',
};
const STATE_WORDS: Record<string, string> = { new: 'New', accepted: 'Accepted', dismissed: 'Dismissed' };

export function formatMetric(unit: string, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 'none';
  if (unit === 'ratio') return `${Math.round(v * 100)}%`;
  if (unit === 'minutes') return v >= 120 ? `${(v / 60).toFixed(1)} h` : `${Math.round(v)} min`;
  if (unit === 'usd') return `$${v.toFixed(2)}`;
  return v.toFixed(v % 1 === 0 ? 0 : 1);
}

const dateWords = (iso: string | number): string =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** One trend line with its interval band; points under the minimum sample are grey and labelled. */
export function trendSvg(points: InsightsView['trends'][number]['points'], unit: string): SVGSVGElement {
  const W = 300, H = 96, PAD = 10, LEFT = 44;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const vals = points.flatMap((p) => [p.value, p.lo, p.hi]).filter((v): v is number => v !== null && Number.isFinite(v));
  if (points.length === 0 || vals.length === 0) return svg;
  const lo = unit === 'ratio' ? 0 : Math.min(...vals), hi = unit === 'ratio' ? 1 : Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i: number): number => (points.length === 1 ? (W + LEFT) / 2 : LEFT + (i * (W - LEFT - PAD)) / (points.length - 1));
  const y = (v: number): number => H - PAD - ((v - lo) / span) * (H - 2 * PAD - 12);
  // The scale, so a flat-looking line is read against its range.
  for (const [v, at] of [[hi, PAD + 2], [lo, H - 2]] as const) {
    const t = s('text', { class: 'axis', x: '0', y: String(at) });
    t.textContent = formatMetric(unit, v);
    svg.append(t);
  }
  const banded = points.map((p, i) => ({ p, i })).filter(({ p }) => p.lo !== null && p.hi !== null);
  if (banded.length > 1) {
    const top = banded.map(({ p, i }) => `${x(i)},${y(p.hi as number)}`);
    const bottom = [...banded].reverse().map(({ p, i }) => `${x(i)},${y(p.lo as number)}`);
    svg.append(s('polygon', { class: 'band', points: [...top, ...bottom].join(' ') }));
  }
  const line = points.map((p, i) => ({ p, i })).filter(({ p }) => p.value !== null);
  if (line.length > 1) svg.append(s('polyline', { class: 'line', points: line.map(({ p, i }) => `${x(i)},${y(p.value as number)}`).join(' ') }));
  for (const { p, i } of line) {
    const c = s('circle', { class: p.small ? 'pt small' : 'pt', cx: String(x(i)), cy: String(y(p.value as number)), r: '3.5', 'data-small': String(p.small) });
    const title = s('title', {});
    title.textContent = `${dateWords(p.at)}: ${formatMetric(unit, p.value)} (n=${p.n})${p.small ? ', too few runs to tell' : ''}`;
    c.append(title);
    svg.append(c);
    if (p.small) {
      const t = s('text', { class: 'lbl', x: String(x(i)), y: String(Math.max(10, y(p.value as number) - 7)), 'text-anchor': 'middle' });
      t.textContent = `n=${p.n}`;
      svg.append(t);
    }
  }
  return svg;
}

export function start(): void {
  const main = h('main', { 'data-testid': 'insights-plugin' });
  document.body.prepend(main);
  let port: MessagePort | null = null;
  let v2: V2Port | null = null;
  let protocol = 1;
  let grants: string[] = [];
  let view: InsightsView | null = null;
  let version = 0;
  let shown = 0; // which review is open (0 = newest)
  let pointed: string | null = null;
  let seq = 0;
  let disposed = false;
  const pending = new Map<string, { resolve: (r: Reply) => void; timer: ReturnType<typeof setTimeout> }>();
  const send = (type: string, payload: unknown): void => port?.postMessage({ p: PROTOCOL, v: ENVELOPE, type, payload });
  const req = (type: string, payload: unknown): Promise<Reply> => new Promise((resolve) => {
    if (port === null || disposed) { resolve({ ok: false, error: { code: 'unavailable', message: 'No host here.' } }); return; }
    const id = `wi-${++seq}`;
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: { code: 'timeout', message: 'The host has not answered.' } }); }, 10000);
    pending.set(id, { resolve, timer });
    port.postMessage({ p: PROTOCOL, v: ENVELOPE, type, id, payload });
  });

  const point = (anchor: string | null): void => {
    pointed = anchor;
    if (grants.includes('selection.chip')) send('selection.set', { anchors: anchor === null ? [] : [{ kind: 'element', id: anchor }] });
    draw();
  };

  function drawReview(rev: InsightsViewReview): HTMLElement {
    const box = h('section', { 'data-testid': 'insights-review', 'aria-label': 'Review' });
    const when = `${dateWords(rev.window.startMs)} to ${dateWords(rev.window.endMs)}`;
    const head = h('div');
    head.append(h('h1', {}, 'Run insights'));
    const runs = rev.totals?.['runs'];
    head.append(h('p', { class: 'lede', 'data-testid': 'insights-summary' },
      rev.status === 'running' ? 'A review is running now.'
        : rev.summary ?? (rev.status === 'completed' ? `Reviewed ${runs ?? 0} runs from ${when}.` : `This review did not finish: ${rev.error ?? rev.status}.`)));
    head.append(h('p', { class: 'note' }, `${when} · ${runs ?? 0} runs · ${rev.trigger === 'schedule' ? 'on its schedule' : 'run by hand'}${rev.interpreted || rev.status !== 'completed' ? '' : ' · not interpreted: the numbers in crew’s own words'}`));
    box.append(head);
    const cols = h('div', { class: 'cols' });
    const better = h('section', { 'data-testid': 'insights-better', 'aria-label': 'What got better' });
    better.append(h('h2', {}, 'What got better'));
    const goods = h('ul', { class: 'plain' });
    if (rev.improvements.length === 0) goods.append(h('li', { class: 'muted' }, rev.status === 'completed' ? 'Nothing changed enough to call it better.' : '—'));
    for (const line of rev.improvements) goods.append(h('li', { class: 'good' }, line));
    better.append(goods);
    cols.append(better);
    const recs = h('section', { 'data-testid': 'insights-recommendations', 'aria-label': 'Recommendations' });
    recs.append(h('h2', {}, 'Recommendations'));
    const list = h('ul', { class: 'plain' });
    if (rev.recommendations.length === 0) list.append(h('li', { class: 'muted' }, rev.status === 'completed' ? 'Nothing to change: no evidence reached the bar.' : '—'));
    for (const r of rev.recommendations) {
      const li = h('li');
      const b = h('button', { type: 'button', class: 'rec', 'data-testid': 'insights-rec', 'data-anchor': r.anchor, 'data-state': r.state, 'aria-pressed': String(pointed === r.anchor) });
      b.append(h('span', { class: 't' }, r.title));
      b.append(h('span', {}, r.line));
      b.append(h('span', { class: 'muted' }, `If done: ${r.expectedEffect}`));
      const row = h('span', { class: 'row' });
      row.append(h('span', { class: 'pill', 'data-state': r.state }, r.state === 'dismissed' && r.reason !== null ? `Dismissed: ${r.reason}` : STATE_WORDS[r.state] ?? r.state));
      row.append(h('span', {}, KIND_WORDS[r.kind] ?? r.kind));
      row.append(h('span', {}, `${r.confidence} confidence · n=${r.n}`));
      b.append(row);
      b.append(h('span', { class: 'muted' }, `Would change our mind: ${r.changeMind}`));
      b.addEventListener('click', () => point(pointed === r.anchor ? null : r.anchor));
      li.append(b);
      list.append(li);
    }
    recs.append(list);
    if (rev.recommendations.some((r) => r.state === 'new')) recs.append(h('p', { class: 'note' }, 'Pick one to accept or dismiss it.'));
    cols.append(recs);
    box.append(cols);
    if (rev.regressions.length > 0 || rev.watching.length > 0) {
      const watch = h('section', { 'data-testid': 'insights-watching', 'aria-label': 'Watching' });
      watch.append(h('h2', {}, 'Watching'));
      const ul = h('ul', { class: 'plain' });
      for (const w of rev.watching) ul.append(h('li', {}, `${w.title}. ${w.line}`));
      for (const line of rev.regressions) if (!rev.recommendations.some((r) => r.line === line)) ul.append(h('li', { class: 'muted' }, line));
      watch.append(ul);
      box.append(watch);
    }
    return box;
  }

  function draw(): void {
    main.replaceChildren();
    if (view === null) { main.append(h('p', { class: 'muted' }, 'Reading the reviews…')); return; }
    if (view.reviews.length === 0) {
      const e = h('div', { class: 'empty', 'data-testid': 'insights-empty' });
      e.append(h('h1', {}, 'Run insights'));
      e.append(h('p', { class: 'lede' }, view.running ? 'The first review is running now.' : 'No review has run yet. The first one runs on its schedule, or start it from Build & settings.'));
      main.append(e);
      return;
    }
    const rev = view.reviews[Math.min(shown, view.reviews.length - 1)] as InsightsViewReview;
    main.append(drawReview(rev));
    const trends = h('section', { 'data-testid': 'insights-trends', 'aria-label': 'Trends' });
    trends.append(h('h2', {}, 'Trends'));
    trends.append(h('p', { class: 'note' }, `Each point is one review: the line is its value, the band its 95% interval. Grey points had fewer than ${view.minSample} runs: too few to tell.`));
    const grid = h('div', { class: 'trends' });
    for (const id of TREND_METRICS) {
      const def = view.metrics.find((m) => m.id === id);
      const series = view.trends.find((t) => t.metric === id);
      if (def === undefined || series === undefined) continue;
      const last = series.points[series.points.length - 1];
      const card = h('div', { class: 'chart', 'data-testid': 'insights-trend', 'data-metric': id });
      card.append(h('div', { class: 't' }, def.label));
      card.append(h('div', { class: 'v' }, last === undefined ? 'No reviews yet' : `${formatMetric(def.unit, last.value)} latest (n=${last.n})${last.small ? ' · too few runs to tell' : ''}`));
      const svg = trendSvg(series.points, def.unit);
      svg.setAttribute('aria-label', `${def.label} across ${series.points.length} reviews`);
      card.append(svg);
      grid.append(card);
    }
    trends.append(grid);
    main.append(trends);
    if (view.reviews.length > 1) {
      const hist = h('section', { class: 'history', 'data-testid': 'insights-history', 'aria-label': 'Earlier reviews' });
      hist.append(h('h2', {}, 'Earlier reviews'));
      const ul = h('ul', { class: 'plain' });
      view.reviews.forEach((r, i) => {
        const b = h('button', { type: 'button', 'data-testid': 'insights-history-row', 'aria-current': String(i === shown) });
        b.append(h('span', {}, `${dateWords(r.launchedAt)} · ${r.status === 'completed' ? `${r.totals?.['runs'] ?? 0} runs` : r.status}`));
        const decided = r.recommendations.filter((x) => x.state !== 'new').length;
        b.append(h('span', { class: 'muted' }, `${r.recommendations.length} recommendations, ${decided} decided`));
        b.addEventListener('click', () => { shown = i; pointed = null; point(null); });
        const li = h('li');
        li.append(b);
        ul.append(li);
      });
      hist.append(ul);
      main.append(hist);
    }
  }

  async function read(): Promise<void> {
    const r = await req('artifact.read', {});
    if (!r.ok || r.payload === undefined) { main.replaceChildren(h('p', { class: 'muted' }, `The reviews could not be read: ${r.error?.message ?? 'no answer'}.`)); return; }
    const content = r.payload['content'] as InsightsView | undefined;
    if (content?.type !== 'run-insights') return;
    view = content;
    version = typeof r.payload['version'] === 'number' ? r.payload['version'] : version;
    draw();
  }

  const applyTheme = (theme: unknown): void => {
    if (typeof theme !== 'object' || theme === null) return;
    for (const [k, v] of Object.entries(theme as Record<string, unknown>)) {
      if (/^--[a-z0-9-]+$/.test(k) && typeof v === 'string' && v.length <= 200 && !/url\(/i.test(v)) document.documentElement.style.setProperty(k, v);
    }
  };

  function dispose(): void {
    disposed = true;
    for (const { timer, resolve } of pending.values()) { clearTimeout(timer); resolve({ ok: false, error: { code: 'unavailable', message: 'Closed.' } }); }
    pending.clear();
    port?.close();
    window.removeEventListener('message', hello);
  }

  function hello(e: MessageEvent): void {
    const d = e.data as Envelope | null;
    if (port !== null || d?.p !== PROTOCOL || d.v !== ENVELOPE || d.type !== 'host.hello' || !e.ports[0]) return;
    const hi = helloOf(d.payload), p = d.payload as Record<string, unknown>;
    protocol = hi.protocol;
    grants = Array.isArray(p['grants']) ? p['grants'].filter((x): x is string => typeof x === 'string') : [];
    applyTheme(p['theme']);
    port = e.ports[0];
    v2 = new V2Port(port, {
      selection(anchors) {
        const a = anchors.find((x) => typeof x === 'object' && x !== null && (x as { kind?: unknown }).kind === 'element') as { id?: unknown } | undefined;
        pointed = typeof a?.id === 'string' ? a.id : null;
        draw();
      },
    });
    port.onmessage = (event: MessageEvent) => {
      const msg = event.data as Envelope | null;
      if (msg?.p !== PROTOCOL || msg.v !== ENVELOPE) return;
      if (typeof msg.re === 'string') {
        const entry = pending.get(msg.re);
        if (entry === undefined) return;
        clearTimeout(entry.timer);
        pending.delete(msg.re);
        entry.resolve({ ok: msg.ok === true, ...(msg.payload !== undefined ? { payload: msg.payload as Record<string, unknown> } : {}), ...(msg.error === undefined ? {} : { error: msg.error }) });
        return;
      }
      if (protocol === 2 && v2?.dispatch(msg)) return;
      const pl = (msg.payload ?? {}) as Record<string, unknown>;
      switch (msg.type) {
        case 'host.ping': if (msg.id) port?.postMessage({ p: PROTOCOL, v: ENVELOPE, re: msg.id, ok: true, payload: {} }); break;
        case 'host.theme': applyTheme(pl['theme']); break;
        case 'artifact.changed': if (typeof pl['head'] !== 'number' || pl['head'] > version) void read(); break;
        case 'selection.cleared': pointed = null; draw(); break;
        case 'host.teardown': dispose(); break;
      }
    };
    port.start();
    draw();
    void read();
  }

  window.addEventListener('message', hello);
  window.addEventListener('pagehide', dispose, { once: true });
  draw();
  announceReady('wicked-insights', surfaces);
}

if (typeof window !== 'undefined' && document.querySelector('meta[name="wicked-editor"][content="wicked-insights"]') !== null) start();
