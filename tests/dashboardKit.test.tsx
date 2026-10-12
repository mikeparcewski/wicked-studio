import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DashboardGrid, FilterStrip } from '../src/components/dashboardKit.js';

/**
 * The shared section-dashboard kit (lane B): StatTile renders its delta
 * HONESTLY (a window with no prior bucket shows "—", never 0%), the sparkline
 * derives from a bucket series (and draws NOTHING for an empty one), the
 * FilterStrip drives its grid through plain callbacks, and the grid imposes
 * no max-width — full-width by construction.
 */

afterEach(cleanup);

describe('FilterStrip — search + status chips + window picker, first-class', () => {
  const chips = [
    { id: 'all', label: 'All', count: 9 },
    { id: 'failed', label: 'Failed', count: 2 },
  ];

  it('drives the grid: search, chip, and window changes all call back', () => {
    const onQuery = vi.fn();
    const onChip = vi.fn();
    const onRange = vi.fn();
    render(
      <FilterStrip
        testId="fs" query="" onQuery={onQuery}
        chips={chips} active="all" onChip={onChip}
        range="30d" onRange={onRange}
      />,
    );
    fireEvent.change(screen.getByTestId('fs-search'), { target: { value: 'auth' } });
    expect(onQuery).toHaveBeenCalledWith('auth');

    const failedChip = screen.getAllByTestId('fs-chip').find((c) => c.getAttribute('data-chip') === 'failed')!;
    expect(failedChip).toHaveTextContent('Failed');
    expect(failedChip).toHaveTextContent('2'); // the chip carries its live count
    fireEvent.click(failedChip);
    expect(onChip).toHaveBeenCalledWith('failed');

    // The window picker is the Work page's honest idiom — "last 60", not "60d".
    fireEvent.click(screen.getByText('last 60'));
    expect(onRange).toHaveBeenCalledWith('60d');
  });

  it('marks the active chip and mirrors it on the container', () => {
    render(
      <FilterStrip testId="fs" query="" onQuery={() => {}} chips={chips} active="failed" onChip={() => {}} />,
    );
    expect(screen.getByTestId('fs').getAttribute('data-filter')).toBe('failed');
    const failedChip = screen.getAllByTestId('fs-chip').find((c) => c.getAttribute('data-chip') === 'failed')!;
    expect(failedChip).toHaveAttribute('aria-pressed', 'true');
  });

  it('omits the window picker when no window applies', () => {
    render(<FilterStrip testId="fs" query="" onQuery={() => {}} chips={chips} active="all" onChip={() => {}} />);
    expect(screen.queryByText('last 30')).toBeNull();
  });
});

describe('DashboardGrid — full-width, never max-width constrained', () => {
  it('the grid flows with the viewport: auto-fill columns, no maxWidth', () => {
    render(<DashboardGrid testId="grid" min={340}><div>a</div><div>b</div></DashboardGrid>);
    const grid = screen.getByTestId('grid') as HTMLElement;
    expect(grid.style.maxWidth).toBe('');
    expect(grid.style.width).toBe('100%');
    expect(grid.style.gridTemplateColumns).toContain('auto-fill');
    expect(grid.style.gridTemplateColumns).toContain('340px');
  });
});
