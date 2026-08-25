import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { ProjectDashboard } from '../src/components/ProjectDashboard.js';
import { CenterDashboard } from '../src/components/CenterDashboard.js';
import { useGateStore } from '../src/store/gates.js';
import { useProjectsStore } from '../src/store/projects.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeUnit, makeView } from './factories.js';
import { NOTHING_REASON } from './fixtures/deliverOutput.js';
import type { Project, SessionView, UnitStatus } from '../src/api/types.js';

/**
 * The two LIST surfaces (wicked-studio#122, slice DA, EC57/EC58): the project
 * page's run rows + RUNS-tile census, and Build's run list.
 *
 * The budget is the point. Both surfaces are DTO-derived and fire ZERO per-run
 * requests — an N-run fan-out to `/runs/:id/units/:key/output` is exactly what
 * CREW-UX-8 (`session.delivery`) exists to make unnecessary, and it is the one
 * thing this slice is not allowed to do. `getUnitOutput` sits in both mocks so a
 * regression that reaches for it fails here rather than in production.
 */

const listProjectMembers = vi.fn();
const getUnitOutput = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjects: () => Promise.resolve({ projects: [] }),
    listProjectMembers: (...a: unknown[]) => listProjectMembers(...a),
    listRepos: () => Promise.resolve({ repos: [] }),
    confirmGate: () => Promise.resolve({}),
    injectMessage: () => Promise.resolve({}),
    getUnitOutput: (...a: unknown[]) => getUnitOutput(...a),
  },
}));

const listDocs = vi.fn();
vi.mock('../src/api/interactive.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/interactive.js')>()),
  listDocs: (...a: unknown[]) => listDocs(...a),
}));

const NOW = Date.now();

function project(id: string): Project {
  return {
    id, name: `The ${id} project`, description: null, status: 'active',
    scope: `project:${id}`, created_at: NOW - 1000, updated_at: NOW - 100,
  };
}

/** A build run filed into `proj-1` whose deliver phase is in the given state. */
function run(id: string, status: UnitStatus, denial: string | null = null): SessionView {
  return makeView(
    { id, workflow_id: 'feature', status: 'completed', problem: `problem of ${id}`, project_id: 'proj-1' },
    [
      makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' }),
      makeUnit({ id: `${id}:deliver`, session_id: id, ord: 1, status, denial_reason: denial }),
    ],
  );
}

