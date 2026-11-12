// H3 (HOST-API §6): the run page's host context — the phase, the open gate's host controls for an artifact,
// and the chat drawer's body.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SessionView } from '../src/api/types.js';
import { phaseOf, primaryRunOf, useRunHostValue } from '../src/components/session/RunHost.js';
import type { ArtifactBinding, RunHostContext } from '../src/editors/hostApi.js';
import { useGateStore } from '../src/store/gates.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { makeUnit, makeView } from './factories.js';

// The recording verbs (H6) are their own component; here only the wiring is under test: which binding
// and which run's units reach them.
vi.mock('../src/components/editorPorts/RecordingGateActions.js', () => ({
  recordingGateActions: (b: { source: string; runId?: string }, units: readonly unknown[], _onEdit?: unknown, _script?: boolean, cutOpens?: boolean) => (b.source === 'walkthrough' || b.source === 'demo')
    ? <span data-testid="rec-actions" data-run={b.runId} data-units={units.length} data-cut-opens={String(cutOpens === true)} /> : null,
}));

const run = (id: string, status: string, over: Record<string, unknown> = {}): SessionView => makeView({ id, status: status as never, unit_ix: 1, ...over }, [
  makeUnit({ id: `${id}:u0`, session_id: id, ord: 0, status: 'done', phase_ref: 'build' }),
  makeUnit({ id: `${id}:u1`, session_id: id, ord: 1, status: 'distributed', phase_ref: 'code_review' }),
]);
const binding = (artifactKey: string, runId?: string): ArtifactBinding => ({ artifactKey, title: 'A page', kind: 'page', source: 'interactive-doc', projectId: 'p', composerKey: 'run:r1', ...(runId !== undefined ? { runId } : {}) });

let ctx: RunHostContext | null = null;
function Harness({ runs }: { runs: SessionView[] }): React.ReactElement {
  ctx = useRunHostValue(runs, () => <p>drawer</p>);
  return <div />;
}

beforeEach(() => {
  ctx = null;
  useGateStore.setState({ gates: { r1: { runId: 'r1', ord: 1, prompt: 'Holds?', lifecycle: 'open', receivedAt: 1, gateKind: 'review' } } });
  useGateActionStore.setState({ byGate: {} });
});
afterEach(() => cleanup());

