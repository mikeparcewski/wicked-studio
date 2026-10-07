// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { draftChanges, draftLine, draftSteps, gateDraftPlan, orderChanged, type GateDraft } from '../src/board/planDraft.js';
import { fixedAt, gateRows, hasPlanEditor, midRunRows, moveStep, orderContext, orderWords, planStepWords, stepWord } from '../src/board/planOrder.js';
import { stepLabelOf } from '../src/board/chainModel.js';
import type { SessionView } from '../src/api/types.js';
import type { ChainModel } from '../src/board/chainModel.js';
import type { PlanGateView } from '../src/board/planModel.js';

/** S10 (DES-STUDIO-REBUILD-001 §5.7, §11 S10; §6 Q-R5 order only): the ordered plan editor, pure. */

const gate = (over: Partial<PlanGateView> = {}): PlanGateView => ({
  gateId: 'g1', ord: 2, planRev: 2, band: '70-100', highRisk: true, reason: 'manual_mode', score: 100, reasons: [],
  floorAdded: ['security_review'],
  editSeed: ['understand', 'design', 'build', 'security_review', 'review'],
  planSteps: [
    { id: 'pa-scope', catalog: 'understand' }, { id: 'understand', catalog: 'understand' }, { id: 'design', catalog: 'design' },
    { id: 'build', catalog: 'build' }, { id: 'security_review', catalog: 'security_review' }, { id: 'review', catalog: 'review' }, { id: 'deliver', catalog: 'deliver' },
  ],
  ...over,
});

/** A draft step with its persistent id (codex r1: identity follows the step through moves). */
const st = (catalog: string, added = false, n = 1): { id: string; catalog: string; added: boolean } => ({ id: `${added ? '+' : ''}${catalog}#${n}`, catalog, added });

const draft = (over: Partial<GateDraft> = {}): GateDraft => ({ runId: 'r1', gateKey: '2:9', seed: gate().editSeed, added: [], order: null, ...over });

describe('what the engine fixes at a plan gate', () => {
  it('the gate before unit 2 of a scoped plan: nothing authored has run; the floor step is fixed where it is', () => {
    const ctx = orderContext(gate());
    expect(ctx).toMatchObject({ progressed: 0, scope: true, deliver: true });
    const steps = draftSteps(draft());
    expect(steps.map((_, i) => fixedAt(steps, i, ctx))).toStrictEqual([null, null, null, 'floor', null]);
  });
  it('a re-plan before unit 4: the two authored steps that ran are done — and an added step is never fixed', () => {
    const ctx = orderContext(gate({ ord: 4 }));
    expect(ctx.progressed).toBe(2);
    const steps = draftSteps(draft({ added: ['test'] }));
    expect(steps.map((_, i) => fixedAt(steps, i, ctx))).toStrictEqual(['done', 'done', null, 'floor', null, null]);
  });
  it('a plan without a scope step counts every step before the gate as authored', () => {
    const g = gate({ ord: 2, planSteps: gate().planSteps.slice(1) });
    expect(orderContext(g)).toMatchObject({ progressed: 1, scope: false });
  });
});

