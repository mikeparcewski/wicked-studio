// DES-UX-001 §7.4 (slice Y) — context-sensitive entry on the ONE canonical
// runs surface: `?filter=<tab>` in the search string lands with that status
// tab active (`data-filter` on the tablist), garbage is ignored, and a later
// search change re-points the tab while the page stays mounted.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkPage } from '../src/components/WorkPage.js';
import { makeView } from './factories.js';

const listRuns = vi.fn();
const archiveRun = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listRuns: (...a: unknown[]) => listRuns(...a),
    archiveRun: (...a: unknown[]) => archiveRun(...a),
  },
}));

const RUNS = [
  makeView({ id: 'r-live', workflow_id: 'feature', problem: 'live work', status: 'executing' }),
  makeView({ id: 'r-done', workflow_id: 'feature', problem: 'done work', status: 'completed' }),
  makeView({ id: 'r-bad', workflow_id: 'feature', problem: 'broken work', status: 'failed' }),
];

beforeEach(() => {
  listRuns.mockReset();
  archiveRun.mockReset();
});

function mount(search?: string) {
  return render(
    <WorkPage
      runs={RUNS}
      selectedRunId={null}
      onSelect={() => {}}
      navigate={() => {}}
      {...(search === undefined ? {} : { search })}
    />,
  );
}

describe('WorkPage — §7.4 context-sensitive entry (slice Y)', () => {
  it('defaults to the All tab with data-filter="all"', () => {
    mount();
    expect(screen.getByRole('tablist')).toHaveAttribute('data-filter', 'all');
    expect(screen.getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('?filter=failed lands with the Failed tab active — the failure lens holds', () => {
    mount('?filter=failed');
    expect(screen.getByRole('tablist')).toHaveAttribute('data-filter', 'failed');
    expect(screen.getByRole('tab', { name: /^Failed/ })).toHaveAttribute('aria-selected', 'true');
    // Only the failed run renders in the panel. Rows carry the slice-Y2
    // synthesized title (`intent · short-id · #ordinal`, EC40), so the raw
    // problem text is a prefix, not the whole text node.
    expect(screen.getByText(/broken work/)).toBeInTheDocument();
    expect(screen.queryByText(/live work/)).toBeNull();
  });

  it('ignores a filter that is not a tab id', () => {
    mount('?filter=bogus');
    expect(screen.getByRole('tablist')).toHaveAttribute('data-filter', 'all');
  });

  it('a later ?filter= entry re-points the tab; a tab click afterwards wins', async () => {
    const { rerender } = mount();
    rerender(
      <WorkPage runs={RUNS} selectedRunId={null} onSelect={() => {}} navigate={() => {}} search="?filter=failed" />,
    );
    expect(screen.getByRole('tablist')).toHaveAttribute('data-filter', 'failed');
    await userEvent.click(screen.getByRole('tab', { name: /^Active/ }));
    expect(screen.getByRole('tablist')).toHaveAttribute('data-filter', 'active');
  });
});
