import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OutcomeBreakdown } from '../src/components/charts/Chart.js';

afterEach(cleanup);
const segments = [
  { key: 'Finished', label: 'Finished', color: 'var(--status-ok)' },
  { key: 'Answered', label: 'Answered', color: 'var(--status-ok)' },
  { key: 'Failed', label: 'Failed', color: 'var(--status-fail)' },
  { key: 'Working', label: 'Working', color: 'var(--accent)' },
];
const props = {
  rows: [
    { key: 'studio', label: 'Studio', values: { Finished: 3, Failed: 2, Working: 0 } },
    { key: 'crew', label: 'Crew', values: { Finished: 0, Failed: 4, Working: 0 } },
  ],
  segments, label: 'Outcomes by project', groupLabel: 'Project', centre: '37%', centreLabel: 'finished',
};

describe('OutcomeBreakdown', () => {
  it('renders one table row per group, active outcome columns and correct totals', () => {
    render(<OutcomeBreakdown {...props} />);
    const table = screen.getByTestId('desk-outcomes-table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Project', 'Mix', 'Finished', 'Failed', 'Total']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('rowheader')).toHaveTextContent('Studio');
    expect(within(rows[1]!).getByRole('rowheader')).toHaveTextContent('Crew');
    expect(within(rows[0]!).getAllByRole('cell', { hidden: true }).map((c) => c.textContent)).toEqual(['', '3', '2', '5']);
    expect(within(rows[1]!).getAllByRole('cell', { hidden: true }).map((c) => c.textContent)).toEqual(['', '0', '4', '4']);
  });

  it('uses the supplied centre text in the donut and updates it on rerender', () => {
    const { rerender } = render(<OutcomeBreakdown {...props} />);
    const donut = screen.getByRole('img', { name: 'Outcomes by project' });
    expect(within(donut).getByText('37%')).toBeInTheDocument();
    rerender(<OutcomeBreakdown {...props} centre="2 of 9" />);
    expect(within(donut).getByText('2 of 9')).toBeInTheDocument();
    expect(within(donut).queryByText('37%')).not.toBeInTheDocument();
  });
});
