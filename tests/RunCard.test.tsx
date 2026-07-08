import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunCard } from '../src/components/RunCard.js';
import { makeView } from './factories.js';

describe('RunCard', () => {
  it('shows the problem, short id, and a distinct status label', () => {
    const view = makeView({ id: 'run-abcdef12345', problem: 'ship the thing', status: 'executing' });
    render(<RunCard view={view} selected={false} onSelect={() => {}} />);
    expect(screen.getByText('ship the thing')).toBeInTheDocument();
    expect(screen.getByText('run-abcd')).toBeInTheDocument(); // first 8 chars
    expect(screen.getByText('Executing')).toBeInTheDocument();
  });

  it('flags awaiting_human runs with a gate badge', () => {
    const view = makeView({ id: 'run-1', status: 'awaiting_human' });
    render(<RunCard view={view} selected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('run-card-gate-flag')).toBeInTheDocument();
    expect(screen.getByText('Awaiting human')).toBeInTheDocument();
  });

  it('reports its run id on click (bound to identity)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<RunCard view={makeView({ id: 'run-xyz' })} selected={false} onSelect={onSelect} />);
    await user.click(screen.getByTestId('run-card'));
    expect(onSelect).toHaveBeenCalledWith('run-xyz');
  });
});
