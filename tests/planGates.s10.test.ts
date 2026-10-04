// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { isPlanGateNow, loadPlanGate, planGateFresh, planGateReading, usePlanGateStore } from '../src/store/planGates.js';
import { useGateStore } from '../src/store/gates.js';

/** S10 codex r1 P1: a plan view is read FOR a gate instance; a successor gate must not take a draft
 *  seeded from its predecessor's view. The store says which gate instance each view was read for. */

const open = (receivedAt: number): void => {
  useGateStore.setState({ gates: { r1: { runId: 'r1', ord: 2, prompt: 'Approve plan', lifecycle: 'open', receivedAt, gateKind: 'plan_approval' } } } as never);
};

afterEach(() => {
  vi.restoreAllMocks();
  useGateStore.setState({ gates: {} });
  usePlanGateStore.setState({ byRun: {}, readFor: {} } as never);
});

describe('which gate a plan view was read for', () => {
  it('a read records the gate instance open when it was asked', async () => {
    open(5);
    vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ rows: [], units: [] } as never);
    await loadPlanGate('r1');
    expect((usePlanGateStore.getState() as unknown as { readFor: Record<string, string | null> }).readFor['r1']).toBe('2:5');
  });
  it('an older read landing after a newer one changes nothing: the view and its gate stay the newer read’s', async () => {
    const answers: ((v: unknown) => void)[] = [];
    vi.spyOn(teamPlanApi, 'team').mockImplementation(() => new Promise((resolve) => { answers.push(resolve); }) as never);
    open(5);
    const first = loadPlanGate('r1');
    open(9);
    const second = loadPlanGate('r1');
    answers[1]!({ rows: [], units: [] });
    await second;
    answers[0]!({ rows: [], units: [] });
    await first;
    expect((usePlanGateStore.getState() as unknown as { readFor: Record<string, string | null> }).readFor['r1']).toBe('2:9');
  });
});

describe('codex r2', () => {
  it('a view is fresh only when it was read for the gate instance open now', () => {
    const gate = { ord: 2, receivedAt: 9 };
    expect(planGateFresh('2:9', gate)).toBe(true);
    expect(planGateFresh('2:5', gate)).toBe(false);
    expect(planGateFresh(undefined, gate)).toBe(false);
    expect(planGateFresh(null, undefined)).toBe(false);
  });
  it('isPlanGateNow honours a live plan_approval frame that arrived while its own read was dropped', async () => {
    const answers: ((v: unknown) => void)[] = [];
    const fails: ((e: unknown) => void)[] = [];
    vi.spyOn(teamPlanApi, 'team').mockImplementation(() => new Promise((resolve, reject) => { answers.push(resolve); fails.push(reject); }) as never);
    const now = isPlanGateNow('r1');
    open(9);
    const newer = loadPlanGate('r1');
    fails[1]!(new Error('503'));
    await newer;
    answers[0]!({ rows: [], units: [] });
    expect(await now).toBe(true);
  });
});

describe('codex r3: a read still on its way vs a read with no gate instance', () => {
  it('reading only while the open instance has no read of its own; a landed read with no instance is not reading', () => {
    expect(planGateReading('2:5', { ord: 2, receivedAt: 9 })).toBe(true);
    expect(planGateReading('2:9', { ord: 2, receivedAt: 9 })).toBe(false);
    expect(planGateReading(undefined, undefined)).toBe(true);
    expect(planGateReading(null, undefined)).toBe(false);
  });
});
