/**
 * PLUGIN SECTIONS IN THE RUN'S DETAILS PANEL (program DES-LEARN §1.2; operator 2026-10-30: phase plugins move to the
 * right panel as plugin-registered accordion sections, replacing the inline blocks).
 *
 * A run plugin's manifest registers sections with `panels[]`:
 *
 *   { "slot": "run.details", "id": "phase", "title": "{phase}", "instances": "per-phase",
 *     "order": 10, "defaultOpen": "current", "summary": "plugin" }
 *
 *  - `slot`: a closed list: `run.details` (the run page's Details panel) and `voice-dashboard` (a widget on voice mode's
 *    dashboard, lane voice: `voice/widgets.ts` reads its entries through this parser). Anything else is dropped.
 *  - `order` 1-99: Now is 0 and always first; the core sections sit at 20-60 and a plugin cannot move them. A tie with
 *    a core section puts the core one first; plugins tie-break by id, then by the phase's place in the run.
 *  - `instances`: `single`, or `per-phase` (one section per phase a power run has; a run without phases gets one).
 *  - `defaultOpen`: `always` · `never` · `current` (the running phase open, the rest folded; a single section: open
 *    while the run is live) · `while-live` (open until the run ends). What the operator opens or folds wins, per run.
 *  - `summary`: `plugin` = the frame says the folded heading's line (`panel.summary`); else the heading has none.
 *
 * Pure: the manifest parser, the section list for one run, and the per-run memory's parser.
 */

import type { RunPhase } from '../store/runPluginView.js';

export const PANEL_SLOTS = ['run.details', 'voice-dashboard'] as const;
export type PanelSlot = (typeof PANEL_SLOTS)[number];

export interface PanelDecl {
  slot: PanelSlot;
  id: string;
  /** Plain text; `{phase}` is the phase's label. */
  title: string;
  instances: 'single' | 'per-phase';
  order: number;
  defaultOpen: 'always' | 'never' | 'current' | 'while-live';
  summary: 'plugin' | 'none';
}

/** The core sections' places (`runPanelModel.ts` PANEL_SECTIONS, in this order). */
export const CORE_ORDER: Readonly<Record<'now' | 'plan' | 'changes' | 'checks' | 'agents' | 'record', number>> = {
  now: 0, plan: 20, changes: 30, checks: 40, agents: 50, record: 60,
};

const PANEL_ID = /^[a-z][a-z0-9-]{0,31}$/u;
const OPEN = new Set(['always', 'never', 'current', 'while-live']);

/** A manifest's `panels[]`, strictly: a malformed entry is dropped whole, never half-read; ids are unique. */
export function parsePanels(raw: unknown): PanelDecl[] {
  if (!Array.isArray(raw)) return [];
  const out: PanelDecl[] = [];
  for (const p of raw.slice(0, 4)) {
    if (typeof p !== 'object' || p === null || Array.isArray(p)) continue;
    const r = p as Record<string, unknown>;
    if (!(PANEL_SLOTS as readonly unknown[]).includes(r['slot'])) continue;
    if (typeof r['id'] !== 'string' || !PANEL_ID.test(r['id']) || out.some((x) => x.id === r['id'])) continue;
    if (typeof r['title'] !== 'string' || r['title'].trim() === '' || r['title'].length > 40 || /[\r\n<>]/u.test(r['title'])) continue;
    if (!Number.isInteger(r['order'])) continue;
    out.push({
      slot: r['slot'] as PanelSlot,
      id: r['id'],
      title: r['title'].trim(),
      instances: r['instances'] === 'per-phase' ? 'per-phase' : 'single',
      // A plugin can't take 0 (Now) and stays inside the panel's range.
      order: Math.min(99, Math.max(1, r['order'] as number)),
      defaultOpen: OPEN.has(r['defaultOpen'] as string) ? r['defaultOpen'] as PanelDecl['defaultOpen'] : 'never',
      summary: r['summary'] === 'plugin' ? 'plugin' : 'none',
    });
  }
  return out;
}

/** One plugin section on one run's panel. */
export interface PluginSection {
  /** `<pluginId>:<panelId>[:<phase>]`: the pin, the open memory and the thread rows are keyed by it. */
  key: string;
  pluginId: string;
  panel: PanelDecl;
  title: string;
  order: number;
  /** The phase a per-phase instance reports on; null = the whole run. */
  phase: RunPhase | null;
}

/** Each section's key. */
export function sectionKey(pluginId: string, panelId: string, phase: Pick<RunPhase, 'key'> | null): string {
  return `${pluginId}:${panelId}${phase !== null ? `:${phase.key}` : ''}`;
}

