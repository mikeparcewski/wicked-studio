import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProjectDashboard } from '../src/components/ProjectDashboard.js';
import { useGateStore } from '../src/store/gates.js';
import { useProjectsStore } from '../src/store/projects.js';
import type { Project, ProjectMember, SessionStatus } from '../src/api/types.js';
import type { DocSummary } from '../src/api/interactive.js';
import { makeUnit, makeView } from './factories.js';

/**
 * The project dashboard (DES-FEEDBACK-001 §4.1, slice D): the `/p/:projectId`
 * no-mode landing — four tiles, all derived from data the app already holds.
 */

const listProjectMembers = vi.fn();
const confirmGate = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjects: () => Promise.resolve({ projects: [] }),
    listProjectMembers: (...a: unknown[]) => listProjectMembers(...a),
    confirmGate: (...a: unknown[]) => confirmGate(...a),
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
});
afterEach(cleanup);

describe('ProjectDashboard (DES-FEEDBACK-001 §4.1, slice D)', () => {
  it('renders the dashboard with all four tiles, the mode verbs, and the meta line', async () => {
    render(<ProjectDashboard projectId="proj-1" runs={[]} navigate={() => {}} />);

    expect(screen.getByTestId('project-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-runs')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-docs')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-gates')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-activity')).toBeInTheDocument();

    // NOT a fifth mode: no switcher on this surface — the four verbs are header links.
    expect(screen.queryByTestId('mode-switcher')).toBeNull();
    for (const m of ['chat', 'build', 'document', 'video']) {
      expect(screen.getByTestId(`dashboard-mode-${m}`)).toHaveAttribute('href', `/p/proj-1/${m}`);
    }

    // The meta line: last activity + open runs. NO cost — the wire carries none.
    expect(screen.getByTestId('dashboard-meta')).toHaveTextContent(/last activity .* · 0 open runs/);
    expect(screen.getByTestId('dashboard-meta').textContent).not.toMatch(/\$/);
    await waitFor(() => expect(listProjectMembers).toHaveBeenCalledWith('proj-1'));
  });

  it('runs tile: scoped to the project and attention-ordered — gate first, then failing, then working, then done', async () => {
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
  });

  it('a run row links into the run’s mode view — Build for a run, Chat for a chat thread', async () => {
    listProjectMembers.mockResolvedValue({
      members: [member('r-1', 'crew.run'), member('t-1', 'crew.chat')],
    });
    const navigate = vi.fn();
    render(
      <ProjectDashboard
        projectId="proj-1"
        runs={[run('r-1', 'executing'), run('t-1', 'executing')]}
        navigate={navigate}
      />,
    );
    await waitFor(() => expect(screen.getAllByTestId('dashboard-run')).toHaveLength(2));

    const rows = screen.getAllByTestId('dashboard-run');
    const byId = (id: string) => rows.find((r) => r.getAttribute('data-run-id') === id)!;
    expect(byId('r-1')).toHaveAttribute('href', '/p/proj-1/build/r-1');
    expect(byId('t-1')).toHaveAttribute('href', '/p/proj-1/chat/t-1');
    fireEvent.click(byId('r-1'));
    expect(navigate).toHaveBeenCalledWith('/p/proj-1/build/r-1');
  });

  it('docs tile: lists listDocs(projectId) results (root present) and navigates into Document mode', async () => {
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
    expect(rows[0]).toHaveAttribute('href', '/p/proj-1/document/spec');
    // A demo doc opens in Video mode — a demo is a doc whose manifest says so (§7.4).
    expect(rows[2]).toHaveAttribute('href', '/p/proj-1/video/walkthrough');
    fireEvent.click(rows[0]!);
    expect(navigate).toHaveBeenCalledWith('/p/proj-1/document/spec');
  });

  it('docs tile: no interactive root ⇒ no listDocs call, and the tile states its empty case', async () => {
    render(<ProjectDashboard projectId="proj-1" runs={[]} navigate={() => {}} />);
    await waitFor(() => expect(listProjectMembers).toHaveBeenCalled());
    expect(listDocs).not.toHaveBeenCalled();
    expect(screen.getByTestId('dashboard-docs')).toHaveTextContent('No documents yet');
  });

  it('gate tile: approve fires the SAME action as the board chip — POST confirmGate {approve:true}', async () => {
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

  it('activity tile: 7-day sparkline reads the membership attach clock, one bucket per day', async () => {
    listProjectMembers.mockResolvedValue({
      members: [
        member('r-a', 'crew.run', NOW - 1 * HOUR),      // today
        member('r-b', 'crew.run', NOW - 1 * HOUR - 1),  // today
        member('r-c', 'crew.run', NOW - 3 * DAY),       // 3 days back
        member('r-old', 'crew.run', NOW - 20 * DAY),    // outside the window
      ],
    });
    render(<ProjectDashboard projectId="proj-1" runs={[]} navigate={() => {}} />);

    await waitFor(() =>
      expect(screen.getByTestId('dashboard-activity')).toHaveAttribute('data-total', '3'));
    const svg = screen.getByTestId('activity-sparkline');
    // Two buckets with counts ⇒ two bars; the max bucket (2) renders full height.
    expect(svg.querySelectorAll('rect')).toHaveLength(2);
    expect(screen.getByTestId('dashboard-activity')).toHaveTextContent('3 runs this week');
  });
});
