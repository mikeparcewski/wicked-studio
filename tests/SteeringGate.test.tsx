import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SteeringGate } from '../src/components/SteeringGate.js';
import * as client from '../src/api/client.js';
import { useGateStore } from '../src/store/gates.js';

describe('SteeringGate (§11.1 — the three/four distinct actions)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
    vi.spyOn(client.api, 'cancelRun').mockResolvedValue({ status: 'cancelled' });
  });

  it('renders the prompt and the run id', () => {
    render(<SteeringGate runId="run-42" ord={3} prompt="Proceed to build?" />);
    expect(screen.getByTestId('steering-prompt')).toHaveTextContent('Proceed to build?');
    expect(screen.getByTestId('steering-gate')).toHaveAttribute('data-run-id', 'run-42');
  });

  it('Approve → confirmGate(id, {approve:true}) — no amend', async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();
    render(<SteeringGate runId="run-42" ord={3} prompt="?" onResolved={onResolved} />);
    await user.click(screen.getByTestId('steering-approve'));
    expect(client.api.confirmGate).toHaveBeenCalledWith('run-42', { approve: true });
    expect(onResolved).toHaveBeenCalledOnce();
  });

  it('Approve with steer → confirmGate(id, {approve:true, amend}) carries the text', async () => {
    const user = userEvent.setup();
    render(<SteeringGate runId="run-42" ord={3} prompt="?" />);
    // The steer button is disabled until amend text is present.
    expect(screen.getByTestId('steering-approve-steer')).toBeDisabled();
    await user.type(screen.getByTestId('steering-amend'), 'prefer the smaller diff');
    await user.click(screen.getByTestId('steering-approve-steer'));
    expect(client.api.confirmGate).toHaveBeenCalledWith('run-42', {
      approve: true,
      amend: 'prefer the smaller diff',
    });
  });

  it('Reject → confirmGate(id, {approve:false})', async () => {
    const user = userEvent.setup();
    render(<SteeringGate runId="run-42" ord={3} prompt="?" />);
    await user.click(screen.getByTestId('steering-reject'));
    expect(client.api.confirmGate).toHaveBeenCalledWith('run-42', { approve: false });
  });

  it('Cancel run → cancelRun(id) — the distinct third action', async () => {
    const user = userEvent.setup();
    render(<SteeringGate runId="run-42" ord={3} prompt="?" />);
    await user.click(screen.getByTestId('steering-cancel'));
    expect(client.api.cancelRun).toHaveBeenCalledWith('run-42');
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });

  it('binds actions to the run id prop, not a positional index (§11.2)', async () => {
    const user = userEvent.setup();
    // Two independent gates rendered together; each action must hit its OWN run.
    render(
      <>
        <SteeringGate runId="run-AAA" ord={1} prompt="a" />
        <SteeringGate runId="run-BBB" ord={2} prompt="b" />
      </>,
    );
    const second = screen.getByText('b').closest('[data-testid="steering-gate"]');
    expect(second).not.toBeNull();
    const rejectOnSecond = second!.querySelector('[data-testid="steering-reject"]');
    await user.click(rejectOnSecond as HTMLElement);
    expect(client.api.confirmGate).toHaveBeenCalledWith('run-BBB', { approve: false });
    expect(client.api.confirmGate).not.toHaveBeenCalledWith('run-AAA', { approve: false });
  });

  it('clears the run gate from the cache after a decision resolves', async () => {
    const user = userEvent.setup();
    useGateStore.setState({
      gates: { 'run-42': { runId: 'run-42', ord: 3, prompt: '?', lifecycle: 'open', receivedAt: 0 } },
    });
    render(<SteeringGate runId="run-42" ord={3} prompt="?" />);
    await user.click(screen.getByTestId('steering-approve'));
    expect(useGateStore.getState().gates['run-42']).toBeUndefined();
  });

  // Arriving from a board gate chip (slice 7): the `#gate` hash is the focus intent.
  describe('deep-linked from the board (§6.2 slice 7)', () => {
    beforeEach(() => window.history.replaceState(null, '', '/p/proj-1/build/run-42'));

    it('scrolls the gate message into view, focuses it, and consumes the hash', () => {
      window.history.replaceState(null, '', '/p/proj-1/build/run-42#gate');
      const scrollIntoView = vi.fn();
      vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scrollIntoView);
      render(<SteeringGate runId="run-42" ord={3} prompt="Approve the acceptance criteria?" />);
      expect(document.activeElement).toBe(screen.getByTestId('steering-prompt'));
      expect(scrollIntoView).toHaveBeenCalled();
      // One-shot: the path survives, the intent does not — the thread re-renders on
      // every frame and must not keep yanking focus back.
      expect(window.location.hash).toBe('');
      expect(window.location.pathname).toBe('/p/proj-1/build/run-42');
    });

    it('leaves focus alone without the hash', () => {
      render(<SteeringGate runId="run-42" ord={3} prompt="?" />);
      expect(document.activeElement).toBe(document.body);
    });
  });

  it('works id-only when the prompt is unavailable (daemon restart, §3.3)', async () => {
    const user = userEvent.setup();
    render(<SteeringGate runId="run-42" />);
    expect(screen.getByTestId('steering-prompt')).toHaveTextContent('Prompt unavailable');
    await user.click(screen.getByTestId('steering-approve'));
    expect(client.api.confirmGate).toHaveBeenCalledWith('run-42', { approve: true });
  });
});