/** A build run with no deliver phase at all. */
function plain(id: string): SessionView {
  return makeView(
    { id, workflow_id: 'feature', status: 'completed', problem: `problem of ${id}`, project_id: 'proj-1' },
    [makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' })],
  );
}

/** A CHAT thread filed into `proj-1` — a run that can never deliver (D5). */
function chat(id: string): SessionView {
  return makeView(
    { id, workflow_id: 'chat', status: 'completed', problem: `chat ${id}`, project_id: 'proj-1' },
    [],
  );
}

/**
 * Nineteen runs: 3 delivered, 2 delivered nothing, 14 with no deliver phase —
 * deliberately more than the tile's MAX_ROWS of 6, and with the interesting ones
 * pushed OUT of the visible window (the 665a9aeb shape: the run that read as the
 * most productive in the project is not in the visible six).
 */
function corpus(): SessionView[] {
  return [
    ...Array.from({ length: 14 }, (_, i) => plain(`r-plain-${i}`)),
    run('r-pr-1', 'done'), run('r-pr-2', 'done'), run('r-pr-3', 'done'),
    run('r-empty-1', 'rejected', NOTHING_REASON), run('r-empty-2', 'rejected', NOTHING_REASON),
  ];
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  listProjectMembers.mockReset().mockResolvedValue({ members: [] });
  listDocs.mockReset().mockResolvedValue([]);
  getUnitOutput.mockReset();
  useGateStore.setState({ gates: {} });
  useRunEventStore.setState({ byRun: {} });
  useProjectsStore.setState({ projects: [project('proj-1')], loading: false, error: null });
  // The evidence bundle is a bare `fetch`, not an `api` method (client.ts:103) —
  // EC58 names it, so the budget is asserted at the transport.
  fetchSpy = vi.fn().mockRejectedValue(new Error('no request should reach the wire'));
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the project page (EC57, EC58)', () => {
  it('chips each run row with what it produced, and stays silent for runs that have no deliver phase', async () => {
    render(<ProjectDashboard projectId="proj-1" runs={corpus()} navigate={() => {}} />);

    const rows = await screen.findAllByTestId('dashboard-run');
    expect(rows).toHaveLength(6); // MAX_ROWS

    const chipped = rows.filter((r) => within(r).queryByTestId('run-delivery-chip') !== null);
    for (const row of chipped) {
      const chip = within(row).getByTestId('run-delivery-chip');
      expect(['delivered', 'nothing-to-deliver', 'failed']).toContain(chip.getAttribute('data-state'));
      // D2: a list surface holds no url, so no chip on it may claim a PR.
      expect(chip.textContent).not.toMatch(/\bPR\b/);
    }
    // Rows for runs with no deliver phase carry no chip — silence, never "unknown".
    const plainRow = rows.find((r) => r.getAttribute('data-run-id')?.startsWith('r-plain-'));
    expect(plainRow).toBeDefined();
    expect(within(plainRow as HTMLElement).queryByTestId('run-delivery-chip')).toBeNull();
  });

  it('an UNRESOLVED deliver phase gets no row chip — the status pill already owns motion', async () => {
    // Verification gap closed: `DeliveryChip` returns null for `in-flight` by
    // deliberate design (a cancelled run's deliver unit stays `pending` forever,
    // so a second motion word on the row would claim progress that stopped) and
    // nothing pinned it — dropping the `in-flight` arm left every test green.
    render(
      <ProjectDashboard
        projectId="proj-1"
        runs={[run('r-pending', 'pending'), run('r-dist', 'distributed'), run('r-pr-1', 'done')]}
        navigate={() => {}}
      />,
    );

    const rows = await screen.findAllByTestId('dashboard-run');
    const chipOf = (id: string): string | null | undefined =>
      within(rows.find((r) => r.getAttribute('data-run-id') === id) as HTMLElement)
        .queryByTestId('run-delivery-chip')?.getAttribute('data-state');
    expect(chipOf('r-pending')).toBeUndefined();
    expect(chipOf('r-dist')).toBeUndefined();
    expect(chipOf('r-pr-1')).toBe('delivered');
  });

  it('the RUNS-tile census counts ALL runs, not the MAX_ROWS window', async () => {
    render(<ProjectDashboard projectId="proj-1" runs={corpus()} navigate={() => {}} />);

    const summary = await screen.findByTestId('dashboard-delivery-summary');
    // 19 runs; 6 rows rendered. The census sees all nineteen — and says "ran
    // deliver", never "delivered": zero fetches means zero urls in hand.
    expect(summary.textContent)
      .toStrictEqual('3 ran deliver · 2 delivered nothing · 14 no deliver phase');
    expect(summary.textContent).not.toMatch(/\bPR\b/);
    expect(screen.getAllByTestId('dashboard-run')).toHaveLength(6);
  });

  it('D5: chat threads are OUT of the census — the rail hides Delivery from them', async () => {
    // The reported symptom, exactly: a chat-heavy project read
    // "3 delivered · 30 no deliver phase", a count of conversations dressed up
    // as a delivery finding. The rail already refused to show Delivery on those
    // threads; now both surfaces agree on what a deliverable run is.
    const runs = [
      run('r-pr-1', 'done'), run('r-pr-2', 'done'), run('r-pr-3', 'done'),
      ...Array.from({ length: 30 }, (_, i) => chat(`c-${i}`)),
    ];
    render(<ProjectDashboard projectId="proj-1" runs={runs} navigate={() => {}} />);

    const summary = await screen.findByTestId('dashboard-delivery-summary');
    expect(summary.textContent).toStrictEqual('3 ran deliver');
    expect(summary.textContent).not.toContain('no deliver phase');
  });

  it('a project of ONLY chats shows no census line at all, not an empty one', async () => {
    render(
      <ProjectDashboard
        projectId="proj-1"
        runs={Array.from({ length: 5 }, (_, i) => chat(`c-${i}`))}
        navigate={() => {}}
      />,
    );

    await screen.findByTestId('dashboard-runs');
    expect(screen.getAllByTestId('dashboard-run').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('dashboard-delivery-summary')).not.toBeInTheDocument();
  });

  it('a project with no runs shows no census line rather than "0 delivered"', async () => {
    render(<ProjectDashboard projectId="proj-1" runs={[]} navigate={() => {}} />);

    await screen.findByTestId('dashboard-runs');
    expect(screen.queryByTestId('dashboard-delivery-summary')).not.toBeInTheDocument();
  });

  it('EC58: rendering the page fires ZERO /units/*/output and ZERO /evidence requests', async () => {
    render(<ProjectDashboard projectId="proj-1" runs={corpus()} navigate={() => {}} />);
    await screen.findByTestId('dashboard-delivery-summary');
    await waitFor(() => expect(listProjectMembers).toHaveBeenCalled());

    expect(getUnitOutput).not.toHaveBeenCalled();
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('/output') || u.includes('/evidence'))).toEqual([]);
  });

  it('no delivery TILE is added — the 2×2 grid keeps its four sections', async () => {
    render(<ProjectDashboard projectId="proj-1" runs={corpus()} navigate={() => {}} />);
    await screen.findByTestId('dashboard-runs');

    expect(screen.getByTestId('dashboard-runs')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-docs')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-delivery')).not.toBeInTheDocument();
    // The census lives INSIDE the runs tile, not in a tile of its own.
    expect(screen.getByTestId('dashboard-runs'))
      .toContainElement(screen.getByTestId('dashboard-delivery-summary'));
  });
});