describe('moving a step', () => {
  const ctx = orderContext(gate());
  it('swaps with its neighbour and keeps everything else', () => {
    const r = moveStep(draftSteps(draft()), 2, -1, ctx);
    expect(r).toStrictEqual({ steps: [st('understand'), st('build'), st('design'), st('security_review'), st('review')] });
  });
  it('is refused, with the reason, past a floor step, off either end, and for a step that ran', () => {
    const steps = draftSteps(draft());
    expect(moveStep(steps, 2, 1, ctx)).toStrictEqual({ refused: 'Build cannot pass Security check: it is required for this risk — the floor put it here.' });
    expect(moveStep(steps, 0, -1, ctx)).toStrictEqual({ refused: 'Research is already first among the steps you can order.' });
    expect(moveStep(steps, 4, 1, ctx)).toStrictEqual({ refused: 'Review is already last among the steps you can order.' });
    expect(moveStep(steps, 3, -1, ctx)).toStrictEqual({ refused: 'Security check stays where it is: it is required for this risk — the floor put it here.' });
    const ran = orderContext(gate({ ord: 4 }));
    expect(moveStep(steps, 2, -1, ran)).toStrictEqual({ refused: 'Build cannot pass Plan: it has run already.' });
    expect(moveStep(steps, 9, 1, ctx)).toStrictEqual({ refused: 'That step is no longer on the plan.' });
  });
  it('an added step moves like any other, up to the floor', () => {
    const steps = draftSteps(draft({ added: ['test'] }));
    const up = moveStep(steps, 5, -1, ctx);
    expect('steps' in up && up.steps.map((s) => s.catalog)).toStrictEqual(['understand', 'design', 'build', 'security_review', 'test', 'review']);
    const again = moveStep('steps' in up ? up.steps : [], 4, -1, ctx);
    expect(again).toStrictEqual({ refused: 'Test cannot pass Security check: it is required for this risk — the floor put it here.' });
  });
});

describe('the draft that carries an order', () => {
  it('a move is a change the card sends; the same order is not', () => {
    const same = draft({ order: draftSteps(draft()) });
    expect(orderChanged(same)).toBe(false);
    expect(draftChanges(same)).toBe(false);
    const moved = draft({ order: (moveStep(draftSteps(draft()), 2, -1, orderContext(gate())) as { steps: GateDraft['order'] }).steps });
    expect(orderChanged(moved)).toBe(true);
    expect(gateDraftPlan(moved).steps.map((s) => s.catalog)).toStrictEqual(['understand', 'build', 'design', 'security_review', 'review']);
    expect(draftLine(moved)).toBe('The order changes: Research → Build → Plan → Security check → Review.');
  });
  it('an added step keeps S7’s line; with a move, both are said', () => {
    expect(draftLine(draft({ added: ['test'] }))).toBe('The steps change: + Test.');
    // codex r1: an added step placed anywhere but last IS an order the card sends — say it.
    const both = draft({ added: ['test'], order: [st('understand'), st('test', true), st('design'), st('build'), st('security_review'), st('review')] });
    expect(orderChanged(both)).toBe(true);
    expect(draftLine(both)).toBe('The steps change: + Test. The order changes: Research → Test → Plan → Build → Security check → Review.');
    const last = draft({ added: ['test'], order: [st('understand'), st('design'), st('build'), st('security_review'), st('review'), st('test', true)] });
    expect(orderChanged(last)).toBe(false);
    expect(draftLine(last)).toBe('The steps change: + Test.');
    expect(gateDraftPlan(both).steps.map((s) => s.catalog)).toStrictEqual(['understand', 'test', 'design', 'build', 'security_review', 'review']);
  });
});

