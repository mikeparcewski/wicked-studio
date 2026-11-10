import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// These suites exercise Desk tabs and project behavior; chart rendering is outside their scope.
vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Project, ProjectMember } from '../src/api/types.js';
import { makeView } from './factories.js';

const { getProject, getRun, apiFetch, detach, listProjects, listMembers, updateProject } = vi.hoisted(() => ({ getProject: vi.fn(), getRun: vi.fn(), apiFetch: vi.fn(), detach: vi.fn(), updateProject: vi.fn(),
  listProjects: vi.fn(() => Promise.resolve({ projects: [] as unknown[] })), listMembers: vi.fn(() => Promise.resolve({ members: [] as unknown[] })) }));
vi.mock('../src/api/client.js', () => ({
  apiBase: () => '/api/v1',
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  api: {
    getProject: (...args: unknown[]) => getProject(...args),
    getRun: (...args: unknown[]) => getRun(...args),
    detachProjectMember: (...args: unknown[]) => detach(...args),
    updateProject: (...args: unknown[]) => updateProject(...args),
    listProjects: () => listProjects(),
    listProjectMembers: () => listMembers(),
    listRepos: () => Promise.resolve({ repos: [{ id: 'repo', name: 'Shop code', root_path: '/code', default_branch: 'main', registered_at: 1 }] }),
    listChats: () => Promise.resolve({ chats: [] }),
    getRoster: () => Promise.resolve({ roster: [] }),
    getRunEvents: () => Promise.resolve({ events: [] }),
    getSeatRecord: (_days: number, project?: string) => Promise.resolve({ seats: [], project }),
  },
}));

const { openWizard } = vi.hoisted(() => ({ openWizard: vi.fn() }));
vi.mock('../src/store/launchWizard.js', async (importOriginal) => ({ ...(await importOriginal<object>()), openLaunchWizard: (...a: unknown[]) => openWizard(...a) }));

import { ProjectDesk } from '../src/components/desk/ProjectDesk.js';
import { makeUnit } from './factories.js';
import { useProjectsStore } from '../src/store/projects.js';
import { useSystemStore } from '../src/store/systemSnapshot.js';
import type { SystemSnapshot } from '../src/api/system.js';
import { clearRepoCache } from '../src/store/repoCache.js';

const NOW = Date.UTC(2026, 9, 13, 12);
const project: Project = { id: 'p1', name: 'Shop', description: 'Checkout work', status: 'active', scope: 'project:p1', created_at: NOW - 1000, updated_at: NOW - 1000 };
const member = (ref: string, kind = 'crew.run'): ProjectMember => ({ id: `${kind}:${ref}`, project_id: 'p1', member_kind: kind, member_ref: ref, meta: null, attached_at: 1, attached_by: 'studio' });
const runs = [
  makeView({ id: 'filed', project_id: 'p1', problem: 'Fix checkout', status: 'completed', created_at: NOW / 1000 - 100 }),
  makeView({ id: 'member', problem: 'Improve cart', status: 'executing', created_at: NOW / 1000 - 200 }),
  makeView({ id: 'elsewhere', project_id: 'p2', problem: 'Other work', created_at: NOW / 1000 - 50 }),
];
const props = { projectId: 'p1', navigate: vi.fn(), runs, needRows: [], now: NOW, search: '', runsLoaded: true };

