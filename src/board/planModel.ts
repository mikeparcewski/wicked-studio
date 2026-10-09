/**
 * The team-plan model (DES-TEAMING-002 T9): pure functions over the plan wire. Components render
 * what these return; the rules live here, table-testable, with no React and no fetch.
 *
 *  - the composed selection → the launch plan (`planFromSelection`);
 *  - the launch preview → what to show (`launchPreviewView`), including the X1 rule that a
 *    `pending_pa_scope` preview has NO final score and its floor is only the baseline's;
 *  - the gate posture → the `humanConfirm` token, shifted past the PA's scope step (`humanConfirmFor`);
 *  - a mid-run edit's answer → what happened (`editOutcome`).
 */

import type {
  CatalogEntry,
  EditPlanResponse,
  LaunchPlan,
  PlanPreviewResponse,
  RunTeamResponse,
  TeamPlanStep,
  TeamRow,
} from '../api/teamPlan.js';

/** The PA's read-only scope step (wicked-core X1): ord 1 of a scoped launch. */
export const PA_SCOPE_STEP = 'pa-scope';

// ── Composing a plan ────────────────────────────────────────────────────────────────────────

/** One picked phase, in the operator's order. */
export interface PickedPhase {
  catalog: string;
  /** (studio#617, wicked-core#810) The step's worker pool, when one is set: at most the entry's
   *  pool (a step may only lower it; the engine refuses a raise as `pool_raised`). */
  pool?: number;
}

/**
 * The launch plan for a selection. A step's id defaults to its catalog id; a repeated phase
 * gets `<catalog>-2`, `-3`, … so every step id is unique. `touch` is sent only when non-empty:
 * an empty touch set means "the PA scopes it", which is what omitting it says.
 */
export function planFromSelection(picked: readonly PickedPhase[], touch: readonly string[]): LaunchPlan {
  const seen = new Map<string, number>();
  const steps = picked.map((p) => {
    const n = (seen.get(p.catalog) ?? 0) + 1;
    seen.set(p.catalog, n);
    const step: { catalog: string; id?: string; pool?: number } = n === 1 ? { catalog: p.catalog } : { catalog: p.catalog, id: `${p.catalog}-${n}` };
    if (p.pool !== undefined) step.pool = p.pool;
    return step;
  });
  const cleaned = touch.map((t) => t.trim()).filter((t) => t !== '');
  return cleaned.length > 0 ? { steps, touch: [...new Set(cleaned)] } : { steps };
}

/** The touch field's text → paths (one per line, or comma-separated). */
export function parseTouch(text: string): string[] {
  return text.split(/[\n,]/).map((t) => t.trim()).filter((t) => t !== '');
}

/** The catalog entries a person can pick: every entry, in catalog order (the engine owns it). */
export function pickableEntries(entries: readonly CatalogEntry[]): CatalogEntry[] {
  return [...entries];
}

/** Short marks for an entry, from its catalog fields. */
export function entryMarks(e: CatalogEntry): string[] {
  const marks: string[] = [];
  if (e.executor === 'tool') marks.push('tool');
  if (e.role === 'creator') marks.push('changes code');
  if (e.pinned) marks.push(e.evidence_floor ? 'evidence floor' : 'pinned check');
  if (e.verified_evidence === true) marks.push('acceptance evidence');
  return marks;
}

// ── The launch preview ──────────────────────────────────────────────────────────────────────

export interface PreviewStepView {
  id: string;
  catalog: string;
  /** Drawn as "added by floor" — only ever true on a scored (non-pending) preview. */
  byFloor: boolean;
  floorReason: string | null;
}

export type LaunchPreviewView =
  | {
      kind: 'pending-scope';
      /** The plan's own steps, after the PA's scope step (no floor markers: the floor is the baseline's). */
      steps: PreviewStepView[];
      pauses: boolean;
      pauseText: string;
    }
  | {
      kind: 'scored';
      score: number;
      band: string;
      highRisk: boolean;
      steps: PreviewStepView[];
      floorAdded: PreviewStepView[];
      pauses: boolean;
      pauseText: string;
    };