describe('the rows the editor draws', () => {
  it('at a gate: the scope row first and hand-over last, both fixed; the authored steps between, with the floor step fixed', () => {
    const rows = gateRows(gate(), null);
    expect(rows.map((r) => [r.label, r.fixed, r.index])).toStrictEqual([
      ['Scope', 'scope', null], ['Research', null, 0], ['Plan', null, 1], ['Build', null, 2], ['Security check', 'floor', 3], ['Review', null, 4], ['Deliver', 'deliver', null],
    ]);
    expect(rows.map((r) => r.key)).toStrictEqual(['scope', 'understand#1', 'design#1', 'build#1', 'security_review#1', 'review#1', 'deliver']);
  });
  it('with a draft, the rows are the draft’s order and the added step says so', () => {
    const rows = gateRows(gate(), draft({ added: ['review'], order: [st('review', true), st('understand'), st('design'), st('build'), st('security_review'), st('review')] }));
    expect(rows.slice(1, 3).map((r) => [r.key, r.added])).toStrictEqual([['+review#1', true], ['understand#1', false]]);
    expect(rows.at(-2)!.key).toBe('review#1');
  });
  it('codex r1: a repeated step keeps its own key through a move — keys follow steps, not positions', () => {
    const g = gate({ floorAdded: [], editSeed: ['review', 'review', 'build'] });
    const moved = moveStep(draftSteps(draft({ seed: ['review', 'review', 'build'] })), 0, 1, orderContext(g));
    expect('steps' in moved && moved.steps.map((s) => s.id)).toStrictEqual(['review#2', 'review#1', 'build#1']);
    const rows = gateRows(g, draft({ seed: ['review', 'review', 'build'], order: 'steps' in moved ? moved.steps : null }));
    expect(rows.slice(1, 3).map((r) => r.key)).toStrictEqual(['review#2', 'review#1']);
  });
  it('mid-run: every row is fixed — done, hand-over, or set — and struck steps are not drawn', () => {
    const chain: ChainModel = {
      source: 'team', proposed: false, transportLine: null, done: 1, total: 4, checked: null,
      steps: [
        { id: 'understand', catalog: 'understand', block: 'research', label: 'Research', state: 'done', addedBy: 'human' },
        { id: 'build', catalog: 'build', block: 'build', label: 'Build', state: 'running', addedBy: 'human' },
        { id: 'old', catalog: 'review', block: 'review', label: 'Review', state: 'struck', addedBy: 'pa' },
        { id: 'test', catalog: 'test', block: 'test', label: 'Test', state: 'todo', addedBy: 'human', late: true },
        { id: 'deliver', catalog: 'deliver', block: 'deliver', label: 'Deliver', state: 'todo', addedBy: 'human' },
      ],
    };
    expect(midRunRows(chain).map((r) => [r.label, r.fixed])).toStrictEqual([['Research', 'done'], ['Build', 'set'], ['Test', 'set'], ['Deliver', 'deliver']]);
    expect(orderWords(chain.steps)).toBe('Research → Build → Review → Test → Deliver');
  });
});

describe('which runs get the plan artifact', () => {
  const view = (status: string, kind: string | null): SessionView => ({ session: { id: 'r1', status, ...(kind !== null ? { run_identity: { kind } } : {}) } } as unknown as SessionView);
  const units: ChainModel = { source: 'units', proposed: false, transportLine: null, done: 0, total: 1, checked: null, steps: [] };
  it('a planned run that is going — even when its team plan could not be read (the chain is the run’s own units), as S7 decides', () => {
    expect(hasPlanEditor(view('executing', 'preset'), units)).toBe(true);
    expect(hasPlanEditor(view('awaiting_human', 'user_plan'), { ...units, source: 'team' })).toBe(true);
  });
  it('not a fixed workflow, not a finished run, not before the chain is read', () => {
    expect(hasPlanEditor(view('executing', 'workflow'), units)).toBe(false);
    expect(hasPlanEditor(view('executing', null), units)).toBe(false);
    expect(hasPlanEditor(view('completed', 'preset'), units)).toBe(false);
    expect(hasPlanEditor(view('executing', 'preset'), undefined)).toBe(false);
  });
});

// ── studio#574: one vocabulary — the editor names a step as the chain and the proposal do ────────

