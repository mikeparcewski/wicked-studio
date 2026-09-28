// Batch W2-S3: the gate card's content, source, verdict states and steer scope.
//  - studio#232: the card leads with the artifact under review and what runs next; the run's
//    working unit comes from the live log, not a lagging snapshot cursor.
//  - core#465 (studio half): a steer at a pre-run gate can target the fix (creator) phase.
//  - studio#306: `agentVerdict: "skipped"` renders as "judge skipped — reason", never a verdict.
//  - studio#310 R8: the revise seed reads the last evaluation that SAID something.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SteeringGate } from '../src/components/SteeringGate.js';
import { GateVerdict } from '../src/components/GateVerdict.js';
import { DecisionsLedger } from '../src/components/DecisionsLedger.js';
import { VerdictDetail } from '../src/components/VerdictDetail.js';
import { reviseContextOf } from '../src/components/RunDelivery.js';
import { gateVerdict } from '../src/components/gateVerdictModel.js';
import { liveExecutingOrd, mergeRunModel } from '../src/hooks/useRunModel.js';
import * as client from '../src/api/client.js';
import { useAnnotationStore } from '../src/store/annotations.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { useSteeringStore } from '../src/store/steering.js';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'w2s3-run';
const ev = (e: Record<string, unknown>): CoreEvent => e as unknown as CoreEvent;

beforeEach(() => {
  vi.restoreAllMocks();
  useGateStore.setState({ gates: {} });
  useAnnotationStore.setState({ drafts: {} });
  useSteeringStore.setState({ entries: [], seq: 0 });
  useRunEventStore.setState({ byRun: {} });
  vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
});

const UNITS = [
  { id: `${RUN}:triage`, ord: 1, stage: 'recon', status: 'done', assigned_cli: 'claude', phase_ref: 'triage', role: 'neutral' },
  { id: `${RUN}:fix`, ord: 2, stage: 'build', status: 'pending', assigned_cli: 'claude', phase_ref: 'fix', role: 'creator' },
  { id: `${RUN}:verify`, ord: 3, stage: 'review', status: 'pending', assigned_cli: 'codex', phase_ref: 'verify', role: 'evaluator' },
] as unknown as WorkUnit[];

describe('studio#232 — the card leads with the artifact under review', () => {
  const PROMPT = 'Approve unit 2 before it runs: fix — Fix issue #12: the parser drops the trailing token …';

  it('names the finished phase under review and what runs next, above the prompt', () => {
    render(<SteeringGate runId={RUN} ord={2} prompt={PROMPT} units={UNITS} />);
    const block = screen.getByTestId('gate-under-review');
    expect(block).toHaveAttribute('data-reviewed-ord', '1');
    expect(block).toHaveTextContent(/triage/);
    expect(screen.getByTestId('gate-next')).toHaveTextContent(/fix/);
    // The artifact leads: the block reads before the echoed prompt.
    expect(block.compareDocumentPosition(screen.getByTestId('steering-prompt')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reads the reviewed phase's output only when opened, and shows it", async () => {
    const spy = vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'Root cause: the tokenizer stops at EOF.' });
    const user = userEvent.setup();
    render(<SteeringGate runId={RUN} ord={2} prompt={PROMPT} units={UNITS} />);
    expect(spy).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('gate-under-review-toggle'));
    expect(spy).toHaveBeenCalledWith(RUN, 'triage');
    expect(await screen.findByTestId('gate-under-review-output')).toHaveTextContent('Root cause: the tokenizer stops at EOF.');
  });

  it("the engine's reviewingOrd wins over the ord-before guess", () => {
    useRunEventStore.setState({ byRun: { [RUN]: [ev({ type: 'awaitingHuman', ord: 3, reviewingOrd: 2, prompt: 'x', gateKind: 'def' })] } });
    const units = UNITS.map((u) => (u.ord === 2 ? { ...u, status: 'done' } : u)) as WorkUnit[];
    render(<SteeringGate runId={RUN} ord={3} prompt={'Approve unit 3 before it runs: verify — review'} units={units} />);
    expect(screen.getByTestId('gate-under-review')).toHaveAttribute('data-reviewed-ord', '2');
  });

  it('the first unit has nothing under review: no block', () => {
    render(<SteeringGate runId={RUN} ord={1} prompt={'Approve unit 1 before it runs: triage — Fix issue #12'} units={UNITS} />);
    expect(screen.queryByTestId('gate-under-review')).toBeNull();
  });
});

describe('studio#232 — the working unit comes from the live log', () => {
  const units = [
    makeUnit({ id: 'r:index', ord: 1, status: 'distributed' }),
    makeUnit({ id: 'r:annotate', ord: 2, status: 'pending' }),
  ];
  const session = makeView({ status: 'executing', unit_ix: 0 }, units).session;

  it('a unitDone for the cursor unit and a unitExecuting for the next moves the label on', () => {
    const events = [ev({ type: 'unitExecuting', ord: 1 }), ev({ type: 'unitDone', ord: 1 }), ev({ type: 'unitExecuting', ord: 2 })];
    expect(liveExecutingOrd(session, units, events)).toBe(2);
  });

  it('between units (the last one done, the next not started) nothing is executing', () => {
    const events = [ev({ type: 'unitExecuting', ord: 1 }), ev({ type: 'unitDone', ord: 1 })];
    expect(liveExecutingOrd(session, units, events)).toBeNull();
  });

  it('an unhydrated log falls back to the snapshot cursor', () => {
    expect(liveExecutingOrd(session, units, [])).toBe(1);
  });
});

