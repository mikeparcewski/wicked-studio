import type { SessionView } from '../api/types.js';
import { distinctLabels, planStepLabel, stepLabelOf, type ChainModel } from './chainModel.js';
import { draftSteps, type DraftStep, type GateDraft } from './planDraft.js';
import { DELIVER_STEP, PA_SCOPE_STEP, type PlanGateView } from './planModel.js';

/**
 * THE ORDERED PLAN EDITOR (DES-STUDIO-REBUILD-001 §5.7, §11 S10; §6 Q-R5: order only — no lanes, no
 * time axis, no "done when"). A plan is the engine's linear `steps[]`, so the editor is a list that
 * can be put in another order where the engine takes one:
 *
 *  - At a `plan_approval` gate the whole plan is the gate's answer, so a new order is a gate-amend
 *    DRAFT on the card ("Approve with these changes"), like a `/` command's added step (S7). Steps
 *    the engine will not let move stay where they are and say why: the lead helper's scope step
 *    (first), hand-over (last), a step that has run already (the ratchet: nothing is reordered past
 *    a done step, DES-TEAMING-002 §8.5), and a step the floor added for this risk.
 *  - Mid-run (no plan gate) the plan only grows (§8.7): its order is set, and the editor says so.
 *    A step can still be added — through the same 10 s undo window as `/` (S7).
 *
 * Everything here is pure; the component renders it.
 */

/** Why a step stays where it is (`null` = it can move). */
export type Fixed = 'scope' | 'deliver' | 'done' | 'floor' | 'set';

/** Each reads after "it": "Build stays where it is: it has run already." */
export const FIXED_WORD: Readonly<Record<Fixed, string>> = {
  scope: 'is the lead helper’s scope step, which comes first',
  deliver: 'is the hand-over, which comes last and always asks you',
  done: 'has run already',
  floor: 'is required for this risk — the floor put it here',
  set: 'is set: a running plan only grows',
};

export interface OrderRow {
  /** A key that follows the step through moves: the draft step's id (mid-run: `<catalog>#<n>`). */
  key: string;
  catalog: string;
  label: string;
  fixed: Fixed | null;
  /** Added at this gate (a `/` command or the editor's Add): part of the draft. */
  added: boolean;
  /** The row's index in the editable list; `null` for the fixed ends and every mid-run row. */
  index: number | null;
}

/** What the engine's ratchet and floor fix at this gate — and the words its steps go by. */
export interface OrderContext {
  /** The authored steps (no scope, no deliver) that have run already: the first `progressed`. */
  progressed: number;
  /** Catalogs the floor added at this rev: fixed where the floor put them. */
  floor: ReadonlySet<string>;
  /** The held plan opens with the lead helper's scope step / closes with hand-over. */
  scope: boolean;
  deliver: boolean;
  /** Each seed step's word, by its draft key (studio#574: {@link planStepWords}). */
  words: ReadonlyMap<string, string>;
}

/**
 * studio#574: the editor's words for a plan's authored steps, keyed as the draft keys them
 * (`<catalog>#<n>` — the n-th seed step of that catalog, `planDraft.ts`'s rule), each step named as
 * the chain names it: its ID's word (Clarify, Challenge), else its catalog's block word, distinct
 * across the plan ("Critique" / "Review", never "Review" twice). The editor list was naming steps by
 * catalog alone — "Research" for `clarify`, "Review" for `adversarial-review` — so one plan read in
 * two vocabularies on one card. From the gate's `planSteps` (`{id, catalog}`) or from chain steps
 * (which bring their label). The scope step and the hand-over are not seed steps, so they take no
 * key; a step with no catalog cannot be keyed and is skipped.
 */
export function planStepWords(steps: readonly { id: string | null; catalog: string | null; label?: string }[]): ReadonlyMap<string, string> {
  // A step with no catalog cannot be keyed, so it is out before the distinct pass as well: it must
  // not turn the keyed `review#1` into "Review 2" (codex r1).
  const named = distinctLabels(steps
    .filter((s): s is { id: string | null; catalog: string; label?: string } => s.catalog !== null)
    .map((s) => ({ id: s.id ?? s.catalog, catalog: s.catalog, label: s.label ?? planStepLabel(s.id, s.catalog) })));
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const s of named) {
    if (s.id === PA_SCOPE_STEP || s.catalog === DELIVER_STEP) continue;
    const n = (seen.get(s.catalog) ?? 0) + 1;
    seen.set(s.catalog, n);
    out.set(`${s.catalog}#${n}`, s.label);
  }
  return out;
}

/** A draft step's word: the plan's word for that seed step, else (an added step, or no plan) its
 *  catalog's word. */
export function stepWord(s: Pick<DraftStep, 'id' | 'catalog'>, words: ReadonlyMap<string, string> | undefined): string {
  return words?.get(s.id) ?? stepLabelOf(s.catalog);
}

/**
 * The context from the gate: it pauses before unit `ord`, and a unit is one plan step in order, so
 * the first `ord - 1` steps of the held plan have run (the scope step among them when the plan has
 * one). `floorAdded` names what the floor put in at this rev.
 */