describe('studio#574: the editor list, the chain line and the proposal sentence read one name per step', () => {
  /** The engine's `feature` plan as the gate carries it: ids the chain names Clarify / Challenge, catalogs
   *  the editor used to name Research / Review — "Review" twice once the real review scrolled in. */
  const PLAN = [
    { id: 'pa-scope', catalog: 'understand' }, { id: 'clarify', catalog: 'understand' }, { id: 'design', catalog: 'design' },
    { id: 'build', catalog: 'build' }, { id: 'adversarial-review', catalog: 'review' }, { id: 'test', catalog: 'test' },
    { id: 'review', catalog: 'review' }, { id: 'deliver', catalog: 'deliver' },
  ];
  const SEED = ['understand', 'design', 'build', 'review', 'test', 'review'];
  const g = gate({ ord: 2, floorAdded: [], editSeed: SEED, planSteps: PLAN });

  it('the rows read Scope · Clarify · Plan · Build · Challenge · Test · Review · Deliver — the ids’ words, as the chain names them', () => {
    const labels = gateRows(g, null).map((r) => r.label);
    expect(labels).toStrictEqual(['Scope', 'Clarify', 'Plan', 'Build', 'Challenge', 'Test', 'Review', 'Deliver']);
    expect(labels).toStrictEqual(PLAN.map((s) => stepLabelOf(s.id)));
    expect(labels.filter((l) => l === 'Review')).toHaveLength(1);
  });

  it('a refusal names the step the same way', () => {
    const steps = draftSteps(draft({ seed: SEED }));
    expect(moveStep(steps, 0, -1, orderContext(g))).toStrictEqual({ refused: 'Clarify is already first among the steps you can order.' });
    const floored = gate({ ord: 2, floorAdded: ['test'], editSeed: SEED, planSteps: PLAN });
    expect(moveStep(steps, 3, 1, orderContext(floored))).toStrictEqual({ refused: 'Challenge cannot pass Test: it is required for this risk — the floor put it here.' });
  });

  it('the draft line after a move reads the same words; without the plan’s words (an older caller) the catalogs’ stand', () => {
    const steps = draftSteps(draft({ seed: SEED }));
    const moved = moveStep(steps, 3, 1, orderContext(g));
    const d = draft({ seed: SEED, order: 'steps' in moved ? moved.steps : null });
    expect(draftLine(d, orderContext(g).words)).toBe('The order changes: Clarify → Plan → Build → Test → Challenge → Review.');
    expect(draftLine(d)).toBe('The order changes: Research → Plan → Build → Test → Review → Review.');
    expect(orderWords(draftSteps(d), orderContext(g).words)).toBe('Clarify → Plan → Build → Test → Challenge → Review');
  });

  it('a repeated word reads distinct — Critique / Review — as the chain reads it; an added step takes its catalog’s word', () => {
    const plan = [{ id: 'critique', catalog: 'review' }, { id: 'review', catalog: 'review' }];
    expect([...planStepWords(plan).entries()]).toStrictEqual([['review#1', 'Critique'], ['review#2', 'Review']]);
    const rows = gateRows(gate({ ord: 1, floorAdded: [], editSeed: ['review', 'review'], planSteps: plan }), draft({ seed: ['review', 'review'], added: ['test'] }));
    expect(rows.map((r) => [r.key, r.label])).toStrictEqual([['review#1', 'Critique'], ['review#2', 'Review'], ['+test#1', 'Test']]);
  });

  it('the scope step and the hand-over take no key; chain steps bring their own label; a nameless step is skipped', () => {
    const w = planStepWords([
      { id: 'pa-scope', catalog: 'understand', label: 'Scope' }, { id: 'clarify', catalog: 'understand', label: 'Clarify' },
      { id: null, catalog: null }, { id: 'odd', catalog: null }, { id: 'deliver', catalog: 'deliver', label: 'Deliver' },
    ]);
    expect([...w.entries()]).toStrictEqual([['understand#1', 'Clarify']]);
    expect(stepWord({ id: 'understand#1', catalog: 'understand' }, w)).toBe('Clarify');
    expect(stepWord({ id: 'understand#2', catalog: 'understand' }, w)).toBe('Research');
    expect(stepWord({ id: '+test#1', catalog: 'test' }, undefined)).toBe('Test');
  });

  it('a plan whose ids are its catalogs reads as before (the fixture corpus: Research · Plan · Build · Security check · Review)', () => {
    expect(gateRows(gate(), null).map((r) => r.label)).toStrictEqual(['Scope', 'Research', 'Plan', 'Build', 'Security check', 'Review', 'Deliver']);
  });
});
