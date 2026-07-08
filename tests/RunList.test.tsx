import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunList } from '../src/components/RunList.js';
import { useConnectionStore } from '../src/store/connection.js';
import { makeView } from './factories.js';

describe('RunList', () => {
  beforeEach(() => {
    useConnectionStore.setState({ status: 'connected' });
  });

  it('shows a graceful disconnected state (SC-S05)', () => {
    useConnectionStore.setState({ status: 'disconnected' });
    render(<RunList runs={[makeView({ id: 'run-1' })]} selectedRunId={null} onSelect={() => {}} />);
    expect(screen.getByTestId('run-list')).toHaveTextContent('reconnecting');
    // Stale run cards are not rendered while disconnected.
    expect(screen.queryByTestId('run-card')).toBeNull();
  });

  it('shows an empty state when connected with no runs', () => {
    render(<RunList runs={[]} selectedRunId={null} onSelect={() => {}} />);
    expect(screen.getByTestId('run-list')).toHaveTextContent('No runs yet');
  });

  it('renders one card per run in the daemon-provided (actionable-first) order', () => {
    const runs = [
      makeView({ id: 'run-a', status: 'awaiting_human', problem: 'A' }),
      makeView({ id: 'run-b', status: 'completed', problem: 'B' }),
    ];
    render(<RunList runs={runs} selectedRunId={null} onSelect={() => {}} />);
    const cards = screen.getAllByTestId('run-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-run-id', 'run-a');
    expect(cards[1]).toHaveAttribute('data-run-id', 'run-b');
  });

  it('selecting a card reports the run id (identity, not index)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const runs = [makeView({ id: 'run-a' }), makeView({ id: 'run-b' })];
    render(<RunList runs={runs} selectedRunId={null} onSelect={onSelect} />);
    const cardB = screen.getAllByTestId('run-card')[1];
    await user.click(cardB as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('run-b');
  });
});
