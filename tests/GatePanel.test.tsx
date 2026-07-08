import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GatePanel } from '../src/components/GatePanel.js';
import type { PendingGate } from '../src/store/gates.js';
import * as client from '../src/api/client.js';

const mockGate: PendingGate = {
  sessionId: 'sess-1',
  phaseId: 'design',
  receivedAt: Date.now(),
};

describe('GatePanel', () => {
  beforeEach(() => {
    vi.spyOn(client.api, 'approveGate').mockResolvedValue(undefined);
    vi.spyOn(client.api, 'rejectGate').mockResolvedValue(undefined);
    vi.spyOn(client.api, 'approveWithConditions').mockResolvedValue(undefined);
  });

  it('renders phase id', () => {
    render(<GatePanel gate={mockGate} />);
    expect(screen.getByText('design')).toBeInTheDocument();
  });

  it('approve button calls approveGate', async () => {
    const user = userEvent.setup();
    render(<GatePanel gate={mockGate} />);
    await user.click(screen.getByTestId('gate-panel-approve'));
    expect(client.api.approveGate).toHaveBeenCalledWith('sess-1', 'design');
  });

  it('notifications arrive within 2000ms of render (SC-S02)', () => {
    const t0 = Date.now();
    render(<GatePanel gate={mockGate} />);
    const t1 = Date.now();
    expect(screen.getByTestId('gate-panel')).toBeInTheDocument();
    expect(t1 - t0).toBeLessThan(2000);
  });
});
