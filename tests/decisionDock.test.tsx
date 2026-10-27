// The decision dock (mockup ui-v2-gate + the operator's addendum, 2026-10-27): a decision is its own surface above the
// composer, never a chat bubble; the thread keeps a one-line marker; the reply box answers the decision or asks a
// separate question, as the draft's intent (the platform's prompt routing) or the person's override says.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import * as client from '../src/api/client.js';
import type { SessionView } from '../src/api/types.js';
import { SessionPage } from '../src/components/session/SessionView.js';
import { DecisionDockFrame, DecisionMarker, Docked, eyebrowWords } from '../src/components/session/DecisionDock.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { useSheets } from '../src/store/sheets.js';
import { useRunEventStore } from '../src/store/events.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { useElicitationStore } from '../src/store/elicitations.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { useHostPanel } from '../src/editors/hostApi.js';
import { useUndoQueue, undoDecision } from '../src/board/undoQueue.js';
import { routeFor, switchWords, useReplyRoute } from '../src/board/replyRoute.js';
import { provideDraftRouter } from '../src/hooks/useDraftRouter.js';
import { builderResponder } from '../src/board/responder.js';
import { failingOnFace, testWords } from '../src/board/failingChecks.js';
import { floorOf } from '../src/components/gateVerdictModel.js';
import { makeUnit, makeView } from './factories.js';
import { DETAILS_OPEN_KEY } from '../src/board/runHeader.js';
import { resetRunPanel } from '../src/store/runPanel.js';
import { RUN_PANEL_KEY } from '../src/board/runPanelModel.js';
import type { CoreEvent } from '../src/api/types.js';

const ROSTER = [
  { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true, signed_in: true },
  { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, signed_in: true },
  { key: 'pi', display_name: 'Pi CLI', binary: 'pi', enabled_for_council: true, signed_in: false },
];

function live(): SessionView {
  return makeView({ id: 'r1', status: 'awaiting_human', workflow_id: 'feature', unit_ix: 2, repo_ref: 'tip-splitter', clis: ['claude', 'codex', 'pi'], base_commit: 'abc1234' } as never, [
    makeUnit({ id: 'r1:build', session_id: 'r1', ord: 1, assigned_cli: 'claude', role: 'creator', status: 'done', stage: 'build' }),
    makeUnit({ id: 'r1:review', session_id: 'r1', ord: 2, assigned_cli: 'codex', role: 'evaluator', status: 'rejected', stage: 'review' }),
    makeUnit({ id: 'r1:deliver', session_id: 'r1', ord: 3, assigned_cli: 'bash', status: 'pending', stage: 'build' }),
  ]);
}

const NOT_PASS = 'Unit 2 verdict is NOT PASS — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run.';
const GATE: OpenGate = { runId: 'r1', ord: 2, prompt: NOT_PASS, lifecycle: 'open', receivedAt: Date.now() - 3 * 3_600_000, gateKind: 'escalation' };

beforeEach(() => {
  localStorage.removeItem(RUN_PANEL_KEY);
  localStorage.removeItem(DETAILS_OPEN_KEY);
  resetRunPanel();
  setCachedRoster(ROSTER as never);
  useSheets.setState({ open: null, stopping: {} } as never);
  useRunEventStore.setState({ byRun: { r1: [{ type: 'awaitingHuman', session: 'r1', ord: 2, gateKind: 'escalation', prompt: NOT_PASS, ts: 1 }] as unknown as CoreEvent[] } });
  useCapabilities.setState({ loaded: true, runChatId: true } as never);
  useGateStore.setState({ gates: { r1: GATE } });
  useGateActionStore.setState({ byGate: {} });
  useElicitationStore.setState({ elicitations: {} });
  useHostPanel.setState({ group: null, folded: false } as never);
  provideDraftRouter(null);
  vi.spyOn(client.api, 'getWatch').mockRejectedValue(new Error('404'));
  vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] } as never);
});
afterEach(() => {
  for (const p of useUndoQueue.getState().pending) undoDecision(p.id);
  provideDraftRouter(null);
  cleanup();
  vi.restoreAllMocks();
});

