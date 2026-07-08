import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnitList } from '../src/components/UnitList.js';
import * as client from '../src/api/client.js';
import { useGateStore } from '../src/store/gates.js';
import { makeUnit } from './factories.js';

describe('UnitList (§11.9 work-unit detail)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'transcript body' });
  });

  it('renders units ordered by ord with stage + status', () => {
    const units = [
      makeUnit({ id: 'u2', ord: 2, stage: 'review', status: 'pending', description: 'second' }),
      makeUnit({ id: 'u1', ord: 1, stage: 'build', status: 'done', description: 'first' }),
    ];
    render(<UnitList runId="run-1" units={units} />);
    const rows = screen.getAllByTestId('work-unit');
    expect(rows[0]).toHaveAttribute('data-ord', '1');
    expect(rows[1]).toHaveAttribute('data-ord', '2');
  });

  it('shows a per-unit approve ONLY on the gated unit, bound to run id + ord', async () => {
    const user = userEvent.setup();
    const units = [makeUnit({ id: 'u1', ord: 1 }), makeUnit({ id: 'u2', ord: 2 })];
    render(<UnitList runId="run-9" units={units} gateOrd={2} />);
    const approves = screen.getAllByTestId('unit-approve');
    expect(approves).toHaveLength(1); // only the gated unit
    await user.click(approves[0] as HTMLElement);
    expect(client.api.confirmGate).toHaveBeenCalledWith('run-9', { approve: true });
  });

  it('lazily loads a unit transcript on demand', async () => {
    const user = userEvent.setup();
    render(<UnitList runId="run-1" units={[makeUnit({ id: 'u1', ord: 1 })]} />);
    expect(client.api.getUnitOutput).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('unit-transcript-toggle'));
    expect(client.api.getUnitOutput).toHaveBeenCalledWith('run-1', 1);
    expect(await screen.findByTestId('unit-transcript')).toHaveTextContent('transcript body');
  });

  it('renders an empty state with no units', () => {
    render(<UnitList runId="run-1" units={[]} />);
    expect(screen.getByTestId('unit-list')).toHaveTextContent('No units planned yet');
  });
});