beforeEach(() => {
  vi.clearAllMocks();
  clearRepoCache();
  window.history.replaceState(null, '', '/projects/p1');
  useProjectsStore.setState({ projects: [project], loading: false, error: null });
  // An older crew has answered (no ranked list): the fold is the needs-you source.
  useSystemStore.setState({ mode: 'fallback', healthAt: Date.now(), healthError: null, snapshot: null });
  getProject.mockResolvedValue({ project, members: [member('member'), member('repo', 'crew.repo')] });
  apiFetch.mockImplementation((path: string) => {
    if (path.includes('/standing-orders')) return Promise.resolve({ away: false, orders: [] });
    if (path.includes('/requirements')) return Promise.resolve({ projectId: 'p1', totals: { repos: 1, ok: 0, absent: 1, errors: 0, dangling: 0, total: 0, corpus: 0 }, rows: [] });
    if (path.includes('/coverage')) return Promise.resolve({ projectId: 'p1', totals: { repos: 1, ok: 0, behavior_bearing: 0, resolved: 0, coverage: null }, rows: [] });
    if (path.includes('/domain')) return Promise.resolve({ projectId: 'p1', totals: { repos: 1, ok: 0, domains: 0, requirements: 0, entities: 0 }, rows: [], merged: [] });
    return Promise.resolve({});
  });
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Unexpected real HTTP read'))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

async function loaded(): Promise<void> {
  expect(await screen.findByRole('heading', { level: 1, name: 'Shop' })).toBeInTheDocument();
}

/** The Jobs view shows Active or Finished: every row the project holds is both lists together. */
const rowIds = (): string[] => screen.queryAllByTestId('desk-runs-row').map((r) => r.getAttribute('data-run-id') ?? '');
function allRows(): string[] {
  fireEvent.click(screen.getByTestId('desk-runs-group-active'));
  const active = rowIds();
  fireEvent.click(screen.getByTestId('desk-runs-group-finished'));
  const finished = rowIds();
  fireEvent.click(screen.getByTestId('desk-runs-group-active'));
  return [...active, ...finished].sort();
}

describe("a project's home (no ?tab=, the approved ui-v2-projects mockup)", () => {
  it('the back link, the title and one sentence, the ask box, in progress (step x of y), the repositories and the week', async () => {
    const navigate = vi.fn();
    const working = makeView({ id: 'member', problem: 'Improve cart', status: 'executing', repo_ref: 'repo', created_at: NOW / 1000 - 200 },
      [makeUnit({ ord: 0, status: 'done' }), makeUnit({ ord: 1, status: 'distributed' }), makeUnit({ ord: 2, status: 'pending' })]);
    const done = makeView({ id: 'filed', project_id: 'p1', problem: 'Fix checkout', status: 'completed', created_at: NOW / 1000 - 100, ended_at: NOW / 1000 - 3600 });
    render(<ProjectDesk {...props} runs={[done, working, runs[2]!]} navigate={navigate} />);
    await loaded();
    expect(screen.getByTestId('project-home')).toBeInTheDocument();
    expect(screen.queryByTestId('desk-tabs')).toBeNull();
    expect(screen.getByTestId('project-back')).toHaveAttribute('href', '/projects');
    expect(screen.getByTestId('project-sentence')).toHaveTextContent('Nothing needs you. One job is running across one repository.');
    expect(screen.getByTestId('project-desc')).toHaveTextContent('Checkout work');
    // The ask box starts a job here through the one New job flow, the words carried in.
    fireEvent.change(screen.getByTestId('project-ask-input'), { target: { value: 'Add a coupon field' } });
    fireEvent.click(screen.getByTestId('project-ask-start'));
    expect(openWizard).toHaveBeenCalledWith({ intent: 'Add a coupon field', projectId: 'p1', composerKey: 'desk' });
    // In progress: the working job, its repository and step x of y; never another project's job.
    const rows = screen.getAllByTestId('project-progress-row');
    expect(rows.map((r) => r.getAttribute('data-run-id'))).toEqual(['member']);
    expect(rows[0]).toHaveTextContent('repo · step 2 of 3');
    expect(screen.getByTestId('project-needs-calm')).toBeInTheDocument();
    // Repositories: the chip; Add a repository opens the register form in this project (registering onboards it,
    // ux-tonight), and Attach takes one already added on the Repositories tab.
    expect(await screen.findAllByTestId('project-repo-chip')).toHaveLength(1);
    // A repository opened from here carries the project, so a launch on its page (Capture learnings) files under it.
    const chip = screen.getByTestId('project-repo-chip');
    expect(chip.tagName).toBe('A');
    expect(chip.getAttribute('href')).toMatch(/^\/repo-detail\/[^?]+\?project=p1$/u);
    fireEvent.click(screen.getByTestId('project-add-repo'));
    expect(navigate).toHaveBeenLastCalledWith('/repos/new?project=p1');
    fireEvent.click(screen.getByTestId('project-attach-repo'));
    expect(navigate).toHaveBeenLastCalledWith('/projects/p1?tab=repositories');
    expect(screen.getByTestId('project-week')).toHaveTextContent('This week: 1 job finished');
    fireEvent.click(screen.getByTestId('project-week-report'));
    expect(navigate).toHaveBeenLastCalledWith('/projects/p1?tab=report');
    // Every tabbed view stays one link away.
    expect(screen.getAllByTestId('project-view').map((a) => a.getAttribute('href'))).toEqual([
      '/projects/p1?tab=work', '/projects/p1?tab=runs', '/projects/p1?tab=repositories', '/projects/p1?tab=report', '/projects/p1?tab=understand',
      '/projects/p1?tab=steer', '/projects/p1?tab=memory', '/projects/p1?tab=agents', '/projects/p1?tab=evaluate', '/projects/p1?tab=settings']);
  });

  it('"More info" replaces the ⋯: a quiet link to the project page\'s first tab (operator 2026-11-09)', async () => {
    const navigate = vi.fn();
    render(<ProjectDesk {...props} navigate={navigate} />);
    await loaded();
    expect(screen.queryByTestId('project-menu')).toBeNull();
    expect(screen.queryByRole('button', { name: /^More actions for/ })).toBeNull();
    const more = screen.getByTestId('project-more-info');
    expect(more.tagName).toBe('A');
    expect(more).toHaveTextContent(/^More info$/);
    expect(more).toHaveAttribute('href', '/projects/p1?tab=work');
    fireEvent.click(more);
    expect(navigate).toHaveBeenCalledWith('/projects/p1?tab=work');
    // No rename, archive or documents control on the home: Settings holds them, Work holds the documents.
    expect(screen.queryByText(/Archive this project|Edit name and description|Rename/)).toBeNull();
    expect(screen.queryByTestId('project-archived')).toBeNull();
  });

  it('an archived project\'s home shows its Archived tag, offers no new work, and links the restore to Settings', async () => {
    const navigate = vi.fn();
    getProject.mockResolvedValue({ project: { ...project, status: 'archived' }, members: [member('repo', 'crew.repo')] });
    render(<ProjectDesk {...props} navigate={navigate} />);
    await loaded();
    expect(screen.getByTestId('project-archived')).toHaveTextContent('Archived');
    // crew refuses a job, a chat or a repository into an archived project: none is offered, not even disabled.
    expect(screen.queryByTestId('project-ask')).toBeNull();
    expect(screen.queryByTestId('project-ask-input')).toBeNull();
    expect(screen.queryByTestId('project-add-repo')).toBeNull();
    expect(screen.queryByTestId('project-attach-repo')).toBeNull();
    expect(screen.getByTestId('project-archived-line')).toHaveTextContent('This project is archived. Restore it in Settings to start work or add repositories.');
    const link = screen.getByTestId('project-archived-settings');
    expect(link).toHaveAttribute('href', '/projects/p1?tab=settings');
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/projects/p1?tab=settings');
    // The repositories it holds are still listed.
    expect(await screen.findAllByTestId('project-repo-chip')).toHaveLength(1);
  });

  it('an archived project\'s Work tab offers no first job; an active one with nothing yet does', async () => {
    getProject.mockResolvedValue({ project: { ...project, status: 'archived' }, members: [] });
    const view = render(<ProjectDesk {...props} runs={[]} search="?tab=work" />);
    await loaded();
    expect(screen.queryByTestId('project-first-run')).toBeNull();
    expect(screen.queryAllByTestId('project-first-job')).toHaveLength(0);
    expect(screen.getByTestId('project-archived-line')).toBeInTheDocument();
    view.unmount();
    getProject.mockResolvedValue({ project, members: [] });
    render(<ProjectDesk {...props} runs={[]} search="?tab=work" />);
    await loaded();
    expect(await screen.findByTestId('project-first-run')).toBeInTheDocument();
    expect(screen.queryByTestId('project-archived-line')).toBeNull();
  });

  it("a ranked crew: Needs you is crew's attention filtered to the project; stale work is one tidy-up line with its spend", async () => {
    const snap: SystemSnapshot = {
      checkedAt: NOW, ranked: true, clis: [], runs: [], infra: [], governance: [],
      attention: [
        { id: 'run:member', level: 'red', panel: 'runs', kind: 'prevents', text: 'Improve cart', reason: 'held at an escalation gate (unit 2)', remedy: null,
          action: { kind: 'open-gate', target: 'member', ord: 2 }, runId: 'member', blockedRunIds: ['member'], waitedSince: NOW - 3_600_000 },
        { id: 'run:elsewhere', level: 'red', panel: 'runs', kind: 'prevents', text: 'Other work', reason: null, remedy: null, action: null, runId: 'elsewhere', blockedRunIds: ['elsewhere'] },
      ],
      unresolved: [{ runId: 'filed', title: 'Fix checkout', repo: null, workflow: null, status: 'failed', why: 'failed', reason: 'failed 10 days ago', supersededBy: null, since: null, costUsd: 0.75, tokens: null, wallMs: null, actions: ['retry'] }],
    };
    useSystemStore.setState({ mode: 'system', snapshot: snap, snapshotAt: NOW, snapshotError: null });
    render(<ProjectDesk {...props} />);
    await loaded();
    const rows = screen.getAllByTestId('project-need');
    expect(rows.map((r) => r.getAttribute('data-key'))).toEqual(['run:member']);
    expect(rows[0]).toHaveTextContent('Improve cart');
    expect(rows[0]).toHaveTextContent('Decide');
    expect(screen.getByTestId('project-sentence')).toHaveTextContent(/^One thing needs you\./);
    expect(screen.getByTestId('project-tidy')).toHaveTextContent('1 job to tidy up ($0.75 spent)');
  });

  it('holds Needs you until crew first answers (no fold count flashing first)', async () => {
    useSystemStore.setState({ mode: 'unknown', healthAt: null, healthError: null });
    render(<ProjectDesk {...props} />);
    await loaded();
    expect(screen.getByTestId('project-home-loading')).toBeInTheDocument();
    expect(screen.getByTestId('project-sentence')).toHaveTextContent('Reading this project’s jobs…');
  });

  it('a tabbed view links back to the home', async () => {
    const navigate = vi.fn();
    render(<ProjectDesk {...props} navigate={navigate} search="?tab=runs" />);
    await loaded();
    fireEvent.click(screen.getByTestId('project-home-link'));
    expect(navigate).toHaveBeenCalledWith('/projects/p1');
  });
});

describe('the project Desk', () => {
  it('shares the Runs tab and includes both project_id and membership, excluding other projects', async () => {
    render(<ProjectDesk {...props} search="?tab=runs" />);
    await loaded();
    await waitFor(() => expect(allRows()).toEqual(['filed', 'member']));
    expect(screen.getByRole('tab', { name: 'Repositories' })).toHaveAttribute('href', '/projects/p1?tab=repositories');
    expect(getRun).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a member run row offers Remove from project; a run filed by project_id has no row menu', async () => {
    detach.mockResolvedValue({});
    render(<ProjectDesk {...props} search="?tab=runs" />);
    await loaded();
    await waitFor(() => expect(allRows()).toEqual(['filed', 'member']));
    const rowOf = (id: string): HTMLElement => screen.getAllByTestId('desk-runs-row').find((r) => r.getAttribute('data-run-id') === id)!;
    fireEvent.click(screen.getByTestId('desk-runs-group-finished'));
    expect(within(rowOf('filed')).queryByTestId('desk-runs-row-menu-button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('desk-runs-group-active'));
    fireEvent.click(within(rowOf('member')).getByTestId('desk-runs-row-menu-button'));
    const item = within(rowOf('member')).getByRole('menuitem', { name: /Remove .Improve cart. from this project/ });
    fireEvent.click(item);
    expect(detach).toHaveBeenCalledExactlyOnceWith('p1', 'crew.run:member');
    // The membership is gone, so the run leaves the project's list.
    await waitFor(() => expect(allRows()).toEqual(['filed']));
  });

  it('keeps project actions, requirements and documents under Work without duplicate dashboard sections', async () => {
    render(<ProjectDesk {...props} search="?tab=work" />);
    await loaded();
    // New job and Chat are the rail's (in this project); the header keeps only the project's own actions.
    expect(screen.queryByTestId('project-new-job')).toBeNull();
    expect(screen.queryByTestId('project-chat')).toBeNull();
    // Operator 2026-11-09: the header keeps Open repository only; Documents and the Edit / Archive ⋯ are gone.
    const actions = screen.getByTestId('project-actions');
    expect(within(actions).queryByTestId('project-documents')).toBeNull();
    expect(within(actions).getByTestId('project-open-repo')).toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: /^More actions for/ })).toBeNull();
    expect(actions.textContent).not.toMatch(/Documents|Archive|Edit|Restore/);
    expect(document.getElementById('requirements')).toBeInTheDocument();
    expect(document.getElementById('project-documents')).toBeInTheDocument();
    for (const id of ['project-band', 'project-jobs', 'project-feed', 'project-needs']) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.getByTestId('project-meta')).toHaveTextContent('2 jobs');
  });

  it('hosts the project repository section and its coverage and domain reads on Repositories', async () => {
    render(<ProjectDesk {...props} search="?tab=repositories" />);
    await loaded();
    expect(await screen.findByTestId('project-repos')).toHaveAttribute('data-count', '1');
    expect(within(screen.getByTestId('project-repos')).getByTestId('project-repo-row')).toHaveAttribute('data-repo', 'repo');
    await waitFor(() => expect(apiFetch.mock.calls.some(([path]) => String(path).includes('/coverage'))).toBe(true));
    expect(apiFetch.mock.calls.some(([path]) => String(path).includes('/domain'))).toBe(true);
    expect(document.getElementById('requirements')).toBeNull();
  });

  it('waits for its own member reads before the job list counts as read (codex r3)', async () => {
    let answer: (v: unknown) => void = () => undefined;
    getRun.mockImplementation(() => new Promise((r) => { answer = r; }));
    const onlyFiled = runs.filter((v) => v.session.id !== 'member');
    render(<ProjectDesk {...props} runs={onlyFiled} search="?tab=runs" />);
    await loaded();
    await waitFor(() => expect(getRun).toHaveBeenCalledWith('member'));
    // While the member read is out, the Runs tab is still reading (no partial list, no counts).
    expect(screen.queryAllByTestId('desk-runs-row')).toHaveLength(0);
    expect(screen.getByTestId('desk-runs-sentence')).toHaveTextContent('Reading your jobs…');
    answer({ run: runs.find((v) => v.session.id === 'member') });
    await waitFor(() => expect(allRows()).toEqual(['filed', 'member']));
  });

  it('names default honestly and offers no requirements, repositories, edit or archive', async () => {
    getProject.mockResolvedValue({ project: { ...project, id: 'default' }, members: [] });
    const view = render(<ProjectDesk {...props} projectId="default" search="?tab=work" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Not in a project' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^More actions for/ })).toBeNull();
    expect(document.getElementById('requirements')).toBeNull();
    // Nothing can edit work in no project (crew refuses the PATCH): no Settings tab, and its address shows Work.
    expect(screen.queryByTestId('desk-tab-settings')).toBeNull();
    view.rerender(<ProjectDesk {...props} projectId="default" search="?tab=settings" />);
    expect(screen.getByTestId('desk')).toHaveAttribute('data-tab', 'work');
    expect(screen.queryByTestId('project-settings')).toBeNull();
    view.rerender(<ProjectDesk {...props} projectId="default" search="?tab=repositories" />);
    expect(screen.getByText(/Work not in a project has no repositories of its own/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Repositories page/ })).toHaveAttribute('href', '/repos');
    expect(screen.queryByTestId('project-repos')).toBeNull();
  });

  it('reads a member missing from the run list and reports failed member reads', async () => {
    getProject.mockResolvedValue({ project, members: [member('older'), member('unreadable')] });
    getRun.mockImplementation((id: string) => id === 'older' ? Promise.resolve({ run: makeView({ id, problem: 'Older work', created_at: NOW / 1000 - 500, status: 'completed' }) }) : Promise.reject(new Error('read failed')));
    render(<ProjectDesk {...props} search="?tab=runs" />);
    await loaded();
    fireEvent.click(await screen.findByTestId('desk-runs-group-finished'));
    expect(await screen.findByRole('link', { name: /^Older work/ })).toBeInTheDocument();
    expect(allRows()).toEqual(['filed', 'older']);
    expect(await screen.findByTestId('project-jobs-unshown')).toHaveTextContent('1 job in this project');
  });

  it('replaces the old repository hash with the Repositories tab', async () => {
    window.history.replaceState(null, '', '/projects/p1#project-repos');
    const navigate = vi.fn();
    render(<ProjectDesk {...props} navigate={navigate} />);
    await loaded();
    expect(navigate).toHaveBeenCalledWith('/projects/p1?tab=repositories', { replace: true });
  });

  it.each(['requirements', 'project-documents'])('moves an old #%s address to Work, then scrolls', async (id) => {
    window.history.replaceState(null, '', `/projects/p1?tab=runs#${id}`);
    const navigate = vi.fn();
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const view = render(<ProjectDesk {...props} navigate={navigate} search="?tab=runs" />);
    await loaded();
    expect(navigate).toHaveBeenCalledWith(`/projects/p1?tab=work#${id}`, { replace: true });
    view.rerender(<ProjectDesk {...props} navigate={navigate} search="?tab=work" />);
    await waitFor(() => expect(scroll.mock.instances).toContain(document.getElementById(id)));
    scroll.mockRestore();
  });

  it('the documents stay on the Work tab, and an old #project-documents link still opens them there', async () => {
    const navigate = vi.fn();
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    window.history.replaceState(null, '', '/projects/p1?tab=repositories#project-documents');
    const view = render(<ProjectDesk {...props} navigate={navigate} search="?tab=repositories" />);
    await loaded();
    expect(navigate).toHaveBeenCalledWith('/projects/p1?tab=work#project-documents', { replace: true });
    window.history.replaceState(null, '', '/projects/p1?tab=work#project-documents');
    view.rerender(<ProjectDesk {...props} navigate={navigate} search="?tab=work" />);
    await waitFor(() => expect(scroll.mock.instances).toContain(document.getElementById('project-documents')));
    scroll.mockRestore();
  });

  it.each(['steer', 'agents', 'evaluate'] as const)('passes project scope to App for %s', async (tab) => {
    const hosted = vi.fn(() => <p>Hosted page</p>);
    render(<ProjectDesk {...props} search={`?tab=${tab}&at=${encodeURIComponent('/testing/evals?project=wrong')}`} hosted={hosted} />);
    await loaded();
    expect(hosted).toHaveBeenCalledWith(tab, '/testing/evals?project=wrong', 'p1');
    // Studio-wide tabs carry no "this is all of it" note on a project's page (operator, 2026-10-14).
    expect(screen.queryByTestId('desk-hosted-note')).toBeNull();
  });

  it('first-run guidance opens the project Repositories tab', async () => {
    getProject.mockResolvedValue({ project, members: [] });
    const navigate = vi.fn();
    render(<ProjectDesk {...props} runs={[]} navigate={navigate} search="?tab=work" />);
    await loaded();
    fireEvent.click(within(screen.getByTestId('project-first-run')).getByRole('button', { name: 'Go to repositories' }));
    expect(navigate).toHaveBeenCalledWith('/projects/p1?tab=repositories');
  });

  it('combines repository aggregate failures into one banner and retries both reads', async () => {
    const read = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string) => path.includes('/coverage') || path.includes('/domain') ? Promise.reject(new TypeError('Failed to fetch')) : read(path));
    render(<ProjectDesk {...props} search="?tab=repositories" />);
    await loaded();
    await waitFor(() => expect(screen.getAllByTestId('state-banner')).toHaveLength(1));
    await waitFor(() => expect(apiFetch.mock.calls.filter(([path]) => String(path).includes('/coverage') || String(path).includes('/domain'))).toHaveLength(2));
    expect(screen.getByTestId('state-banner')).toHaveAttribute('data-kind', 'offline');
    fireEvent.click(within(screen.getByTestId('state-banner')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(apiFetch.mock.calls.filter(([path]) => String(path).includes('/coverage') || String(path).includes('/domain'))).toHaveLength(4));
  });

  it('reports a missing project without mounting a Desk', async () => {
    getProject.mockResolvedValue({ project: null, members: [] });
    render(<ProjectDesk {...props} />);
    expect(await screen.findByText('Project not found')).toBeInTheDocument();
    expect(screen.queryByTestId('desk')).toBeNull();
  });
});