const page = (): ReturnType<typeof render> => render(
  <SessionPage sessionId="run:r1" runs={[live()]} runsLoaded needRows={[]} navigate={() => {}} onAsk={vi.fn()} />,
);

describe('the dock: its own surface above the composer, never a bubble', () => {
  it('the decision docks between the thread and the composer; the thread keeps a one-line marker', async () => {
    page();
    const dock = await screen.findByTestId('decision-dock');
    // Outside the message stream, and before the composer.
    expect(screen.getByTestId('session-thread').contains(dock)).toBe(false);
    expect(dock.compareDocumentPosition(screen.getByTestId('composer')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(within(dock).getByTestId('session-gate-row')).toBeTruthy());
    // No avatar, no bubble: the asking seat's message wrapper stays out of the dock.
    expect(within(dock).queryByTestId('chat-gate')).toBeNull();
    // The eyebrow names the BUILDER (the creator step), not the reviewer the gate sits on.
    expect(within(dock).getByTestId('decision-dock-eyebrow').textContent).toBe('Your decision · Claude Code is waiting · 3 h');
    const marker = within(screen.getByTestId('session-thread')).getByTestId('decision-marker');
    expect(marker.textContent).toMatch(/^Claude Code asked for a decision · 3 hours ago/);
  });

  it('the composer reads "Or tell <builder> what to do…" while the dock is open', async () => {
    page();
    await screen.findByTestId('decision-dock');
    await waitFor(() => expect(screen.getByTestId('session-composer-input').getAttribute('placeholder')).toBe('Or tell Claude Code what to do…'));
  });

  it('more than one open decision: the dock shows the first and steps to the next', () => {
    const items = [
      { key: 'a', who: 'Codex', since: null, question: 'First?', tone: 'waiting' as const },
      { key: 'b', who: null, since: null, question: 'Second?', tone: 'blocking' as const },
    ];
    render(
      <DecisionDockFrame items={items}>
        <Docked dockKey="a" open marker={<DecisionMarker dockKey="a" who="Codex" since={null} />}><p>A in place</p></Docked>
        <Docked dockKey="b" open marker={<DecisionMarker dockKey="b" who={null} since={null} />}><p>B in place</p></Docked>
      </DecisionDockFrame>,
    );
    const dock = screen.getByTestId('decision-dock');
    expect(dock.dataset['key']).toBe('a');
    expect(within(dock).getByText('A in place')).toBeTruthy();
    expect(screen.queryByText('B in place')).toBeNull();
    expect(screen.getAllByTestId('decision-marker')).toHaveLength(2);
    fireEvent.click(within(dock).getByTestId('decision-dock-next'));
    expect(screen.getByTestId('decision-dock').dataset['key']).toBe('b');
    expect(screen.getByTestId('decision-dock').dataset['tone']).toBe('blocking');
    expect(within(screen.getByTestId('decision-dock')).getByText('B in place')).toBeTruthy();
    expect(within(screen.getByTestId('decision-dock')).getByTestId('decision-dock-eyebrow').textContent).toBe('Your decision · the job is waiting');
  });

  it('without a dock (a run block alone, the inbox pane) the renderer draws in place', () => {
    render(<Docked dockKey="a" open marker={<span>marker</span>}><p>in place</p></Docked>);
    expect(screen.getByText('in place')).toBeTruthy();
    expect(screen.queryByText('marker')).toBeNull();
  });

  it('the eyebrow\'s words', () => {
    expect(eyebrowWords({ who: 'Codex', since: 0 }, 3 * 3_600_000)).toBe('Your decision · Codex is waiting · 3 h');
    expect(eyebrowWords({ who: null, since: null }, 0)).toBe('Your decision · the job is waiting');
  });

  it('the builder is the newest creator step, never a hand-over script', () => {
    const v = live();
    expect(builderResponder(v, 2, ROSTER as never)?.name).toBe('Claude Code');
    expect(builderResponder(v, 3, ROSTER as never)?.name).toBe('Claude Code');
    const noCreator = makeView({ id: 'r2', status: 'awaiting_human' } as never, [makeUnit({ id: 'r2:deliver', session_id: 'r2', ord: 1, assigned_cli: 'bash' })]);
    expect(builderResponder(noCreator, 1, ROSTER as never)).toBeNull();
  });
});

describe('the reply box: the draft\'s intent picks where Send goes; the switch says so; a click overrides', () => {
  it('routing unavailable (today\'s crew): it replies to the decision, and the switch says why', async () => {
    page();
    await screen.findByTestId('decision-dock');
    const input = screen.getByTestId('session-composer-input');
    fireEvent.change(input, { target: { value: 'why did this fail?' } });
    const sw = await screen.findByTestId('session-reply-switch');
    expect(sw.dataset['to']).toBe('reply');
    expect(sw.dataset['why']).toBe('unavailable');
    expect(sw.textContent).toMatch(/^Replies to this decision \(Send back\) · this service can’t tell questions from instructions yet, so it replies · Ask instead$/);
  });

  it('an instruction goes to the decision\'s note choice, through its undo window', async () => {
    provideDraftRouter(async () => 'instruction');
    const confirm = vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' } as never);
    const onAsk = vi.fn();
    render(<SessionPage sessionId="run:r1" runs={[live()]} runsLoaded needRows={[]} navigate={() => {}} onAsk={onAsk} />);
    await screen.findByTestId('decision-dock');
    const input = screen.getByTestId('session-composer-input');
    fireEvent.change(input, { target: { value: 'skip the flaky test, it is on main too' } });
    await waitFor(() => expect(screen.getByTestId('session-reply-switch').dataset['why']).toBe('instruction'));
    expect(screen.getByTestId('session-reply-dest').textContent).toBe('Replies to this decision (Send back)');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAsk).not.toHaveBeenCalled();
    // Queued with its undo window: nothing posted yet, the note rides the send-back.
    const pending = useUndoQueue.getState().pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]!.amend).toBe('skip the flaky test, it is on main too');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('a question asks a separate question (the composer\'s own send)', async () => {
    provideDraftRouter(async () => 'question');
    const onAsk = vi.fn();
    render(<SessionPage sessionId="run:r1" runs={[live()]} runsLoaded needRows={[]} navigate={() => {}} onAsk={onAsk} />);
    await screen.findByTestId('decision-dock');
    const input = screen.getByTestId('session-composer-input');
    fireEvent.change(input, { target: { value: 'what does this test check?' } });
    await waitFor(() => expect(screen.getByTestId('session-reply-switch').dataset['to']).toBe('ask'));
    expect(screen.getByTestId('session-reply-switch').textContent).toBe('Asks a separate question · Reply instead');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAsk).toHaveBeenCalledWith('what does this test check?', expect.anything());
    expect(useUndoQueue.getState().pending).toHaveLength(0);
  });

  it('an override sticks for that draft, and a new draft is read afresh', async () => {
    provideDraftRouter(async () => 'question');
    const { result, rerender } = renderHook(({ text }) => useReplyRoute(text, async () => 'question', 0), { initialProps: { text: 'why did this fail?' } });
    await waitFor(() => expect(result.current.route).toEqual({ to: 'ask', why: 'question' }));
    act(() => result.current.flip());
    expect(result.current.route).toEqual({ to: 'reply', why: 'override' });
    rerender({ text: 'why did this fail? and the other one?' });
    await new Promise((r) => setTimeout(r, 5));
    expect(result.current.route).toEqual({ to: 'reply', why: 'override' });
    rerender({ text: '' });
    rerender({ text: 'what does it check?' });
    await waitFor(() => expect(result.current.route).toEqual({ to: 'ask', why: 'question' }));
  });

  it('an unclear reading goes to the decision, said so', () => {
    expect(routeFor('unclear')).toEqual({ to: 'reply', why: 'unclear' });
    expect(switchWords(routeFor('unclear'), 'Send back').why).toBe('couldn’t tell if it was a question, so it replies');
    expect(routeFor(null)).toEqual({ to: 'reply', why: 'unavailable' });
  });
});

