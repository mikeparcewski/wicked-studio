import { executingOrd } from '../api/run-state.js';
import type { SessionView } from '../api/types.js';
import type { TeamRow } from '../api/teamPlan.js';
import type { TeamFold } from '../store/teamPlan.js';

/**
 * THE CHAIN (DES-STUDIO-REBUILD-001 §5.2, slice S6a): a run's plan as one line of steps, each a
 * block (research, plan, build, …) with a state. Pure: the session renders what this returns.
 *
 *  - A team run's chain is the team-plan fold (`store/teamPlan.ts`): the latest accepted plan's
 *    steps (or, before any is accepted, the proposed plan, marked so), grown by later revisions,
 *    with each step's state from `step.claimed` / `step.completed` / `step.reviewed` in event order.
 *  - A run that is not a team run (`teamed: false`: free text, a registered def) renders from its
 *    units, as the run page's timeline does.
 *  - A team run with no team transport says so, with the engine's reason (§8.12), never silently.
 *  - "checked" is never derived here. It needs the acceptance read's per-step `check_state` (WT);
 *    until a step carries one, the most a step can be is "done".
 */

export type Block =
  | 'research' | 'brainstorm' | 'plan' | 'build' | 'write' | 'test' | 'review' | 'walkthrough'
  | 'deliver' | 'yours' | 'tool';

export type ChainStepState = 'todo' | 'running' | 'done' | 'checked' | 'failed' | 'replaced' | 'struck';

export interface ChainStep {
  id: string;
  catalog: string;
  block: Block;
  label: string;
  state: ChainStepState;
  addedBy: 'pa' | 'floor' | 'human' | 'policy';
  reason?: string;
  late?: boolean;
  /** Only from `/acceptance` (WT). Absent ⇒ the step is never "checked". */
  checkState?: string;
}

export interface ChainModel {
  source: 'team' | 'units';
  steps: ChainStep[];
  /** No plan accepted yet: these are the proposed steps. */
  proposed: boolean;
  /** "Team transport unavailable: <reason>" for a team run with no transport; else null. */
  transportLine: string | null;
  done: number;
  total: number;
  /** `null` until a step carries `check_state` (never, before WT). */
  checked: number | null;
  /** A team run's plan proposal NEWER than its accepted plan (the plan gate's question), labelled
   *  in the same words as the chain, so the proposal card and the line agree (studio#442). */
  pending?: ChainStep[];
}

// ── The block table (catalog ids at wicked-core src/catalog.rs) ────────────────────────────

const BLOCKS: Record<string, Block> = {
  understand: 'research',
  test_plan: 'plan', design: 'plan', architecture: 'plan',
  build: 'build',
  produce: 'write',
  test: 'test', domain_coverage: 'test',
  review: 'review', critique: 'review', security_review: 'review',
  walkthrough_review: 'walkthrough',
  deliver: 'deliver',
};

/** A catalog id → its block. `run` owned by the operator is "yours"; anything unknown is a tool step. */
export function blockOf(catalog: string, ownedBy?: string | null): Block {
  if (catalog === 'run') return ownedBy === 'operator' ? 'yours' : 'tool';
  return BLOCKS[catalog] ?? 'tool';
}

const BLOCK_LABEL: Record<Exclude<Block, 'tool'>, string> = {
  research: 'Research', brainstorm: 'Brainstorm', plan: 'Plan', build: 'Build', write: 'Write',
  test: 'Test', review: 'Review', walkthrough: 'Walkthrough', deliver: 'Deliver', yours: 'Yours',
};

function humanize(id: string): string {
  const s = id.replace(/[-_]+/g, ' ').trim();
  return s === '' ? 'Step' : s[0]!.toUpperCase() + s.slice(1);
}

/**
 * A step's ONE word (studio#442): the chain, the status sentence and the proposal card all read
 * it, so the same step is never "Pa scope" in one place and "Research" in another. Keyed by the
 * step id (the engine's phase id: a team plan step's `id`, a unit's `<phase> — …` head). An id not
 * listed falls back to its block's word; a tool step to the catalog's label, else its id in words.
 */
