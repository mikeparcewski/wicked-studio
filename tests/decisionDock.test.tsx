// The decision dock (mockup ui-v2-gate + the operator's addendum, 2026-10-27): a decision is its own surface above the
// composer, never a chat bubble; the thread keeps a one-line marker; the reply box answers the decision or asks a
// separate question, as the draft's intent (the platform's prompt routing) or the person's override says.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import * as client from '../src/api/client.js';
import type { SessionView } from '../src/api/types.js';
import { SessionPage } from '../src/components/session/SessionView.js';
import { DecisionDockFrame, DecisionMarker, Docked, eyebrowWords } from '../src/components/session/DecisionDock.js';
import { GateRow, judgeSeats } from '../src/components/session/GateRow.js';
import { peekRetryPrefill } from '../src/store/retryPrefill.js';
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
  it('a docked decision with no note choice (a hand-over): the box and its footer say Send asks a separate question', async () => {
    useGateStore.setState({ gates: { r1: { runId: 'r1', ord: 3, prompt: 'Approve delivery before unit 3 runs. Pushes branch wicked/r1', lifecycle: 'open', receivedAt: Date.now(), gateKind: 'deliver' } } });
    useRunEventStore.setState({ byRun: { r1: [] } });
    page();
    await screen.findByTestId('decision-dock');
    await waitFor(() => expect(screen.getByTestId('session-composer-input').getAttribute('placeholder')).toBe('Ask a separate question about this job…'));
    expect(screen.getByTestId('session-reply-switch').textContent).toBe('Send asks a separate question');
    expect(screen.queryByTestId('session-reply-flip')).toBeNull();
  });

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

  const viewWith = (clis: string[]): SessionView => {
    const v = live();
    (v.session as unknown as { clis: string[] }).clis = clis;
    return v;
  };
  const rosterWith = (piSignedIn: boolean): void => setCachedRoster(ROSTER.map((r) => (r.key === 'pi' ? { ...r, signed_in: piSignedIn } : r)) as never);

  it('builder ≠ judge: every seat that built the judged work is excluded (the creator steps, crew\'s "built on", the gate\'s own seat)', () => {
    const j = judgeSeats(viewWith(['claude', 'codex', 'pi']), 2, REFUSAL, ['claude', 'codex', 'pi'], ROSTER as never);
    expect(j.builders.sort()).toEqual(['claude', 'codex']);
    expect(j.inJob).toBeUndefined();
  });

  it('none is free: the headline says so and the primary opens sign-in; no builder is ever offered as the lead', async () => {
    useRunEventStore.setState({ byRun: { r1: refusalEvents } });
    rosterWith(false);
    render(<GateRow view={viewWith(['claude', 'codex', 'pi'])} gate={{ ...GATE, prompt: REFUSAL }} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('session-gate-question').textContent).toBe('No second helper is free to review this'));
    expect(screen.getByTestId('session-gate-lead-act').textContent).toBe('Sign in a second helper');
    expect(screen.queryAllByTestId('session-gate-choice').some((b) => /Claude Code|Codex/.test(b.textContent ?? '') && b.className.includes('--primary'))).toBe(false);
    // The explanation, the receipt and the raw detail are folded behind More about this.
    expect((screen.getByTestId('session-gate-more-about') as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByTestId('session-gate-more-about').contains(screen.getByTestId('session-gate-creator-seat'))).toBe(true);
  });

  it('a distinct seat in the job is free: it is the headline and the primary (approve and retry with it)', async () => {
    useRunEventStore.setState({ byRun: { r1: refusalEvents } });
    rosterWith(true);
    render(<GateRow view={viewWith(['claude', 'codex', 'pi'])} gate={{ ...GATE, prompt: REFUSAL }} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('session-gate-question').textContent).toBe('Pi CLI can review this instead'));
    const primary = screen.getAllByTestId('session-gate-choice')[0]!;
    expect(primary.textContent).toBe('Approve and retry with Pi CLI');
    expect(primary.className).toMatch(/wk-gate2-btn--primary/);
  });

  it('a distinct seat is signed in but outside the job (crew re-seats only within it): start again with it, never a builder', async () => {
    useRunEventStore.setState({ byRun: { r1: refusalEvents } });
    rosterWith(true);
    const navigate = vi.fn();
    render(<GateRow view={viewWith(['claude', 'codex'])} gate={{ ...GATE, prompt: REFUSAL }} navigate={navigate} />);
    await waitFor(() => expect(screen.getByTestId('session-gate-question').textContent).toBe('Pi CLI could review this, but isn’t one of this job’s helpers'));
    fireEvent.click(screen.getByTestId('session-gate-lead-act'));
    expect(navigate).toHaveBeenCalledWith('/runs/new');
    expect(peekRetryPrefill()?.clis).toEqual(['claude', 'codex', 'pi']);
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
    // Stop is the menu's last way on (mockup ui-v2-gate), after a rerun from the overflow (gate_move journey).
    expect(keys[keys.length - 1]).toBe('stop');
  });

  it('the face\'s one button says what it does ABOVE the buttons, so hovering it never grows the dock under the pointer', async () => {
    render(<GateRow view={live()} gate={GATE} navigate={vi.fn()} />);
    const choices = await screen.findByTestId('session-gate-choices');
    const primary = choices.querySelector<HTMLElement>(':scope > [data-testid="session-gate-choice"]');
    expect(primary).not.toBeNull();
    const line = screen.getByTestId('session-gate-consequence');
    expect(line.textContent).not.toBe('');
    // The line is before the buttons in the row's order.
    expect(line.compareDocumentPosition(choices) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.mouseEnter(primary!);
    expect(screen.getByTestId('session-gate-choice-consequence').textContent).toBe('');
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

describe('the phone sheet, folded (live nit 2026-10-27: act without expanding the sheet)', () => {
  // jsdom has no matchMedia: stub it for the dock's phone query.
  const phone = (matches: boolean): void => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }) as unknown as MediaQueryList);
  };
  afterEach(() => { vi.unstubAllGlobals(); });

  it('folded: the eyebrow, the renderer\'s own headline and its primary move are in the sheet; no stand-in peek', async () => {
    phone(true);
    page();
    const dock = await screen.findByTestId('decision-dock');
    expect(dock.dataset.collapsed).toBe('true');
    const slot = within(dock).getByTestId('decision-dock-slot');
    // The slot is drawn (folded by CSS to the headline + primary), never hidden.
    expect(slot.hidden).toBe(false);
    expect(slot.dataset.folded).toBe('true');
    expect(within(dock).getByTestId('decision-dock-eyebrow').textContent).toMatch(/^Your decision/);
    expect(within(slot).getByTestId('session-gate-question').textContent).not.toBe('');
    const primary = slot.querySelector('.wk-gate2-choices > .wk-gate2-btn, [data-testid="session-gate-lead-act"]');
    expect(primary).not.toBeNull();
    await waitFor(() => expect(within(dock).queryByTestId('decision-dock-peek')).toBeNull());
  });

  it('a tap in the folded sheet unfolds it (what the tap opens is in view)', async () => {
    phone(true);
    page();
    const dock = await screen.findByTestId('decision-dock');
    fireEvent.click(within(dock).getByTestId('session-gate-question'));
    expect(dock.dataset.collapsed).toBe('false');
    expect(within(dock).getByTestId('decision-dock-slot').dataset.folded).toBe('false');
  });

  it('a desk never folds', async () => {
    phone(false);
    page();
    const dock = await screen.findByTestId('decision-dock');
    expect(dock.dataset.collapsed).toBe('false');
    expect(within(dock).queryByTestId('decision-dock-handle')).toBeNull();
  });
});

describe('#gate on a run question lands its answer field in the dock (never the thread marker)', () => {
  it('the docked question\'s field takes the focus; the marker stays in the thread', async () => {
    useGateStore.setState({ gates: {} });
    useElicitationStore.setState({ elicitations: { r1: { runId: 'r1', elicitationId: 'el-1', message: 'Which region?', options: null, receivedAt: new Date().toISOString() } } });
    window.history.replaceState(null, '', '/s/run%3Ar1#gate');
    try {
      page();
      const dock = await screen.findByTestId('decision-dock');
      const prompt = await within(dock).findByTestId('elicitation-prompt');
      await waitFor(() => expect(prompt.contains(document.activeElement)).toBe(true));
      expect(document.activeElement?.getAttribute('data-testid')).not.toBe('decision-marker');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
});
