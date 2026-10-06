import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SessionView } from '../src/api/types.js';

/**
 * The Archived lens of See everything › Sessions (S15c), studio#510 + #511:
 *  - an archived onboarding run's row names its repository ("Set up offsite-plan"), the same word
 *    the Desk rail uses since #423 — not the shared "Onboard repository" clause;
 *  - Unarchive re-reads the runs list (the same `onRetryRuns` Archive on a finished row calls), so
 *    the run shows under its state filter without leaving the page. Before, Unarchive edited only
 *    the lens's local rows and the run stayed missing from Sessions until some other navigation
 *    happened to reload the list.
 */

const listRuns = vi.fn();
const archiveRun = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, {
    get: (_t, k) => (k === 'listRuns' ? listRuns : k === 'archiveRun' ? archiveRun : () => Promise.resolve({})),
  }),
  apiFetch: () => Promise.resolve({}),
}));
vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null, failedAt: null }),
}));

const { EverythingPage } = await import('../src/components/everything/EverythingPage.js');

function archived(id: string, problem: string): SessionView {
  return {
    session: {
      id, workflow_id: 'wf', problem, entity_mode: 'shared', collection_scope: null, clis: ['claude'], status: 'cancelled',
      human_confirm: 'none', unit_ix: 0, attempt: 0, workdir: null, repo_ref: null, extra_write_roots: [],
      archived_at: 1_759_000_000, archive_note: null, project_id: 'notes',
    },
    units: [],
  } as unknown as SessionView;
}

beforeEach(() => {
  listRuns.mockReset().mockResolvedValue({ runs: [archived('r-arch-1', 'Onboard repository: offsite-plan'), archived('r-arch-2', 'Onboard repository: notes-b')] });
  archiveRun.mockReset().mockResolvedValue({ runId: 'r-arch-1', archived: false });
});
afterEach(cleanup);

describe('Everything › Sessions › Archived', () => {
  it('names the repository of an archived onboarding run (studio#510)', async () => {
    render(<EverythingPage runs={[]} runsLoaded needRows={[]} navigate={() => {}} search="?tab=sessions&filter=archived" />);
    const rows = await screen.findAllByTestId('everything-archived-run');
    expect(rows.map((r) => r.querySelector('.wk-desk-session-title')?.textContent)).toEqual(['Set up offsite-plan', 'Set up notes-b']);
  });

  it('Unarchive re-reads the runs list, like Archive does (studio#511)', async () => {
    const onRetryRuns = vi.fn();
    render(<EverythingPage runs={[]} runsLoaded onRetryRuns={onRetryRuns} needRows={[]} navigate={() => {}} search="?tab=sessions&filter=archived" />);
    const rows = await screen.findAllByTestId('everything-archived-run');
    fireEvent.click(rows[0]!.querySelector('[data-testid="everything-unarchive"]')!);
    await waitFor(() => expect(archiveRun).toHaveBeenCalledWith('r-arch-1', false));
    await waitFor(() => expect(onRetryRuns).toHaveBeenCalledTimes(1));
    // The row leaves the lens at once, as before.
    await waitFor(() => expect(screen.getAllByTestId('everything-archived-run')).toHaveLength(1));
  });
});
