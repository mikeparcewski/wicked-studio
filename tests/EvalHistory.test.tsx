// The eval-run history (crew-side EvalRunStore wiring) — the Evals section's real list + drilldown.

import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listEvalRuns = vi.fn();
const getEvalRun = vi.fn();
vi.mock('../src/api/testing.js', () => ({ listEvalRuns: () => listEvalRuns(), getEvalRun: (id: string) => getEvalRun(id) }));
vi.mock('../src/api/errors.js', () => ({ isRouteAbsent: (e: unknown) => e instanceof Error && e.message === '404' }));

const { EvalHistory } = await import('../src/components/EvalHistory.js');

afterEach(cleanup);

const NOW = 1_760_000_000_000;
const row = (over = {}) => ({
  id: 'run-1', created_at: Math.floor(NOW / 1000) - 120, actor: 'mikeparcewski',
  corpus: null, type_filter: null, rule_store: '/x/core.db',
  summary: { total: 3, caught: 1, gaps: 1, false_positives: 1 },
  per_type: {}, degraded: null, ...over,
});

describe('EvalHistory', () => {
  it('lists recorded runs with their rollup, newest-first from the store', async () => {
    listEvalRuns.mockResolvedValue([row({ id: 'run-1', corpus: 'evals:dev', type_filter: 'security' })]);
    render(<EvalHistory now={NOW} />);
    await waitFor(() => expect(screen.getByTestId('eval-history')).toBeInTheDocument());
    const r = screen.getByTestId('eval-history-row');
    expect(r.textContent).toContain('evals:dev');
    expect(r.textContent).toContain('security');
    expect(r.textContent).toContain('1'); // caught/gaps/fp counts render
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
