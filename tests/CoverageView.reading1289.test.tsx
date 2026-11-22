/**
 * studio#1289: Understand → Coverage showed a lone disabled "Loading…" button for 20 s and more while its read ran.
 * The pane now says what it is reading, stops waiting after COVERAGE_READ_TIMEOUT_MS with Try again, drops a late
 * answer, and offers Try again on a failed read.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoverageReport } from '../src/api/types.js';
import { COVERAGE_READ_TIMEOUT_MS, CoverageView } from '../src/components/CoverageView.js';

const REPORT: CoverageReport = {
  total: 10, behavior_bearing: 8, resolved: 8, risk_flagged: 0, unaccounted: 0, coverage: 1,
  resolved_rate: 1, mean_confidence: 0.9, resolve_threshold: 0.7, per_app: [], unaccounted_nodes: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] } as never);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('the coverage read (studio#1289)', () => {
  it('says what it is reading while the read runs', async () => {
    vi.spyOn(client.api, 'getCoverageReport').mockReturnValue(new Promise(() => {}));
    render(<CoverageView />);
    expect(screen.getByTestId('coverage-reading')).toHaveTextContent('Reading coverage for all repositories (daemon)…');
    expect(screen.getByTestId('coverage-reading')).toHaveAttribute('role', 'status');
  });

  it('a read that never answers ends in a timeout with Try again, which reads again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const get = vi.spyOn(client.api, 'getCoverageReport').mockReturnValueOnce(new Promise(() => {}));
    render(<CoverageView />);
    expect(screen.queryByTestId('coverage-error')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(COVERAGE_READ_TIMEOUT_MS); });
    const err = await screen.findByTestId('coverage-error');
    expect(err).toHaveAttribute('data-kind', 'timeout');
    expect(err).toHaveAttribute('role', 'alert');
    expect(err).toHaveTextContent('Coverage didn’t answer within 30 s.');
    expect(screen.queryByTestId('coverage-reading')).toBeNull();
    get.mockResolvedValueOnce({ report: REPORT });
    fireEvent.click(screen.getByTestId('coverage-retry'));
    await waitFor(() => expect(screen.getByText('Total nodes')).toBeInTheDocument());
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('coverage-error')).toBeNull();
  });

  it('an answer that lands after the timeout is dropped', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let late: (v: { report: CoverageReport }) => void = () => undefined;
    vi.spyOn(client.api, 'getCoverageReport').mockReturnValueOnce(new Promise((done) => { late = done; }));
    render(<CoverageView />);
    await act(async () => { vi.advanceTimersByTime(COVERAGE_READ_TIMEOUT_MS); });
    await screen.findByTestId('coverage-error');
    await act(async () => { late({ report: REPORT }); });
    expect(screen.queryByText('Total nodes')).toBeNull();
    expect(screen.getByTestId('coverage-error')).toHaveAttribute('data-kind', 'timeout');
  });

  it('a failed read says so, keeps the daemon\'s words, and Try again reads again', async () => {
    const get = vi.spyOn(client.api, 'getCoverageReport').mockRejectedValueOnce(new Error('the daemon refused this — store locked'));
    render(<CoverageView />);
    const err = await screen.findByTestId('coverage-error');
    expect(err).toHaveAttribute('data-kind', 'error');
    expect(err).toHaveTextContent('Coverage couldn’t be read: the daemon refused this — store locked');
    get.mockResolvedValueOnce({ report: REPORT });
    fireEvent.click(screen.getByTestId('coverage-retry'));
    await waitFor(() => expect(screen.getByText('Total nodes')).toBeInTheDocument());
  });
});
