import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import * as client from '../src/api/client.js';
import type { CoreEvent } from '../src/api/types.js';
import { SteeringGate } from '../src/components/SteeringGate.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import { layerLine } from '../src/components/gateVerdictModel.js';
import { makeUnit } from './factories.js';

/**
 * studio#430: the escalation's `verdictSummary` is the engine's 4 KB TAIL of the evaluator's verdict,
 * head-cut with "…" — items 1-4 of 9 are not in it. The card's send-back prefill must carry the
 * whole verdict (the unit's own output), and the layers must not read as a contradiction.
 */
const RUN = 'r-430';
const FULL = ['Reviewed the importer.', ...Array.from({ length: 9 }, (_, i) => `- finding ${i + 1}: item ${i + 1} is wrong`), 'VERDICT: FAIL'].join('\n');
const TAIL = `…${FULL.slice(FULL.indexOf('- finding 5'))}`;
const PROMPT = 'Unit 2 verdict is NOT PASS — the evaluator\'s verdict is FAIL. confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run.';
const UNITS = [
  makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 1, stage: 'build', status: 'done', role: 'creator', assigned_cli: 'claude' } as never),
  makeUnit({ id: `${RUN}:test`, session_id: RUN, ord: 2, stage: 'test', status: 'rejected', role: 'evaluator', assigned_cli: 'codex' } as never),
];
// The frames as crew 0.7.46 sent them for run 922de722 (unit 3 there): the denial reason and the
// escalation's summary are both the engine's head-cut tail of the evaluator's verdict.
const EVENTS = [
  { type: 'unitDispatched', session: RUN, ord: 1, attempt: 0, ts: 1, seq: 1 },
  { type: 'unitDone', session: RUN, ord: 1, ts: 2, seq: 2 },
  { type: 'unitDispatched', session: RUN, ord: 2, attempt: 0, ts: 3, seq: 3 },
  { type: 'gateEvaluated', session: RUN, ord: 2, ts: 4, seq: 4, criterion: null, hasDeterministicFloor: false, deterministicPass: true,
    agentVerdict: 'pass', agentReasoning: 'PASS — the floor looks fine', evaluatorPass: true, evaluatorPolicies: [],
    evaluatorVerdict: 'FAIL', denialReason: TAIL,
    denial: { claimId: null, deniedTool: null, phase: 'unit-2', reason: TAIL, ruleIds: [], source: 'evaluator_verdict' },
    combined: false, judgeCli: 'pi', judgeDistinct: true, judgeSkippedReason: null },
  { type: 'gateEscalated', session: RUN, ord: 2, ts: 4, seq: 5, attempt: 0, condition: 'verdict_not_pass', defGate: false,
    denialSource: 'evaluator_verdict', discarded: [], outputCaptured: true, restored: false, suggestionRef: null, verdictSummary: TAIL },
  { type: 'awaitingHuman', session: RUN, ord: 2, ts: 5, seq: 6, prompt: PROMPT, reviewingOrd: 2 },
] as unknown as CoreEvent[];

beforeEach(() => {
  vi.restoreAllMocks();
  useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 2, prompt: PROMPT, lifecycle: 'open', receivedAt: 1 } } });
  useRunEventStore.setState({ byRun: { [RUN]: EVENTS } });
  vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: FULL, outputUnavailable: null } as never);
  vi.spyOn(client.api, 'getRunDiff').mockRejectedValue(new Error('no diff'));
});
afterEach(cleanup);