describe('core#465 — a steer at a pre-run gate can target the fix phase', () => {
  const INTAKE = 'Approve unit 1 before it runs: triage — Fix issue #12';

  it('defaults the steer to the first creator phase and sends amendScope "creator"', async () => {
    const user = userEvent.setup();
    render(<SteeringGate runId={RUN} ord={1} prompt={INTAKE} units={UNITS} />);
    expect(screen.getByTestId('steer-scope')).toHaveTextContent(/fix/);
    expect(screen.getByTestId('steer-scope-creator')).toBeChecked();
    await user.type(screen.getByTestId('steering-amend'), 'merge branch x first');
    await user.click(screen.getByTestId('steering-approve-steer'));
    expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, { approve: true, amend: 'merge branch x first', amendScope: 'creator' });
  });

  it('the operator can keep the steer on the unit about to run', async () => {
    const user = userEvent.setup();
    render(<SteeringGate runId={RUN} ord={1} prompt={INTAKE} units={UNITS} />);
    await user.click(screen.getByTestId('steer-scope-cursor'));
    await user.type(screen.getByTestId('steering-amend'), 'look at the parser first');
    await user.click(screen.getByTestId('steering-approve-steer'));
    expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, { approve: true, amend: 'look at the parser first' });
  });

  it('no picker when the unit about to run IS the creator, or no creator follows', () => {
    const { unmount } = render(<SteeringGate runId={RUN} ord={2} prompt={'Approve unit 2 before it runs: fix — x'} units={UNITS} />);
    expect(screen.queryByTestId('steer-scope')).toBeNull();
    unmount();
    render(<SteeringGate runId={RUN} ord={3} prompt={'Approve unit 3 before it runs: verify — x'} units={UNITS} />);
    expect(screen.queryByTestId('steer-scope')).toBeNull();
  });
});

describe('studio#306 — agentVerdict "skipped" is no judge verdict', () => {
  const SKIPPED = {
    type: 'gateEvaluated', session: RUN, ord: 1, criterion: 'the fix passes its tests', combined: true,
    hasDeterministicFloor: true, deterministicPass: true, agentVerdict: 'skipped', agentReasoning: null,
    judgeDistinct: false, judgeCli: null, judgeSkippedReason: 'claude is the only eligible seat and it created the work',
    evaluatorPass: true, evaluatorPolicies: [],
  };

  it('the gate card says "judge skipped — reason", with no judge chip', () => {
    const view = gateVerdict([ev(SKIPPED)], 1)!;
    render(<GateVerdict view={view} phase="fix" />);
    expect(screen.getByTestId('gate-verdict-judge-skipped')).toHaveTextContent('judge skipped — claude is the only eligible seat and it created the work');
    expect(screen.queryByTestId('gate-verdict-judge')).toBeNull();
    expect(view.agentVerdict).toBeNull();
  });

  it('the decisions ledger says "judge skipped", never "agent: skipped" or "agent judge"', () => {
    const snap = makeView({}, [makeUnit({ id: `${RUN}:fix`, ord: 1 })]);
    render(<DecisionsLedger model={mergeRunModel(snap, [ev(SKIPPED)])} />);
    const ledger = screen.getByTestId('decisions-ledger');
    expect(ledger.textContent).toMatch(/judge skipped — claude is the only eligible seat/);
    expect(ledger.textContent).not.toMatch(/agent: skipped/);
    expect(ledger.textContent).not.toMatch(/agent judge/);
  });

  it('the verdict detail says "judge skipped" and shows judgeDistinct false beside it', () => {
    useRunEventStore.setState({ byRun: { [RUN]: [ev(SKIPPED)] } });
    render(<VerdictDetail runId={RUN} units={[makeUnit({ id: `${RUN}:fix`, ord: 1 })]} />);
    const skipped = screen.getByTestId('verdict-judge-skipped');
    expect(skipped).toHaveTextContent('judge skipped — claude is the only eligible seat');
    expect(skipped).toHaveAttribute('data-judge-distinct', 'false');
    expect(screen.getByTestId('verdict-detail').textContent).not.toMatch(/\bskipped —.*skipped/);
  });

  it('a "pass" verdict is unchanged', () => {
    const view = gateVerdict([ev({ ...SKIPPED, agentVerdict: 'pass', judgeSkippedReason: undefined, judgeCli: 'codex', judgeDistinct: true })], 1)!;
    render(<GateVerdict view={view} phase="fix" />);
    expect(screen.getByTestId('gate-verdict-judge')).toHaveTextContent('judge: pass');
    expect(screen.queryByTestId('gate-verdict-judge-skipped')).toBeNull();
  });
});

describe('studio#310 R8 — the revise seed reads the last evaluation that said something', () => {
  it('scans past a clean deliver evaluation to the verdict before it', () => {
    const events = [
      ev({ type: 'gateEvaluated', ord: 3, evaluatorVerdict: 'VERDICT: pass — the fix holds; one nit in parser.ts' }),
      ev({ type: 'gateEvaluated', ord: 4, combined: true }),
    ];
    expect(reviseContextOf(events)).toBe('VERDICT: pass — the fix holds; one nit in parser.ts');
  });

  it('a denial reason still counts, and an empty log seeds nothing', () => {
    expect(reviseContextOf([ev({ type: 'gateEvaluated', ord: 2, denial: { reason: 'tests fail' } }), ev({ type: 'gateEvaluated', ord: 3 })])).toBe('tests fail');
    expect(reviseContextOf([])).toBeNull();
  });
});
