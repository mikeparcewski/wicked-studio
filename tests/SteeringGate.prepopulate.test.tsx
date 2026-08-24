import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SteeringGate } from '../src/components/SteeringGate.js';
import * as client from '../src/api/client.js';
import { useAnnotationStore } from '../src/store/annotations.js';
import { useGateStore } from '../src/store/gates.js';

/**
 * Slice BD (DES-UX-002 §4.3/§4.5, EC51): gate arrival pre-populates the steer
 * textarea from the session draft; the decision consumes the draft; Alt+1
 * inserts the Focus: prefix at the cursor inside the textarea.
 */

describe('SteeringGate pre-population (slice BD)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {}, approaching: {} });
    useAnnotationStore.setState({ drafts: {} });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' } as never);
    vi.spyOn(client.api, 'cancelRun').mockResolvedValue({ status: 'cancelled' } as never);
  });

  it('a standing draft pre-populates as amend-prepopulated, auto-expanded, steer armed', () => {
    useAnnotationStore.getState().setDraft('r-1', 'Focus: burst budget\nSkip: docs\nContext: v2');
    render(<SteeringGate runId="r-1" ord={1} prompt="Proceed?" />);
    const ta = screen.getByTestId('amend-prepopulated') as HTMLTextAreaElement;
    expect(ta.value).toBe('Focus: burst budget\nSkip: docs\nContext: v2');
    expect(ta.rows).toBe(3); // auto-expand: one row per draft line (min 2)
    expect(screen.queryByTestId('steering-amend')).toBeNull();
    // Pre-populated text arms Approve+steer without any extra click (§4.3).
    expect(screen.getByTestId('steering-approve-steer')).toBeEnabled();
  });

  it('no draft ⇒ blank as today, under the standing steering-amend testid', () => {
    render(<SteeringGate runId="r-1" ord={1} prompt="Proceed?" />);
    const ta = screen.getByTestId('steering-amend') as HTMLTextAreaElement;
    expect(ta.value).toBe('');
    expect(ta.rows).toBe(2);
    expect(screen.queryByTestId('amend-prepopulated')).toBeNull();
  });

  it('approve-with-steer rides the draft as amend and consumes it', async () => {
    const user = userEvent.setup();
    useAnnotationStore.getState().setDraft('r-1', 'prefer the smaller diff');
    render(<SteeringGate runId="r-1" ord={1} prompt="Proceed?" />);
    await user.click(screen.getByTestId('steering-approve-steer'));
    expect(client.api.confirmGate).toHaveBeenCalledWith('r-1', {
      approve: true,
      amend: 'prefer the smaller diff',
    });
    await waitFor(() =>
      expect(useAnnotationStore.getState().drafts['r-1']).toBeUndefined());
  });

  it('plain approve also consumes the draft — it was declined, not deferred', async () => {
    const user = userEvent.setup();
    useAnnotationStore.getState().setDraft('r-1', 'stale note');
    render(<SteeringGate runId="r-1" ord={1} prompt="Proceed?" />);
    await user.click(screen.getByTestId('steering-approve'));
    await waitFor(() =>
      expect(useAnnotationStore.getState().drafts['r-1']).toBeUndefined());
  });

  it('edits sync back to the draft store (remount keeps the newest text)', async () => {
    const user = userEvent.setup();
    render(<SteeringGate runId="r-1" ord={1} prompt="Proceed?" />);
    await user.type(screen.getByTestId('steering-amend'), 'newest');
    expect(useAnnotationStore.getState().drafts['r-1']).toBe('newest');
  });

  it('Alt+1 inside the steer textarea inserts "Focus: " at the cursor', async () => {
    useAnnotationStore.getState().setDraft('r-1', 'burst budget');
    render(<SteeringGate runId="r-1" ord={1} prompt="Proceed?" />);
    const ta = screen.getByTestId('amend-prepopulated') as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, 0);
    fireEvent.keyDown(ta, { key: '1', code: 'Digit1', altKey: true, bubbles: true });
    await waitFor(() => expect(ta.value).toBe('Focus: burst budget'));
    // The chord acted as an editor command, not as a global shortcut leak.
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });
});