describe('studio#430', () => {
  it('the send-back prefill carries the whole verdict, the first findings included, read from the unit\'s output', async () => {
    render(<SteeringGate runId={RUN} ord={2} prompt={PROMPT} units={UNITS} clis={['claude', 'codex']} />);
    await waitFor(() => {
      const field = (screen.queryByTestId('amend-prepopulated') ?? screen.queryByTestId('steering-amend')) as HTMLTextAreaElement | null;
      expect(field?.value ?? '').toContain('finding 1: item 1 is wrong');
    });
    const field = (screen.queryByTestId('amend-prepopulated') ?? screen.getByTestId('steering-amend')) as HTMLTextAreaElement;
    expect(field.value).toContain('finding 9: item 9 is wrong');
    expect(client.api.getUnitOutput).toHaveBeenCalledTimes(1);
  });

  it('a summary that is whole is used as it is — no read', () => {
    useRunEventStore.setState({ byRun: { [RUN]: EVENTS.map((e) => {
      const ev = e as unknown as Record<string, unknown>;
      if (ev['type'] === 'gateEscalated') return { ...ev, verdictSummary: FULL };
      if (ev['type'] === 'gateEvaluated') return { ...ev, denialReason: FULL, denial: { ...(ev['denial'] as object), reason: FULL } };
      return ev;
    }) as unknown as CoreEvent[] } });
    render(<SteeringGate runId={RUN} ord={2} prompt={PROMPT} units={UNITS} clis={['claude', 'codex']} />);
    expect(client.api.getUnitOutput).not.toHaveBeenCalled();
  });

  it('the layers are named when they disagree: the judge passed, the evaluator\'s own verdict denied', () => {
    expect(layerLine({ outcome: 'fail', agentVerdict: 'pass', judgeCli: 'pi', denial: { source: 'evaluator_verdict' } } as never))
      .toBe('judge (pi): pass · evaluator’s own verdict: FAIL — the evaluator is what denied it');
    expect(layerLine({ outcome: 'fail', agentVerdict: 'fail', judgeCli: 'pi', denial: { source: 'agent_validator' } } as never)).toBeNull();
    expect(layerLine({ outcome: 'pass', agentVerdict: 'pass', judgeCli: null, denial: null } as never)).toBeNull();
  });

  it('codex on #430: the whole output is used only when it IS the verdict the engine cut (it ends with the kept tail)', async () => {
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'Context from the creator:\n- added OAuth wiring\nTool log:\n- npm test', outputUnavailable: null } as never);
    render(<SteeringGate runId={RUN} ord={2} prompt={PROMPT} units={UNITS} clis={['claude', 'codex']} />);
    await waitFor(() => expect(client.api.getUnitOutput).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    const field = (screen.queryByTestId('amend-prepopulated') ?? screen.getByTestId('steering-amend')) as HTMLTextAreaElement;
    expect(field.value).not.toContain('added OAuth wiring');
    expect(field.value).toContain('finding 5');
  });

  it('codex on #430: another run with the same step name reads its own output', async () => {
    const other = 'r-430-b';
    const otherFull = FULL.replace(/item 1 is wrong/, 'item 1 is OTHER');
    const otherTail = `…${otherFull.slice(otherFull.indexOf('- finding 5'))}`;
    const otherUnits = UNITS.map((u) => ({ ...u, id: u.id.replace(RUN, other), session_id: other }));
    const otherEvents = EVENTS.map((e) => {
      const ev: Record<string, unknown> = { ...(e as unknown as Record<string, unknown>), session: other };
      if (ev['type'] === 'gateEscalated') ev['verdictSummary'] = otherTail;
      if (ev['type'] === 'gateEvaluated') { ev['denialReason'] = otherTail; ev['denial'] = { ...(ev['denial'] as object), reason: otherTail }; }
      return ev;
    }) as unknown as CoreEvent[];
    useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 2, prompt: PROMPT, lifecycle: 'open', receivedAt: 1 }, [other]: { runId: other, ord: 2, prompt: PROMPT, lifecycle: 'open', receivedAt: 1 } } });
    useRunEventStore.setState({ byRun: { [RUN]: EVENTS, [other]: otherEvents } });
    vi.spyOn(client.api, 'getUnitOutput').mockImplementation(async (runId: string) => ({ output: runId === other ? otherFull : FULL, outputUnavailable: null }) as never);
    const { rerender } = render(<SteeringGate runId={RUN} ord={2} prompt={PROMPT} units={UNITS} clis={['claude', 'codex']} />);
    await waitFor(() => expect(((screen.queryByTestId('amend-prepopulated') ?? screen.getByTestId('steering-amend')) as HTMLTextAreaElement).value).toContain('item 1 is wrong'));
    rerender(<SteeringGate runId={other} ord={2} prompt={PROMPT} units={otherUnits} clis={['claude', 'codex']} />);
    await waitFor(() => expect(client.api.getUnitOutput).toHaveBeenCalledWith(other, expect.anything()));
  });

  it('codex on #430: a judge that did not run is not said to have passed', () => {
    expect(layerLine({ outcome: 'fail', agentVerdict: 'PASS', judgeSkipped: 'no judge configured', judgeCli: null, denial: { source: 'evaluator_verdict' } } as never)).toBeNull();
    expect(layerLine({ outcome: 'fail', agentVerdict: 'PASS', judgeSkipped: null, judgeCli: 'pi', denial: { source: 'evaluator_verdict' } } as never)).toMatch(/^judge \(pi\): pass/);
  });
});

