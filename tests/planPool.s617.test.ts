// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { draftChanges, draftLine, draftSteps, gateDraftPlan, heldPoolsOf, poolChanges, type GateDraft } from '../src/board/planDraft.js';
import { gateRows, poolCeiling, poolCeilings, poolChoices, poolRefusal } from '../src/board/planOrder.js';
import { planGateOf, type PlanGateView } from '../src/board/planModel.js';
import { reorderGateDraft, setGateDraftPool, usePlanDrafts } from '../src/store/planDrafts.js';
import type { RunTeamResponse } from '../src/api/teamPlan.js';

/**
 * studio#617's plan-editor half (wicked-core#810): a plan step may LOWER its catalog entry's worker
 * pool, never raise it (the engine refuses a raise as `pool_raised`). Pure model + the draft store.
 */

const gate = (over: Partial<PlanGateView> = {}): PlanGateView => ({
  gateId: 'g1', ord: 2, planRev: 2, band: '0-19', highRisk: false, reason: 'manual_mode', score: 0, reasons: [],
  floorAdded: [],
  editSeed: ['understand', 'build', 'review'],
  planSteps: [
    { id: 'pa-scope', catalog: 'understand' }, { id: 'understand', catalog: 'understand' },
    { id: 'build', catalog: 'build' }, { id: 'review', catalog: 'review' }, { id: 'deliver', catalog: 'deliver' },
  ],
  ...over,
});

const draft = (over: Partial<GateDraft> = {}): GateDraft => ({ runId: 'r1', gateKey: '2:9', seed: gate().editSeed, added: [], order: null, ...over });

const ceilings = poolCeilings([{ id: 'understand' }, { id: 'build', pool: 3 } as { id: string }, { id: 'review', pool: 1 } as { id: string }]);

describe('the entry pool is the ceiling', () => {
  it('reads `pool` off a catalog entry; absent, malformed or an older engine is a pool of 1', () => {
    expect(poolCeiling({ id: 'build', pool: 3 })).toBe(3);
    expect(poolCeiling({ id: 'build' })).toBe(1);
    expect(poolCeiling({ id: 'build', pool: 0 })).toBe(1);
    expect(poolCeiling({ id: 'build', pool: 2.5 })).toBe(1);
    expect(poolCeiling(undefined)).toBe(1);
    expect([...ceilings.entries()]).toStrictEqual([['build', 3]]);
  });
  it('offers 1 up to the ceiling and never more; a raise is refused in words', () => {
    expect(poolChoices(3)).toStrictEqual([1, 2, 3]);
    expect(poolRefusal('Build', 2, 3)).toBeNull();
    expect(poolRefusal('Build', 4, 3)).toBe('Build’s pool can only be lowered: its step allows 3, and the engine refuses a raise.');
    expect(poolRefusal('Build', 0, 3)).toBe('Build’s pool is at least 1.');
  });
});

describe('the editor rows', () => {
  it('only an editable step whose entry pools above 1 offers a pool, at the entry pool by default', () => {
    const rows = gateRows(gate(), null, ceilings);
    expect(rows.map((r) => [r.catalog, r.pool])).toStrictEqual([
      ['pa-scope', null], ['understand', null], ['build', { value: 3, ceiling: 3 }], ['review', null], ['deliver', null],
    ]);
  });
  it('a step that has run keeps its pool: no control', () => {
    const rows = gateRows(gate({ ord: 4 }), null, ceilings);
    expect(rows.find((r) => r.catalog === 'build')?.pool).toBeNull();
  });
  it('the held plan’s lowered pool is the value shown; the draft’s wins over it', () => {
    const g = gate({ editPools: [null, 2, null] });
    expect(gateRows(g, null, ceilings).find((r) => r.catalog === 'build')?.pool).toStrictEqual({ value: 2, ceiling: 3 });
    const d = draft({ pools: { 'build#1': 1 }, heldPools: { 'build#1': 2 } });
    expect(gateRows(g, d, ceilings).find((r) => r.catalog === 'build')?.pool).toStrictEqual({ value: 1, ceiling: 3 });
  });
  it('without the catalog (no ceilings) nothing offers a pool', () => {
    expect(gateRows(gate(), null).every((r) => r.pool === null)).toBe(true);
  });
});

