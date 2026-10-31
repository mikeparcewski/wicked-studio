/**
 * THE VOICE DASHBOARD'S WIDGETS (operator 2026-10-31: "users can create, add and remove widgets on the voice
 * dashboard"; mockup learn-and-panels state g).
 *
 * A widget is a PLUGIN that registers one section in the `voice-dashboard` panel slot: the same `panels[]` entry a
 * run plugin uses for `run.details` (lane ui-v3-panels, `board/runPluginPanels.ts`), with this slot's own name:
 *
 *   { "slot": "voice-dashboard", "id": "main", "title": "Machine", "order": 10 }
 *
 * Built-in widgets ship in studio's bundle (their manifests are below; studio draws them). A person makes more with
 * the metric-widget builder: a USER PLUGIN that is only a manifest (no code, nothing framed) naming one field of
 * `GET /system` or `GET /diagnostics` and how to show it (a number, or a chart of its recent readings). Crew keeps
 * the person's layout and their user widgets (`GET|PUT /voice/dashboard`, per actor).
 *
 * Pure: the manifests, the slot parser, the field-path reader and the layout moves.
 */

import type { VoicePanelDecl, VoiceWidgetManifest } from '../api/voice.js';

export const VOICE_SLOT = 'voice-dashboard';

/** The built-in widgets, as manifests: the six the mockup frames the transcript with. */
export type BuiltinWidgetId = 'builtin.load' | 'builtin.health' | 'builtin.helpers' | 'builtin.jobs' | 'builtin.gates' | 'builtin.spend';

export interface BuiltinWidget {
  id: BuiltinWidgetId;
  title: string;
  description: string;
  /** Which side of the transcript it sits on by default (a phone shows them all in one strip). */
  side: 'left' | 'right';
  panels: [VoicePanelDecl];
}

const builtin = (id: BuiltinWidgetId, title: string, description: string, side: 'left' | 'right', order: number): BuiltinWidget => ({
  id, title, description, side, panels: [{ slot: 'voice-dashboard', id: 'main', title, order }],
});

export const BUILTIN_WIDGETS: readonly BuiltinWidget[] = [
  builtin('builtin.load', 'Machine', 'Machine load, with its recent readings', 'left', 10),
  builtin('builtin.health', 'Health', 'How many services are up', 'left', 20),
  builtin('builtin.helpers', 'Helpers', 'Your agents and what each is doing', 'left', 30),
  builtin('builtin.jobs', 'Running jobs', 'Jobs running now and where they are', 'right', 40),
  builtin('builtin.gates', 'Waiting on you', 'Decisions waiting on you; pulses when one arrives', 'right', 50),
  builtin('builtin.spend', 'Today', 'What today cost so far', 'right', 60),
];

export const DEFAULT_LAYOUT: readonly string[] = BUILTIN_WIDGETS.map((w) => w.id);

/** A widget on the dashboard: a built-in, or a user plugin. */
export type DashboardWidget = { kind: 'builtin'; id: string; title: string; description: string; side: 'left' | 'right'; order: number }
  | { kind: 'user'; id: string; title: string; description: string; side: 'left' | 'right'; order: number; manifest: VoiceWidgetManifest };

const PANEL_ID = /^[a-z][a-z0-9-]{0,31}$/u;

/** A manifest's `voice-dashboard` section, strictly (the run-panel parser's rules): malformed → null. */
export function voicePanelOf(raw: unknown): VoicePanelDecl | null {
  if (!Array.isArray(raw)) return null;
  for (const p of raw.slice(0, 4)) {
    if (typeof p !== 'object' || p === null) continue;
    const r = p as Record<string, unknown>;
    if (r['slot'] !== VOICE_SLOT) continue;
    if (typeof r['id'] !== 'string' || !PANEL_ID.test(r['id'])) continue;
    if (typeof r['title'] !== 'string' || r['title'].trim() === '' || r['title'].length > 40 || /[\r\n<>]/u.test(r['title'])) continue;
    if (!Number.isInteger(r['order'])) continue;
    return { slot: VOICE_SLOT, id: r['id'], title: r['title'].trim(), order: Math.min(99, Math.max(1, r['order'] as number)) };
  }
  return null;
}

/** The widgets on the dashboard, in the person's order (unknown ids dropped; nothing saved = the six built-ins). */
export function dashboardWidgets(layout: readonly string[] | null, user: readonly VoiceWidgetManifest[]): DashboardWidget[] {
  const ids = layout ?? DEFAULT_LAYOUT;
  const out: DashboardWidget[] = [];
  ids.forEach((id, i) => {
    const b = BUILTIN_WIDGETS.find((w) => w.id === id);
    if (b !== undefined) { out.push({ kind: 'builtin', id: b.id, title: b.title, description: b.description, side: b.side, order: i }); return; }
    const u = user.find((w) => w.id === id);
    const panel = u !== undefined ? voicePanelOf(u.panels) : null;
    if (u !== undefined && panel !== null) {
      out.push({ kind: 'user', id: u.id, title: panel.title, description: describeMetric(u), side: i % 2 === 0 ? 'left' : 'right', order: i, manifest: u });
    }
  });
  return out;
}

/** Split the dashboard into the transcript's two sides: built-ins keep theirs, user widgets balance them. */
export function sides(widgets: readonly DashboardWidget[]): { left: DashboardWidget[]; right: DashboardWidget[] } {
  const left: DashboardWidget[] = [];
  const right: DashboardWidget[] = [];
  for (const w of widgets) {
    if (w.kind === 'builtin') (w.side === 'left' ? left : right).push(w);
    else (left.length <= right.length ? left : right).push(w);
  }
  return { left, right };
}

