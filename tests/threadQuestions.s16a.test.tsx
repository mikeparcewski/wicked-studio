/**
 * S16a-4g: every question a run or a chat asks is answered in its session thread.
 *  - RunQuestions (under the run's card): an MCP question answered with ONE POST; the stall
 *    watchdog's hand-off; nothing on a finished run; `#gate` focuses the question when no gate is open.
 *  - ChatQuestions (a chat thread's foot): the chat-keyed gate survives a runs reconcile while the
 *    thread is mounted (pinned) and is answered with ONE decision POST after the undo window;
 *    GateRow's `view: null` arm offers approve / steer / send back / stop and never reassign.
 *  - AnswerInThread / the author panel: one line, no card, nothing sent.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { setUndoWindowForTest, undoDecision, useUndoQueue } from '../src/board/undoQueue.js';
import { AnswerInThread, answerPath } from '../src/components/AnswerInThread.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { ChatQuestions, RunQuestions } from '../src/components/session/ThreadQuestions.js';
import { useElicitationStore } from '../src/store/elicitations.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { makeView } from './factories.js';

const NOW = 1_700_000_000_000;

function gate(runId: string, over: Partial<OpenGate> = {}): OpenGate {
  return { runId, ord: 2, prompt: 'Approve the outline?', lifecycle: 'open', receivedAt: NOW, ...over };
}

beforeEach(() => {
  vi.restoreAllMocks();
  setUndoWindowForTest(0);
  useGateStore.setState({ gates: {} });
  useGateActionStore.setState({ byGate: {} });
  useElicitationStore.setState({ elicitations: {}, generations: {} } as never);
  useRunEventStore.setState({ byRun: {} });
  vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  for (const p of useUndoQueue.getState().pending) undoDecision(p.id);
  cleanup();
});

describe('RunQuestions — under the run\'s card', () => {
  it('an MCP question on a live run is answered there with ONE POST', async () => {
    const respond = vi.spyOn(client.api, 'respondToElicitation').mockResolvedValue({} as never);
    act(() => { useElicitationStore.getState().setElicitation({ runId: 'r1', elicitationId: 'e1', message: 'Which region?', options: null, receivedAt: new Date(NOW).toISOString() }); });
    render(<RunQuestions view={makeView({ id: 'r1', status: 'executing' })} />);
    const prompt = screen.getByTestId('elicitation-prompt');
    expect(prompt).toHaveTextContent('Which region?');
    fireEvent.change(screen.getByPlaceholderText('Your answer'), { target: { value: 'eu-west' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(respond).toHaveBeenCalledTimes(1));
    expect(respond).toHaveBeenCalledWith('r1', { elicitationId: 'e1', action: 'accept', content: { response: 'eu-west' } });
  });

  it('the stall watchdog\'s hand-off renders in the block while the run executes', () => {
    useRunEventStore.setState({
      byRun: { r2: [{ type: 'workerStallEscalated', session: 'r2', ord: 3, needsYou: true, action: 'reassign', outcome: 'exhausted', ts: NOW } as never] },
    });
    render(<RunQuestions view={makeView({ id: 'r2', status: 'executing' })} />);
    expect(screen.getByTestId('needs-you-card')).toBeInTheDocument();
  });

  it('a finished run asks nothing', () => {
    act(() => { useElicitationStore.getState().setElicitation({ runId: 'r3', elicitationId: 'e3', message: 'Late?', options: null, receivedAt: new Date(NOW).toISOString() }); });
    const { container } = render(<RunQuestions view={makeView({ id: 'r3', status: 'completed' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('#gate on arrival focuses the question\'s first control when no gate is open', () => {
    window.history.replaceState(null, '', '/s/run%3Ar4#gate');
    act(() => { useElicitationStore.getState().setElicitation({ runId: 'r4', elicitationId: 'e4', message: 'Proceed?', options: ['yes', 'no'], receivedAt: new Date(NOW).toISOString() }); });
    render(<RunQuestions view={makeView({ id: 'r4', status: 'executing' })} />);
    expect(screen.getByTestId('elicitation-prompt').contains(document.activeElement)).toBe(true);
  });
});

describe('ChatQuestions — the chat\'s own gate at its thread foot', () => {
  it('pins the chat id: a runs reconcile never sweeps the chat-keyed gate while the thread is mounted', () => {
    const { unmount } = render(<ChatQuestions chatId="chat-1" />);
    act(() => { useGateStore.getState().setGate(gate('chat-1')); });
    act(() => { useGateStore.getState().reconcile([]); });
    expect(screen.getByTestId('session-chat-questions')).toHaveAttribute('data-chat-id', 'chat-1');
    expect(screen.getByTestId('session-gate-row')).toBeInTheDocument();
    unmount();
    act(() => { useGateStore.getState().reconcile([]); });
    expect(useGateStore.getState().gates['chat-1']).toBeUndefined();
  });

  it('offers approve / steer / send back / stop (no reassign) and sends ONE decision after the undo window', async () => {
    setUndoWindowForTest(30);
    render(<ChatQuestions chatId="chat-2" />);
    act(() => { useGateStore.getState().setGate(gate('chat-2')); });
    const keys = screen.getAllByTestId('session-gate-choice').map((c) => c.dataset['choiceKey']);
    expect(keys).toEqual(['approve', 'steer', 'send-back', 'stop']);
    expect(keys.some((k) => k?.startsWith('reassign'))).toBe(false);
    fireEvent.click(screen.getAllByTestId('session-gate-choice')[0]!);
    expect(client.api.confirmGate).not.toHaveBeenCalled(); // inside the undo window
    await waitFor(() => expect(client.api.confirmGate).toHaveBeenCalledTimes(1));
    expect(client.api.confirmGate).toHaveBeenCalledWith('chat-2', expect.objectContaining({ approve: true, ord: 2 }));
  });

  it('GateRow view:null reads no run events (no hydration)', () => {
    const events = vi.spyOn(client.api, 'getRunEvents');
    render(<GateRow view={null} gate={gate('chat-3')} chatId="chat-3" />);
    expect(screen.getByTestId('session-gate-row')).toBeInTheDocument();
    expect(events).not.toHaveBeenCalled();
  });
});

describe('AnswerInThread — the one line a dock or panel shows', () => {
  it('names the question and links to the session with #gate; nothing without a waiting question', async () => {
    const { rerender } = render(<AnswerInThread subject={{ kind: 'chat', chatId: 'chat-9' }} />);
    expect(screen.queryByTestId('answer-in-thread')).toBeNull();
    act(() => { useGateStore.getState().setGate(gate('chat-9', { prompt: 'Ship the draft?' })); });
    rerender(<AnswerInThread subject={{ kind: 'chat', chatId: 'chat-9' }} />);
    const line = screen.getByTestId('answer-in-thread');
    expect(line).toHaveTextContent('Ship the draft?');
    expect(screen.getByTestId('answer-in-thread-open')).toHaveAttribute('href', '/s/chat-9#gate');
    expect(answerPath({ kind: 'run', runId: 'r 1' })).toBe('/s/run%3Ar%201#gate');
    const pop = vi.fn();
    window.addEventListener('popstate', pop);
    fireEvent.click(screen.getByTestId('answer-in-thread-open'));
    window.removeEventListener('popstate', pop);
    expect(window.location.pathname + window.location.hash).toBe('/s/chat-9#gate');
    expect(pop).toHaveBeenCalledTimes(1);
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });
});

describe('AuthorPanel (testing rules) — the propose gate is answered in the run\'s thread', () => {
  it('shows the line, no gate card, and fires onAuthored when the store clears the gate', async () => {
    const steering = await import('../src/api/steering.js');
    vi.spyOn(steering, 'authorSteeringRules').mockResolvedValue({ runId: 'r-author' } as never);
    const { AuthorPanel } = await import('../src/components/SteeringAuthorPanel.js');
    const onAuthored = vi.fn();
    render(<AuthorPanel type="testing" onClose={() => undefined} onAuthored={onAuthored} />);
    fireEvent.change(screen.getByTestId('steering-author-instructions'), { target: { value: 'cover checkout' } });
    fireEvent.click(screen.getByRole('button', { name: 'Launch authoring run' }));
    await screen.findByTestId('steering-author-waiting');
    act(() => { useGateStore.getState().setGate(gate('r-author', { prompt: 'Propose 2 testing rules?' })); });
    expect(screen.getByTestId('answer-in-thread-open')).toHaveAttribute('href', '/s/run%3Ar-author#gate');
    expect(screen.queryByTestId('steering-gate')).toBeNull();
    act(() => { useGateStore.getState().clearGate('r-author'); });
    await waitFor(() => expect(onAuthored).toHaveBeenCalledTimes(1));
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });
});
