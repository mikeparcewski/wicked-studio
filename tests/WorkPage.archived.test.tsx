// crew#265 — the Archived chip: a write-off view, off by default.
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
