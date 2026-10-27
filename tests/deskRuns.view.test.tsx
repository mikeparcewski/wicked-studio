import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
    onNewJob: vi.fn(), onClearRefine: vi.fn(),
  };
}
const rowIds = (): string[] => screen.queryAllByTestId('desk-runs-row').map((r) => r.getAttribute('data-run-id') ?? '');
const SENTENCE = 'One running, one waiting on you. Two finished in the last 30 days, one failed.';

describe('Jobs page', () => {
  it('opens on Active: a title, one sentence of live state and New job; Finished is the one filter', () => {
    const p = props();
    render(<DeskRuns {...p} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Jobs');
    expect(screen.getByTestId('desk-runs-sentence')).toHaveTextContent(SENTENCE);
    fireEvent.click(screen.getByTestId('desk-runs-new'));
    expect(p.onNewJob).toHaveBeenCalledOnce();
    expect(rowIds()).toEqual(['working', 'waiting']);
    expect(screen.getByTestId('desk-runs-group-active')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('desk-runs-group-finished'));
    expect(rowIds()).toEqual(['finished', 'answered', 'failed', 'stopped']);
    // The search and the finer filters wait behind Search and filter.
    expect(screen.getByTestId('desk-runs-refine')).not.toBeVisible();
  });

  it('narrows Finished to Failed behind Search and filter, says so when closed, and the sentence never moves', () => {
    render(<DeskRuns {...props()} />);
    fireEvent.click(screen.getByTestId('desk-runs-group-finished'));
    fireEvent.click(screen.getByTestId('desk-runs-tools'));
    expect(screen.getByTestId('desk-runs-refine')).toBeVisible();
    fireEvent.click(screen.getByTestId('desk-runs-status-failed'));
    expect(rowIds()).toEqual(['failed']);
    expect(screen.getByTestId('desk-runs-row')).toHaveAttribute('data-outcome', 'Failed');
    expect(screen.getByTestId('desk-runs-sentence')).toHaveTextContent(SENTENCE);
    fireEvent.click(screen.getByTestId('desk-runs-tools'));
    expect(screen.getByTestId('desk-runs-filtered')).toHaveTextContent('Showing only Failed');
    fireEvent.click(screen.getByTestId('desk-runs-clear'));
    expect(rowIds()).toHaveLength(4);
  });

  it('every row is a dot, the title, one muted line and one status word, with no id on its face', () => {
    const base = props();
    render(<DeskRuns {...base} runs={[...base.runs, deskRun('loose', { project_id: '', status: 'executing', repo_ref: 'wicked-core' })]} />);
    for (const row of screen.getAllByTestId('desk-runs-row')) {
      const id = row.getAttribute('data-run-id')!;
      expect(row.querySelectorAll('.wk-jr-dot')).toHaveLength(1);
      expect(within(row).getByTestId('desk-runs-line')).toBeInTheDocument();
      expect(within(row).getByTestId('desk-runs-word').textContent).toMatch(/^(Working|Waiting on you|Needs a decision)$/);
      expect(row.textContent).not.toContain(id === 'loose' ? 'run:' : `run:${id}`);
    }
    const loose = screen.getAllByTestId('desk-runs-row').find((r) => r.dataset.runId === 'loose')!;
    expect(within(loose).getByTestId('desk-runs-line')).toHaveTextContent('wicked-core · Codex · step 2 of 2');
    expect(within(loose).getByTestId('desk-runs-word')).toHaveTextContent('Working');
  });

  it('says Needs a decision for a job Needs you holds for one', () => {
    render(<DeskRuns {...props()} holds={new Map([['waiting', 'decision']])} />);
    const row = screen.getAllByTestId('desk-runs-row').find((r) => r.dataset.runId === 'waiting')!;
    expect(within(row).getByTestId('desk-runs-word')).toHaveTextContent('Needs a decision');
    expect(screen.getByTestId('desk-runs-sentence')).toHaveTextContent(/^One running, one needs a decision\./);
  });

  it('filters typed search and shows the designed empty state when no row matches', () => {
    render(<DeskRuns {...props()} />);
    fireEvent.click(screen.getByTestId('desk-runs-group-finished'));
    fireEvent.change(screen.getByTestId('desk-runs-search'), { target: { value: 'FINISHED studio sonnet' } });
    expect(rowIds()).toEqual(['finished']);
    fireEvent.change(screen.getByTestId('desk-runs-search'), { target: { value: 'missing run' } });
    expect(screen.getByTestId('desk-runs-empty')).toHaveTextContent('No job matches');
    expect(screen.queryByTestId('desk-runs-row')).not.toBeInTheDocument();
    expect(screen.getByTestId('desk-runs-sentence')).toHaveTextContent(SENTENCE);
  });

  it('an empty Active list says nothing is running and offers the finished jobs', () => {
    render(<DeskRuns {...props()} runs={[deskRun('done')]} />);
    expect(screen.getByTestId('desk-runs-empty')).toHaveTextContent('Nothing is running right now.');
    fireEvent.click(within(screen.getByTestId('desk-runs-empty')).getByRole('button', { name: 'Show finished jobs' }));
    expect(rowIds()).toEqual(['done']);
  });

  it('navigates to pathOf on a plain click and preserves meta-click', () => {
    const p = props();
    render(<DeskRuns {...p} runs={[deskRun('chosen', { status: 'executing' })]} />);
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
    fireEvent.click(screen.getByTestId('desk-runs-group-finished'));
    expect(screen.getAllByTestId('desk-runs-row')).toHaveLength(40);
    expect(screen.getByTestId('desk-runs-count')).toHaveTextContent('40 of 85');
    fireEvent.click(screen.getByTestId('desk-runs-more'));
    expect(screen.getAllByTestId('desk-runs-row')).toHaveLength(80);
    expect(screen.getByTestId('desk-runs-count')).toHaveTextContent('80 of 85');
    fireEvent.click(screen.getByTestId('desk-runs-more'));
    expect(screen.getAllByTestId('desk-runs-row')).toHaveLength(85);
    expect(screen.queryByTestId('desk-runs-more')).not.toBeInTheDocument();
  });

  it('shows the rows’ shape while runs have not been read, and never a zero', () => {
    render(<DeskRuns {...props()} runs={[]} runsShown={false} />);
    expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('desk-runs-sentence')).toHaveTextContent('Reading your jobs…');
    expect(screen.getByTestId('desk-runs-sentence').textContent).not.toMatch(/\d|No |None/);
    expect(screen.queryByTestId('desk-runs-row')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desk-runs-empty')).not.toBeInTheDocument();
  });
});