describe('Not in a project (operator 2026-10-16: the same dashboard as a project)', () => {
  it('a daemon that answers 404 for the synthesized project gets the stand-in: the board\'s unfiled runs, never a stale member list', async () => {
    const { ApiError } = await import('../src/api/errors.js');
    // A legacy run filed by membership alone (no project_id) is NOT unfiled; null and 'default' are.
    const legacy = makeView({ id: 'legacy', problem: 'Legacy filed', status: 'completed', created_at: NOW / 1000 - 250 });
    delete (legacy.session as { project_id?: unknown }).project_id; // a pre-0.8.0 DTO: no claim, filed by membership
    // The board's membership read (the rail's, and the Desk's own) knows legacy belongs to Shop.
    listProjects.mockResolvedValue({ projects: [project] });
    listMembers.mockResolvedValue({ members: [member('legacy')] });
    const unfiledRuns = [runs[0]!, runs[2]!, legacy,
      makeView({ id: 'loose', project_id: null, problem: 'Loose end', status: 'completed', created_at: NOW / 1000 - 300 }),
      makeView({ id: 'defaulted', project_id: 'default', problem: 'Default claim', status: 'completed', created_at: NOW / 1000 - 400 })];
    // First the real project (its members read), then Not in a project on the same mount.
    const { rerender } = render(<ProjectDesk {...props} runs={unfiledRuns} search="?tab=runs" />);
    await loaded();
    getProject.mockRejectedValue(new ApiError(404, 'no such project'));
    window.history.replaceState(null, '', '/projects/default');
    rerender(<ProjectDesk {...props} projectId="default" runs={unfiledRuns} search="?tab=runs" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Not in a project' })).toBeInTheDocument();
    await waitFor(() => expect(allRows()).toEqual(['defaulted', 'loose']));
    expect(screen.queryByText('Project not found')).not.toBeInTheDocument();
    expect(screen.getByTestId('project-meta')).not.toHaveTextContent('repository attached');
    listProjects.mockResolvedValue({ projects: [] });
    listMembers.mockResolvedValue({ members: [] });
  });
});

describe("a project's Settings tab (operator 2026-11-09)", () => {
  const settings = async (search = '?tab=settings'): Promise<void> => {
    render(<ProjectDesk {...props} search={search} />);
    await loaded();
    await screen.findByTestId('project-settings');
  };

  it('is the last tab, and edits the name and description through PATCH /projects/:id', async () => {
    updateProject.mockImplementation(async (id: string, body: Record<string, unknown>) => ({ project: { ...project, id, ...body } }));
    await settings();
    const tabs = within(screen.getByTestId('desk-tabs')).getAllByRole('tab');
    expect(tabs.at(-1)).toHaveTextContent('Settings');
    expect(tabs.at(-1)).toHaveAttribute('href', '/projects/p1?tab=settings');
    expect(screen.getByTestId('project-settings-name')).toHaveValue('Shop');
    expect(screen.getByTestId('project-settings-description')).toHaveValue('Checkout work');
    // Unchanged, there is nothing to save; an empty name cannot be saved.
    expect(screen.getByTestId('project-settings-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('project-settings-name'), { target: { value: '  ' } });
    expect(screen.getByTestId('project-settings-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('project-settings-name'), { target: { value: ' Shop front ' } });
    fireEvent.change(screen.getByTestId('project-settings-description'), { target: { value: 'The storefront' } });
    fireEvent.click(screen.getByTestId('project-settings-save'));
    await waitFor(() => expect(updateProject).toHaveBeenCalledExactlyOnceWith('p1', { name: 'Shop front', description: 'The storefront' }));
    expect(await screen.findByTestId('project-settings-saved')).toHaveTextContent('Saved.');
    // The page's header and the shared store say the new name at once.
    expect(screen.getByRole('heading', { level: 1, name: 'Shop front' })).toBeInTheDocument();
    expect(useProjectsStore.getState().projects.find((x) => x.id === 'p1')?.name).toBe('Shop front');
  });

  it('a refused save says so in its own section, with the daemon\'s words behind technical details', async () => {
    updateProject.mockRejectedValue(new Error('409 a project named Shop front already exists'));
    await settings();
    fireEvent.change(screen.getByTestId('project-settings-name'), { target: { value: 'Shop front' } });
    fireEvent.click(screen.getByTestId('project-settings-save'));
    expect(await screen.findByTestId('project-settings-error')).toHaveTextContent('Couldn’t save the project.');
    expect(screen.queryByTestId('project-settings-saved')).toBeNull();
  });

  it('links Personality to Learn for this project', async () => {
    const navigate = vi.fn();
    render(<ProjectDesk {...props} navigate={navigate} search="?tab=settings" />);
    await loaded();
    const link = await screen.findByTestId('project-personality');
    expect(link).toHaveAttribute('href', '/learn?tab=personality&project=p1');
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/learn?tab=personality&project=p1');
  });

  it('archives only after the inline confirm; Cancel sends nothing', async () => {
    updateProject.mockImplementation(async (id: string, body: Record<string, unknown>) => ({ project: { ...project, id, ...body } }));
    await settings();
    const zone = screen.getByTestId('project-danger-zone');
    expect(zone).toHaveTextContent('Danger zone');
    expect(within(zone).getByTestId('project-archive-words')).toHaveTextContent('no new jobs, chats, repositories or trackers');
    expect(within(zone).getByTestId('project-archive-words')).toHaveTextContent('Nothing is deleted.');
    fireEvent.click(within(zone).getByTestId('project-archive'));
    expect(updateProject).not.toHaveBeenCalled();
    expect(within(zone).getByTestId('project-archive-confirming')).toHaveTextContent('Archive Shop? It stops taking new work until you restore it.');
    // No modal: the confirm is inline.
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(within(zone).getByTestId('project-archive-cancel'));
    expect(within(zone).queryByTestId('project-archive-confirming')).toBeNull();
    expect(updateProject).not.toHaveBeenCalled();
    fireEvent.click(within(zone).getByTestId('project-archive'));
    fireEvent.click(within(zone).getByTestId('project-archive-confirm'));
    await waitFor(() => expect(updateProject).toHaveBeenCalledExactlyOnceWith('p1', { status: 'archived' }));
    // Archived: the header says so, and the danger zone now offers Restore.
    expect(await within(zone).findByTestId('project-restore')).toHaveTextContent('Restore this project');
    expect(screen.getByTestId('project-meta')).toHaveTextContent('Archived');
  });

  it("an archived project's Settings restores it in one click (restoring destroys nothing)", async () => {
    getProject.mockResolvedValue({ project: { ...project, status: 'archived' }, members: [] });
    useProjectsStore.setState({ projects: [] });
    updateProject.mockImplementation(async (id: string, body: Record<string, unknown>) => ({ project: { ...project, id, ...body } }));
    await settings();
    expect(screen.queryByTestId('project-archive')).toBeNull();
    expect(screen.getByTestId('project-archived-note')).toHaveTextContent('It takes no new work until you restore it.');
    fireEvent.click(screen.getByTestId('project-restore'));
    await waitFor(() => expect(updateProject).toHaveBeenCalledExactlyOnceWith('p1', { status: 'active' }));
    expect(await screen.findByTestId('project-archive')).toBeInTheDocument();
    // A restored project rejoins the active register the rail reads.
    expect(useProjectsStore.getState().projects.map((x) => x.id)).toContain('p1');
  });

  it('one save at a time: while a rename is out, the fields and Archive wait, and the answer never overwrites a newer edit', async () => {
    let answer: (v: unknown) => void = () => undefined;
    updateProject.mockImplementation(() => new Promise((r) => { answer = r; }));
    await settings();
    fireEvent.change(screen.getByTestId('project-settings-name'), { target: { value: 'Shop front' } });
    fireEvent.click(screen.getByTestId('project-settings-save'));
    await waitFor(() => expect(updateProject).toHaveBeenCalledTimes(1));
    // Nothing else can be typed or sent until crew answers (codex review: a slower answer undid a newer one); the
    // fields are read-only, not disabled, so focus stays where Enter left it.
    expect(screen.getByTestId('project-settings-name')).toHaveAttribute('readonly');
    expect(screen.getByTestId('project-settings-description')).toHaveAttribute('readonly');
    expect(screen.getByTestId('project-archive')).toBeDisabled();
    fireEvent.click(screen.getByTestId('project-archive'));
    expect(screen.queryByTestId('project-archive-confirming')).toBeNull();
    answer({ project: { ...project, name: 'Shop front' } });
    await waitFor(() => expect(screen.getByTestId('project-settings-name')).not.toHaveAttribute('readonly'));
    expect(screen.getByTestId('project-settings-name')).toHaveValue('Shop front');
    expect(screen.getByTestId('project-settings-description')).toHaveValue('Checkout work');
    expect(updateProject).toHaveBeenCalledTimes(1);
  });

  it('writes queue per project across a remount: leaving Settings mid-save keeps a new draft and the newer write wins', async () => {
    const answers: ((v: unknown) => void)[] = [];
    updateProject.mockImplementation(() => new Promise((r) => { answers.push(r); }));
    const view = render(<ProjectDesk {...props} search="?tab=settings" />);
    await loaded();
    fireEvent.change(await screen.findByTestId('project-settings-name'), { target: { value: 'Sent rename' } });
    fireEvent.click(screen.getByTestId('project-settings-save'));
    await waitFor(() => expect(updateProject).toHaveBeenCalledTimes(1));
    // Away and back while the rename is out: a fresh form.
    view.rerender(<ProjectDesk {...props} search="?tab=work" />);
    view.rerender(<ProjectDesk {...props} search="?tab=settings" />);
    fireEvent.change(await screen.findByTestId('project-settings-description'), { target: { value: 'Unsaved draft' } });
    fireEvent.click(screen.getByTestId('project-archive'));
    fireEvent.click(screen.getByTestId('project-archive-confirm'));
    // The archive waits for the rename: crew sees them in order, so the archived answer is the last one.
    await new Promise((r) => setTimeout(r, 20));
    expect(updateProject).toHaveBeenCalledTimes(1);
    answers[0]!({ project: { ...project, name: 'Sent rename' } });
    await waitFor(() => expect(updateProject).toHaveBeenCalledTimes(2));
    expect(updateProject).toHaveBeenLastCalledWith('p1', { status: 'archived' });
    answers[1]!({ project: { ...project, name: 'Sent rename', status: 'archived' } });
    expect(await screen.findByTestId('project-restore')).toBeInTheDocument();
    expect(useProjectsStore.getState().projects.find((x) => x.id === 'p1')?.status).toBe('archived');
    // The draft typed meanwhile is kept; the name follows the saved one (it still showed the old value).
    expect(screen.getByTestId('project-settings-description')).toHaveValue('Unsaved draft');
    expect(screen.getByTestId('project-settings-name')).toHaveValue('Sent rename');
  });

  it('focus follows the confirm: Cancel on open, Archive on cancel, Restore once archived; Escape cancels', async () => {
    updateProject.mockImplementation(async (id: string, body: Record<string, unknown>) => ({ project: { ...project, id, ...body } }));
    await settings();
    fireEvent.click(screen.getByTestId('project-archive'));
    await waitFor(() => expect(screen.getByTestId('project-archive-cancel')).toHaveFocus());
    fireEvent.click(screen.getByTestId('project-archive-cancel'));
    await waitFor(() => expect(screen.getByTestId('project-archive')).toHaveFocus());
    fireEvent.click(screen.getByTestId('project-archive'));
    fireEvent.keyDown(screen.getByTestId('project-archive-cancel'), { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('project-archive')).toHaveFocus());
    expect(updateProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('project-archive'));
    fireEvent.click(screen.getByTestId('project-archive-confirm'));
    await waitFor(() => expect(screen.getByTestId('project-restore')).toHaveFocus());
  });

  it('a refused archive keeps the confirm open and says why', async () => {
    updateProject.mockRejectedValue(new Error('403 admin only'));
    await settings();
    fireEvent.click(screen.getByTestId('project-archive'));
    fireEvent.click(screen.getByTestId('project-archive-confirm'));
    expect(await screen.findByTestId('project-archive-error')).toHaveTextContent('Couldn’t archive the project.');
    expect(screen.getByTestId('project-archive-confirm')).toBeEnabled();
  });
});

describe("a project's own pages never lead to the filtered Everything list (operator 2026-11-09)", () => {
  it.each(['', '?tab=work', '?tab=runs', '?tab=report', '?tab=understand', '?tab=settings', '?tab=repositories'])('no anchor on %s links /everything with project=', async (search) => {
    render(<ProjectDesk {...props} search={search} />);
    await loaded();
    await waitFor(() => expect(screen.queryByTestId('project-home-loading')).toBeNull());
    const bad = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '').filter((h) => h.startsWith('/everything') && /[?&]project=/.test(h));
    expect(bad).toEqual([]);
  });

  it('Running now, Failed and See all open the project\'s Jobs tab, the filter in the address', async () => {
    render(<ProjectDesk {...props} search="?tab=work" />);
    await loaded();
    const hrefOf = (id: string): string | null => screen.getByTestId(id).closest('a')?.getAttribute('href') ?? screen.getByTestId(id).querySelector('a')?.getAttribute('href') ?? null;
    expect(hrefOf('desk-block-running')).toBe('/projects/p1?tab=runs&filter=active');
    expect(hrefOf('desk-block-failed')).toBe('/projects/p1?tab=runs&filter=failed');
  });

  it('Failed lands on the list it counted: a range picked earlier on Jobs does not hide it (codex review)', async () => {
    const old = makeView({ id: 'old-fail', project_id: 'p1', problem: 'Old failure', status: 'failed', created_at: NOW / 1000 - 20 * 86400, ended_at: NOW / 1000 - 20 * 86400 + 60 });
    const all = [...runs, old];
    const view = render(<ProjectDesk {...props} runs={all} search="?tab=runs" />);
    await loaded();
    fireEvent.click(screen.getByTestId('desk-runs-tools'));
    fireEvent.click(screen.getByTestId('desk-range-7'));
    fireEvent.click(screen.getByTestId('desk-runs-group-finished'));
    await waitFor(() => expect(rowIds()).not.toContain('old-fail'));
    view.rerender(<ProjectDesk {...props} runs={all} search="?tab=work" />);
    view.rerender(<ProjectDesk {...props} runs={all} search="?tab=runs&filter=failed" />);
    await waitFor(() => expect(rowIds()).toEqual(['old-fail']));
  });

  it('?filter=failed opens Jobs on Finished, narrowed to Failed; ?filter=active on Active', async () => {
    const failed = makeView({ id: 'broke', project_id: 'p1', problem: 'Broken deploy', status: 'failed', created_at: NOW / 1000 - 100, ended_at: NOW / 1000 - 50 });
    const view = render(<ProjectDesk {...props} runs={[...runs, failed]} search="?tab=runs&filter=failed" />);
    await loaded();
    await waitFor(() => expect(rowIds()).toEqual(['broke']));
    expect(screen.getByTestId('desk-runs-group-finished')).toHaveAttribute('aria-checked', 'true');
    view.rerender(<ProjectDesk {...props} runs={[...runs, failed]} search="?tab=runs&filter=active" />);
    await waitFor(() => expect(rowIds()).toEqual(['member']));
  });
});