/** The plugin sections of one run, in panel order. `phases` = a power build's phases (empty = none). */
export function pluginSections(plugins: ReadonlyArray<{ id: string; title: string; panels: readonly PanelDecl[] }>, phases: readonly RunPhase[]): PluginSection[] {
  const out: Array<PluginSection & { at: number }> = [];
  for (const p of plugins) {
    for (const panel of p.panels) {
      if (panel.slot !== 'run.details') continue;
      const instances: Array<RunPhase | null> = panel.instances === 'per-phase' && phases.length > 0 ? [...phases] : [null];
      instances.forEach((phase, at) => {
        const title = panel.title.includes('{phase}') ? (phase !== null ? panel.title.replace(/\{phase\}/gu, phase.label) : p.title) : panel.title;
        out.push({ key: sectionKey(p.id, panel.id, phase), pluginId: p.id, panel, title, order: panel.order, phase, at });
      });
    }
  }
  return out
    .sort((a, b) => a.order - b.order || (a.pluginId < b.pluginId ? -1 : a.pluginId > b.pluginId ? 1 : 0) || a.at - b.at)
    .map((s) => ({ key: s.key, pluginId: s.pluginId, panel: s.panel, title: s.title, order: s.order, phase: s.phase }));
}

/** Is a section open with nobody's choice yet? `live` = the run has not ended. */
export function defaultOpen(s: Pick<PluginSection, 'panel' | 'phase'>, live: boolean): boolean {
  switch (s.panel.defaultOpen) {
    case 'always': return true;
    case 'never': return false;
    case 'while-live': return live;
    case 'current': return s.phase !== null ? s.phase.current : live;
  }
}

/** Is a section open? Sent there (Show in Details) → open; else the operator's choice for THIS run; else the default. */
export function pluginSectionOpen(s: Pick<PluginSection, 'key' | 'panel' | 'phase'>, live: boolean, mine: boolean | undefined, sent = false): boolean {
  if (sent) return true;
  if (mine !== undefined) return mine;
  return defaultOpen(s, live);
}

/** One panel row: a core section by id, or a plugin section. Pinned plugin sections lead, in their own order. */
export type PanelRow = { kind: 'core'; id: keyof typeof CORE_ORDER } | { kind: 'plugin'; section: PluginSection };

export function panelRows(sections: readonly PluginSection[], pinned: (key: string) => boolean): PanelRow[] {
  const core = (Object.keys(CORE_ORDER) as Array<keyof typeof CORE_ORDER>).map((id) => ({ order: CORE_ORDER[id], row: { kind: 'core', id } as PanelRow, core: true }));
  const plug = sections.filter((s) => !pinned(s.key)).map((s, i) => ({ order: s.order, row: { kind: 'plugin', section: s } as PanelRow, core: false, i }));
  const rest = [...core, ...plug].sort((a, b) => a.order - b.order || Number(b.core) - Number(a.core) || ((a as { i?: number }).i ?? 0) - ((b as { i?: number }).i ?? 0));
  return [...sections.filter((s) => pinned(s.key)).map((s): PanelRow => ({ kind: 'plugin', section: s })), ...rest.map((r) => r.row)];
}

// ── what the operator opened or folded, per run (this browser) ──────────────────────────────────────────

export const PLUGIN_OPEN_KEY = 'studio.runPanel.pluginOpen.v1';
/** The runs remembered: the oldest is forgotten past this. */
export const PLUGIN_OPEN_RUNS = 100;

export type PluginOpenMemory = Record<string, Record<string, boolean>>;

const KEY = /^[a-z0-9-]{1,64}:[a-z0-9-]{1,32}(?::[a-z]{1,16})?$/u;

/** A stored value, keeping only well-formed run ids, section keys and booleans (anything else is dropped). */
export function parsePluginOpen(raw: string | null): PluginOpenMemory {
  if (raw === null) return {};
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return {}; }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return {};
  const out: PluginOpenMemory = {};
  for (const [run, row] of Object.entries(data as Record<string, unknown>).slice(-PLUGIN_OPEN_RUNS)) {
    if (!/^[A-Za-z0-9_-]{1,80}$/u.test(run) || row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    const kept: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) if (KEY.test(k) && typeof v === 'boolean') kept[k] = v;
    if (Object.keys(kept).length > 0) out[run] = kept;
  }
  return out;
}

/** Remember one choice; the run moves to the newest place, and the oldest runs past the cap are forgotten. */
export function rememberPluginOpen(m: PluginOpenMemory, runId: string, key: string, open: boolean): PluginOpenMemory {
  const { [runId]: was, ...rest } = m;
  const next: PluginOpenMemory = { ...rest, [runId]: { ...was, [key]: open } };
  const runs = Object.keys(next);
  if (runs.length <= PLUGIN_OPEN_RUNS) return next;
  const out: PluginOpenMemory = {};
  for (const r of runs.slice(-PLUGIN_OPEN_RUNS)) out[r] = next[r]!;
  return out;
}
