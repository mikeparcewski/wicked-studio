import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SteeringGate } from '../src/components/SteeringGate.js';
import { UndoToasts } from '../src/components/UndoToasts.js';
import * as client from '../src/api/client.js';
import { setUndoWindowForTest, undoDecision, useUndoQueue } from '../src/board/undoQueue.js';
import { useAnnotationStore } from '../src/store/annotations.js';

/**
 * Wave 2a round 2: the run page's gate card decides through the ONE shared path, so its
 * Approve (button and `a` key) waits out the same 10 s undo window as the board, and Undo
 * leaves the gate open. Plus the history fix: consuming `#gate` keeps the entry's state.
 */

beforeEach(() => {
  setUndoWindowForTest(null);
  vi.restoreAllMocks();
  useAnnotationStore.setState({ drafts: {} });
  vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'resumed' } as never);
});

afterEach(() => {
  for (const p of useUndoQueue.getState().pending) undoDecision(p.id);
  vi.useRealTimers();
});

function renderCard(): void {
  render(
    <>
      <SteeringGate runId="r-gate" ord={2} prompt="Proceed with unit 2?" />
      <UndoToasts />
    </>,
  );
}

describe('the gate card rides the undo window', () => {
  it('Approve shows "Approving in 10 s" + Undo, sends nothing for 9 s, exactly once at 10 s', async () => {
    vi.useFakeTimers();
    renderCard();
    act(() => { fireEvent.click(screen.getByTestId('steering-approve')); });
    expect(screen.getByTestId('undo-toast').textContent).toContain('Approving in 10 s');
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
    expect(client.api.confirmGate).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(client.api.confirmGate).toHaveBeenCalledTimes(1);
    expect(client.api.confirmGate).toHaveBeenCalledWith('r-gate', { approve: true });
  });

  it('Undo sends nothing and the card is answerable again', async () => {
    vi.useFakeTimers();
    renderCard();
    act(() => { fireEvent.click(screen.getByTestId('steering-approve')); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(client.api.confirmGate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('undo-toast')).toBeNull();
    expect(screen.getByTestId('steering-approve')).not.toBeDisabled();
  });

  it("the card's a key queues the same way", async () => {
    vi.useFakeTimers();
    renderCard();
    screen.getByTestId('steering-gate').focus();
    act(() => { fireEvent.keyDown(window, { key: 'a' }); });
    expect(screen.getByTestId('undo-toast').textContent).toContain('Approving in 10 s');
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });
});

describe('consuming #gate keeps the history entry', () => {
  it("keeps wave 1's in-app mark (and other view state) when the hash is dropped", () => {
    window.history.replaceState({ 'wk.inApp': true, 'home.scroll': 120 }, '', '/p/beta/build/r-gate?x=1#gate');
    renderCard();
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?x=1');
    expect(window.history.state).toMatchObject({ 'wk.inApp': true, 'home.scroll': 120 });
  });
});
