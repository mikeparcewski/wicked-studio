import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeskRuns } from '../src/components/desk/DeskRuns.js';
import { DEFAULT_REFINE } from '../src/board/deskInsights.js';
import { NOW, deskRun, names, outcomeRuns, title } from './fixtures/deskV2.js';

afterEach(cleanup);
const pathOf = (id: string): string => `/sessions/run:${id}`;
function props() {
  return {
    runs: outcomeRuns(), runsShown: true, refine: DEFAULT_REFINE, refineBar: <span>Refine</span>,
    now: NOW, navigate: vi.fn(), pathOf, agentName: names.agent, projectName: names.project, title, showProject: true,
  };
}
function expectStats(): void {
  for (const [key, value] of Object.entries({ running: 1, waiting: 1, finished: 2, failed: 1, window: 6 })) {
    expect(screen.getByTestId(`desk-runs-stat-${key}`).querySelector('.wk-stat-value')).toHaveTextContent(new RegExp(`^${value}$`));
  }
}

describe('Desk Runs view', () => {
  it('shows stat counts and only failed rows after choosing Failed, with stable stats', () => {
    render(<DeskRuns {...props()} />);
    expectStats();
    expect(screen.getAllByTestId('desk-runs-row')).toHaveLength(6);
    fireEvent.click(screen.getByTestId('desk-runs-status-failed'));
    const rows = screen.getAllByTestId('desk-runs-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-outcome', 'Failed');
    expectStats();
  });

  it('filters typed search and shows the empty state when no row matches', () => {
    render(<DeskRuns {...props()} />);
    fireEvent.change(screen.getByTestId('desk-runs-search'), { target: { value: 'FINISHED studio sonnet' } });
    expect(screen.getAllByTestId('desk-runs-row')).toHaveLength(1);
    expect(screen.getByTestId('desk-runs-row')).toHaveAttribute('data-run-id', 'finished');
    fireEvent.change(screen.getByTestId('desk-runs-search'), { target: { value: 'missing run' } });
    expect(screen.getByTestId('desk-runs-empty')).toHaveTextContent('No run matches');
    expect(screen.queryByTestId('desk-runs-row')).not.toBeInTheDocument();
    expectStats();
  });

  it('navigates to pathOf on a plain click and preserves meta-click', () => {
    const p = props();
    render(<DeskRuns {...p} runs={[deskRun('chosen')]} />);
    const link = screen.getByTestId('desk-runs-open');
    expect(link).toHaveAttribute('href', pathOf('chosen'));
    fireEvent.click(link);
    expect(p.navigate).toHaveBeenCalledExactlyOnceWith(pathOf('chosen'));
    p.navigate.mockClear();
    fireEvent.click(link, { metaKey: true });
    expect(p.navigate).not.toHaveBeenCalled();
  });

  it('shows 40 rows at a time and expands to the next page', () => {
    const runs = Array.from({ length: 85 }, (_, i) => deskRun(`r${i}`, { created_at: (NOW - 100_000 + i * 1000) / 1000 }));
    render(<DeskRuns {...props()} runs={runs} />);
    expect(screen.getAllByTestId('desk-runs-row')).toHaveLength(40);
    expect(screen.getByTestId('desk-runs-count')).toHaveTextContent('40 of 85');
    fireEvent.click(screen.getByTestId('desk-runs-more'));
    expect(screen.getAllByTestId('desk-runs-row')).toHaveLength(80);
    expect(screen.getByTestId('desk-runs-count')).toHaveTextContent('80 of 85');
    fireEvent.click(screen.getByTestId('desk-runs-more'));
    expect(screen.getAllByTestId('desk-runs-row')).toHaveLength(85);
    expect(screen.queryByTestId('desk-runs-more')).not.toBeInTheDocument();
  });

  it('shows a skeleton and unknown values while runs have not been read', () => {
    render(<DeskRuns {...props()} runs={[]} runsShown={false} />);
    expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-busy', 'true');
    for (const key of ['running', 'waiting', 'finished', 'failed', 'window']) {
      const value = screen.getByTestId(`desk-runs-stat-${key}`).querySelector('.wk-stat-value');
      expect(value).toHaveAttribute('aria-busy', 'true');
      expect(value).toHaveTextContent('…');
      expect(value).not.toHaveTextContent('0');
    }
    expect(screen.queryByTestId('desk-runs-row')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desk-runs-empty')).not.toBeInTheDocument();
  });
});
