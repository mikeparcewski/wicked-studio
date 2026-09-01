import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  DashboardGrid, FilterStrip, KpiBand, KpiGroup, Sparkline, sparkPoints, StatTile,
} from '../src/components/dashboardKit.js';

/**
 * The shared section-dashboard kit (lane B): StatTile renders its delta
 * HONESTLY (a window with no prior bucket shows "—", never 0%), the sparkline
 * derives from a bucket series (and draws NOTHING for an empty one), the
 * FilterStrip drives its grid through plain callbacks, and the grid imposes
 * no max-width — full-width by construction.
 */

afterEach(cleanup);

describe('StatTile — the honest KPI tile', () => {
  it('renders label, ONE big tabular number, and the context line', () => {
    render(<StatTile testId="t" label="Runs" value={42} context="last 30 vs previous 30" />);
    const tile = screen.getByTestId('t');
    expect(tile).toHaveTextContent('Runs');
    expect(within(tile).getByTestId('stat-value')).toHaveTextContent('42');
    expect((within(tile).getByTestId('stat-value') as HTMLElement).style.fontVariantNumeric).toBe('tabular-nums');
    expect(tile).toHaveTextContent('last 30 vs previous 30');
    expect(tile.getAttribute('data-value')).toBe('42');
  });

  it('no prior window ⇒ the delta is "—", never a fabricated 0%', () => {
    render(<StatTile testId="t" label="Runs" value={8} delta={{ current: 8, previous: null }} />);
    const delta = within(screen.getByTestId('t')).getByTestId('stat-delta');
    expect(delta).toHaveTextContent('—');
    expect(delta.getAttribute('data-delta')).toBe('none');
    expect(screen.getByTestId('t').getAttribute('data-delta')).toBe('none');
  });

  it('renders ▲ with the absolute diff when the window grew', () => {
    render(<StatTile testId="t" label="Runs" value={30} delta={{ current: 30, previous: 22 }} />);
    const delta = within(screen.getByTestId('t')).getByTestId('stat-delta');
    expect(delta).toHaveTextContent('▲ 8');
    expect(delta.getAttribute('data-delta')).toBe('8');
  });

  it('renders ▼ when it shrank, and a flat mark for zero change', () => {
    const { unmount } = render(<StatTile testId="t" label="Failed" value={1} delta={{ current: 1, previous: 4 }} />);
    expect(within(screen.getByTestId('t')).getByTestId('stat-delta')).toHaveTextContent('▼ 3');
    unmount();
    render(<StatTile testId="t2" label="Failed" value={4} delta={{ current: 4, previous: 4 }} />);
    const flat = within(screen.getByTestId('t2')).getByTestId('stat-delta');
    expect(flat.getAttribute('data-delta')).toBe('0');
  });

  it('bad-up sense paints a RISING delta with the fail token — threshold color only where it means something', () => {
    render(<StatTile testId="t" label="Failed" value={5} delta={{ current: 5, previous: 2 }} deltaSense="bad-up" />);
    const delta = within(screen.getByTestId('t')).getByTestId('stat-delta');
    expect((delta as HTMLElement).style.color).toBe('var(--status-fail)');
  });

  it('neutral sense keeps the delta in ink — a run-count move is not a verdict', () => {
    render(<StatTile testId="t" label="Runs" value={5} delta={{ current: 5, previous: 2 }} />);
    const delta = within(screen.getByTestId('t')).getByTestId('stat-delta');
    expect((delta as HTMLElement).style.color).toBe('var(--ink-muted)');
  });

  it('is a door: onOpen fires on click, and an href renders a real link', () => {
    const onOpen = vi.fn();
    render(<StatTile testId="t" label="Runs" value={1} href="/work" onOpen={onOpen} />);
    const tile = screen.getByTestId('t');
    expect(tile.tagName).toBe('A');
    expect(tile).toHaveAttribute('href', '/work');
    fireEvent.click(tile);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('embeds the sparkline under the number when a series is passed', () => {
    render(<StatTile testId="t" label="Runs" value={3} spark={[0, 1, 2]} />);
    expect(screen.getByTestId('t').querySelector('svg')).not.toBeNull();
  });
});

describe('Sparkline — inline SVG from a bucket series, no chart lib', () => {
  it('computes polyline points normalized to the series max', () => {
    // 3 buckets over 100x10: x at 0/50/100, y at 10 (zero), 5 (half), 0 (max).
    expect(sparkPoints([0, 1, 2], 100, 10)).toBe('0.0,10.0 50.0,5.0 100.0,0.0');
  });

  it('renders a polyline + area for a live series', () => {
    render(<Sparkline counts={[1, 0, 3, 2]} testId="spark" />);
    const svg = screen.getByTestId('spark');
    expect(svg.querySelector('polyline')).not.toBeNull();
    expect(svg.querySelector('polygon')).not.toBeNull();
  });

  it('draws NOTHING for an all-zero or empty series — absence stays absent', () => {
    const { container } = render(<Sparkline counts={[0, 0, 0]} testId="spark" />);
    expect(container.querySelector('svg')).toBeNull();
    const { container: c2 } = render(<Sparkline counts={[]} testId="spark2" />);
    expect(c2.querySelector('svg')).toBeNull();
  });
});

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

describe('DashboardGrid + KpiBand — full-width, never max-width constrained', () => {
  it('the grid flows with the viewport: auto-fill columns, no maxWidth', () => {
    render(<DashboardGrid testId="grid" min={340}><div>a</div><div>b</div></DashboardGrid>);
    const grid = screen.getByTestId('grid') as HTMLElement;
    expect(grid.style.maxWidth).toBe('');
    expect(grid.style.width).toBe('100%');
    expect(grid.style.gridTemplateColumns).toContain('auto-fill');
    expect(grid.style.gridTemplateColumns).toContain('340px');
  });

  it('the KPI band groups tiles under the command-center kickers', () => {
    render(
      <KpiBand testId="band">
        <KpiGroup label="Performance"><StatTile testId="a" label="A" value={1} /></KpiGroup>
        <KpiGroup label="Risk"><StatTile testId="b" label="B" value={2} /></KpiGroup>
      </KpiBand>,
    );
    const band = screen.getByTestId('band') as HTMLElement;
    expect(band.style.maxWidth).toBe('');
    expect(band).toHaveTextContent('Performance');
    expect(band).toHaveTextContent('Risk');
    expect(band.querySelector('[data-kpi-group="performance"]')).not.toBeNull();
  });
});
