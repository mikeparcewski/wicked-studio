import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Project, SessionView } from '../src/api/types.js';
import { everythingPath, readEverythingQuery } from '../src/board/everythingModel.js';

/**
 * The "Every run" table on See everything › Sessions (S17b). The load-bearing proof is R1: the table
 * paints while `useBoardModel` is STILL loading — the runs view reads only the `runs` prop, the
 * projects store and the `runsLoaded` gate, never the board model's members fan-out. The rest covers
 * the view switch, the count, sort, text filter, state chips, the pager and the Archived lens.
 */

const listRuns = vi.fn();
const archiveRun = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, {
    get: (_t, k) => (k === 'listRuns' ? listRuns : k === 'archiveRun' ? archiveRun : () => Promise.resolve({})),
  }),
  apiFetch: () => Promise.resolve({}),
}));
// The guard: the board model never finishes loading, yet the runs table must still paint.
vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: true, error: null, failedAt: null }),
}));

const { EverythingPage } = await import('../src/components/everything/EverythingPage.js');
const { useProjectsStore } = await import('../src/store/projects.js');

const proj = (id: string, name: string): Project => ({ id, name, status: 'active', description: '', updated_at: 1, created_at: 1 } as Project);

function makeView(id: string, opts: { status?: string; problem?: string; project_id?: string | null; created_at?: number; ended_at?: number | null } = {}): SessionView {
  return {
    session: {
      id, workflow_id: 'wf', problem: opts.problem ?? `Problem ${id}`,
      status: opts.status ?? 'executing',
      project_id: opts.project_id !== undefined ? opts.project_id : null,
      created_at: opts.created_at ?? 1_700_000_000,
      ended_at: opts.ended_at !== undefined ? opts.ended_at : null,
      finished_at: null, repo_ref: null, archived_at: null, archive_note: null,
      entity_mode: 'shared', collection_scope: null, clis: ['claude'],
      human_confirm: 'none', unit_ix: 0, attempt: 0, workdir: null, extra_write_roots: [],
    },
    units: [],
  } as unknown as SessionView;
}

const runs: SessionView[] = [
  makeView('r-done', { status: 'completed', problem: 'Write tests', project_id: 'alpha', ended_at: 1_700_000_500 }),
  makeView('r-work', { status: 'executing', problem: 'Build tool', project_id: 'beta', created_at: 1_700_000_400 }),
  makeView('r-wait', { status: 'awaiting_human', problem: 'Review output', project_id: 'alpha' }),
  makeView('r-block', { status: 'failed', problem: 'Deploy pipeline', project_id: null }),
  makeView('r-quiet', { status: 'cancelled', problem: 'Abandoned run', project_id: 'beta' }),
];

const make150 = (): SessionView[] => Array.from({ length: 150 }, (_, i) => makeView(`r-${i}`, { status: i % 2 === 0 ? 'completed' : 'executing', created_at: 1_700_000_000 + i }));

beforeEach(() => {
  useProjectsStore.setState({ projects: [proj('alpha', 'Alpha'), proj('beta', 'Beta')] });
  listRuns.mockReset().mockResolvedValue({ runs: [] });
  archiveRun.mockReset().mockResolvedValue({ runId: 'r-arch', archived: false });
});
afterEach(cleanup);

describe('EverythingQuery carries view', () => {
  it('reads view=runs and defaults to grouped', () => {
    expect(readEverythingQuery('?tab=sessions&view=runs').view).toBe('runs');
    expect(readEverythingQuery('?tab=sessions').view).toBe('grouped');
  });
  it('writes view=runs and omits the grouped default', () => {
    expect(everythingPath({ tab: 'sessions', view: 'runs' })).toBe('/everything?tab=sessions&view=runs');
    expect(everythingPath({ tab: 'sessions', view: 'grouped' })).toBe('/everything?tab=sessions');
    expect(everythingPath({ tab: 'sessions' })).toBe('/everything?tab=sessions');
  });
});