/** Why the launch pauses, in words. */
export function pauseReasonText(reason: string | null, band: string | null): string {
  switch (reason) {
    case 'manual_mode':
      return 'you approve the plan first (a human gate is set)';
    case 'high_risk':
      return band !== null ? `high risk (band ${band}): the plan needs your approval` : 'high risk: the plan needs your approval';
    case 'override':
      return 'the floor override needs your approval';
    case null:
      return 'the plan needs your approval';
    default:
      return reason;
  }
}

/**
 * What the preview says. A `pending_pa_scope` preview (X1) is NOT a final answer: its score and
 * band are the baseline's and its floor is only the baseline floor, so the view carries neither a
 * score nor floor markers. Its `pauses` is manual mode's alone — an auto launch may still pause
 * once the PA's scope lands high, and the text says so.
 */
export function launchPreviewView(p: PlanPreviewResponse): LaunchPreviewView {
  if (p.graph === 'pending_pa_scope') {
    const steps = p.steps
      .filter((s) => s.id !== PA_SCOPE_STEP)
      .map((s) => ({ id: s.id, catalog: s.catalog, byFloor: false, floorReason: null }));
    return {
      kind: 'pending-scope',
      steps,
      pauses: p.pauses,
      pauseText: p.pauses
        ? `Pauses before any work: ${pauseReasonText(p.pause_reason, null)}.`
        : 'Does not pause now; it pauses if the PA’s scope lands high risk.',
    };
  }
  const steps = p.steps.map(stepView);
  return {
    kind: 'scored',
    score: p.score,
    band: p.band,
    highRisk: p.high_risk,
    steps,
    floorAdded: steps.filter((s) => s.byFloor),
    pauses: p.pauses,
    pauseText: p.pauses
      ? `Pauses before any work: ${pauseReasonText(p.pause_reason, p.band)}.`
      : 'Runs without pausing for plan approval.',
  };
}

function stepView(s: TeamPlanStep): PreviewStepView {
  const byFloor = s.added_by === 'floor';
  return { id: s.id, catalog: s.catalog, byFloor, floorReason: byFloor ? (s.floor_reason ?? null) : null };
}

/**
 * How many units the launch runs before the composer's own numbering starts: 1 when the PA's
 * scope step leads the plan (X1: it is ord 1), else 0. Read off the preview's steps — the order
 * the run's units will have — never guessed from the plan's shape.
 */
export function scopeOffset(p: PlanPreviewResponse | null | undefined): 0 | 1 {
  return p?.steps[0]?.id === PA_SCOPE_STEP ? 1 : 0;
}

// ── The gate posture ────────────────────────────────────────────────────────────────────────

export type PostureMode = 'ask' | 'balanced' | 'autonomous' | undefined;
export type ConfirmChoice = 'none' | 'all' | 'before';

/**
 * The launch's `humanConfirm` token (absent = no run-level gate). `before:<N>` names a unit ord:
 * the composer's N counts the run's own units, so on a scoped launch (the PA's step is ord 1) it
 * is sent as N + 1. The engine accepts only a number here (`HumanConfirm::parse`), not a step id.
 */
export function humanConfirmFor(
  mode: PostureMode,
  confirm: ConfirmChoice,
  beforeOrd: number,
  offset: 0 | 1,
): string | undefined {
  if (mode === 'ask') return 'all';
  if (mode === 'autonomous') return undefined;
  if (confirm === 'all') return 'all';
  if (confirm === 'before') return `before:${beforeOrd + offset}`;
  return undefined;
}

// ── Mid-run edits ───────────────────────────────────────────────────────────────────────────

export type EditOutcome =
  | { kind: 'applied'; proposalId: string; band: string | null; highRisk: boolean | null; floorAdded: string[] }
  | { kind: 'already-applied'; proposalId: string }
  | { kind: 'answered-gate'; status: string };

/** What a `POST /runs/:id/plan` answer means. `duplicate: true` = this edit was already taken. */
export function editOutcome(r: EditPlanResponse): EditOutcome {
  if ('proposal_id' in r) {
    if (r.duplicate) return { kind: 'already-applied', proposalId: r.proposal_id };
    return {
      kind: 'applied',
      proposalId: r.proposal_id,
      band: r.band,
      highRisk: r.high_risk,
      floorAdded: [...r.floor_added],
    };
  }
  return { kind: 'answered-gate', status: r.status };
}