describe('the draft', () => {
  it('a lowered pool is a change, said on the card, and sent on that step only', () => {
    const d = draft({ pools: { 'build#1': 2 }, heldPools: {} });
    expect(draftChanges(d)).toBe(true);
    expect(poolChanges(d).map((s) => s.id)).toStrictEqual(['build#1']);
    expect(draftLine(d)).toBe('The pool changes: Build to 2.');
    expect(gateDraftPlan(d).steps).toStrictEqual([{ catalog: 'understand' }, { catalog: 'build', pool: 2 }, { catalog: 'review' }]);
  });
  it('a pool set back to the held one is no change — but the held pool still rides the plan', () => {
    const d = draft({ pools: { 'build#1': 2 }, heldPools: { 'build#1': 2 } });
    expect(draftChanges(d)).toBe(false);
    expect(draftLine(d)).toBe('');
    expect(gateDraftPlan({ ...d, added: ['test'] }).steps).toStrictEqual([
      { catalog: 'understand' }, { catalog: 'build', pool: 2 }, { catalog: 'review' }, { catalog: 'test' },
    ]);
  });
  it('a moved step keeps its pool (the pool follows the step id, not its place)', () => {
    const order = [...draftSteps(draft())].reverse();
    const d = draft({ order, pools: { 'build#1': 1 }, heldPools: {} });
    expect(gateDraftPlan(d).steps).toStrictEqual([{ catalog: 'review' }, { catalog: 'build', pool: 1 }, { catalog: 'understand' }]);
  });
  it('the held plan’s pools are keyed as the draft keys its seed', () => {
    expect(heldPoolsOf(['build', 'review', 'build'], [2, null, 1])).toStrictEqual({ 'build#1': 2, 'build#2': 1 });
    expect(heldPoolsOf(['build'], undefined)).toStrictEqual({});
  });
});

describe('the store', () => {
  beforeEach(() => usePlanDrafts.setState({ gate: {}, added: {}, queued: {} }));
  it('the first pool set seeds the held pools, a later one keeps them; a reorder keeps the pools', () => {
    setGateDraftPool('r1', '2:9', ['understand', 'build', 'review'], { 'review#1': 1 }, 'build#1', 2);
    let d = usePlanDrafts.getState().gate['r1']!;
    expect(d.pools).toStrictEqual({ 'review#1': 1, 'build#1': 2 });
    expect(d.heldPools).toStrictEqual({ 'review#1': 1 });
    setGateDraftPool('r1', '2:9', ['understand', 'build', 'review'], { 'review#1': 1 }, 'build#1', 1);
    reorderGateDraft('r1', '2:9', ['understand', 'build', 'review'], [...draftSteps(d)].reverse());
    d = usePlanDrafts.getState().gate['r1']!;
    expect(d.pools).toStrictEqual({ 'review#1': 1, 'build#1': 1 });
    expect(d.order?.some((s) => 'pool' in s)).toBe(false);
    expect(gateDraftPlan(d).steps).toStrictEqual([{ catalog: 'review', pool: 1 }, { catalog: 'build', pool: 1 }, { catalog: 'understand' }]);
  });
  it('a new gate instance starts a fresh draft with no pools', () => {
    setGateDraftPool('r1', '2:9', ['build'], {}, 'build#1', 2);
    setGateDraftPool('r1', '3:10', ['build'], {}, 'build#1', 1);
    expect(usePlanDrafts.getState().gate['r1']).toMatchObject({ gateKey: '3:10', pools: { 'build#1': 1 }, heldPools: {} });
  });
});

describe('the gate view reads the held plan’s pools', () => {
  it('aligned with editSeed: pa-scope and deliver out, a step without a pool is null', () => {
    const team: RunTeamResponse = {
      rows: [
        { event_id: 1, event_type: 'wicked.team.plan.proposed', payload: { steps: [
          { catalog: 'understand', id: 'pa-scope' }, { catalog: 'understand', id: 'understand' },
          { catalog: 'build', id: 'build', pool: 2 }, { catalog: 'review', id: 'review', pool: 'x' }, { catalog: 'deliver', id: 'deliver' },
        ] } },
        { event_id: 2, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: 'g1', ord: 2 } },
      ],
      units: [],
    };
    const v = planGateOf(team)!;
    expect(v.editSeed).toStrictEqual(['understand', 'build', 'review']);
    expect(v.editPools).toStrictEqual([null, 2, null]);
  });
});
