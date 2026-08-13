import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GateNotifications } from '../src/components/GateNotifications.js';
import { useGateStore } from '../src/store/gates.js';

const noop = () => {};

const seed = () =>
  useGateStore.setState({
    gates: {
      'run-1': { runId: 'run-1', ord: 1, prompt: 'gate for run-1', lifecycle: 'open', receivedAt: 0 },
      'run-2': { runId: 'run-2', ord: 2, prompt: 'gate for run-2', lifecycle: 'open', receivedAt: 0 },
    },
  });

describe('GateNotifications runId scope (studio#10)', () => {
  beforeEach(() => useGateStore.setState({ gates: {} }));

  it('shows all gates when no runId is provided', () => {
    seed();
    render(<GateNotifications onSelect={noop} />);
    const toasts = screen.getAllByTestId('gate-toast');
    expect(toasts).toHaveLength(2);
  });

  it('shows only the matching gate when runId is provided', () => {
    seed();
    render(<GateNotifications onSelect={noop} runId="run-1" />);
    const toasts = screen.getAllByTestId('gate-toast');
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toHaveAttribute('data-run-id', 'run-1');
  });

  it('shows nothing when runId matches no gate', () => {
    seed();
    render(<GateNotifications onSelect={noop} runId="run-99" />);
    expect(screen.queryByTestId('gate-toast')).toBeNull();
  });

  it('shows nothing when store is empty', () => {
    render(<GateNotifications onSelect={noop} runId="run-1" />);
    expect(screen.queryByTestId('gate-notification')).toBeNull();
  });
});
