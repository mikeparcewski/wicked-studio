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
  TeamPlanStep,
} from '../api/teamPlan.js';

/** The PA's read-only scope step (wicked-core X1): ord 1 of a scoped launch. */
export const PA_SCOPE_STEP = 'pa-scope';

// ── Composing a plan ────────────────────────────────────────────────────────────────────────

/** One picked phase, in the operator's order. */
export interface PickedPhase {
  catalog: string;
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
    return n === 1 ? { catalog: p.catalog } : { catalog: p.catalog, id: `${p.catalog}-${n}` };
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
