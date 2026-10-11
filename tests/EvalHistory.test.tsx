// The eval-run history (crew-side EvalRunStore wiring) — the Evals section's real list + drilldown.

import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EvalRunSummary } from '../src/api/types.js';

const listEvalRuns = vi.fn();
const getEvalRun = vi.fn();
vi.mock('../src/api/testing.js', () => ({ listEvalRuns: () => listEvalRuns(), getEvalRun: (id: string) => getEvalRun(id) }));
vi.mock('../src/api/errors.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/api/errors.js')>(),
  isRouteAbsent: (e: unknown) => e instanceof Error && e.message === '404',
}));

const { EvalHistory, groupEvalRuns } = await import('../src/components/EvalHistory.js');

afterEach(cleanup);

const NOW = 1_760_000_000_000;
const row = (over: Partial<EvalRunSummary> = {}): EvalRunSummary => ({
  id: 'run-1', created_at: Math.floor(NOW / 1000) - 120, actor: 'mikeparcewski',
  corpus: null, type_filter: null, rule_store: '/x/core.db',
  summary: { total: 3, caught: 1, gaps: 1, false_positives: 1 },
  per_type: {}, degraded: null, ...over,
});

describe('EvalHistory', () => {
  it('a folded group keeps every member run one click away (codex r1)', async () => {
    listEvalRuns.mockResolvedValue([row({ id: 'run-new' }), row({ id: 'run-old', created_at: Math.floor(NOW / 1000) - 7200 })]);
    getEvalRun.mockImplementation((id: string) => Promise.resolve({ ...row({ id }), results: [] }));
    render(<EvalHistory now={NOW} />);
    await waitFor(() => expect(screen.getByTestId('eval-history-row')).toHaveAttribute('data-count', '2'));
    fireEvent.click(screen.getByTestId('eval-history-row').querySelector('button')!);
    const members = await screen.findAllByTestId('eval-history-member');
    expect(members.map((m) => m.getAttribute('data-run-id'))).toEqual(['run-new', 'run-old']);
    fireEvent.click(members[1]!);
    await waitFor(() => expect(getEvalRun).toHaveBeenCalledWith('run-old'));
    await waitFor(() => expect(screen.getAllByTestId('eval-history-member')[1]).toHaveAttribute('aria-pressed', 'true'));
  });

  it('lists recorded runs with their rollup, newest-first from the store', async () => {
    listEvalRuns.mockResolvedValue([row({ id: 'run-1', corpus: 'evals:dev', type_filter: 'security' })]);
    render(<EvalHistory now={NOW} />);
    await waitFor(() => expect(screen.getByTestId('eval-history')).toBeInTheDocument());
    const r = screen.getByTestId('eval-history-row');
    expect(r.textContent).toContain('evals:dev');
    expect(r.textContent).toContain('security');
    expect(r.textContent).toContain('1 caught · 1 gap · 1 false positive');
  });

  it('drills into a run: clicking a row loads its full results', async () => {
    listEvalRuns.mockResolvedValue([row()]);
    getEvalRun.mockResolvedValue({
      ...row(),
      results: [
        { sample: { id: 'S-2', description: 'ships a migration with no review', kind: 'bad', steering_type: 'development' }, expected: 'deny', fired: [], verdict: 'gap' },
      ],
    });
    render(<EvalHistory now={NOW} />);
    await waitFor(() => expect(screen.getByTestId('eval-history-row')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('eval-history-row').querySelector('button')!);
    await waitFor(() => expect(screen.getByTestId('eval-history-detail')).toBeInTheDocument());
    expect(screen.getByTestId('eval-history-detail').textContent).toContain('ships a migration with no review');
    expect(getEvalRun).toHaveBeenCalledWith('run-1');
  });

  it('a failed detail fetch shows an error, not an endless "Loading…" (copilot #198)', async () => {
    listEvalRuns.mockResolvedValue([row()]);
    getEvalRun.mockRejectedValue(new Error('boom'));
    render(<EvalHistory now={NOW} />);
    await waitFor(() => expect(screen.getByTestId('eval-history-row')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('eval-history-row').querySelector('button')!);
    await waitFor(() => expect(screen.getByTestId('eval-history-detail-error')).toBeInTheDocument());
  });

  it('an empty store shows the honest empty state', async () => {
    listEvalRuns.mockResolvedValue([]);
    render(<EvalHistory now={NOW} />);
    await waitFor(() => expect(screen.getByTestId('eval-history-empty')).toBeInTheDocument());
  });

  it('a daemon that predates the store (404) shows the unavailable note, not an error', async () => {
    listEvalRuns.mockRejectedValue(new Error('404'));
    render(<EvalHistory now={NOW} />);
    await waitFor(() => expect(screen.getByTestId('eval-history-unavailable')).toBeInTheDocument());
  });
});


describe('groupEvalRuns', () => {
  it('folds only consecutive identical rollups, preserving order and the newest detail target', () => {
    const first = row({ id: 'newest', degraded: 'facet-only' });
    const second = row({ id: 'older', created_at: first.created_at - 60, actor: 'another actor', degraded: 'facet-only' });
    const variants = [
      row({ id: 'corpus', corpus: 'evals:other', degraded: 'facet-only' }),
      row({ id: 'type', corpus: 'evals:other', type_filter: 'security', degraded: 'facet-only' }),
      row({ id: 'degraded', corpus: 'evals:other', type_filter: 'security' }),
      row({ id: 'caught', corpus: 'evals:other', type_filter: 'security', summary: { total: 3, caught: 2, gaps: 1, false_positives: 1 } }),
      row({ id: 'gaps', corpus: 'evals:other', type_filter: 'security', summary: { total: 3, caught: 2, gaps: 2, false_positives: 1 } }),
      row({ id: 'false-positives', corpus: 'evals:other', type_filter: 'security', summary: { total: 3, caught: 2, gaps: 2, false_positives: 2 } }),
      row({ id: 'total', corpus: 'evals:other', type_filter: 'security', summary: { total: 4, caught: 2, gaps: 2, false_positives: 2 } }),
    ];
    const repeated = row({ id: 'nonconsecutive', degraded: 'facet-only' });
    const input = [first, second, ...variants, repeated];
    const groups = groupEvalRuns(input);
    expect(groups.map((group) => group.key)).toEqual(['newest', ...variants.map((run) => run.id), 'nonconsecutive']);
    expect(groups.map((group) => group.runs.length)).toEqual([2, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(groups[0]?.newest).toBe(first);
    expect(groups[0]?.runs).toEqual([first, second]);
    expect(groups.flatMap((group) => group.runs)).toEqual(input);
    expect(input).toHaveLength(10);
    expect(groupEvalRuns([])).toEqual([]);
  });
});
