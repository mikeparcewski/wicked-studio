/**
 * studio#568 / #569 / #570 (backlog lane G19): the S15e gate row is styled, keeps the caret in its
 * note through thread updates, and asks each gate kind's question in the row's words.
 *
 *  - #568: every `wk-session-gate-*` class GateRow.tsx uses has a rule in the shipped stylesheet
 *    chain (index.css → global.css → components.css); the test fails on a class nobody styled.
 *  - #569: with `#gate` in the URL, a model recompute (units re-polled, events appended) must not
 *    pull focus out of an open note; the type-to-composer redirect never fires while the note has
 *    focus; the note opens with the caret at the END of its pre-filled text; Escape cancels it.
 *  - #570: escalation / floor / denied / team prompts read their own one-line question, never
 *    the generic "Waiting on your answer".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { setUndoWindowForTest, undoDecision, useUndoQueue } from '../src/board/undoQueue.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { useTypeToComposer } from '../src/hooks/useTypeToComposer.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import type { OpenGate } from '../src/store/gates.js';
import { makeView } from './factories.js';
import { NOT_PASS_EVENTS, NOT_PASS_PROMPT, MOVE_RUN, MOVE_UNITS } from './fixtures/gateMove.js';

const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.restoreAllMocks();
  setUndoWindowForTest(0);
  useGateStore.setState({ gates: {} });
  useGateActionStore.setState({ byGate: {} });
  useRunEventStore.setState({ byRun: { [MOVE_RUN]: NOT_PASS_EVENTS } });
  vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
});
afterEach(() => {
  for (const p of useUndoQueue.getState().pending) undoDecision(p.id);
  cleanup();
  window.location.hash = '';
});

function escalationGate(): OpenGate {
  return { runId: MOVE_RUN, ord: 2, prompt: NOT_PASS_PROMPT, lifecycle: 'open', receivedAt: NOW };
}

// ── #568: the stylesheet covers every class the row uses ────────────────────────────────────

describe('studio#568: every wk-session-gate-* class GateRow uses has a rule in the stylesheet chain', () => {
  const gateRowSrc = readFileSync(join(process.cwd(), 'src/components/session/GateRow.tsx'), 'utf8');
  const componentsCss = readFileSync(join(process.cwd(), 'src/styles/components.css'), 'utf8');

  it('the shipped bundle includes components.css (index.css → global.css → components.css)', () => {
    const index = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
    const global = readFileSync(join(process.cwd(), 'src/styles/global.css'), 'utf8');
    expect(index).toMatch(/@import\s+'\.\/styles\/global\.css'/);
    expect(global).toMatch(/@import\s+'\.\/components\.css'/);
  });

  it('no class the row renders is left unstyled', () => {
    const used = [...new Set(gateRowSrc.match(/wk-session-gate-[a-z0-9-]+/g) ?? [])].sort();
    expect(used.length).toBeGreaterThan(10);
    const unstyled = used.filter((cls) => !new RegExp(`\\.${cls}(?![a-z0-9-])`).test(componentsCss));
    expect(unstyled).toEqual([]);
  });
});

// ── #570: the question per gate kind ────────────────────────────────────────────────────────

describe('studio#570: session-gate-question reads each gate kind in the row\'s words', () => {
  it('a FAIL escalation (evaluator verdict) asks to send it back', () => {
    render(<GateRow view={makeView({ id: MOVE_RUN, status: 'awaiting_human' }, MOVE_UNITS)} gate={escalationGate()} />);
    expect(screen.getByTestId('session-gate-row').dataset['reason']).toBe('escalation');
    expect(screen.getByTestId('session-gate-question').textContent).toBe('The reviewer said FAIL — send it back?');
  });

  it('a failed floor names the floor', () => {
    const gate: OpenGate = {
      runId: MOVE_RUN, ord: 2, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation',
      prompt: 'Unit 4 failed its deterministic floor (pinned_validator): the pinned validator exited 1 — confirm to retry the phase, request changes to send it back, or reject to cancel the run',
    };
    render(<GateRow view={makeView({ id: MOVE_RUN, status: 'awaiting_human' }, MOVE_UNITS)} gate={gate} />);
    expect(screen.getByTestId('session-gate-question').textContent).toBe('The floor failed — how should the step go on?');
  });

  it('an input-governance denial names the refused tool', () => {
    const gate: OpenGate = {
      runId: MOVE_RUN, ord: 2, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation',
      prompt: 'Unit 2 was DENIED by input governance — a tool call was refused (`Bash`): rm -rf is never allowed. confirm to retry the phase, request changes to send it back, or reject to cancel the run',
    };
    render(<GateRow view={makeView({ id: MOVE_RUN, status: 'awaiting_human' }, MOVE_UNITS)} gate={gate} />);
    expect(screen.getByTestId('session-gate-question').textContent).toBe('A Bash call was denied — how should the step go on?');
  });

  it('a team dispute says the team disagreed', () => {
    const gate: OpenGate = {
      runId: MOVE_RUN, ord: 4, lifecycle: 'open', receivedAt: NOW, gateKind: 'team_dispute', choices: ['approve', 'reject'],
      prompt: 'Team dispute on unit 4 (build — Rules for booking): unresolved HIGH finding(s) without a council YES — approve to continue or reject to cancel the run',
    };
    render(<GateRow view={makeView({ id: MOVE_RUN, status: 'awaiting_human' }, MOVE_UNITS)} gate={gate} />);
    expect(screen.getByTestId('session-gate-row').dataset['reason']).toBe('team');
    expect(screen.getByTestId('session-gate-question').textContent).toBe('The team disagreed — send it back, approve or reject?');
  });

  it('a NOT PASS whose reviewer edited the tree (restored retry) is not called a FAIL; the legacy guard prompt stays neutral', () => {
    const restored: OpenGate = {
      runId: MOVE_RUN, ord: 2, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation',
      prompt: "Unit 4 verdict is NOT PASS — the evaluator changed the tree under review; its edit was discarded and the creator's verified tree restored. Approve to retry the phase against the restored tree, or reject to cancel the run",
    };
    const { unmount } = render(<GateRow view={makeView({ id: MOVE_RUN, status: 'awaiting_human' }, MOVE_UNITS)} gate={restored} />);
    expect(screen.getByTestId('session-gate-question').textContent).toBe('The reviewer changed the work instead of judging it — retry on the restored tree?');
    unmount();
    const legacy: OpenGate = { ...restored, prompt: 'Unit 4 verdict is NOT PASS — confirm to retry the phase, or reject to cancel the run' };
    render(<GateRow view={makeView({ id: MOVE_RUN, status: 'awaiting_human' }, MOVE_UNITS)} gate={legacy} />);
    expect(screen.getByTestId('session-gate-question').textContent).toBe('The step did not pass review — how should it go on?');
  });

  it("core's output-governance denial judges the work, not a tool call", () => {
    const gate: OpenGate = {
      runId: MOVE_RUN, ord: 2, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation',
      prompt: 'Governance DENIED unit 1 (review): the refactored middleware drops the token-refresh path — auth.refresh.spec fails on the expired-token branch',
    };
    render(<GateRow view={makeView({ id: MOVE_RUN, status: 'awaiting_human' }, MOVE_UNITS)} gate={gate} />);
    expect(screen.getByTestId('session-gate-question').textContent).toBe('Governance denied this step — how should it go on?');
  });

  it('a def gate keeps its "Approve the <step>" question', () => {
    const gate: OpenGate = { runId: MOVE_RUN, ord: 1, lifecycle: 'open', receivedAt: NOW, gateKind: 'def', prompt: 'Approve the output of unit 1 (clarify — Rules for booking ||| PHASE SCOPE: …) before unit 2 runs' };
    render(<GateRow view={makeView({ id: MOVE_RUN, status: 'awaiting_human' }, MOVE_UNITS)} gate={gate} />);
    expect(screen.getByTestId('session-gate-question').textContent).toBe('Approve the questions and answers');
  });
});

// ── #569: the note keeps the caret ──────────────────────────────────────────────────────────

/** App's type-to-composer hook plus a page composer, as the session page has (`session-composer-input`). */
function Harness({ view, gate }: { view: ReturnType<typeof makeView>; gate: OpenGate | undefined }): React.ReactElement {
  useTypeToComposer(() => {});
  return (
    <div>
      <GateRow view={view} gate={gate} />
      <textarea data-testid="session-composer-input" data-type-target="page" defaultValue="" />
    </div>
  );
}