export const STEP_WORD: Readonly<Record<string, string>> = {
  'pa-scope': 'Scope', scope: 'Scope', clarify: 'Clarify',
  design: 'Plan', plan: 'Plan', architecture: 'Plan', 'test-plan': 'Test plan', test_plan: 'Test plan',
  build: 'Build', implement: 'Build', fix: 'Fix', produce: 'Write',
  'adversarial-review': 'Challenge', critique: 'Review', review: 'Review', 'code-review': 'Review',
  'security-review': 'Security check', security_review: 'Security check',
  test: 'Test', verify: 'Check', domain_coverage: 'Coverage',
  walkthrough: 'Walkthrough', walkthrough_review: 'Walkthrough',
  deliver: 'Deliver', understand: 'Research', research: 'Research', recon: 'Research',
};

/** A step's label: its id's word, else its block's word; a tool step is labelled from the catalog,
 *  else by its own id. */
function labelOf(block: Block, id: string, catalog: string, catalogLabels: Record<string, string>): string {
  const word = STEP_WORD[id.toLowerCase()];
  if (word !== undefined) return word;
  if (block !== 'tool') return BLOCK_LABEL[block];
  return catalogLabels[catalog] ?? humanize(id || catalog);
}

/** A step id (a plan gate prompt's arrow list) named as the chain names it: its id's word, else
 *  its catalog block's word, else the id in words. */
export function stepLabelOf(id: string, catalogLabels: Record<string, string> = {}): string {
  return labelOf(blockOf(id), id, id, catalogLabels);
}

/** Two steps of one run never share a label (studio#442: "Research, Research", "Review, Review").
 *  A repeated label falls back to each step's own id in words; if that still repeats, it is
 *  numbered in plan order ("Review 2"). Mutates and returns `steps`. */
export function distinctLabels<T extends { id: string; label: string }>(steps: T[]): T[] {
  const count = (xs: readonly T[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x.label, (m.get(x.label) ?? 0) + 1);
    return m;
  };
  const first = count(steps);
  for (const s of steps) if ((first.get(s.label) ?? 0) > 1) s.label = humanize(s.id);
  const second = count(steps);
  const seen = new Map<string, number>();
  for (const s of steps) {
    if ((second.get(s.label) ?? 0) <= 1) continue;
    const n = (seen.get(s.label) ?? 0) + 1;
    seen.set(s.label, n);
    if (n > 1) s.label = `${s.label} ${n}`;
  }
  return steps;
}

// ── From the team fold ─────────────────────────────────────────────────────────────────────

