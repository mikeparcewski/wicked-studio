// crew#265 + issue #219 — Archived chip and Archive-from-row.
//
// Default: archived runs are simply absent (the daemon excludes them; WorkPage adds nothing).
// Chip ON: fetches the complete list, shows ONLY the archived remainder under an "Archived"
// group, with an Unarchive action that removes the row optimistically on success.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

const live = makeView({ id: 'live-1', workflow_id: 'feature', problem: 'live work', status: 'completed' });
const failed = makeView({ id: 'fail-1', workflow_id: 'feature', problem: 'broken work', status: 'failed' });
const cancelled = makeView({ id: 'canc-1', workflow_id: 'feature', problem: 'stopped work', status: 'cancelled' });
const active = makeView({ id: 'act-1', workflow_id: 'feature', problem: 'active work', status: 'executing' });
const archived = makeView({
  id: 'old-1',
  workflow_id: 'feature',
  problem: 'campaign leftover',
  status: 'failed',
  archived_at: 1786700000000,
});

beforeEach(() => {
  listRuns.mockReset();
  archiveRun.mockReset();
});

function renderPage() {
  return render(
    <WorkPage runs={[live]} selectedRunId={null} onSelect={() => {}} navigate={() => {}} />,
  );
}

describe('WorkPage — Archived chip (crew#265)', () => {
  it('is off by default: no fetch, no Archived group', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /^Archived/ })).toHaveAttribute('aria-pressed', 'false');
    expect(listRuns).not.toHaveBeenCalled();
    expect(screen.queryByText('campaign leftover')).toBeNull();
  });

  it('toggling on fetches the complete list and shows only the archived remainder', async () => {
    listRuns.mockResolvedValue({ runs: [live, archived] });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Archived/ }));
    // Slice Y2 (DES-UX-001 §7.5): rows render the SYNTHESIZED title —
    // intent · short-id · #ordinal — so the lookups match on the intent lead.
    await waitFor(() => expect(screen.getByText(/campaign leftover · old-1/)).toBeInTheDocument());
    expect(listRuns).toHaveBeenCalledWith(true);
    // The live run appears once (its normal group), not duplicated into the archived group.
    expect(screen.getAllByText(/live work · live-1/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Archived 1$/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Unarchive calls the API and drops the row', async () => {
    listRuns.mockResolvedValue({ runs: [live, archived] });
    archiveRun.mockResolvedValue({ runId: 'old-1', archived: false });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Archived/ }));
    await waitFor(() => expect(screen.getByText(/campaign leftover · old-1/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Unarchive' }));
    expect(archiveRun).toHaveBeenCalledWith('old-1', false);
    await waitFor(() => expect(screen.queryByText(/campaign leftover/)).toBeNull());
  });
});

describe('WorkPage — Archive from terminal row (#219)', () => {
  it('terminal rows show an Archive button', () => {
    render(
      <WorkPage
        runs={[live]}
        selectedRunId={null}
        onSelect={() => {}}
        navigate={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getAllByRole('button', { name: 'Archive' })).toHaveLength(1);
  });

  it('active runs do not show an Archive button', () => {
    const activeRun = makeView({ id: 'act-1', workflow_id: 'feature', problem: 'active work', status: 'executing' });
    render(
      <WorkPage
        runs={[activeRun]}
        selectedRunId={null}
        onSelect={() => {}}
        navigate={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });

  it('Archive calls archiveRun(id, true) and invokes onRefresh', async () => {
    archiveRun.mockResolvedValue({ runId: 'live-1', archived: true });
    const onRefresh = vi.fn();
    render(
      <WorkPage
        runs={[live]}
        selectedRunId={null}
        onSelect={() => {}}
        navigate={() => {}}
        onRefresh={onRefresh}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(archiveRun).toHaveBeenCalledWith('live-1', true);
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  // The All tab partitions rows into Active / Completed / Failed / Cancelled groups
  // (`outcomeOf`); every TERMINAL group carries the button, the Active group none.
  // Each group is exercised on its own so a group that drops the button fails on
  // its own name — the review's surviving mutation M5.
  it.each([
    ['Completed', live],
    ['Failed', failed],
    ['Cancelled', cancelled],
  ] as const)('the %s group on the All tab archives its row', async (label, view) => {
    archiveRun.mockResolvedValue({ runId: view.session.id, archived: true });
    const onRefresh = vi.fn();
    render(
      <WorkPage
        runs={[active, view]}
        selectedRunId={null}
        onSelect={() => {}}
        navigate={() => {}}
        onRefresh={onRefresh}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Filter by status' })).toHaveAttribute('data-filter', 'all');
    expect(screen.getByText(label)).toBeInTheDocument();
    // The Active row has no button, so the single Archive belongs to this group's row.
    const buttons = screen.getAllByRole('button', { name: 'Archive' });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    expect(archiveRun).toHaveBeenCalledWith(view.session.id, true);
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('the All tab shows one Archive per terminal row across all three groups, none for Active', () => {
    render(
      <WorkPage
        runs={[active, live, failed, cancelled]}
        selectedRunId={null}
        onSelect={() => {}}
        navigate={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getAllByRole('button', { name: 'Archive' })).toHaveLength(3);
    expect(screen.getByText(/active work · act-1/)).toBeInTheDocument();
  });

  // The filtered tab views render their own row wrapper (not the All-tab groups), so
  // they are covered separately — the review's surviving mutation M4.
  it.each([
    ['completed', live],
    ['failed', failed],
    ['cancelled', cancelled],
  ] as const)('the ?filter=%s tab view archives its row', async (tab, view) => {
    archiveRun.mockResolvedValue({ runId: view.session.id, archived: true });
    const onRefresh = vi.fn();
    render(
      <WorkPage
        runs={[active, live, failed, cancelled]}
        selectedRunId={null}
        onSelect={() => {}}
        navigate={() => {}}
        search={`?filter=${tab}`}
        onRefresh={onRefresh}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Filter by status' })).toHaveAttribute('data-filter', tab);
    // Exactly the one run of this status is listed, with exactly one Archive.
    expect(screen.getByText(new RegExp(`${view.session.problem} · ${view.session.id}`))).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Archive' });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    expect(archiveRun).toHaveBeenCalledWith(view.session.id, true);
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('the ?filter=active tab view lists live runs with no Archive', () => {
    render(
      <WorkPage
        runs={[active, live, failed, cancelled]}
        selectedRunId={null}
        onSelect={() => {}}
        navigate={() => {}}
        search="?filter=active"
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Filter by status' })).toHaveAttribute('data-filter', 'active');
    expect(screen.getByText(/active work · act-1/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });
});