describe('studio#569: typing into the gate note never moves the caret to the composer', () => {
  it('#gate focuses the row once on arrival; a thread update while the note is open keeps the note focused', async () => {
    window.location.hash = '#gate';
    const gate = escalationGate();
    const view = (): ReturnType<typeof makeView> => makeView({ id: MOVE_RUN, status: 'awaiting_human' }, [...MOVE_UNITS]);
    const { rerender } = render(<Harness view={view()} gate={gate} />);
    // Arrival: the row has focus (operator amendment 3).
    expect(document.activeElement).toBe(screen.getByTestId('session-gate-row'));

    // Send back opens the pre-filled note, which takes focus.
    fireEvent.click(screen.getByTestId('session-gate-choices').querySelector('[data-choice-key="send-back"]')!);
    const note = screen.getByTestId('session-gate-note') as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(note));
    expect(note.value.length).toBeGreaterThan(0);

    // The thread updates under the operator: units re-polled (new array identity) and events appended.
    act(() => { useRunEventStore.setState({ byRun: { [MOVE_RUN]: [...NOT_PASS_EVENTS] } }); });
    rerender(<Harness view={view()} gate={gate} />);
    rerender(<Harness view={view()} gate={gate} />);
    expect(screen.getByTestId('session-gate-note')).toBe(note);
    expect(document.activeElement).toBe(note);

    // The next letter is typed into the note, never redirected to the composer.
    fireEvent.keyDown(document.activeElement!, { key: 't' });
    const composer = screen.getByTestId('session-composer-input') as HTMLTextAreaElement;
    expect(composer.value).toBe('');
    expect(document.activeElement).toBe(note);
  });

  it('the note opens with the caret at the END of its pre-filled text (End / Enter / typing go after it)', async () => {
    const gate = escalationGate();
    render(<Harness view={makeView({ id: MOVE_RUN, status: 'awaiting_human' }, MOVE_UNITS)} gate={gate} />);
    fireEvent.click(screen.getByTestId('session-gate-choices').querySelector('[data-choice-key="send-back"]')!);
    const note = screen.getByTestId('session-gate-note') as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(note));
    expect(note.value.length).toBeGreaterThan(0);
    expect(note.selectionStart).toBe(note.value.length);
    expect(note.selectionEnd).toBe(note.value.length);
  });

  it('a model recompute without #gate never focuses the row either', () => {
    const gate = escalationGate();
    const { rerender } = render(<Harness view={makeView({ id: MOVE_RUN, status: 'awaiting_human' }, [...MOVE_UNITS])} gate={gate} />);
    fireEvent.click(screen.getByTestId('session-gate-choices').querySelector('[data-choice-key="send-back"]')!);
    const note = screen.getByTestId('session-gate-note');
    act(() => { note.focus(); });
    rerender(<Harness view={makeView({ id: MOVE_RUN, status: 'awaiting_human' }, [...MOVE_UNITS])} gate={gate} />);
    expect(document.activeElement).toBe(note);
  });

  it('a replacement gate arriving while the note is open closes the note and the ROW takes focus (never body)', async () => {
    window.location.hash = '#gate';
    const gate = escalationGate();
    const { rerender } = render(<Harness view={makeView({ id: MOVE_RUN, status: 'awaiting_human' }, MOVE_UNITS)} gate={gate} />);
    fireEvent.click(screen.getByTestId('session-gate-choices').querySelector('[data-choice-key="send-back"]')!);
    const note = screen.getByTestId('session-gate-note');
    await waitFor(() => expect(document.activeElement).toBe(note));
    // The same ord re-opens as a new instance (a new receivedAt): a fresh question.
    const replacement: OpenGate = { ...gate, receivedAt: NOW + 60_000 };
    await act(async () => { rerender(<Harness view={makeView({ id: MOVE_RUN, status: 'awaiting_human' }, MOVE_UNITS)} gate={replacement} />); });
    await waitFor(() => expect(screen.queryByTestId('session-gate-note')).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId('session-gate-row'));
  });

  it('a gate that clears and comes back with the same identity focuses the row again', async () => {
    window.location.hash = '#gate';
    const gate = escalationGate();
    const view = makeView({ id: MOVE_RUN, status: 'awaiting_human' }, MOVE_UNITS);
    const { rerender } = render(<Harness view={view} gate={gate} />);
    expect(document.activeElement).toBe(screen.getByTestId('session-gate-row'));
    act(() => { (document.activeElement as HTMLElement).blur(); });
    await act(async () => { rerender(<Harness view={view} gate={undefined} />); });
    expect(screen.queryByTestId('session-gate-choices')).toBeNull();
    await act(async () => { rerender(<Harness view={view} gate={gate} />); });
    expect(document.activeElement).toBe(screen.getByTestId('session-gate-row'));
  });

  it("a gate's arrival never yanks the caret out of the composer", () => {
    window.location.hash = '#gate';
    const gate = escalationGate();
    const view = makeView({ id: MOVE_RUN, status: 'awaiting_human' }, MOVE_UNITS);
    const { rerender } = render(<Harness view={view} gate={undefined} />);
    const composer = screen.getByTestId('session-composer-input');
    act(() => { composer.focus(); });
    rerender(<Harness view={view} gate={gate} />);
    expect(screen.getByTestId('session-gate-row')).toBeDefined();
    expect(document.activeElement).toBe(composer);
  });

  it('Escape leaves the note (cancels it) and the row takes focus back', () => {
    const gate = escalationGate();
    render(<Harness view={makeView({ id: MOVE_RUN, status: 'awaiting_human' }, MOVE_UNITS)} gate={gate} />);
    fireEvent.click(screen.getByTestId('session-gate-choices').querySelector('[data-choice-key="send-back"]')!);
    const note = screen.getByTestId('session-gate-note');
    fireEvent.keyDown(note, { key: 'Escape' });
    expect(screen.queryByTestId('session-gate-note')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('session-gate-row'));
    expect(vi.mocked(client.api.confirmGate)).not.toHaveBeenCalled();
  });
});
