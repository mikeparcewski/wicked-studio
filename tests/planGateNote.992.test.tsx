// studio#992 (crew#1139, wire core#1270 + crew#1350): at the plan gate, a reply typed in the docked reply box is the
// approval's note. It rides `POST /runs/:id/gate {approve: true, amend}` only when the daemon says
// `/health.capabilities.planGateNote`; without it the box asks a separate question and the approve is unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as client from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import type { SessionView } from '../src/api/types.js';
import { SessionPage } from '../src/components/session/SessionView.js';
import { PLAN_NOTE_PLACEHOLDER, PLAN_NOTE_REPLY } from '../src/components/session/ProposalCard.js';
import { useRunEventStore } from '../src/store/events.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { useElicitationStore } from '../src/store/elicitations.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { useSheets } from '../src/store/sheets.js';
import { useSessionDrafts } from '../src/store/sessionDrafts.js';
import { useHostPanel } from '../src/editors/hostApi.js';
import { flushDecisionsForTest, resetDecisionsForTest, restoreNote, undoDecision, useUndoQueue } from '../src/board/undoQueue.js';
import { addAboutChip, clearAboutChips } from '../src/store/composerChips.js';
import { provideDraftRouter } from '../src/hooks/useDraftRouter.js';
import { resetRunPanel } from '../src/store/runPanel.js';
import { RUN_PANEL_KEY } from '../src/board/runPanelModel.js';
import { DETAILS_OPEN_KEY } from '../src/board/runHeader.js';
import { makeUnit, makeView } from './factories.js';
import type { CoreEvent } from '../src/api/types.js';

const ROSTER = [
  { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true, signed_in: true },
  { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, signed_in: true },
];
const NOTE = 'approve, and keep the public API unchanged';
const PLAN_PROMPT = 'Approve plan rev 1 before unit 1 runs: triage → fix → review → deliver';

function planRun(): SessionView {
  return makeView({ id: 'r1', status: 'awaiting_human', workflow_id: 'bug', unit_ix: 0, repo_ref: 'tiny-math', clis: ['claude', 'codex'], base_commit: 'abc1234' } as never, [
    makeUnit({ id: 'r1:triage', session_id: 'r1', ord: 1, assigned_cli: 'claude', role: 'neutral', status: 'pending', stage: 'recon' }),
    makeUnit({ id: 'r1:fix', session_id: 'r1', ord: 2, assigned_cli: 'codex', role: 'creator', status: 'pending', stage: 'build' }),
    makeUnit({ id: 'r1:review', session_id: 'r1', ord: 3, assigned_cli: 'claude', role: 'evaluator', status: 'pending', stage: 'review' }),
  ]);
}
const GATE: OpenGate = { runId: 'r1', ord: 1, prompt: PLAN_PROMPT, lifecycle: 'open', receivedAt: Date.now() - 60_000, gateKind: 'plan_approval' };

let confirm: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.removeItem(RUN_PANEL_KEY);
  localStorage.removeItem(DETAILS_OPEN_KEY);
  resetRunPanel();
  resetDecisionsForTest();
  setCachedRoster(ROSTER as never);
  useSheets.setState({ open: null, stopping: {} } as never);
  useSessionDrafts.setState({ drafts: {} } as never);
  useUndoQueue.setState({ restoredNotes: {} } as never);
  useRunEventStore.setState({ byRun: { r1: [{ type: 'awaitingHuman', session: 'r1', ord: 1, gateKind: 'plan_approval', prompt: PLAN_PROMPT, ts: 1 }] as unknown as CoreEvent[] } });
  useGateStore.setState({ gates: { r1: GATE }, approaching: {} });
  useGateActionStore.setState({ byGate: {} });
  useElicitationStore.setState({ elicitations: {} });
  useHostPanel.setState({ group: null, folded: false } as never);
  provideDraftRouter(null);
  vi.spyOn(client.api, 'getWatch').mockRejectedValue(new Error('404'));
  vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] } as never);
  vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false } as never);
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ rows: [], units: [] } as never);
  confirm = vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' } as never);
});
afterEach(() => {
  resetDecisionsForTest();
  provideDraftRouter(null);
  cleanup();
  vi.restoreAllMocks();
});