describe('the Build run list (EC57, EC58)', () => {
  function build(runs: SessionView[]): void {
    render(
      <CenterDashboard
        runs={runs}
        onSelectRun={vi.fn()}
        onApproveGate={vi.fn()}
        onRejectGate={vi.fn()}
        navigate={vi.fn()}
      />,
    );
  }

  it('carries the SAME chip as the project rows, per state', () => {
    build([run('r-pr-1', 'done'), run('r-empty-1', 'rejected', NOTHING_REASON), plain('r-plain-0')]);

    const rows = screen.getAllByTestId('build-run-row');
    const chipOf = (id: string): HTMLElement | null => {
      const row = rows.find((r) => r.getAttribute('title')?.includes(id));
      return within(row as HTMLElement).queryByTestId('run-delivery-chip');
    };
    expect(chipOf('r-pr-1')?.getAttribute('data-state')).toBe('delivered');
    expect(chipOf('r-empty-1')?.getAttribute('data-state')).toBe('nothing-to-deliver');
    // No deliver phase → no chip (the status pill already says what it is doing).
    expect(chipOf('r-plain-0')).toBeNull();
  });

  it('D2: an approved deliver phase reads as the PHASE here — never "PR open"', () => {
    // The 665a9aeb wire shape on a zero-fetch surface: `done`, `denial_reason`
    // null, and no url anywhere on the DTO. The first cut rendered "PR open" for
    // exactly this run — the false productivity signal the slice exists to kill.
    build([run('r-665a9aeb', 'done')]);

    const chip = screen.getByTestId('run-delivery-chip');
    expect(chip).toHaveAttribute('data-state', 'delivered');
    expect(chip.textContent).toStrictEqual('deliver ran');
    expect(chip.textContent).not.toMatch(/\bPR\b/);
    // Nothing was read to reach that word, and nothing on the row links a PR.
    expect(getUnitOutput).not.toHaveBeenCalled();
    const row = screen.getByTestId('build-run-row');
    const hrefs = [...row.querySelectorAll('[href]')].map((e) => e.getAttribute('href') ?? '');
    expect(hrefs.filter((h) => h.includes('/pull/'))).toEqual([]);
  });

  it('an UNRESOLVED deliver phase gets no chip here either', () => {
    build([run('r-pending', 'pending'), run('r-dist', 'distributed')]);

    expect(screen.queryByTestId('run-delivery-chip')).toBeNull();
  });

  it('EC58: the list fires ZERO per-run output reads', () => {
    build(corpus());

    expect(screen.getAllByTestId('build-run-row').length).toBeGreaterThan(0);
    expect(getUnitOutput).not.toHaveBeenCalled();
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('/output') || u.includes('/evidence'))).toEqual([]);
  });
});
