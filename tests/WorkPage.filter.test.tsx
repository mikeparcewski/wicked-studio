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

// EC39 follow-through (fix slice J4/J5 verification finding): the positional
// range window (useTimeRange, 30d → first 30 rows) can hide the very rows a
// landing count links to — live, the lede's "3 cancelled" landed on a 30d
// /work view holding ZERO cancelled rows. The exclusion must be STATED.
describe('WorkPage — range-hidden rows are stated, never silent (EC39)', () => {
  // 31 completed rows first (fills the 30d positional window), then the
  // cancelled row — outside the window on the cancelled tab.
  const MANY = [
    ...Array.from({ length: 31 }, (_, i) =>
      makeView({ id: `r-c${i}`, workflow_id: 'feature', problem: `done ${i}`, status: 'completed' })),
    makeView({ id: 'r-cxl', workflow_id: 'feature', problem: 'called off', status: 'cancelled' }),
  ];

  it('states the hidden count on a filter whose rows the window excludes, and shows all on demand', async () => {
    render(
      <WorkPage runs={MANY} selectedRunId={null} onSelect={() => {}} navigate={() => {}} search="?filter=cancelled" />,
    );
    // The last-30 window (first 30 rows) holds no cancelled run — the note
    // says so, in the window's HONEST name (review #9: never "30d").
    const note = screen.getByTestId('work-range-hidden-note');
    expect(note).toHaveAttribute('data-hidden', '1');
    expect(note.textContent).toMatch(/1 more cancelled run sits outside the last 30-runs window/);
    // The empty state tells the SAME truth — never "No cancelled runs yet."
    // one line under a note saying they exist.
    expect(screen.getByText(/No cancelled runs in this range view — 1 exists outside it\./)).toBeInTheDocument();
    // Show all → the row appears and the note goes away.
    await userEvent.click(screen.getByTestId('work-range-widen'));
    expect(screen.getByText(/called off/)).toBeInTheDocument();
    expect(screen.queryByTestId('work-range-hidden-note')).toBeNull();
  });

  it('renders no note when the window hides nothing', () => {
    render(
      <WorkPage runs={RUNS} selectedRunId={null} onSelect={() => {}} navigate={() => {}} search="?filter=failed" />,
    );
    expect(screen.queryByTestId('work-range-hidden-note')).toBeNull();
  });

  it('surfaces the held-back rows as a FIRST-CLASS chip beside the tabs; clicking shows all (review #9)', async () => {
    render(<WorkPage runs={MANY} selectedRunId={null} onSelect={() => {}} navigate={() => {}} />);
    const chip = screen.getByTestId('work-hidden-chip');
    // 32 work runs, 30 in the window → 2 held back across all statuses.
    expect(chip).toHaveAttribute('data-hidden', '2');
    await userEvent.click(chip);
    // Everything shows; the chip retires with nothing left to reveal.
    expect(screen.queryByTestId('work-hidden-chip')).toBeNull();
    expect(screen.getByText(/called off/)).toBeInTheDocument();
  });

  it('search looks at the FULL set — a match outside the window is found, and no hidden note contradicts it', async () => {
    render(<WorkPage runs={MANY} selectedRunId={null} onSelect={() => {}} navigate={() => {}} />);
    // "called off" is row 32 — outside the last-30 window.
    await userEvent.type(screen.getByPlaceholderText('Search work…'), 'called off');
    expect(screen.getByText(/called off/)).toBeInTheDocument();
    expect(screen.queryByTestId('work-range-hidden-note')).toBeNull();
    expect(screen.queryByTestId('work-hidden-chip')).toBeNull();
  });
});

describe('WorkPage — the success-rate tile wears threshold colors (review #9)', () => {
  const mixed = (completed: number, failed: number): ReturnType<typeof makeView>[] => [
    ...Array.from({ length: completed }, (_, i) =>
      makeView({ id: `r-ok${i}`, workflow_id: 'feature', problem: `ok ${i}`, status: 'completed' })),
    ...Array.from({ length: failed }, (_, i) =>
      makeView({ id: `r-no${i}`, workflow_id: 'feature', problem: `no ${i}`, status: 'failed' })),
  ];

  it('9 completed vs 21 failed (the live 30%) is BAD — never success-green', () => {
    render(<WorkPage runs={mixed(9, 21)} selectedRunId={null} onSelect={() => {}} navigate={() => {}} />);
    const tile = screen.getByTestId('work-success-rate');
    expect(tile).toHaveAttribute('data-health', 'bad');
    expect(tile).toHaveTextContent('30%');
  });

  it('a borderline rate is amber; a healthy one green; no terminal runs, no verdict', () => {
    const { unmount } = render(
      <WorkPage runs={mixed(6, 4)} selectedRunId={null} onSelect={() => {}} navigate={() => {}} />,
    );
    expect(screen.getByTestId('work-success-rate')).toHaveAttribute('data-health', 'warn');
    unmount();

    const second = render(
      <WorkPage runs={mixed(9, 1)} selectedRunId={null} onSelect={() => {}} navigate={() => {}} />,
    );
    expect(screen.getByTestId('work-success-rate')).toHaveAttribute('data-health', 'good');
    second.unmount();

    render(<WorkPage runs={[]} selectedRunId={null} onSelect={() => {}} navigate={() => {}} />);
    expect(screen.getByTestId('work-success-rate')).toHaveAttribute('data-health', 'none');
    expect(screen.getByTestId('work-success-rate')).toHaveTextContent('—');
  });
});
