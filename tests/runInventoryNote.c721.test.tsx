// wicked-crew#721: the run's record says when an enumerating step's list is not complete —
// a partial or unreadable `wicked-inventory` claim, or a finished unit whose output was unreadable.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { api } from '../src/api/client.js';
import type { RunInventoryResponse } from '../src/api/types.js';
import { RunInventoryNote, claimWords, inventoryLines, inventoryProgress } from '../src/components/RunInventoryNote.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const RUN = 'r-inv';
const inv = (over: Partial<RunInventoryResponse> = {}): RunInventoryResponse => ({
  runId: RUN,
  readable: true,
  complete: false,
  units: [
    {
      ord: 2,
      unitId: `${RUN}:survey`,
      claims: [
        { source: 'gh issue list', answered: 'full', listed: 58, expected: 58, unread: [] },
        { source: 'gh pr list', answered: 'partial', listed: 4, expected: 10, unread: ['PRs: API 403'] },
      ],
    },
  ],
  unreadUnits: [],
  ...over,
});

describe('crew#721 — a run says when its inventory is incomplete', () => {
  it('words a claim: the answer, the count, the source and what was unread', () => {
    expect(claimWords({ source: 'gh pr list', answered: 'partial', listed: 4, expected: 10, unread: ['PRs: API 403'] }))
      .toBe('partial: 4 of 10 from gh pr list · unread: PRs: API 403');
    expect(claimWords({ source: null, answered: 'unknown', listed: null, expected: null, unread: ['not JSON'] }))
      .toBe('unreadable claim · unread: not JSON');
    expect(claimWords({ source: 'ls', answered: 'none', listed: 3, expected: null, unread: [] })).toBe('none: 3 listed from ls');
  });

  it('lists every claim that is not full, then each unit whose output could not be read', () => {
    const lines = inventoryLines(inv({ unreadUnits: [`${RUN}:triage`] }));
    expect(lines.map((l) => l.words)).toEqual([
      'partial: 4 of 10 from gh pr list · unread: PRs: API 403',
      'triage: output could not be read, so its inventory is unknown',
    ]);
  });

  it('says nothing for a complete inventory or a daemon that keeps no transcripts', () => {
    const full = inv();
    full.units[0]!.claims = [full.units[0]!.claims[0]!];
    expect(inventoryLines({ ...full, complete: true })).toEqual([]);
    expect(inventoryLines(inv({ readable: false }))).toEqual([]);
  });

  it('renders the lines from the route, and nothing when the route is missing', async () => {
    vi.spyOn(api, 'getRunInventory').mockResolvedValue(inv());
    const { unmount } = render(<RunInventoryNote runId={RUN} progress="executing:0" />);
    await waitFor(() => expect(screen.getByTestId('run-inventory')).toBeTruthy());
    expect(screen.getAllByTestId('run-inventory-line').map((p) => p.textContent)).toEqual([
      'Inventory partial: 4 of 10 from gh pr list · unread: PRs: API 403',
    ]);
    unmount();
    vi.spyOn(api, 'getRunInventory').mockRejectedValue(new Error('404'));
    render(<RunInventoryNote runId={RUN} progress="executing:0" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('run-inventory')).toBeNull();
  });

  it('re-reads as units settle, and never shows another run\'s response', async () => {
    expect(inventoryProgress('executing', [{ status: 'done' }, { status: 'pending' }])).toBe('executing:1');
    expect(inventoryProgress('completed', [{ status: 'done' }, { status: 'rejected' }])).toBe('completed:2');
    const spy = vi.spyOn(api, 'getRunInventory').mockResolvedValueOnce(inv({ units: [] }));
    const { rerender } = render(<RunInventoryNote runId={RUN} progress="executing:0" />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('run-inventory')).toBeNull();
    spy.mockResolvedValueOnce(inv());
    rerender(<RunInventoryNote runId={RUN} progress="executing:1" />);
    await waitFor(() => expect(screen.getByTestId('run-inventory')).toBeTruthy());
    // Another run: the previous run's lines are not shown while (or after) its read is pending.
    spy.mockReturnValueOnce(new Promise(() => {}));
    rerender(<RunInventoryNote runId="r-other" progress="executing:0" />);
    expect(screen.queryByTestId('run-inventory')).toBeNull();
  });
});
