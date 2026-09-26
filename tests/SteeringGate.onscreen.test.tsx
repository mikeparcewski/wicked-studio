import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SteeringGate, PROMPT_CLAMP_CHARS } from '../src/components/SteeringGate.js';
import * as client from '../src/api/client.js';
import { useAnnotationStore } from '../src/store/annotations.js';
import { useGateStore } from '../src/store/gates.js';

// A gate prompt the engine builds for a long intent (it echoes the intent per unit) pushed the
// answer buttons below a 700 px viewport. The answer bar is pinned and a long prompt is clamped.
describe('SteeringGate keeps the answer on screen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    useAnnotationStore.setState({ drafts: {} });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  });

  it('pins the note and every decision button in one sticky answer bar', () => {
    render(<SteeringGate runId="run-42" ord={5} prompt="Proceed?" />);
    const bar = screen.getByTestId('steering-actions');
    expect(bar.className).toContain('sticky');
    expect(bar.className).toContain('bottom-0');
    for (const id of ['steering-amend', 'steering-approve', 'steering-approve-steer', 'steering-reject', 'steering-cancel']) {
      expect(within(bar).getByTestId(id)).toBeInTheDocument();
    }
  });

  it('a short prompt is shown whole, with no toggle', () => {
    render(<SteeringGate runId="run-42" ord={5} prompt="Proceed to build?" />);
    expect(screen.getByTestId('steering-prompt')).not.toHaveAttribute('data-clamped');
    expect(screen.queryByTestId('steering-prompt-toggle')).toBeNull();
  });

  it('a long prompt is clamped and the toggle shows it all, then clamps it again', async () => {
    const user = userEvent.setup();
    const long = 'Approve the output of unit 4 — ' + 'x'.repeat(PROMPT_CLAMP_CHARS + 50);
    render(<SteeringGate runId="run-42" ord={5} prompt={long} />);
    const prompt = screen.getByTestId('steering-prompt');
    expect(prompt).toHaveAttribute('data-clamped', 'true');
    expect(prompt).toHaveTextContent(long);
    await user.click(screen.getByTestId('steering-prompt-toggle'));
    expect(prompt).toHaveAttribute('data-clamped', 'false');
    await user.click(screen.getByTestId('steering-prompt-toggle'));
    expect(prompt).toHaveAttribute('data-clamped', 'true');
  });

  it('the answer still works from the pinned bar', async () => {
    const user = userEvent.setup();
    render(<SteeringGate runId="run-42" ord={5} prompt={'y'.repeat(PROMPT_CLAMP_CHARS + 1)} />);
    await user.click(within(screen.getByTestId('steering-actions')).getByTestId('steering-approve'));
    expect(client.api.confirmGate).toHaveBeenCalled();
  });
});
