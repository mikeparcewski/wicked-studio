// Slice R (DES-UX-001 §1.3-4b / §1.5): the zero-request eternal-Loading diff
// hang, fixed outright.
//
// The regression this pins: "Full diff" on a historical run hung on "Loading…"
// forever WHILE FIRING ZERO NETWORK REQUESTS. Two falsifiable contracts:
//
//   1. opening the diff tab ALWAYS dispatches the request (≥1 getRunDiff call —
//      the rig's request-tap twin asserts the same on the wire);
//   2. a request that never resolves lands in `[data-testid="diff-error"]`
//      within the DIFF_TIMEOUT_MS budget — with a Retry that re-dispatches.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { FileViewer, DIFF_TIMEOUT_MS } from '../src/components/FileViewer.js';
import * as client from '../src/api/client.js';

describe('FileViewer — the diff hang is dead (slice R)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a never-resolving diff dispatches the request AND reaches diff-error within the budget', async () => {
    const getRunDiff = vi
      .spyOn(client.api, 'getRunDiff')
      .mockImplementation(() => new Promise(() => { /* never resolves */ }));
    render(<FileViewer runId="r-hist" defaultTab="diff" onClose={() => {}} onUnsupported={() => {}} />);

    // Contract 1: the request WAS attempted, immediately on activation.
    expect(getRunDiff).toHaveBeenCalledTimes(1);
    expect(getRunDiff).toHaveBeenCalledWith('r-hist', undefined);

    // Still honestly loading inside the budget…
    act(() => { vi.advanceTimersByTime(DIFF_TIMEOUT_MS - 1); });
    expect(screen.queryByTestId('diff-error')).not.toBeInTheDocument();

    // …and the error branch lands AT the budget — never an indefinite spinner.
    act(() => { vi.advanceTimersByTime(2); });
    expect(screen.getByTestId('diff-error')).toHaveTextContent("Couldn't load the diff");
  });

  it('Retry re-dispatches the request', async () => {
    const getRunDiff = vi
      .spyOn(client.api, 'getRunDiff')
      .mockImplementation(() => new Promise(() => { /* never resolves */ }));
    render(<FileViewer runId="r-hist" defaultTab="diff" onClose={() => {}} onUnsupported={() => {}} />);

    act(() => { vi.advanceTimersByTime(DIFF_TIMEOUT_MS + 1); });
    act(() => { screen.getByTestId('diff-retry').click(); });

    expect(getRunDiff).toHaveBeenCalledTimes(2);
    // Back to an honest loading state, not a stale error.
    expect(screen.queryByTestId('diff-error')).not.toBeInTheDocument();
  });

  it('a resolving diff inside the budget renders normally (no spurious timeout)', async () => {
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
    render(<FileViewer runId="r-1" defaultTab="diff" onClose={() => {}} onUnsupported={() => {}} />);

    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(screen.getByTestId('viewer-clean-tree')).toBeInTheDocument();
    // The §8.1 interim baseline note rides every resolved diff view.
    expect(screen.getByTestId('diff-baseline-note')).toHaveTextContent(
      'showing uncommitted changes vs HEAD; committed work is not shown here',
    );
    act(() => { vi.advanceTimersByTime(DIFF_TIMEOUT_MS + 10); });
    expect(screen.queryByTestId('diff-error')).not.toBeInTheDocument();
  });
});
