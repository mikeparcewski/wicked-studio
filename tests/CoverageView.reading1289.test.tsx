/**
 * studio#1289: Understand → Coverage showed a lone disabled "Loading…" button for 20 s and more while its read ran.
 * The pane now says what it is reading, stops waiting after COVERAGE_READ_TIMEOUT_MS with Try again, drops a late
 * answer, and offers Try again on a failed read.
 */
import { StrictMode } from 'react';
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

describe('the coverage read ends cleanly (studio#1289, xreview r1)', () => {
  it('a timeout ends the request, and Try again starts a fresh one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const signals: AbortSignal[] = [];
    vi.spyOn(client.api, 'getCoverageReport').mockImplementation(((opts?: { signal?: AbortSignal }) => {
      if (opts?.signal !== undefined) signals.push(opts.signal);
      return new Promise(() => {});
    }) as never);
    render(<CoverageView />);
    await act(async () => { vi.advanceTimersByTime(COVERAGE_READ_TIMEOUT_MS); });
    await screen.findByTestId('coverage-error');
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(true);
    fireEvent.click(screen.getByTestId('coverage-retry'));
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[1]!.aborted).toBe(false);
  });

  it('leaving the pane ends the read in flight', async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(client.api, 'getCoverageReport').mockImplementation(((opts?: { signal?: AbortSignal }) => {
      signal = opts?.signal;
      return new Promise(() => {});
    }) as never);
    const { unmount } = render(<CoverageView />);
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal!.aborted).toBe(true);
  });

  it('an older read that answers after a newer one started is dropped (strict-mode remount)', async () => {
    const answers: Array<(v: { report: CoverageReport }) => void> = [];
    vi.spyOn(client.api, 'getCoverageReport').mockImplementation((() => new Promise((done) => { answers.push(done); })) as never);
    render(<StrictMode><CoverageView /></StrictMode>);
    await waitFor(() => expect(answers.length).toBe(2));
    await act(async () => { answers[0]!({ report: { ...REPORT, total: 111 } }); });
    expect(screen.queryByText('Total nodes')).toBeNull();
    expect(screen.getByTestId('coverage-reading')).toBeInTheDocument();
    await act(async () => { answers[1]!({ report: { ...REPORT, total: 222 } }); });
    await waitFor(() => expect(screen.getByText('Total nodes')).toBeInTheDocument());
    expect(screen.getByText('222')).toBeInTheDocument();
    expect(screen.queryByText('111')).toBeNull();
  });

  it('a repository that times out never shows the previous repository\'s numbers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [{ id: 'repo-b', name: 'billing-api' }] } as never);
    vi.spyOn(client.api, 'getCoverageReport').mockResolvedValue({ report: { ...REPORT, total: 333 } });
    vi.spyOn(client.api, 'getCoverageReportForRepo').mockReturnValue(new Promise(() => {}));
    vi.spyOn(client.api, 'getGraphKindsForRepo').mockResolvedValue({ kinds: [] });
    render(<CoverageView />);
    await waitFor(() => expect(screen.getByText('333')).toBeInTheDocument());
    await screen.findByRole('option', { name: 'billing-api' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Coverage repo' }), { target: { value: 'repo-b' } });
    expect(await screen.findByTestId('coverage-reading')).toHaveTextContent('Reading coverage for billing-api…');
    expect(screen.queryByText('333')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(COVERAGE_READ_TIMEOUT_MS); });
    expect(await screen.findByTestId('coverage-error')).toHaveAttribute('data-kind', 'timeout');
    expect(screen.queryByText('Total nodes')).toBeNull();
    expect(screen.queryByText('333')).toBeNull();
  });
});