const page = (onAsk = vi.fn()): ReturnType<typeof render> => render(
  <SessionPage sessionId="run:r1" runs={[planRun()]} runsLoaded needRows={[]} navigate={() => {}} onAsk={onAsk} />,
);

async function typeAndSend(text: string): Promise<HTMLElement> {
  await screen.findByTestId('decision-dock');
  await screen.findByTestId('session-proposal');
  const input = screen.getByTestId('session-composer-input');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
  return input;
}

describe('studio#992: the plan gate takes a note, as a reply at the plan', () => {
  it('with planGateNote: the reply box answers the plan, and the note reaches crew\'s approval exactly', async () => {
    useCapabilities.setState({ loaded: true, runChatId: true, planGateNote: true } as never);
    const onAsk = vi.fn();
    page(onAsk);
    await screen.findByTestId('decision-dock');
    await screen.findByTestId('session-proposal');
    const input = screen.getByTestId('session-composer-input');
    fireEvent.change(input, { target: { value: `  ${NOTE}  ` } });
    await waitFor(() => expect(screen.getByTestId('session-reply-dest').textContent).toBe(`Replies to this decision (${PLAN_NOTE_REPLY})`));
    // The card keeps its quick replies, and the reply box says it takes the approval's note.
    const labels = [...screen.getByTestId('session-proposal-choices').querySelectorAll('[role="radio"] .wk-ask-opt-label')].map((e) => e.textContent);
    expect(labels).toEqual(['Approve plan', 'Change something', 'Not now', 'Don’t start']);
    expect(input.getAttribute('placeholder')).toBe(PLAN_NOTE_PLACEHOLDER);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAsk).not.toHaveBeenCalled();
    await act(async () => { await flushDecisionsForTest(); });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    const [runId, body] = confirm.mock.calls[0] as [string, Record<string, unknown>];
    expect(runId).toBe('r1');
    expect(body).toEqual({ approve: true, amend: NOTE, ord: 1 });
  });

  it('with planGateNote: Approve plan with no note sends the plain approval (no amend key)', async () => {
    useCapabilities.setState({ loaded: true, runChatId: true, planGateNote: true } as never);
    page();
    await screen.findByTestId('session-proposal');
    fireEvent.click(screen.getByTestId('session-proposal-go'));
    await act(async () => { await flushDecisionsForTest(); });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0]![1]).toEqual({ approve: true, ord: 1 });
  });

  it('without planGateNote: no note choice, the box asks a separate question, and the approval call is unchanged', async () => {
    useCapabilities.setState({ loaded: true, runChatId: true, planGateNote: false } as never);
    const onAsk = vi.fn();
    page(onAsk);
    await screen.findByTestId('session-proposal');
    await waitFor(() => expect(screen.getByTestId('session-reply-switch').textContent).toBe('Send asks a separate question'));
    expect(screen.getByTestId('session-composer-input').getAttribute('placeholder')).toBe('Ask a separate question about this job…');
    await typeAndSend(NOTE);
    expect(onAsk).toHaveBeenCalledWith(NOTE, expect.anything());
    await act(async () => { await flushDecisionsForTest(); });
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('session-proposal-go'));
    await act(async () => { await flushDecisionsForTest(); });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0]![1]).toEqual({ approve: true, ord: 1 });
  });

  it('a card choice with its own reason box (Don’t start) stands the note reply down: one note input per choice', async () => {
    useCapabilities.setState({ loaded: true, runChatId: true, planGateNote: true } as never);
    const onAsk = vi.fn();
    page(onAsk);
    await screen.findByTestId('session-proposal');
    fireEvent.click(screen.getByTestId('session-proposal-end'));
    await waitFor(() => expect(screen.getByTestId('session-reply-switch').textContent).toBe('Send asks a separate question'));
    await typeAndSend('why this order?');
    expect(onAsk).toHaveBeenCalledWith('why this order?', expect.anything());
    await act(async () => { await flushDecisionsForTest(); });
    expect(confirm).not.toHaveBeenCalled();
  });

  // ── xreview r1 (codex) ────────────────────────────────────────────────────────────────────────────────────────
  it('P1: a reply sent after the plan gate was replaced (a stale card) is not sent to the new gate', async () => {
    useCapabilities.setState({ loaded: true, runChatId: true, planGateNote: true } as never);
    page();
    await screen.findByTestId('session-proposal');
    const input = screen.getByTestId('session-composer-input');
    fireEvent.change(input, { target: { value: NOTE } });
    await waitFor(() => expect(screen.getByTestId('session-reply-dest').textContent).toBe(`Replies to this decision (${PLAN_NOTE_REPLY})`));
    // The gate moves to a hand-over in the same tick as Enter: the handler still holds the plan card's closure.
    act(() => {
      useGateStore.setState({ gates: { r1: { runId: 'r1', ord: 9, prompt: 'Approve delivery before unit 9 runs.', lifecycle: 'open', receivedAt: Date.now(), gateKind: 'deliver' } } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await act(async () => { await flushDecisionsForTest(); });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('P2: Try again after a refused send carries the same note', async () => {
    useCapabilities.setState({ loaded: true, runChatId: true, planGateNote: true } as never);
    confirm.mockRejectedValueOnce(new Error('engine busy'));
    page();
    await typeAndSend(NOTE);
    await act(async () => { await flushDecisionsForTest(); });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    const retry = await screen.findByTestId('session-proposal-go');
    await waitFor(() => expect(retry.textContent).toMatch(/Try again/));
    fireEvent.click(retry);
    await act(async () => { await flushDecisionsForTest(); });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(confirm.mock.calls[1]![1]).toEqual({ approve: true, amend: NOTE, ord: 1 });
  });

  it('P2: the note is what the person typed, never the about chips\' context', async () => {
    useCapabilities.setState({ loaded: true, runChatId: true, planGateNote: true } as never);
    addAboutChip('run:r1', { kind: 'about', key: 'p:1', label: 'a selected paragraph' });
    try {
      page();
      await typeAndSend(NOTE);
      await act(async () => { await flushDecisionsForTest(); });
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      expect(confirm.mock.calls[0]![1]).toEqual({ approve: true, amend: NOTE, ord: 1 });
    } finally {
      clearAboutChips('run:r1');
    }
  });

  it('P3: Undo hands the note back to the reply box', async () => {
    useCapabilities.setState({ loaded: true, runChatId: true, planGateNote: true } as never);
    page();
    const input = await typeAndSend(NOTE) as HTMLTextAreaElement;
    const pending = useUndoQueue.getState().pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]!.amend).toBe(NOTE);
    act(() => undoDecision(pending[0]!.id));
    await waitFor(() => expect((screen.getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe(NOTE));
    expect(input).toBeDefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  // ── xreview r2 (codex) ────────────────────────────────────────────────────────────────────────────────────────
  it('P1 r2: a note typed at one plan gate is not sent to the plan that replaced it (after a rerender) by one Send', async () => {
    useCapabilities.setState({ loaded: true, runChatId: true, planGateNote: true } as never);
    page();
    await screen.findByTestId('session-proposal');
    const input = screen.getByTestId('session-composer-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: NOTE } });
    await waitFor(() => expect(screen.getByTestId('session-reply-dest').textContent).toBe(`Replies to this decision (${PLAN_NOTE_REPLY})`));
    act(() => { useGateStore.setState({ gates: { r1: { ...GATE, ord: 2, receivedAt: GATE.receivedAt + 5_000, prompt: 'Approve plan rev 2 before unit 2 runs' } } }); });
    await waitFor(() => expect(screen.getByTestId('session-proposal')).toBeDefined());
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => { await flushDecisionsForTest(); });
    expect(confirm).not.toHaveBeenCalled();
    expect(useUndoQueue.getState().pending).toHaveLength(0);
    await waitFor(() => expect(screen.getByTestId('session-reply-moved').textContent).toMatch(/^Not sent: this decision changed/));
    await waitFor(() => expect((screen.getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe(NOTE));
    // The person's own second Send answers the plan they now see.
    fireEvent.keyDown(screen.getByTestId('session-composer-input'), { key: 'Enter' });
    await act(async () => { await flushDecisionsForTest(); });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0]![1]).toEqual({ approve: true, amend: NOTE, ord: 2 });
  });

  it('P2 r2: Try again carries the note even after the card remounts', async () => {
    useCapabilities.setState({ loaded: true, runChatId: true, planGateNote: true } as never);
    confirm.mockRejectedValueOnce(new Error('engine busy'));
    const first = page();
    await typeAndSend(NOTE);
    await act(async () => { await flushDecisionsForTest(); });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    first.unmount();
    page();
    const retry = await screen.findByTestId('session-proposal-go');
    await waitFor(() => expect(retry.textContent).toMatch(/Try again/));
    fireEvent.click(retry);
    await act(async () => { await flushDecisionsForTest(); });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(confirm.mock.calls[1]![1]).toEqual({ approve: true, amend: NOTE, ord: 1 });
  });

  it('P2 r2: a note another gate choice handed back (a Send back undone) is never put in the plan\'s box', async () => {
    useCapabilities.setState({ loaded: true, runChatId: true, planGateNote: true } as never);
    restoreNote('r1', 'GateRow send-back note');
    page();
    await screen.findByTestId('session-proposal');
    await new Promise((r) => setTimeout(r, 50));
    expect((screen.getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe('');
    expect(useUndoQueue.getState().restoredNotes['r1']).toBe('GateRow send-back note');
  });

  // ── xreview r3 (codex) ────────────────────────────────────────────────────────────────────────────────────────
  it('P2 r3: a retry carries exactly the failed attempt\'s note: none after the note was undone and cleared', async () => {
    useCapabilities.setState({ loaded: true, runChatId: true, planGateNote: true } as never);
    confirm.mockRejectedValueOnce(new Error('engine busy'));
    page();
    await typeAndSend(NOTE);
    const pending = useUndoQueue.getState().pending;
    act(() => undoDecision(pending[0]!.id));
    await waitFor(() => expect((screen.getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe(NOTE));
    fireEvent.change(screen.getByTestId('session-composer-input'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('session-proposal-go'));
    await act(async () => { await flushDecisionsForTest(); });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0]![1]).toEqual({ approve: true, ord: 1 });
    const retry = await screen.findByTestId('session-proposal-go');
    await waitFor(() => expect(retry.textContent).toMatch(/Try again/));
    fireEvent.click(retry);
    await act(async () => { await flushDecisionsForTest(); });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(confirm.mock.calls[1]![1]).toEqual({ approve: true, ord: 1 });
  });

  it('P2 r3: a cancelled plan note never lands in the run\'s shared note slot (a rejection reason reads it)', async () => {
    useCapabilities.setState({ loaded: true, runChatId: true, planGateNote: true } as never);
    page();
    await typeAndSend(NOTE);
    expect(useUndoQueue.getState().pending).toHaveLength(1);
    act(() => { useGateStore.setState({ gates: { r1: { ...GATE, ord: 2, receivedAt: GATE.receivedAt + 9_000 } } }); });
    await waitFor(() => expect(useUndoQueue.getState().pending).toHaveLength(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(useUndoQueue.getState().restoredNotes['r1']).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });
});