export function orderContext(gate: Pick<PlanGateView, 'ord' | 'floorAdded' | 'planSteps'>): OrderContext {
  const scope = gate.planSteps[0]?.id === PA_SCOPE_STEP;
  const deliver = gate.planSteps.some((s) => s.catalog === DELIVER_STEP);
  const ran = Math.max(0, gate.ord - 1);
  return { progressed: Math.max(0, ran - (scope ? 1 : 0)), floor: new Set(gate.floorAdded), scope, deliver, words: planStepWords(gate.planSteps) };
}

/** Why the i-th editable step cannot move (`null` = it can). An added step is never fixed. */
export function fixedAt(steps: readonly DraftStep[], i: number, ctx: OrderContext): Fixed | null {
  const s = steps[i];
  if (s === undefined) return null;
  if (s.added) return null;
  if (i < ctx.progressed) return 'done';
  if (ctx.floor.has(s.catalog)) return 'floor';
  return null;
}

function keyed(steps: readonly { catalog: string }[]): string[] {
  const seen = new Map<string, number>();
  return steps.map((s) => {
    const n = (seen.get(s.catalog) ?? 0) + 1;
    seen.set(s.catalog, n);
    return `${s.catalog}#${n}`;
  });
}

/** The editor's rows at a plan gate: the fixed scope row, the editable steps, the fixed hand-over. */
export function gateRows(gate: Pick<PlanGateView, 'ord' | 'floorAdded' | 'planSteps' | 'editSeed'>, draft: GateDraft | null): OrderRow[] {
  const ctx = orderContext(gate);
  const steps = draftSteps(draft ?? { seed: gate.editSeed, added: [], order: null });
  const rows: OrderRow[] = steps.map((s, i) => ({ key: s.id, catalog: s.catalog, label: stepWord(s, ctx.words), fixed: fixedAt(steps, i, ctx), added: s.added, index: i }));
  if (ctx.scope) rows.unshift({ key: 'scope', catalog: PA_SCOPE_STEP, label: stepLabelOf(PA_SCOPE_STEP), fixed: 'scope', added: false, index: null });
  if (ctx.deliver) rows.push({ key: 'deliver', catalog: DELIVER_STEP, label: stepLabelOf(DELIVER_STEP), fixed: 'deliver', added: false, index: null });
  return rows;
}

/** The editor's rows mid-run: the chain as it stands, every row fixed — done, hand-over, or set. */
export function midRunRows(chain: ChainModel): OrderRow[] {
  const live = chain.steps.filter((s) => s.state !== 'struck' && s.state !== 'replaced');
  const keys = keyed(live);
  return live.map((s, i) => ({
    key: keys[i]!,
    catalog: s.catalog,
    label: s.label,
    fixed: s.catalog === DELIVER_STEP ? 'deliver' : s.state === 'done' || s.state === 'checked' || s.state === 'failed' ? 'done' : 'set',
    added: false,
    index: null,
  }));
}

export type Move = { steps: DraftStep[] } | { refused: string };

/**
 * Move the i-th editable step one place up (`-1`) or down (`+1`): a swap with its neighbour, refused
 * — with the engine's reason — when either of the two is fixed, or there is nowhere to go. A refusal
 * is shown, never hidden (§5.7).
 */
export function moveStep(steps: readonly DraftStep[], i: number, dir: -1 | 1, ctx: OrderContext): Move {
  const s = steps[i];
  if (s === undefined) return { refused: 'That step is no longer on the plan.' };
  const j = i + dir;
  const label = stepWord(s, ctx.words);
  if (j < 0 || j >= steps.length) {
    return { refused: `${label} is already ${dir < 0 ? 'first' : 'last'} among the steps you can order.` };
  }
  const mine = fixedAt(steps, i, ctx);
  if (mine !== null) return { refused: `${label} stays where it is: it ${FIXED_WORD[mine]}.` };
  const other = steps[j]!;
  const theirs = fixedAt(steps, j, ctx);
  if (theirs !== null) return { refused: `${label} cannot pass ${stepWord(other, ctx.words)}: it ${FIXED_WORD[theirs]}.` };
  const next = [...steps];
  next[i] = other;
  next[j] = s;
  return { steps: next };
}

/** "Clarify → Plan → Challenge → Build": the authored order in the chain's own words (the plan's
 *  words when given, else the catalogs'). */
export function orderWords(steps: readonly { catalog: string; id?: string }[], words?: ReadonlyMap<string, string>): string {
  return steps.map((s) => (s.id !== undefined ? stepWord({ id: s.id, catalog: s.catalog }, words) : stepLabelOf(s.catalog))).join(' → ');
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/** A preset or user plan (`run_identity`): only a planned run takes plan edits (S7's rule). */
export function plannedRun(v: SessionView): boolean {
  const id = (v.session as unknown as { run_identity?: { kind?: unknown } }).run_identity;
  return typeof id === 'object' && id !== null && (id.kind === 'preset' || id.kind === 'user_plan');
}

/** Whether a run gets the plan artifact at all: a planned run (`run_identity`, as S7 decides) that is
 *  still going. The chain's source does not decide it: when the team plan cannot be read the chain is
 *  the run's own units, and the chain line already says so. */
export function hasPlanEditor(v: SessionView, chain: ChainModel | undefined): boolean {
  return chain !== undefined && plannedRun(v) && !TERMINAL.has(v.session.status);
}