/** A fresh idempotency key for one edit. */
export function newRequestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID();
  return `edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Where a run stands for a mid-run plan edit. */
export type PlanEditAvailability =
  | { show: false }
  | { show: true; editable: true }
  | { show: true; editable: false; reason: string };

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/**
 * Whether the run page offers a mid-run plan edit. Only a planned run (a preset or a user plan,
 * per the daemon's `run_identity`) has a plan to edit, and only while it is live. While the run
 * waits on a human the edit is not offered: at a plan gate the edit would BE the gate's answer,
 * and every gate answer goes through the one gate-decision path (its undo window and `ord`).
 */
export function planEditAvailability(session: { status: string; run_identity?: unknown }): PlanEditAvailability {
  const id = session.run_identity as { kind?: unknown } | undefined;
  const planned = typeof id === 'object' && id !== null && (id.kind === 'preset' || id.kind === 'user_plan');
  if (!planned || TERMINAL.has(session.status)) return { show: false };
  if (session.status === 'awaiting_human') {
    return { show: true, editable: false, reason: 'The run is waiting at a gate: answer the gate first, then add phases.' };
  }
  return { show: true, editable: true };
}

// ── The plan gate (D10 / D11) ───────────────────────────────────────────────────────────────

/** The catalog id of the launch's own deliver step: never authored in a plan edit. */
export const DELIVER_STEP = 'deliver';

/** What the person decides at a `plan_approval` gate, read off `GET /runs/:id/team`. */
export interface PlanGateView {
  gateId: string;
  /** The unit the gate pauses before. */
  ord: number;
  planRev: number;
  band: string;
  highRisk: boolean;
  /** Why the gate opened: `manual_mode`, `high_risk`, `into_high_risk`, `override`. */
  reason: string;
  /** The score behind the band (`path.scored` before the gate); `null` when none was published. */
  score: number | null;
  /** The score's reasons, as the engine wrote them (40-hex commits shortened to 7). */
  reasons: string[];
  /** The phases the floor added to the plan at this rev (`gate.opened.diff.added`). */
  floorAdded: string[];
  /** The held plan's authored phases (catalog ids), for an edit: no `pa-scope`, no deliver step. */
  editSeed: string[];
  /**
   * (studio#617, wicked-core#810) Each {@link editSeed} step's worker pool as the held plan sets it
   * (`plan.proposed.steps[].pool`), aligned with `editSeed`; `null` where the step sets none (it
   * takes its entry's). Optional so a hand-built view reads as "none set".
   */
  editPools?: Array<number | null>;
  /**
   * THE PLAN THIS GATE HOLDS (ship-proof F4): every step of `plan.proposed`, in order — nothing
   * stripped — with the `id` the card shows it under and the `catalog` that says WHAT it is.
   *
   * Distinct from {@link editSeed} on purpose, and the distinction is the defect F4 caught. The
   * edit seed is what the plan EDITOR is filled with, so it strips the two steps an operator cannot
   * author (`pa-scope`, `deliver`) and names them by CATALOG. The gate's consequence line reused it
   * as if it were the plan, and so said "approve runs 6 phases: understand → design → build →
   * review → test → critique" over a plan of `pa-scope → clarify → design → build →
   * adversarial-review → test → review → deliver`: the wrong count, the wrong names, and `deliver`
   * — the only phase with an external side effect — missing from the sentence that gates it.
   *
   * BOTH halves are kept because they answer different questions (codex review of the F4 PR): `id`
   * is what a reader sees on the card, and `catalog` is the identity — whether a step IS the
   * deliver step, and whether a `floorAdded` name (which is a catalog) is already in the plan,
   * cannot be answered from a display name.
   */
  planSteps: PlanGateStep[];
}

/** One step of the plan a gate holds: the name the card shows, and what the step IS. */
export interface PlanGateStep {
  /** The step's own id, else its catalog, else `null` — nothing is invented for a nameless step. */
  id: string | null;
  /** The catalog the step instantiates (`deliver`, `understand`, …), or `null`. */
  catalog: string | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** `str`, but an EMPTY string is an absent value — otherwise `{ id: '', catalog: 'build' }` would
 *  never fall back to its catalog (`?? ` accepts `''`) and the step would end up nameless. */
function nonEmpty(v: unknown): string | null {
  const s = str(v);
  return s === null || s === '' ? null : s;
}

const SHA40 = /\b([0-9a-f]{7})[0-9a-f]{33}\b/g;

/**
 * The OPEN plan gate of a run: the newest `gate.opened{kind:"plan_approval"}` no `gate.decided`
 * answered. `null` when the run is not waiting on its plan (a unit gate, or nothing open).
 */
export function planGateOf(team: RunTeamResponse): PlanGateView | null {
  const all: TeamRow[] = [...(team.rows ?? []), ...(team.units ?? []).flatMap((u) => u.rows ?? [])]
    .sort((a, b) => a.event_id - b.event_id);
  const decided = new Set(
    all.filter((r) => r.event_type === 'wicked.team.gate.decided').map((r) => str(r.payload['gate_id'])),
  );
  const open = all
    .filter((r) => r.event_type === 'wicked.team.gate.opened' && r.payload['kind'] === 'plan_approval')
    .filter((r) => !decided.has(str(r.payload['gate_id'])))
    .pop();
  if (open === undefined) return null;
  const p = open.payload;
  const before = all.filter((r) => r.event_id < open.event_id);
  const scored = before.filter((r) => r.event_type === 'wicked.team.path.scored').pop();
  const proposed = before.filter((r) => r.event_type === 'wicked.team.plan.proposed').pop();
  const diff = p['diff'] as { added?: unknown } | undefined;
  const reasons = Array.isArray(scored?.payload['reasons'])
    ? (scored.payload['reasons'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const steps = Array.isArray(proposed?.payload['steps'])
    ? (proposed.payload['steps'] as Array<{ catalog?: unknown; id?: unknown; pool?: unknown }>)
    : [];
  const authored = steps.filter((st) => st.id !== PA_SCOPE_STEP && st.catalog !== DELIVER_STEP && typeof st.catalog === 'string');
  return {
    gateId: str(p['gate_id']) ?? '',
    ord: typeof p['ord'] === 'number' ? p['ord'] : 0,
    planRev: typeof p['plan_rev'] === 'number' ? p['plan_rev'] : 0,
    band: str(p['band']) ?? '',
    highRisk: p['high_risk'] === true,
    reason: str(p['reason']) ?? '',
    score: typeof scored?.payload['score'] === 'number' ? scored.payload['score'] : null,
    reasons: reasons.map((r) => r.replace(SHA40, '$1')),
    floorAdded: Array.isArray(diff?.added) ? diff.added.filter((x): x is string => typeof x === 'string') : [],
    editSeed: authored.map((st) => st.catalog as string),
    editPools: authored.map((st) => (typeof st.pool === 'number' && Number.isInteger(st.pool) && st.pool >= 1 ? st.pool : null)),
    // Nothing stripped, nothing renamed, NOTHING DROPPED: a step the payload could not name stays
    // in the list as `id: null`, because losing it would make the count disagree with the plan
    // again — which is the whole defect (codex review of the F4 PR, LOW).
    planSteps: steps.map((st) => ({ id: nonEmpty(st.id) ?? nonEmpty(st.catalog), catalog: nonEmpty(st.catalog) })),
  };
}

/** Why the plan gate stopped the run, in words (the gate's `reason`, with its band). */
export function planGateReasonText(v: PlanGateView): string {
  if (v.reason === 'into_high_risk') return `the plan moved into high risk (band ${v.band}): it needs your approval`;
  return pauseReasonText(v.reason === '' ? null : v.reason, v.highRisk ? v.band : null);
}

/** What the floor added and why: a band's floor requires those phases. */
export function floorAddedText(v: PlanGateView): string {
  if (v.floorAdded.length === 0) return 'The floor added nothing to this plan.';
  return `The floor added ${v.floorAdded.join(', ')}: band ${v.band} requires ${v.floorAdded.length === 1 ? 'it' : 'them'}.`;
}

/**
 * A gate prompt with each repeated clause said once: the engine's plan gate prompt reads
 * "(manual mode; band 0-19; manual mode)" — its mode and its reason are both "manual mode".
 */
export function dedupePromptClauses(prompt: string): string {
  return prompt.replace(/\(([^()]*)\)/g, (_m, inner: string) => {
    const seen = new Set<string>();
    const kept = inner.split(';').map((c) => c.trim()).filter((c) => {
      if (c === '' || seen.has(c)) return false;
      seen.add(c);
      return true;
    });
    return `(${kept.join('; ')})`;
  });
}
