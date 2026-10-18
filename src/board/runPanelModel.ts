import type { SessionView } from '../api/types.js';

/**
 * THE RUN PANEL (one right panel on the run page). The Details panel's Run tab (11 blocks) and the ⋯ session sheet
 * (17 tabs) were two right-side surfaces over the same run; they are one panel now, grouped into six folding sections.
 * Each section names the old tabs it absorbed as its ITEMS (an item id IS the old sheet tab id, so a link that asked
 * the sheet for a tab — ⌘K, `#governance`, a sign-in line — lands on the same content in the panel).
 *
 *  - The section that matters for the run's state opens by default (a plan gate → Plan; a hand-over → Changes; any
 *    other gate → Checks; finished → Changes; failed or stopped → Now, which says why).
 *  - A section with nothing in it yet is one quiet line, closed.
 *  - What the operator opens or closes is remembered per run STATE (this browser): closing Checks on finished runs
 *    keeps it closed on the next finished run, without hiding a gate's section the next time a run waits on them.
 */

export type PanelSectionId = 'now' | 'plan' | 'changes' | 'checks' | 'agents' | 'record';

/** The run's state as the panel reads it: what decides which section opens. */
export type PanelStateKind = 'none' | 'running' | 'gate-plan' | 'gate-deliver' | 'gate' | 'done' | 'failed' | 'stopped';

export interface PanelItem { id: string; label: string }
export interface PanelSection { id: PanelSectionId; label: string; items: readonly PanelItem[] }

export const PANEL_SECTIONS: readonly PanelSection[] = [
  // Status and the next action: what it is doing or waiting on, why it stopped, Stop, the ask itself.
  { id: 'now', label: 'Now', items: [{ id: 'goal', label: 'What you asked' }] },
  { id: 'plan', label: 'Plan and steps', items: [
    { id: 'plan', label: 'Change the plan' },
    { id: 'steps', label: 'Each step and what it did' },
  ] },
  { id: 'changes', label: 'Changes and delivery', items: [
    { id: 'changes', label: 'Changes' },
    { id: 'delivery', label: 'Delivery details' },
    { id: 'files', label: 'Files referenced' },
  ] },
  { id: 'checks', label: 'Checks and evidence', items: [
    { id: 'evidence', label: 'Evidence' },
    { id: 'governance', label: 'Governance' },
    { id: 'steering', label: 'Steering' },
  ] },
  { id: 'agents', label: 'Agents and spend', items: [
    { id: 'helpers', label: 'Helpers and their roles' },
    { id: 'signins', label: 'Sign-ins' },
    { id: 'burn', label: 'Spend over time' },
  ] },
  { id: 'record', label: 'Record', items: [
    { id: 'activity', label: 'Activity' },
    { id: 'decisions', label: 'Decisions' },
    { id: 'assumptions', label: 'Assumptions' },
    { id: 'data', label: 'Data used' },
    { id: 'whatwhere', label: 'What and where' },
  ] },
];

export const PANEL_SECTION_IDS: readonly PanelSectionId[] = PANEL_SECTIONS.map((s) => s.id);

/** Where an old session-sheet tab lives now; unknown tabs land on Now. */
export function panelPlaceOf(tab: string | undefined): { section: PanelSectionId; item: string | null } {
  if (tab === undefined) return { section: 'now', item: null };
  for (const s of PANEL_SECTIONS) {
    if (s.items.some((i) => i.id === tab)) return { section: s.id, item: tab };
  }
  return { section: 'now', item: null };
}

const PLAN_PROMPT = /^\s*Approve plan\b/i;

export function panelStateKind(view: SessionView | undefined, gate: { gateKind?: string | undefined; prompt?: string } | undefined): PanelStateKind {
  if (view === undefined) return 'none';
  const status = view.session.status;
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'stopped';
  if (status !== 'awaiting_human') return 'running';
  if (gate?.gateKind === 'plan_approval' || PLAN_PROMPT.test(gate?.prompt ?? '')) return 'gate-plan';
  if (gate?.gateKind === 'deliver') return 'gate-deliver';
  return 'gate';
}

/** The sections open by default in a state. Now (the status and next action) always is. */
export function defaultOpenSections(kind: PanelStateKind): ReadonlySet<PanelSectionId> {
  switch (kind) {
    case 'running': return new Set(['now', 'plan']);
    case 'gate-plan': return new Set(['now', 'plan']);
    case 'gate-deliver': return new Set(['now', 'changes']);
    case 'gate': return new Set(['now', 'checks']);
    case 'done': return new Set(['now', 'changes']);
    case 'failed':
    case 'stopped':
    case 'none':
      return new Set(['now']);
  }
}

const DONE_UNIT = new Set(['done', 'rejected']);

/** Sections with nothing to show yet — each is one quiet line, closed unless the operator opens it. */
export function quietSections(view: SessionView | undefined): ReadonlySet<PanelSectionId> {
  const out = new Set<PanelSectionId>();
  if (view === undefined) return new Set(PANEL_SECTION_IDS.filter((s) => s !== 'now'));
  const terminal = ['completed', 'failed', 'cancelled'].includes(view.session.status);
  const anyDone = view.units.some((u) => DONE_UNIT.has(u.status));
  const delivery = (view.session as unknown as { delivery?: unknown }).delivery;
  if (view.units.length === 0) out.add('plan');
  if (!anyDone && !terminal && (delivery === undefined || delivery === null || delivery === 'none')) out.add('changes');
  if (!anyDone && !terminal) out.add('checks');
  if (!view.units.some((u) => typeof u.assigned_cli === 'string' && u.assigned_cli !== '')) out.add('agents');
  return out;
}

/** The operator's remembered choices: per state kind, per section, open or closed. */
export type RememberedOpen = Partial<Record<PanelStateKind, Partial<Record<PanelSectionId, boolean>>>>;

/**
 * Is a section open? A section the operator was just sent to (a link, ⌘K) is; else their remembered choice for this
 * state; else the state's default — unless the section is quiet.
 */
export function sectionOpen(section: PanelSectionId, kind: PanelStateKind, remembered: RememberedOpen, quiet: ReadonlySet<PanelSectionId>, focused: PanelSectionId | null = null): boolean {
  if (focused === section) return true;
  const mine = remembered[kind]?.[section];
  if (mine !== undefined) return mine;
  return defaultOpenSections(kind).has(section) && !quiet.has(section);
}

export const RUN_PANEL_KEY = 'studio.runPanel.v1';

const KINDS: readonly PanelStateKind[] = ['none', 'running', 'gate-plan', 'gate-deliver', 'gate', 'done', 'failed', 'stopped'];

/** Parse a stored value, keeping only known kinds, sections and booleans (anything else is dropped). */
export function parseRemembered(raw: string | null): RememberedOpen {
  if (raw === null) return {};
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return {}; }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return {};
  const out: RememberedOpen = {};
  for (const kind of KINDS) {
    const row = (data as Record<string, unknown>)[kind];
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    const kept: Partial<Record<PanelSectionId, boolean>> = {};
    for (const s of PANEL_SECTION_IDS) {
      const v = (row as Record<string, unknown>)[s];
      if (typeof v === 'boolean') kept[s] = v;
    }
    if (Object.keys(kept).length > 0) out[kind] = kept;
  }
  return out;
}