describe('the run host context', () => {
  it('the page’s run is the newest still going, else the newest', () => {
    expect(primaryRunOf([run('a', 'executing'), run('b', 'completed')])?.session.id).toBe('a');
    expect(primaryRunOf([run('a', 'failed'), run('b', 'completed')])?.session.id).toBe('b');
    expect(primaryRunOf([])).toBeNull();
  });

  it('the phase is the live run’s current step, in plain words; a finished run has none', () => {
    expect(phaseOf(run('r1', 'executing'))).toBe('Code review');
    expect(phaseOf(run('r1', 'completed'))).toBeNull();
    // A chat's own answer run is not a step of the artifact: the header says no phase for it.
    expect(phaseOf(makeView({ status: 'awaiting_human', ask_path: true } as never, [makeUnit({ id: 'c408bf71:recon', stage: 'recon' as never })]))).toBeNull();
  });

  it.each([
    { phase_ref: 'wf-e246ea98-cfcc-42b8-8a56-38c25c7659b2:unit-1', stage: null, id: 'c408bf71:unit-1', expected: null },
    { phase_ref: null, stage: null, id: 'c408bf71:critique', expected: 'Critique' },
    { phase_ref: 'wf-e246ea98-cfcc-42b8-8a56-38c25c7659b2:unit-1', stage: 'draft', id: 'c408bf71:unit-1', expected: 'Draft' },
    { phase_ref: 'workflow:code_review', stage: null, id: 'c408bf71:unit-1', expected: 'Code review' },
    { phase_ref: 'wf-internal', stage: 'unit-build', id: 'c408bf71:unit-1', expected: null },
    { phase_ref: 'step-c408bf71', stage: 'e246ea98-cfcc-42b8-8a56-38c25c7659b2', id: 'c408bf71:unit-1', expected: null },
    { phase_ref: '  ', stage: null, id: 'c408bf71:unit-1', expected: null },
  ])('shows a readable phase or nothing for $phase_ref / $stage / $id', ({ expected, ...unit }) => {
    // Live ask-path runs can carry no stage, or a phase name outside the contract's legacy StageKind enum.
    expect(phaseOf(makeView({ status: 'executing' }, [makeUnit({ ...unit, stage: unit.stage as never })]))).toBe(expected);
  });

  it.each(['completed', 'cancelled', 'failed'] as const)('hides even a readable phase for a %s run', (status) => {
    expect(phaseOf(makeView({ status }, [makeUnit({ id: 'c408bf71:critique' })]))).toBeNull();
  });

  it('an artifact of the run with the open gate gets Approve (queued, undoable) and the way to the gate card', () => {
    useGateStore.setState({ gates: { r1: { runId: 'r1', ord: 1, prompt: 'Approve unit 2 before it runs', lifecycle: 'open', receivedAt: 1, gateKind: 'def' } } });
    render(<Harness runs={[run('r1', 'awaiting_human')]} />);
    expect(ctx?.runId).toBe('r1');
    render(<>{ctx!.gateActions!(binding('r1:p/home'))}</>);
    fireEvent.click(screen.getByTestId('run-gate-approve'));
    expect(useGateActionStore.getState().byGate['r1']?.queued).toBe(true);
    expect(screen.getByTestId('run-gate-open')).toHaveTextContent('Send back or more');
  });

  it('an artifact naming a run this page does not hold gets no gate controls — never another run’s (codex h3-r1 #1)', () => {
    render(<Harness runs={[run('r1', 'awaiting_human')]} />);
    const { container } = render(<>{ctx!.gateActions!(binding('r9:p/home', 'r9'))}</>);
    expect(container.querySelector('[data-testid="run-gate-actions"]')).toBeNull();
  });

  it('fail closed (codex final P1): a gate of unknown kind (a late join), an escalation, a consent or a free-text gate gets no bare Approve', () => {
    const cases: Array<Record<string, unknown>> = [{}, { gateKind: 'escalation' }, { gateKind: 'consent' }, { gateKind: 'def', choices: null }, { gateKind: 'def', choices: ['a', 'b', 'c'] },
      { gateKind: 'def', choices: ['retry', 'stop'] }, { gateKind: 'def', choices: ['ok'] }, { gateKind: 'def', choices: [] }];
    for (const extra of cases) {
      cleanup();
      useGateStore.setState({ gates: { r1: { runId: 'r1', ord: 1, prompt: 'Gate?', lifecycle: 'open', receivedAt: 1, ...extra } as never } });
      render(<Harness runs={[run('r1', 'awaiting_human')]} />);
      render(<>{ctx!.gateActions!(binding('r1:p/home'))}</>);
      expect(screen.queryByTestId('run-gate-approve')).toBeNull();
      expect(screen.getByTestId('run-gate-open')).toHaveTextContent('Answer in the thread');
    }
  });

  it('a deliver gate offers only the way to its card (the push is answered there)', () => {
    useGateStore.setState({ gates: { r1: { runId: 'r1', ord: 1, prompt: 'Deliver?', lifecycle: 'open', receivedAt: 1, gateKind: 'deliver' } } });
    render(<Harness runs={[run('r1', 'awaiting_human')]} />);
    render(<>{ctx!.gateActions!(binding('r1:p/home'))}</>);
    expect(screen.queryByTestId('run-gate-approve')).toBeNull();
    expect(screen.getByTestId('run-gate-open')).toHaveTextContent('Answer in the thread');
  });

  it('the chat drawer is the run page’s own', () => {
    render(<Harness runs={[run('r1', 'executing')]} />);
    render(<>{ctx!.renderChat!()}</>);
    expect(screen.getByText('drawer')).toBeTruthy();
  });

  it('a recording artifact gets its own verbs (Ask helpers to fix, Edit the check) from its run, beside the gate controls', () => {
    render(<Harness runs={[run('r1', 'awaiting_human')]} />);
    render(<>{ctx!.gateActions!({ ...binding('r1:run/walkthrough'), kind: 'walkthrough', source: 'walkthrough' })}</>);
    const rec = screen.getByTestId('rec-actions');
    expect(rec).toHaveAttribute('data-run', 'r1');
    expect(rec).toHaveAttribute('data-units', '2');
    expect(screen.getByTestId('run-gate-open')).toBeTruthy();
  });

  it('G7 piece 2: the run host binds a demo\'s made cut to its card, so it tells the verbs a cut opens (Edit the cut)', () => {
    render(<Harness runs={[run('r1', 'completed')]} />);
    render(<>{ctx!.gateActions!({ ...binding('r1:run/demo-video'), kind: 'demo-video', source: 'demo' })}</>);
    expect(screen.getByTestId('rec-actions')).toHaveAttribute('data-cut-opens', 'true');
  });

  it('a page artifact gets no recording verbs', () => {
    render(<Harness runs={[run('r1', 'awaiting_human')]} />);
    render(<>{ctx!.gateActions!(binding('r1:p/home'))}</>);
    expect(screen.queryByTestId('rec-actions')).toBeNull();
  });
});
