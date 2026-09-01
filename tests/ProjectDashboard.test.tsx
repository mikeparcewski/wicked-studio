import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProjectDashboard } from '../src/components/ProjectDashboard.js';
import { clearRepoCache, fetchReposCached } from '../src/store/repoCache.js';
import { useGateStore } from '../src/store/gates.js';
import { useProjectsStore } from '../src/store/projects.js';
import { clearRetryPrefill, peekRetryPrefill } from '../src/store/retryPrefill.js';
import type { Project, ProjectMember, SessionStatus } from '../src/api/types.js';
import type { DocSummary } from '../src/api/interactive.js';
import { makeUnit, makeView } from './factories.js';

/**
 * The project HOMEPAGE — `/p/:projectId` (lane B): full-width command surface.
 * A project-scoped KPI band with honest window deltas, the gate inbox FIRST,
 * then runs/docs as filterable cards with derived titles, a needs-you jump
 * straight to the gate, and an inline Retry (prefill, never a relaunch).
 */

const listProjectMembers = vi.fn();
const confirmGate = vi.fn();
const listRepos = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjects: () => Promise.resolve({ projects: [] }),
    listProjectMembers: (...a: unknown[]) => listProjectMembers(...a),
    confirmGate: (...a: unknown[]) => confirmGate(...a),
    listRepos: (...a: unknown[]) => listRepos(...a),
  },
}));

const listDocs = vi.fn();
vi.mock('../src/api/interactive.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/interactive.js')>()),
  listDocs: (...a: unknown[]) => listDocs(...a),
}));

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function project(id: string, extra: Partial<Project> = {}): Project {
  return {
    id, name: `The ${id} project`, description: null, status: 'active',
    scope: `project:${id}`, created_at: NOW - 10 * DAY, updated_at: NOW - HOUR, ...extra,
  };
}

function member(ref: string, kind = 'crew.run', attachedAt = NOW - 2 * HOUR): ProjectMember {
  return {
    id: `proj-1:${kind}:${ref}`, project_id: 'proj-1', member_kind: kind,
    member_ref: ref, meta: null, attached_at: attachedAt, attached_by: 'studio',
  };
}

function run(id: string, status: SessionStatus, problem = `problem of ${id}`) {
  return makeView(
    { id, status, problem, unit_ix: 0 },
    [makeUnit({ id: `${id}:u0`, session_id: id, ord: 0 })],
  );
}

function doc(name: string, kind: 'doc' | 'demo' = 'doc'): DocSummary {
  return { name, kind, head: 3, versions: 3, updated_at: null };
}

beforeEach(() => {
  listProjectMembers.mockReset();
  listDocs.mockReset();
  confirmGate.mockReset();
  listProjectMembers.mockResolvedValue({ members: [] });
  listDocs.mockResolvedValue([]);
  useGateStore.setState({ gates: {} });
  useProjectsStore.setState({ projects: [project('proj-1')], loading: false, error: null });
  clearRetryPrefill(); // drop any deposit a prior test left
});
afterEach(cleanup);

