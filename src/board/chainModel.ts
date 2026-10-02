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

/** A step's label: its block's word; a tool step is labelled from the catalog, else by its own id. */
function labelOf(block: Block, id: string, catalog: string, catalogLabels: Record<string, string>): string {
  if (block !== 'tool') return BLOCK_LABEL[block];
  return catalogLabels[catalog] ?? humanize(id || catalog);
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

  const snap = fold.snapshot;
  return {
    source: 'team',
    steps,
    proposed: accepted === null && proposed !== null,
    transportLine: snap === null ? null : transportLineOf(snap.transport, snap.reason),
    ...counts(steps),
  };
}

// ── From the units (a run that is not a team run) ──────────────────────────────────────────

const STAGE_CATALOG: Record<string, string> = { recon: 'understand', build: 'build', review: 'review', test: 'test' };

export function chainFromUnits(view: SessionView, opts: ChainOptions = {}): ChainModel {
  // `distributed` means routed, not running: every unit is routed before any runs. The one unit
  // working is the one under the cursor while the run executes (api/run-state.ts).
  const running = executingOrd(view.session, view.units);
  const steps: ChainStep[] = [...view.units]
    .sort((a, b) => a.ord - b.ord)
    .map((u) => {
      const catalog = u.phase_ref ?? STAGE_CATALOG[u.stage] ?? 'run';
      const block = blockOf(catalog);
      const state: ChainStepState = u.status === 'done' ? 'done'
        : u.status === 'rejected' ? 'failed'
          : u.ord === running ? 'running' : 'todo';
      return {
        id: `u${u.ord}`, catalog, block,
        label: u.description || labelOf(block, catalog, catalog, opts.catalogLabels ?? {}),
        state, addedBy: 'pa' as const,
      };
    });
  return { source: 'units', steps, proposed: false, transportLine: null, ...counts(steps) };
}

/** The run's chain: the team fold when the route says it is a team run, else its units. */
export function chainOf(view: SessionView, fold: TeamFold | null, opts: ChainOptions = {}): ChainModel {
  if (fold !== null && fold.snapshot !== null && fold.snapshot.teamed) {
    const c = chainFromTeam(fold, opts);
    // A team run whose plan has not reached the bus yet still shows its units, never an empty line.
    return c.steps.length === 0 && c.transportLine === null && view.units.length > 0 ? chainFromUnits(view, opts) : c;
  }
  if (fold !== null && fold.snapshot === null && fold.rows.length > 0) return chainFromTeam(fold, opts);
  return chainFromUnits(view, opts);
}

/** "2 of 5 done" — and "· 1 checked" only once a step carries `check_state`. */
export function chainSentence(c: ChainModel): string {
  if (c.total === 0) return c.transportLine ?? 'No steps yet';
  const base = c.proposed ? `${c.total} steps proposed` : `${c.done} of ${c.total} done`;
  return c.checked === null ? base : `${base} · ${c.checked} checked`;
}