// ── Layout moves (each returns the new layout; the caller saves it) ────────────────────────────

export function addWidgets(layout: readonly string[] | null, ids: readonly string[]): string[] {
  const cur = [...(layout ?? DEFAULT_LAYOUT)];
  for (const id of ids) if (!cur.includes(id)) cur.push(id);
  return cur;
}

export function removeWidget(layout: readonly string[] | null, id: string): string[] {
  return (layout ?? DEFAULT_LAYOUT).filter((x) => x !== id);
}

export function moveWidget(layout: readonly string[] | null, id: string, by: -1 | 1): string[] {
  const cur = [...(layout ?? DEFAULT_LAYOUT)];
  const i = cur.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= cur.length) return cur;
  [cur[i], cur[j]] = [cur[j]!, cur[i]!];
  return cur;
}

// ── Field paths: `infra[key=load].details.load1`, `runs.length`, `toReview` ──────────────────────

export const METRIC_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9_.:-]{1,64}\])?(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[[A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9_.:-]{1,64}\])?){0,7}$/u;

/** Read a number at `path` in `doc`: a number, a numeric string, an array's `length`, or a boolean (1/0). Else null. */
export function readMetric(doc: unknown, path: string): number | null {
  if (!METRIC_PATH.test(path)) return null;
  let cur: unknown = doc;
  for (const seg of path.split('.')) {
    const m = /^([A-Za-z0-9_]+)(?:\[([A-Za-z0-9_]+)=([^\]]+)\])?$/u.exec(seg);
    if (m === null) return null;
    const [, name, key, val] = m;
    if (cur === null || typeof cur !== 'object') return null;
    if (name === 'length' && Array.isArray(cur) && key === undefined) { cur = cur.length; continue; }
    if (!Object.prototype.hasOwnProperty.call(cur, name!)) return null;
    cur = (cur as Record<string, unknown>)[name!];
    if (key !== undefined) {
      if (!Array.isArray(cur)) return null;
      cur = cur.find((el) => el !== null && typeof el === 'object' && String((el as Record<string, unknown>)[key]) === val);
    }
  }
  if (typeof cur === 'number' && Number.isFinite(cur)) return cur;
  if (typeof cur === 'boolean') return cur ? 1 : 0;
  if (typeof cur === 'string' && cur.trim() !== '' && Number.isFinite(Number(cur))) return Number(cur);
  return null;
}

/** Every numeric field in `doc` with its path, for the builder's list (bounded; arrays of rows by their key). */
export function metricFields(doc: unknown, max = 200): Array<{ path: string; value: number }> {
  const out: Array<{ path: string; value: number }> = [];
  const KEYS = ['key', 'cli', 'runId', 'name', 'id'];
  const walk = (v: unknown, path: string, depth: number): void => {
    if (out.length >= max || depth > 6) return;
    if (Array.isArray(v)) {
      if (path !== '') out.push({ path: `${path}.length`, value: v.length });
      for (const el of v.slice(0, 30)) {
        if (el === null || typeof el !== 'object') continue;
        const k = KEYS.find((x) => typeof (el as Record<string, unknown>)[x] === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/u.test((el as Record<string, string>)[x]!));
        if (k === undefined) continue;
        const seg = `${path}[${k}=${(el as Record<string, string>)[k]}]`;
        walkObj(el as Record<string, unknown>, seg, depth + 1);
      }
      return;
    }
    if (v !== null && typeof v === 'object') walkObj(v as Record<string, unknown>, path, depth + 1);
    else if (typeof v === 'number' && Number.isFinite(v) && path !== '') out.push({ path, value: v });
  };
  const walkObj = (o: Record<string, unknown>, path: string, depth: number): void => {
    for (const [k, v] of Object.entries(o)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(k)) continue;
      walk(v, path === '' ? k : `${path}.${k}`, depth);
    }
  };
  walk(doc, '', 0);
  return out.filter((f) => METRIC_PATH.test(f.path));
}

/** The metric in words: "Free disk · /system · number". */
export function describeMetric(w: VoiceWidgetManifest): string {
  return `${w.metric.path} · /${w.metric.source} · ${w.metric.display === 'chart' ? 'chart' : 'number'}`;
}

/** A slug for a new user widget id, unique against the ones the person has. */
export function userWidgetId(title: string, taken: readonly string[]): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'metric';
  let id = `user.${base}`;
  for (let n = 2; taken.includes(id); n++) id = `user.${base}-${n}`;
  return id;
}

/** The builder's output: a user plugin manifest for the `voice-dashboard` slot. */
export function makeMetricWidget(o: { title: string; source: 'system' | 'diagnostics'; path: string; display: 'number' | 'chart'; unit?: string; taken: readonly string[] }): VoiceWidgetManifest {
  const title = o.title.trim().replace(/[\r\n<>]/g, '').slice(0, 40);
  const unit = o.unit?.trim().slice(0, 12);
  return {
    id: userWidgetId(title, o.taken),
    title,
    version: 1,
    kind: 'metric',
    panels: [{ slot: 'voice-dashboard', id: 'main', title, order: 70 }],
    metric: { source: o.source, path: o.path, display: o.display, ...(unit !== undefined && unit !== '' ? { unit } : {}) },
    createdAt: new Date().toISOString(),
  };
}

/** A number for a tile: 1 234, 3.4, 12.3k. */
export function formatMetric(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}G`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  if (Number.isInteger(v)) return v.toLocaleString('en-US');
  return v.toFixed(a < 10 ? 2 : 1);
}
