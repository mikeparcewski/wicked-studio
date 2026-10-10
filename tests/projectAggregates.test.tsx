import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';

/**
 * studio#158 — the project page's Coverage and Domain sections, read from crew's folds
 * (`GET /projects/:id/{coverage,domain}`, crew#371). Every member repo is a row with its state;
 * an unread one says why in crew's words; an older daemon (route absent) draws nothing.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a), apiBase: () => '/api/v1' }));

const { ProjectCoverage, ProjectDomain, coverageTotalsLine } = await import('../src/components/product/ProjectAggregates.js');

const report = (resolved: number, bb: number) => ({ total: bb + 5, behavior_bearing: bb, resolved, risk_flagged: 1, unaccounted: bb - resolved - 1, coverage: bb === 0 ? 1 : (resolved + 1) / bb, resolved_rate: 0.9, mean_confidence: 0.8, resolve_threshold: 0.75, per_app: [] });
const totals = { repos: 4, ok: 1, absent: 1, errors: 1, dangling: 1 };
const COVERAGE = {
  projectId: 'shop',
  totals: { ...totals, behavior_bearing: 40, resolved: 12, coverage: 0.3 },
  rows: [
    { repo: { id: 'r1', name: 'api' }, state: 'ok', report: report(12, 40) },
    { repo: { id: 'r2', name: 'web' }, state: 'absent', reason: 'the graph is not indexed', report: null },
    { repo: { id: 'r3', name: null }, state: 'error', reason: 'timed out after 15 s', report: null },
    { repo: { id: 'r4', name: null }, state: 'dangling', reason: 'repo r4 is not registered', report: null },
  ],
};
const DOMAIN = {
  projectId: 'shop',
  totals: { ...totals, domains: 2, requirements: 30, entities: 9 },
  merged: [{ name: 'billing', repoIds: ['r1', 'r2'], requirements: 20, entities: 6 }, { name: 'auth', repoIds: ['r1'], requirements: 10, entities: 3 }],
  rows: [
    { repo: { id: 'r1', name: 'api' }, state: 'ok', domains: [{ name: 'billing', description: null, requirements: 12, entities: 4 }, { name: 'auth', description: null, requirements: 10, entities: 3 }] },
    { repo: { id: 'r2', name: 'web' }, state: 'absent', reason: 'no requirements_graph.json', domains: [] },
  ],
};

beforeEach(() => apiFetch.mockReset());
afterEach(cleanup);

describe('Coverage (studio#158)', () => {
  it('every member repo is a row: ok with its numbers, the others with crew\'s reason', async () => {
    apiFetch.mockResolvedValue(COVERAGE);
    const navigate = vi.fn();
    render(<ProjectCoverage projectId="shop" navigate={navigate} />);
    expect(await screen.findByTestId('project-coverage-totals')).toHaveTextContent('Resolved 12 of 40 behavior-bearing nodes (30.0%) · 1 of 4 repositories read');
    expect(apiFetch).toHaveBeenCalledWith('/projects/shop/coverage');
    const rows = screen.getAllByTestId('project-coverage-row');
    expect(rows.map((r) => r.dataset.state)).toEqual(['ok', 'absent', 'error', 'dangling']);
    expect(rows[0]).toHaveTextContent('api32.5% · resolved 12 of 40 · 1 risk-flagged · 27 unaccounted');
    expect(rows[1]).toHaveTextContent('web' + 'not generated yet — the graph is not indexed');
    expect(rows[2]).toHaveTextContent('r3could not be read — timed out after 15 s');
    expect(rows[3]).toHaveTextContent('no longer registered — repo r4 is not registered');
    await userEvent.click(within(rows[0]!).getByRole('link', { name: 'api' }));
    expect(navigate).toHaveBeenCalledWith('/repo-detail/r1');
  });

  it('0/0 is undefined, not complete — and "nothing read" is not "nothing behavior-bearing"', () => {
    expect(coverageTotalsLine({ ...totals, behavior_bearing: 0, resolved: 0, coverage: null })).toBe('The repositories read have nothing behavior-bearing yet, so project coverage is undefined · 1 of 4 repositories read');
    expect(coverageTotalsLine({ ...totals, ok: 0, behavior_bearing: 0, resolved: 0, coverage: null })).toBe("No repository's coverage could be read, so project coverage is unknown · 0 of 4 repositories read");
  });

  it('a ratio below 1 never rounds up to 100%', () => {
    expect(coverageTotalsLine({ ...totals, behavior_bearing: 10_000, resolved: 9_999, coverage: 0.9999 })).toContain('(<100%)');
    expect(coverageTotalsLine({ ...totals, behavior_bearing: 10, resolved: 10, coverage: 1 })).toContain('(100.0%)');
  });

  it('the sections are headed regions', async () => {
    apiFetch.mockResolvedValue(COVERAGE);
    render(<ProjectCoverage projectId="shop" navigate={vi.fn()} />);
    expect(await screen.findByRole('region', { name: 'Coverage' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Coverage' })).toBeInTheDocument();
  });

  it('an older daemon (route absent) draws nothing; a refusal says why; no repo says so', async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(404, 'Not Found'));
    const { container } = render(<ProjectCoverage projectId="shop" navigate={vi.fn()} />);
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    cleanup();
    apiFetch.mockRejectedValueOnce(new ApiError(404, 'project shop not found'));
    render(<ProjectCoverage projectId="shop" navigate={vi.fn()} />);
    expect(await screen.findByTestId('project-coverage-error')).toHaveTextContent('project shop not found');
    cleanup();
    apiFetch.mockResolvedValueOnce({ ...COVERAGE, rows: [] });
    render(<ProjectCoverage projectId="shop" navigate={vi.fn()} />);
    expect(await screen.findByTestId('project-coverage-empty')).toBeInTheDocument();
  });

  it('A loaded → B pending → back to A shows no stale answer while A is read again (codex on #158)', async () => {
    let releaseA2: (v: unknown) => void = () => undefined;
    apiFetch
      .mockResolvedValueOnce(COVERAGE) // A, first read
      .mockImplementationOnce(() => new Promise(() => undefined)) // B, never answers
      .mockImplementationOnce(() => new Promise((r) => { releaseA2 = r; })); // A, second read
    const { rerender } = render(<ProjectCoverage projectId="a" navigate={vi.fn()} />);
    await screen.findByTestId('project-coverage-totals');
    rerender(<ProjectCoverage projectId="b" navigate={vi.fn()} />);
    rerender(<ProjectCoverage projectId="a" navigate={vi.fn()} />);
    expect(screen.queryByTestId('project-coverage')).toBeNull();
    releaseA2({ ...COVERAGE, totals: { ...COVERAGE.totals, resolved: 7 } });
    expect(await screen.findByTestId('project-coverage-totals')).toHaveTextContent('Resolved 7 of 40');
  });

  it('a switch of project never shows the previous project\'s answer', async () => {
    let release: (v: unknown) => void = () => undefined;
    apiFetch.mockImplementationOnce(() => new Promise((r) => { release = r; })).mockResolvedValueOnce({ ...COVERAGE, projectId: 'b' });
    const { rerender } = render(<ProjectCoverage projectId="a" navigate={vi.fn()} />);
    rerender(<ProjectCoverage projectId="b" navigate={vi.fn()} />);
    await screen.findByTestId('project-coverage-totals');
    release({ ...COVERAGE, totals: { ...COVERAGE.totals, resolved: 999 } });
    await Promise.resolve();
    expect(screen.getByTestId('project-coverage-totals')).toHaveTextContent('Resolved 12 of 40');
  });
});

describe('Domain (studio#158)', () => {
  it('the merged domains, then each repo\'s own, with reasons for the unread', async () => {
    apiFetch.mockResolvedValue(DOMAIN);
    render(<ProjectDomain projectId="shop" navigate={vi.fn()} />);
    expect(await screen.findByTestId('project-domain-totals')).toHaveTextContent('2 domains · 30 requirements · 9 entities · 1 of 4 repositories read');
    expect(apiFetch).toHaveBeenCalledWith('/projects/shop/domain');
    expect(screen.getAllByTestId('project-domain-merged-row').map((r) => r.textContent)).toEqual([
      'billing20 requirements · 6 entities · in 2 repositories',
      'auth10 requirements · 3 entities · in 1 repository',
    ]);
    const rows = screen.getAllByTestId('project-domain-row');
    expect(rows[0]).toHaveTextContent('apibilling · auth');
    expect(rows[1]).toHaveTextContent('not generated yet — no requirements_graph.json');
  });
});