describe('ProjectDashboard — the full-width project command surface', () => {
  it('renders FULL WIDTH with the KPI band, the mode verbs, Do Work, and the meta line', async () => {
    render(<ProjectDashboard projectId="proj-1" runs={[]} navigate={() => {}} />);

    const root = screen.getByTestId('project-dashboard') as HTMLElement;
    expect(root.style.maxWidth).toBe('');

    // The command-center band, project-scoped.
    const band = screen.getByTestId('project-kpis');
    for (const tid of ['stat-runs', 'stat-active', 'stat-gates', 'stat-failed']) {
      expect(within(band as HTMLElement).getByTestId(tid)).toBeInTheDocument();
    }

    // NOT a fifth mode: the four verbs are header links, plus the creation verb.
    expect(screen.queryByTestId('mode-switcher')).toBeNull();
    for (const m of ['chat', 'build', 'document', 'video']) {
      expect(screen.getByTestId(`dashboard-mode-${m}`)).toHaveAttribute('href', `/p/proj-1/${m}`);
    }
    expect(screen.getByTestId('dashboard-do-work')).toHaveAttribute('href', '/p/proj-1/build/new');

    // The meta line: last activity + open runs. NO cost — the wire carries none.
    expect(screen.getByTestId('dashboard-meta')).toHaveTextContent(/last activity .* · 0 open runs/);
    expect(screen.getByTestId('dashboard-meta').textContent).not.toMatch(/\$/);
    // The gate inbox earns its space only when something waits.
    expect(screen.queryByTestId('dashboard-gates')).toBeNull();
    expect(screen.getByTestId('dashboard-runs')).toHaveTextContent('No runs yet — Build starts one.');
    await waitFor(() => expect(listProjectMembers).toHaveBeenCalledWith('proj-1'));
  });

  it('run cards: scoped to the project and attention-ordered — gate first, then failing, then working, then done', async () => {
    listProjectMembers.mockResolvedValue({
      members: [member('r-done'), member('r-work'), member('r-gate'), member('r-fail')],
    });
    useGateStore.setState({
      gates: { 'r-gate': { runId: 'r-gate', ord: 0, prompt: 'ok?', lifecycle: 'open', receivedAt: NOW - HOUR } },
    });
    const runs = [
      run('r-done', 'completed'),
      run('r-work', 'executing'),
      run('r-gate', 'awaiting_human'),
      run('r-fail', 'failed'),
      run('r-other', 'executing', 'someone else’s run'), // NOT a member — must not render
    ];
    render(<ProjectDashboard projectId="proj-1" runs={runs} navigate={() => {}} />);

    await waitFor(() => expect(screen.getAllByTestId('dashboard-run')).toHaveLength(4));
    const ids = screen.getAllByTestId('dashboard-run').map((el) => el.getAttribute('data-run-id'));
    expect(ids).toEqual(['r-gate', 'r-fail', 'r-work', 'r-done']);
    expect(ids).not.toContain('r-other');
    // Open count excludes terminal states.
    expect(screen.getByTestId('dashboard-meta')).toHaveTextContent('2 open runs');
    // EC34: the section head counts exactly the rendered cards.
    expect(screen.getByTestId('dashboard-runs')).toHaveAttribute('data-count', '4');
  });

  it('a run card carries a DERIVED title (raw prompt hover-only) and doors into its mode view', async () => {
    const longIntent = 'Implement the auth flow refactor across every consumer of the session token; then re-run the full suite and file the follow-ups.';
    listProjectMembers.mockResolvedValue({
      members: [member('r-1', 'crew.run'), member('t-1', 'crew.chat')],
    });
    const navigate = vi.fn();
    render(
      <ProjectDashboard
        projectId="proj-1"
        runs={[run('r-1', 'executing', longIntent), run('t-1', 'executing')]}
        navigate={navigate}
      />,
    );
    await waitFor(() => expect(screen.getAllByTestId('dashboard-run')).toHaveLength(2));

    const rows = screen.getAllByTestId('dashboard-run');
    const byId = (id: string) => rows.find((r) => r.getAttribute('data-run-id') === id)! as HTMLElement;
    // The title link is a real href — Build for a run, Chat for a chat thread.
    const title = within(byId('r-1')).getByTestId('dashboard-run-title');
    expect(title).toHaveAttribute('href', '/p/proj-1/build/r-1');
    expect(within(byId('t-1')).getByTestId('dashboard-run-title')).toHaveAttribute('href', '/p/proj-1/chat/t-1');
    // Derived, word-trimmed, ellipsized — never the raw 140-char prompt.
    expect(title.textContent!.length).toBeLessThan(70);
    expect(title.textContent).toMatch(/…$/);
    expect(title).toHaveAttribute('title', longIntent);
    fireEvent.click(byId('r-1'));
    expect(navigate).toHaveBeenCalledWith('/p/proj-1/build/r-1');
  });

  it('a waiting run’s card shows the needs-you jump STRAIGHT to its gate', async () => {
    listProjectMembers.mockResolvedValue({ members: [member('r-gate')] });
    useGateStore.setState({
      gates: { 'r-gate': { runId: 'r-gate', ord: 0, prompt: 'ok?', lifecycle: 'open', receivedAt: NOW - HOUR } },
    });
    const navigate = vi.fn();
    render(<ProjectDashboard projectId="proj-1" runs={[run('r-gate', 'awaiting_human')]} navigate={navigate} />);

    await waitFor(() => expect(screen.getByTestId('dashboard-run-needs-you')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('dashboard-run-needs-you'));
    expect(navigate).toHaveBeenCalledWith('/p/proj-1/build/r-gate#gate');
    // The KPI gate tile is the same door.
    expect(screen.getByTestId('stat-gates')).toHaveAttribute('href', '/p/proj-1/build/r-gate#gate');
  });

  it('a FAILED run’s card offers inline Retry — a prefill deposit + composer, never a relaunch', async () => {
    listProjectMembers.mockResolvedValue({ members: [member('r-fail')] });
    const navigate = vi.fn();
    render(<ProjectDashboard projectId="proj-1" runs={[run('r-fail', 'failed', 'ship the uploader')]} navigate={navigate} />);

    await waitFor(() => expect(screen.getByTestId('dashboard-run-retry')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('dashboard-run-retry'));
    const prefill = peekRetryPrefill();
    expect(prefill).not.toBeNull();
    expect(prefill!.retryOf).toBe('r-fail');
    expect(prefill!.problem).toBe('ship the uploader');
    expect(prefill!.projectId).toBe('proj-1');
    expect(navigate).toHaveBeenCalledWith('/runs/new');
  });

  it('the FilterStrip drives the card grid; search lifts the recency window', async () => {
    listProjectMembers.mockResolvedValue({
      members: [member('r-done'), member('r-work'), member('r-fail')],
    });
    render(
      <ProjectDashboard
        projectId="proj-1"
        runs={[run('r-done', 'completed'), run('r-work', 'executing'), run('r-fail', 'failed')]}
        navigate={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getAllByTestId('dashboard-run')).toHaveLength(3));

    const chip = (id: string) => screen.getAllByTestId('dashboard-filter-chip')
      .find((c) => c.getAttribute('data-chip') === id)!;
    fireEvent.click(chip('failed'));
    expect(screen.getAllByTestId('dashboard-run').map((r) => r.getAttribute('data-run-id'))).toEqual(['r-fail']);
    fireEvent.click(chip('active'));
    expect(screen.getAllByTestId('dashboard-run').map((r) => r.getAttribute('data-run-id'))).toEqual(['r-work']);
    fireEvent.click(chip('all'));
    fireEvent.change(screen.getByTestId('dashboard-filter-search'), { target: { value: 'r-done' } });
    expect(screen.getAllByTestId('dashboard-run').map((r) => r.getAttribute('data-run-id'))).toEqual(['r-done']);
  });

  it('the runs KPI tile shows an honest "—" delta when no prior window exists', async () => {
    listProjectMembers.mockResolvedValue({ members: [member('r-a')] });
    render(<ProjectDashboard projectId="proj-1" runs={[run('r-a', 'executing')]} navigate={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('stat-runs').getAttribute('data-value')).toBe('1'));
    expect(screen.getByTestId('stat-runs').getAttribute('data-delta')).toBe('none');
  });

  it('docs cards: lists listDocs(projectId) results (root present) and doors into Document mode', async () => {
    useProjectsStore.setState({
      projects: [project('proj-1', { interactiveRoot: '/tmp/wi-proj-1' })],
      loading: false, error: null,
    });
    listDocs.mockResolvedValue([doc('spec'), doc('pitch'), doc('walkthrough', 'demo')]);
    const navigate = vi.fn();
    render(<ProjectDashboard projectId="proj-1" runs={[]} navigate={navigate} />);

    await waitFor(() => expect(screen.getAllByTestId('dashboard-doc')).toHaveLength(3));
    expect(listDocs).toHaveBeenCalledWith('proj-1');
    expect(screen.getByTestId('dashboard-docs')).toHaveAttribute('data-count', '3');

    const rows = screen.getAllByTestId('dashboard-doc');
    expect(rows[0]!.querySelector('a')).toHaveAttribute('href', '/p/proj-1/document/spec');
    // A demo doc opens in Video mode — a demo is a doc whose manifest says so.
    expect(rows[2]!.querySelector('a')).toHaveAttribute('href', '/p/proj-1/video/walkthrough');
    fireEvent.click(rows[0]!);
    expect(navigate).toHaveBeenCalledWith('/p/proj-1/document/spec');
  });

  it('docs cards: no interactive root ⇒ no listDocs call, and the section states its empty case', async () => {
    render(<ProjectDashboard projectId="proj-1" runs={[]} navigate={() => {}} />);
    await waitFor(() => expect(listProjectMembers).toHaveBeenCalled());
    expect(listDocs).not.toHaveBeenCalled();
    expect(screen.getByTestId('dashboard-docs')).toHaveTextContent('No documents yet');
  });

  it('gate inbox: approve fires the SAME action as the board chip — POST confirmGate {approve:true}', async () => {
    listProjectMembers.mockResolvedValue({ members: [member('r-gate')] });
    useGateStore.setState({
      gates: { 'r-gate': { runId: 'r-gate', ord: 0, prompt: 'Approve the outline?', lifecycle: 'open', receivedAt: NOW - HOUR } },
    });
    confirmGate.mockResolvedValue({ status: 'ok' });
    render(
      <ProjectDashboard projectId="proj-1" runs={[run('r-gate', 'awaiting_human')]} navigate={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('dashboard-gate')).toBeInTheDocument());
    const tile = screen.getByTestId('dashboard-gates');
    expect(tile).toHaveTextContent('Approve the outline?');

    fireEvent.click(within(tile).getByTestId('gate-approve-r-gate'));
    await waitFor(() => expect(confirmGate).toHaveBeenCalledWith('r-gate', { approve: true }));
    // The chip clears its gate from the shared store exactly as it does on the board.
    expect(useGateStore.getState().gates['r-gate']).toBeUndefined();
  });

  it('the runs KPI sparkline reads the membership attach clock', async () => {
    listProjectMembers.mockResolvedValue({
      members: [
        member('r-a', 'crew.run', NOW - 1 * HOUR),      // today
        member('r-b', 'crew.run', NOW - 1 * HOUR - 1),  // today
        member('r-c', 'crew.run', NOW - 3 * DAY),       // 3 days back
        member('r-old', 'crew.run', NOW - 20 * DAY),    // outside the span
      ],
    });
    render(<ProjectDashboard projectId="proj-1" runs={[]} navigate={() => {}} />);

    await waitFor(() => expect(listProjectMembers).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('stat-runs').querySelector('svg')).not.toBeNull());
  });
});

describe('bound repos row (unchanged contract)', () => {
  beforeEach(() => {
    clearRepoCache();
    listRepos.mockReset();
    listRepos.mockResolvedValue({
      repos: [{ id: 'studio-api', name: 'studio-api', root_path: '/x', default_branch: 'main', registered_at: 1 }],
    });
  });

  it('a crew.repo member renders one chip linking to the repo page — warm cache, ZERO new requests', async () => {
    await fetchReposCached(); // the palette/rail gesture already warmed it
    const fetchesBefore = listRepos.mock.calls.length;
    listProjectMembers.mockResolvedValue({
      members: [member('studio-api', 'crew.repo'), member('r-a', 'crew.run')],
    });
    render(<ProjectDashboard projectId="proj-1" runs={[run('r-a', 'executing')]} navigate={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('dashboard-repos')).toBeInTheDocument());
    const chips = screen.getAllByTestId('dashboard-repo');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveAttribute('href', '/repo-detail/studio-api');
    expect(chips[0]).toHaveTextContent('studio-api');
    // Zero new requests: the SAME membership read, the SAME repo cache.
    expect(listRepos.mock.calls.length).toBe(fetchesBefore);
    // And the repo member never leaks into the runs section.
    expect(screen.getByTestId('dashboard-runs')).toHaveAttribute('data-count', '1');
  });

  it('a cold cache renders the raw ref in --ink-dim — membership is the truth, still a link, still no fetch', async () => {
    listProjectMembers.mockResolvedValue({ members: [member('studio-api', 'crew.repo')] });
    render(<ProjectDashboard projectId="proj-1" runs={[]} navigate={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('dashboard-repos')).toBeInTheDocument());
    const chip = screen.getByTestId('dashboard-repo');
    expect(chip).toHaveTextContent('studio-api'); // the raw ref
    expect(chip).toHaveAttribute('href', '/repo-detail/studio-api');
    expect((chip as HTMLElement).style.color).toBe('var(--ink-dim)');
    expect(listRepos).not.toHaveBeenCalled();
  });

  it('with no crew.repo member the testid is ABSENT — the empty-state budget', async () => {
    listProjectMembers.mockResolvedValue({ members: [member('r-a', 'crew.run')] });
    render(<ProjectDashboard projectId="proj-1" runs={[]} navigate={() => {}} />);

    await waitFor(() => expect(listProjectMembers).toHaveBeenCalled());
    expect(screen.queryByTestId('dashboard-repos')).toBeNull();
  });
});