interface PlanStepWire {
  catalog?: unknown;
  id?: unknown;
  owner?: unknown;
  owned_by?: unknown;
  added_by?: unknown;
  floor_reason?: unknown;
  late?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function stepsOf(payload: Record<string, unknown>, key: 'steps' | 'added'): PlanStepWire[] {
  const v = payload[key];
  return Array.isArray(v) ? (v.filter((x) => typeof x === 'object' && x !== null) as PlanStepWire[]) : [];
}

export interface ChainOptions {
  /** The run was launched from the operator's own plan (`run_identity.kind === 'user_plan'`). */
  userPlan?: boolean;
  /** `GET /catalog` labels for ids the block table does not know. */
  catalogLabels?: Record<string, string>;
}

function toStep(w: PlanStepWire, opts: ChainOptions, late: boolean, revisedBy: string | null): ChainStep | null {
  const catalog = str(w.catalog);
  if (catalog === null) return null;
  const id = str(w.id) ?? catalog;
  const block = blockOf(catalog, str(w.owned_by) ?? str(w.owner));
  const floor = w.added_by === 'floor';
  const addedBy: ChainStep['addedBy'] = floor ? 'floor'
    : revisedBy !== null ? 'pa'
      : opts.userPlan === true ? 'human' : 'pa';
  const step: ChainStep = {
    id, catalog, block, label: labelOf(block, id, catalog, opts.catalogLabels ?? {}), state: 'todo', addedBy,
  };
  const reason = str(w.floor_reason);
  if (reason !== null) step.reason = reason;
  if (late || w.late === true) step.late = true;
  return step;
}

function counts(steps: readonly ChainStep[]): { done: number; total: number; checked: number | null } {
  const live = steps.filter((s) => s.state !== 'struck' && s.state !== 'replaced');
  const withCheck = live.filter((s) => s.checkState !== undefined);
  return {
    done: live.filter((s) => s.state === 'done' || s.state === 'checked').length,
    total: live.length,
    checked: withCheck.length === 0 ? null : live.filter((s) => s.state === 'checked').length,
  };
}

export function transportLineOf(transport: string | null, reason: string | null): string | null {
  if (transport !== 'none' && transport !== 'unavailable') return null;
  const why = reason ?? (transport === 'unavailable' ? 'this daemon has no team bus' : 'no reason given');
  return `Team transport unavailable: ${why}`;
}

export function chainFromTeam(fold: TeamFold, opts: ChainOptions = {}): ChainModel {
  const rows = fold.rows;
  let accepted: TeamRow | null = null;
  let proposed: TeamRow | null = null;
  for (const r of rows) {
    if (r.event_type === 'wicked.team.plan.accepted') {
      const rev = Number(r.payload.plan_rev ?? 0);
      if (accepted === null || rev >= Number(accepted.payload.plan_rev ?? 0)) accepted = r;
    } else if (r.event_type === 'wicked.team.plan.proposed') {
      proposed = r;
    }
  }
  const base = accepted ?? proposed;
  // A proposal that came after the accepted plan (manual mode's rev 2 at its plan gate).
  const newer = accepted !== null && proposed !== null && proposed.event_id > accepted.event_id ? proposed : null;
  const steps: ChainStep[] = [];
  const byId = new Map<string, ChainStep>();
  const add = (s: ChainStep | null): void => {
    if (s === null || byId.has(s.id)) return;
    byId.set(s.id, s);
    steps.push(s);
  };

  // Which step ids a revision added (so the accepted plan that carries them marks them late/PA).
  const revisedIds = new Map<string, string>();
  for (const r of rows) {
    if (r.event_type !== 'wicked.team.plan.revised') continue;
    const why = str(r.payload.reason) ?? 'pa_added';
    for (const w of stepsOf(r.payload, 'added')) {
      const id = str(w.id) ?? str(w.catalog);
      if (id !== null && !revisedIds.has(id)) revisedIds.set(id, why);
    }
  }

  if (base !== null) {
    for (const w of stepsOf(base.payload, 'steps')) {
      const id = str(w.id) ?? str(w.catalog) ?? '';
      const why = revisedIds.get(id) ?? null;
      add(toStep(w, opts, why !== null, why));
    }
  }
  // A revision newer than the accepted plan: its steps are on the way in.
  const acceptedRev = accepted === null ? -1 : Number(accepted.payload.plan_rev ?? 0);
  for (const r of rows) {
    if (r.event_type !== 'wicked.team.plan.revised' || Number(r.payload.plan_rev ?? 0) <= acceptedRev) continue;
    for (const w of stepsOf(r.payload, 'added')) add(toStep(w, opts, true, str(r.payload.reason) ?? 'pa_added'));
  }

  // Step states, in event order.
  for (const r of rows) {
    const id = str(r.payload.step_id);
    const s = id === null ? undefined : byId.get(id);
    if (s === undefined) continue;
    switch (r.event_type) {
      case 'wicked.team.step.claimed':
        if (s.state === 'todo' || s.state === 'failed') s.state = 'running';
        break;
      case 'wicked.team.step.completed':
        s.state = r.payload.status === 'ok' ? 'done' : 'failed';
        break;
      case 'wicked.team.step.reviewed':
        if (r.payload.verdict === 'rejected') s.state = 'running';
        break;
      default:
        break;
    }
  }

  const pending = newer === null ? null
    : distinctLabels(stepsOf(newer.payload, 'steps').map((w) => toStep(w, opts, false, null)).filter((x): x is ChainStep => x !== null));
  // The line shows what the plan gate asks about: the proposal's steps the accepted plan does not
  // have yet follow it, not started — so the line and the proposal card list the same steps.
  for (const p of pending ?? []) add({ ...p });
  distinctLabels(steps);
  if (pending !== null) for (const p of pending) p.label = byId.get(p.id)?.label ?? p.label;
  const snap = fold.snapshot;
  return {
    source: 'team',
    steps,
    ...(pending !== null && pending.length > 0 ? { pending } : {}),
    proposed: accepted === null && proposed !== null,
    transportLine: snap === null ? null : transportLineOf(snap.transport, snap.reason),
    ...counts(steps),
  };
}

// ── From the units (a run that is not a team run) ──────────────────────────────────────────

const STAGE_CATALOG: Record<string, string> = { recon: 'understand', build: 'build', review: 'review', test: 'test' };

/** A unit's phase id: the head of its description (`<phase> — <problem> ||| …`, crew's unit
 *  naming), else a plain `phase_ref`. Never the description itself (studio#440): that is the
 *  engine's instruction, with the problem, phase prompts and local paths in it. */
export function unitPhaseId(u: { description?: string | null; phase_ref?: string | null }): string | null {
  const head = /^([A-Za-z0-9_-]+) — /.exec(u.description ?? '')?.[1];
  if (head !== undefined) return head;
  const ref = u.phase_ref ?? null;
  return ref !== null && /^[A-Za-z0-9_-]+$/.test(ref) ? ref : null;
}

export function chainFromUnits(view: SessionView, opts: ChainOptions = {}): ChainModel {
  // `distributed` means routed, not running: every unit is routed before any runs. The one unit
  // working is the one under the cursor while the run executes (api/run-state.ts).
  const running = executingOrd(view.session, view.units);
  const sorted = [...view.units].sort((a, b) => a.ord - b.ord);
  const phases = sorted.map((u) => unitPhaseId(u));
  const steps: ChainStep[] = sorted.map((u, i) => {
    const phase = phases[i] ?? null;
    const ref = u.phase_ref ?? null;
    // The block: the phase id when it is a catalog id, else a catalog `phase_ref`, else the stage.
    const catalog = phase !== null && BLOCKS[phase] !== undefined ? phase
      : ref !== null && BLOCKS[ref] !== undefined ? ref
        : STAGE_CATALOG[u.stage] ?? 'run';
    const block = blockOf(catalog);
    const state: ChainStepState = u.status === 'done' ? 'done'
      : u.status === 'rejected' ? 'failed'
        : u.ord === running ? 'running' : 'todo';
    return {
      id: `u${u.ord}`, catalog, block,
      label: labelOf(block, phase ?? catalog, catalog, opts.catalogLabels ?? {}),
      state, addedBy: 'pa' as const,
    };
  });
  // Told apart by phase id (the step's own name), never by the `u<ord>` key.
  const named = distinctLabels(steps.map((s, i) => ({ id: phases[i] ?? s.catalog, label: s.label })));
  steps.forEach((s, i) => { s.label = named[i]!.label; });
  return { source: 'units', steps, proposed: false, transportLine: null, ...counts(steps) };
}

/** studio#445: a team step whose unit the run reports `done` is done, whether or not a
 *  `step.completed` row reached the bus (the deliver Tool unit emits none). Matched by phase id. */
function withUnitStates(c: ChainModel, units: SessionView['units']): ChainModel {
  if (c.proposed) return c;
  const done = new Set<string>();
  for (const u of units) {
    const phase = unitPhaseId(u);
    if (u.status === 'done' && phase !== null) done.add(phase);
  }
  if (done.size === 0) return c;
  let changed = false;
  const steps = c.steps.map((s) => {
    if ((s.state === 'todo' || s.state === 'running') && done.has(s.id)) { changed = true; return { ...s, state: 'done' as const }; }
    return s;
  });
  return changed ? { ...c, steps, ...counts(steps) } : c;
}

/** The run's chain: the team fold when the route says it is a team run, else its units. */
export function chainOf(view: SessionView, fold: TeamFold | null, opts: ChainOptions = {}): ChainModel {
  if (fold !== null && fold.snapshot !== null && fold.snapshot.teamed) {
    const c = chainFromTeam(fold, opts);
    // A team run whose plan has not reached the bus yet still shows its units, never an empty line.
    return c.steps.length === 0 && c.transportLine === null && view.units.length > 0 ? chainFromUnits(view, opts) : withUnitStates(c, view.units);
  }
  if (fold !== null && fold.snapshot === null && fold.rows.length > 0) return withUnitStates(chainFromTeam(fold, opts), view.units);
  return chainFromUnits(view, opts);
}

/** "2 of 5 done" — and "· 1 checked" only once a step carries `check_state`. */
export function chainSentence(c: ChainModel): string {
  if (c.total === 0) return c.transportLine ?? 'No steps yet';
  const base = c.proposed ? `${c.total} steps proposed` : `${c.done} of ${c.total} done`;
  return c.checked === null ? base : `${base} · ${c.checked} checked`;
}