describe('S17b Every-run table', () => {
  it('R1 paints the table while useBoardModel is still loading', () => {
    render(<EverythingPage runs={runs} runsLoaded needRows={[]} navigate={() => {}} search="?tab=sessions&view=runs" />);
    expect(screen.getAllByTestId('runs-row')).toHaveLength(5);
  });

  it('R2 "Reading your work…" when runsLoaded is false', () => {
    render(<EverythingPage runs={[]} runsLoaded={false} needRows={[]} navigate={() => {}} search="?tab=sessions&view=runs" />);
    expect(screen.getByTestId('everything-checking')).toBeInTheDocument();
    expect(screen.queryByTestId('runs-row')).toBeNull();
  });

  it('R3 a failed read shows the error and retry', () => {
    render(<EverythingPage runs={[]} runsLoaded={false} runsError="500 error" onRetryRuns={() => {}} needRows={[]} navigate={() => {}} search="?tab=sessions&view=runs" />);
    expect(screen.getByTestId('everything-failed')).toBeInTheDocument();
    expect(screen.getByTestId('everything-retry')).toBeInTheDocument();
  });

  it('R4 a stale read still shows the table', () => {
    render(<EverythingPage runs={runs} runsLoaded runsError="timeout" needRows={[]} navigate={() => {}} search="?tab=sessions&view=runs" />);
    expect(screen.getAllByTestId('runs-row').length).toBe(5);
  });

  it('R5 grouped is the default view (no ?view=)', () => {
    render(<EverythingPage runs={runs} runsLoaded needRows={[]} navigate={() => {}} search="?tab=sessions" />);
    expect(screen.queryByTestId('runs-row')).toBeNull();
    const grouped = screen.getAllByTestId('everything-view').find((b) => b.getAttribute('data-view') === 'grouped')!;
    expect(grouped.getAttribute('aria-pressed')).toBe('true');
  });

  it('R6/R7 the view switch has both views and navigates to runs', () => {
    const navigate = vi.fn();
    render(<EverythingPage runs={runs} runsLoaded needRows={[]} navigate={navigate} search="?tab=sessions" />);
    const views = screen.getAllByTestId('everything-view');
    expect(views.map((b) => b.getAttribute('data-view'))).toEqual(['grouped', 'runs']);
    fireEvent.click(views.find((b) => b.getAttribute('data-view') === 'runs')!);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('view=runs'), { replace: true });
  });

  it('R8 the count sentence reports runs and sessions', () => {
    render(<EverythingPage runs={runs} runsLoaded needRows={[]} navigate={() => {}} search="?tab=sessions&view=runs" />);
    const count = screen.getByTestId('everything-count');
    expect(count.getAttribute('data-runs')).toBe('5');
    expect(count.textContent).toContain('5 runs');
  });

  it('R10/R11 sort by title toggles direction', () => {
    render(<EverythingPage runs={runs} runsLoaded needRows={[]} navigate={() => {}} search="?tab=sessions&view=runs" />);
    const titleCol = screen.getAllByTestId('runs-col').find((b) => b.getAttribute('data-key') === 'title')!;
    fireEvent.click(titleCol);
    expect(titleCol.getAttribute('aria-sort')).toBe('ascending');
    const firstAsc = within(screen.getAllByTestId('runs-row')[0]!).getByText('Abandoned run');
    expect(firstAsc).toBeInTheDocument();
    fireEvent.click(titleCol);
    expect(titleCol.getAttribute('aria-sort')).toBe('descending');
    expect(within(screen.getAllByTestId('runs-row')[0]!).getByText('Write tests')).toBeInTheDocument();
  });

  it('R12 text filter narrows the rows', () => {
    render(<EverythingPage runs={runs} runsLoaded needRows={[]} navigate={() => {}} search="?tab=sessions&view=runs" />);
    expect(screen.getAllByTestId('runs-row')).toHaveLength(5);
    fireEvent.change(screen.getByTestId('runs-filter'), { target: { value: 'Alpha' } });
    expect(screen.getAllByTestId('runs-row').every((r) => within(r).queryByText('Alpha') !== null)).toBe(true);
    expect(screen.getAllByTestId('runs-row').length).toBe(2);
  });

  it('R13 the Done chip filters to done rows', () => {
    const navigate = vi.fn();
    render(<EverythingPage runs={runs} runsLoaded needRows={[]} navigate={navigate} search="?tab=sessions&view=runs&filter=completed" />);
    const rows = screen.getAllByTestId('runs-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute('data-state')).toBe('done');
  });

  it('R14/R15 pager: 150 runs → 2 pages, next advances', () => {
    render(<EverythingPage runs={make150()} runsLoaded needRows={[]} navigate={() => {}} search="?tab=sessions&view=runs" />);
    expect(screen.getAllByTestId('runs-row')).toHaveLength(100);
    expect(screen.getByTestId('runs-pager-at').textContent).toContain('page 1 of 2');
    fireEvent.click(screen.getByTestId('runs-pager-next'));
    expect(screen.getAllByTestId('runs-row')).toHaveLength(50);
    expect(screen.getByTestId('runs-pager-at').textContent).toContain('page 2 of 2');
  });

  it('R16 grouped view renders the sessions panel, not the table', () => {
    // The board model is mocked empty here, so the proof is the inverse: the grouped view shows the
    // sessions container and never the runs table. desk_everything (e2e) proves the groups paint.
    render(<EverythingPage runs={runs} runsLoaded needRows={[]} navigate={() => {}} search="?tab=sessions" />);
    expect(screen.getByTestId('everything-sessions')).toBeInTheDocument();
    expect(screen.queryByTestId('everything-runs')).toBeNull();
    expect(screen.queryByTestId('runs-row')).toBeNull();
  });

  it('R17/R18 Archived lens in the runs view lists rows and unarchives', async () => {
    const archived = (id: string): SessionView => {
      const v = makeView(id, { status: 'cancelled', problem: `Archived ${id}`, project_id: 'alpha' });
      (v.session as unknown as { archived_at: number }).archived_at = 1_759_000_000;
      return v;
    };
    listRuns.mockResolvedValue({ runs: [archived('r-arch-1'), archived('r-arch-2')] });
    const onRetryRuns = vi.fn();
    render(<EverythingPage runs={runs} runsLoaded onRetryRuns={onRetryRuns} needRows={[]} navigate={() => {}} search="?tab=sessions&view=runs&filter=archived" />);
    await waitFor(() => expect(screen.getAllByTestId('runs-row')).toHaveLength(2));
    expect(listRuns).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getAllByTestId('everything-unarchive')[0]!);
    await waitFor(() => expect(archiveRun).toHaveBeenCalledWith('r-arch-1', false));
    await waitFor(() => expect(onRetryRuns).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByTestId('runs-row')).toHaveLength(1));
  });

  it('R19 a per-row menu opens the run and looks underneath', () => {
    const navigate = vi.fn();
    render(<EverythingPage runs={runs} runsLoaded needRows={[]} navigate={navigate} search="?tab=sessions&view=runs" />);
    const row = screen.getAllByTestId('runs-row').find((r) => r.getAttribute('data-run-id') === 'r-done')!;
    fireEvent.click(within(row).getByTestId('runs-row-menu'));
    fireEvent.click(within(row).getByTestId('runs-row-open'));
    expect(navigate).toHaveBeenCalledWith('/s/run%3Ar-done');
  });
  it('an archived run with a chat links its run address in the table too (studio#675)', async () => {
    const { useCapabilities } = await import('../src/store/capabilities.js');
    useCapabilities.setState({ loaded: true, runChatId: true });
    const v = makeView('r-arch-chat', { status: 'cancelled' });
    (v.session as unknown as { archived_at: number; chat_id: string }).archived_at = 1_759_000_000;
    (v.session as unknown as { chat_id: string }).chat_id = 'chat-7';
    listRuns.mockResolvedValue({ runs: [v] });
    render(<EverythingPage runs={runs} runsLoaded needRows={[]} navigate={() => {}} search="?tab=sessions&view=runs&filter=archived" />);
    const row = await screen.findByTestId('runs-row');
    expect(row.querySelector('a')!.getAttribute('href')).toBe('/s/run%3Ar-arch-chat');
    useCapabilities.setState({ runChatId: false });
  });
});