describe('the gate card, compact (review of the dock)', () => {
  const REFUSAL = 'Unit 2 (codex) reviewed work built on its own seat: unit 2 checks work built on `codex` and ran on that same seat; the run requires a distinct evaluator (distinct_evaluator) — reassign it to a distinct signed-in seat and approve to re-run, or relaunch with reduced assurance.';
  const refusalEvents = [
    { type: 'awaitingHuman', session: 'r1', ord: 2, gateKind: 'escalation', prompt: REFUSAL, ts: 1 },
  ] as unknown as CoreEvent[];

  it('the cause is the headline, and the move the gate names is the primary: approve and retry with a free seat', async () => {
    useRunEventStore.setState({ byRun: { r1: refusalEvents } });
    const gate: OpenGate = { ...GATE, prompt: REFUSAL };
    render(<GateRow view={live()} gate={gate} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('session-gate-question').textContent).toBe('No second helper is free to review this'));
    const primary = screen.getAllByTestId('session-gate-choice')[0]!;
    expect(primary.textContent).toBe('Approve and retry with Claude Code');
    expect(primary.className).toMatch(/wk-gate2-btn--primary/);
    // The explanation, the receipt and the raw detail are folded behind More about this.
    expect((screen.getByTestId('session-gate-more-about') as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByTestId('session-gate-more-about').contains(screen.getByTestId('session-gate-creator-seat'))).toBe(true);
  });

  it('every other choice stays reachable under Other options', async () => {
    render(<GateRow view={live()} gate={GATE} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('session-gate-more')).toBeTruthy());
    const menu = screen.getByTestId('session-gate-menu');
    expect(menu.hidden).toBe(true);
    fireEvent.click(screen.getByTestId('session-gate-more'));
    expect(menu.hidden).toBe(false);
    const keys = [...menu.querySelectorAll('[data-testid="session-gate-choice"]')].map((b) => (b as HTMLElement).dataset['choiceKey']);
    expect(keys).toContain('stop');
    expect(keys.length).toBeGreaterThan(1);
  });

  it('the new failure is highlighted; the ones failing on the base too are counted and folded', () => {
    const f = failingOnFace(floorOf({
      type: 'repoChecksEvaluated', session: 'r1', ord: 2, attempt: 1, passed: false, criterion: 'checks pass', skipped: [],
      checks: [{ name: 'test', argv: [], source: '', exitCode: 1, timedOut: false, spawnError: null, durationMs: 1, stdoutTail: '', stderrTail: '',
        classification: 'regression', preExisting: ['a::test_old_one', 'a::test_old_two'], regressions: ['b::test_walkthrough_runs_in_a_jail'],
        failureIds: ['a::test_old_one', 'a::test_old_two', 'b::test_walkthrough_runs_in_a_jail'] }],
    } as unknown as CoreEvent))!;
    expect(f.split).toEqual({ fresh: ['b::test_walkthrough_runs_in_a_jail'], onBase: ['a::test_old_one', 'a::test_old_two'] });
    expect(testWords('b::test_walkthrough_runs_in_a_jail')).toBe('Walkthrough runs in a jail');
    expect(testWords('src/a.test.ts > GateRow > names tests')).toBe('names tests');
    expect(testWords('the test check')).toBe('the test check');
  });
});
