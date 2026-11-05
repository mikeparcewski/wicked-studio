import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RepoEntry } from '../src/api/types.js';
import { makeView } from './factories.js';

/**
 * The Repositories redesign (operator 2026-11-05: "just a giant list of boxes ... break into tabs or not have all the
 * content run on each other"; approved mockup design/mockups/repos-page.html). Pinned here:
 *  - a repository's page has six tabs, one panel in the page at a time: each tab shows only its own content;
 *  - every tab is its own address (`?tab=`), a bad one is Overview, a click moves the address (Back returns);
 *  - History reads git only when it opens;
 *  - the projects and trackers (Overview, the Trackers tab, the list's columns) exist only on a crew with tracker links;
 *  - the row details that left the list (code-map and learnings state, Re-index, the run counts) are on the page.
 */

const NOW = Date.now();
const REPO: RepoEntry = { id: 'studio-api', name: 'studio-api', root_path: '/tmp/studio-api', default_branch: 'main', registered_at: 1_700_000_000 };
const RUNS = [
  makeView({ id: 'r-a1', repo_ref: 'studio-api', workflow_id: 'feature', status: 'executing', problem: 'wire uploads' }),
  makeView({ id: 'r-a2', repo_ref: 'studio-api', workflow_id: 'feature', status: 'failed', problem: 'refactor auth' }),
  makeView({ id: 'r-a3', repo_ref: 'studio-api', workflow_id: 'feature', status: 'completed', problem: 'add search' }),
  makeView({ id: 'o-api', repo_ref: 'studio-api', workflow_id: 'onboarding', status: 'completed', problem: 'Onboard studio-api', clis: ['claude'] }),
  makeView({ id: 'c-api', repo_ref: 'studio-api', workflow_id: 'capture-learnings', status: 'completed', problem: 'Capture learnings from studio-api' }),
];

const listRepos = vi.fn(() => Promise.resolve({ repos: [REPO] }));
const listRuns = vi.fn(() => Promise.resolve({ runs: RUNS }));
const getRepoGitHistory = vi.fn(() => Promise.resolve({ commits: [] }));
const getRepoContributors = vi.fn(() => Promise.resolve({ contributors: [] }));
const rerunOnboarding = vi.fn(() => Promise.resolve({ runId: 'r-new' }));
const listApps = vi.fn(() => Promise.resolve({ apps: [] as Array<{ slug: string; name: string; repoId: string }> }));
const launchRun = vi.fn((...a: unknown[]) => { void a; return Promise.resolve({ runId: 'r-cap' }); });

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => listRepos(),
    listRuns: () => listRuns(),
    getRepoGraph: () => Promise.resolve({ graph: null }),
    getRepoGitHistory: () => getRepoGitHistory(),
    getRepoContributors: () => getRepoContributors(),
    rerunOnboarding: () => rerunOnboarding(),
    launchRun: (...a: unknown[]) => launchRun(...a),
    getGraphKindsForRepo: () => Promise.resolve({ kinds: [{ kind: 'Function', count: 41 }, { kind: 'File', count: 4 }] }),
    listRequirements: () => Promise.reject(new Error('no requirements in this suite')),
    listProjects: () => Promise.resolve({ projects: [] }),
    listApps: () => listApps(),
  },
  apiFetch: () => Promise.reject(new Error('not in this suite')),
}));

const { RepoDetailPage } = await import('../src/components/RepoDetailPage.js');
const { RepositoriesPanel } = await import('../src/components/RepositoriesPanel.js');
const { trackersApi } = await import('../src/api/trackers.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useMembershipStore } = await import('../src/store/membership.js');
const { resetRepoLinks } = await import('../src/store/repoLinks.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { resetRepoKnowledge } = await import('../src/store/repoKnowledge.js');
const { clearRetryPrefill, peekRetryPrefill } = await import('../src/store/retryPrefill.js');

const link = (id: string, system: string, tenant: string, key: string, label: string): Record<string, unknown> => ({
  id, trackerId: `t-${id}`, source: system, sourceId: '', system, tenant, key, label,
  target: { kind: 'repo', id: 'studio-api' }, linkedAt: '2026-11-01T00:00:00Z', linkedBy: 'person', projection: 'current',
});

const LINKS = {
  target: { repo: 'studio-api' },
  links: [
    link('l1', 'jira', 'acme', 'BILL', 'Billing board'),
    link('l2', 'github', 'o', 'o/studio-api', 'studio-api issues'),
  ],
  viaRepos: [],
  projects: [{ id: 'p-billing', name: 'Billing' }, { id: 'p-ops', name: 'Ops' }],
  agents: [],
};

function trackers(on: boolean): void {
  useCapabilities.setState({ loaded: true, trackerLinks: on });
}

async function page(search = '', navigate: (p: string) => void = () => {}): Promise<void> {
  render(<RepoDetailPage repoId="studio-api" onSelectRun={() => {}} navigate={navigate} onOpenGraph={() => {}} search={search} />);
  await screen.findByRole('heading', { name: 'studio-api' });
}

/** What only each tab shows: its own testids (another tab's must not be in the page). */
const OWN: Record<string, string[]> = {
  overview: ['repo-know-band', 'repo-overview-recent'],
  knowledge: ['repo-code-map', 'repo-hotspots', 'repo-languages', 'repo-requirements', 'repo-requirements-graph'],
  jobs: ['repo-detail-stats', 'repo-jobs-all'],
  history: ['repo-history-commits', 'repo-history-cadence', 'repo-history-contributors'],
  trackers: ['repo-trackers'],
  settings: ['repo-upkeep', 'repo-where', 'repo-run-onboarding', 'repo-capture-learnings'],
};

beforeEach(() => {
  resetRepoLinks();
  resetRepoKnowledge();
  clearRetryPrefill();
  listRepos.mockClear();
  getRepoGitHistory.mockClear();
  getRepoContributors.mockClear();
  rerunOnboarding.mockClear();
  launchRun.mockReset().mockImplementation(() => Promise.resolve({ runId: 'r-cap' }));
  listRuns.mockImplementation(() => Promise.resolve({ runs: RUNS }));
  getRepoGitHistory.mockImplementation(() => Promise.resolve({ commits: [] }));
  getRepoContributors.mockImplementation(() => Promise.resolve({ contributors: [] }));
  trackers(true);
  vi.spyOn(trackersApi, 'links').mockResolvedValue(LINKS);
  useMembershipStore.setState({ projectNameByRun: {}, projectIdByRun: {}, attachedAtByRun: { 'o-api': NOW - 5 * 86_400_000, 'c-api': NOW - 2 * 3_600_000 } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); trackers(false); });

describe('a repository’s page: six tabs, one panel at a time', () => {
  it.each(Object.keys(OWN))('?tab=%s shows only its own content', async (tab) => {
    await page(tab === 'overview' ? '' : `?tab=${tab}`);
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('data-testid', `repo-panel-${tab}`);
    expect(panel).toHaveAttribute('aria-labelledby', `repo-tab-${tab}`);
    expect(screen.getByTestId(`repo-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    for (const id of OWN[tab]!) expect(await within(panel).findByTestId(id)).toBeInTheDocument();
    for (const [other, ids] of Object.entries(OWN)) {
      if (other === tab) continue;
      for (const id of ids) expect(screen.queryByTestId(id), `${id} (the ${other} tab's) on ${tab}`).toBeNull();
    }
  });

  it('the tabs are in the approved order, and a count rides Jobs and Trackers', async () => {
    await page();
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.replace(/\d+$/u, ''))).toEqual(['Overview', 'Knowledge', 'Jobs', 'History', 'Trackers', 'Settings']);
    expect(screen.getByTestId('repo-tab-jobs-count')).toHaveTextContent('5');
    expect(await screen.findByTestId('repo-tab-trackers-count')).toHaveTextContent('2');
  });
});

describe('deep links: every tab is its own address', () => {
  it('a bad or missing ?tab= is Overview', async () => {
    await page('?tab=nonsense');
    expect(screen.getByTestId('repo-tab-overview')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-testid', 'repo-panel-overview');
  });

  it('each tab links to its address; a click moves there (Overview is the address with no ?tab=)', async () => {
    const navigate = vi.fn();
    await page('?tab=jobs', navigate);
    expect(screen.getByTestId('repo-tab-history')).toHaveAttribute('href', '/repo-detail/studio-api?tab=history');
    expect(screen.getByTestId('repo-tab-overview')).toHaveAttribute('href', '/repo-detail/studio-api');
    fireEvent.click(screen.getByTestId('repo-tab-settings'));
    expect(navigate).toHaveBeenCalledWith('/repo-detail/studio-api?tab=settings');
    fireEvent.click(screen.getByTestId('repo-tab-jobs')); // the open tab: no history entry
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('the project a page was opened from rides every tab’s address', async () => {
    const navigate = vi.fn();
    await page('?project=p-billing', navigate);
    expect(screen.getByTestId('repo-tab-knowledge')).toHaveAttribute('href', '/repo-detail/studio-api?tab=knowledge&project=p-billing');
    fireEvent.click(screen.getByTestId('repo-tab-knowledge'));
    expect(navigate).toHaveBeenCalledWith('/repo-detail/studio-api?tab=knowledge&project=p-billing');
  });

  it('Overview’s “All jobs” opens the Jobs tab', async () => {
    listRuns.mockImplementationOnce(() => Promise.resolve({ runs: [...RUNS, ...RUNS.map((v, i) => makeView({ ...v.session, id: `x-${i}` }))] }));
    const navigate = vi.fn();
    await page('', navigate);
    fireEvent.click(screen.getByTestId('repo-overview-all-jobs'));
    expect(navigate).toHaveBeenCalledWith('/repo-detail/studio-api?tab=jobs');
  });

  it('History reads git only when it opens', async () => {
    await page();
    expect(getRepoGitHistory).not.toHaveBeenCalled();
    expect(getRepoContributors).not.toHaveBeenCalled();
    cleanup();
    await page('?tab=history');
    await waitFor(() => expect(getRepoGitHistory).toHaveBeenCalledTimes(1));
    expect(getRepoContributors).toHaveBeenCalledTimes(1);
  });
});

describe('projects and trackers: only on a crew with tracker links', () => {
  it('with them: the header names the projects; Overview shows them and the trackers; the Trackers tab exists', async () => {
    await page();
    await waitFor(() => expect(screen.getByTestId('repo-detail-meta')).toHaveTextContent('in Billing, Ops'));
    expect(within(screen.getByTestId('repo-overview-projects')).getAllByRole('link').map((a) => a.textContent)).toEqual(['Billing', 'Ops']);
    expect(screen.getByTestId('repo-overview-trackers')).toHaveTextContent('2 linked.');
    expect(screen.getByTestId('repo-tab-trackers')).toBeInTheDocument();
  });

  it('without them: no Trackers tab, no projects or trackers on Overview, no read; ?tab=trackers is Overview', async () => {
    trackers(false);
    await page('?tab=trackers');
    expect(screen.queryByTestId('repo-tab-trackers')).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-testid', 'repo-panel-overview');
    expect(screen.queryByTestId('repo-overview-projects')).toBeNull();
    expect(screen.queryByTestId('repo-overview-trackers')).toBeNull();
    expect(trackersApi.links).not.toHaveBeenCalled();
  });
});

describe('what left the list’s row details is on the page', () => {
  it('Settings: the code map and learnings states in words, where it lives, and the upkeep verbs', async () => {
    await page('?tab=settings');
    expect(screen.getByTestId('repo-graph-state')).toHaveAttribute('data-state', 'ready');
    expect(screen.getByTestId('repo-graph-state').textContent).toContain('Code map ready · onboarded 5d ago');
    expect(screen.getByTestId('repo-capture-state')).toHaveAttribute('data-state', 'captured');
    expect(screen.getByTestId('repo-capture-state').textContent).toContain('Learnings captured 2h ago');
    expect(screen.getByTestId('repo-capture-learnings')).toHaveTextContent('Capture learnings again');
    expect(screen.getByTestId('repo-detail-path')).toHaveTextContent('/tmp/studio-api');
    expect(screen.getByTestId('action-preview')).toHaveTextContent('rebuilds this repository’s code map');
  });

  it('Re-index is a PREFILL: it deposits the recorded onboard run’s setup and opens the composer; NOTHING posts', async () => {
    const navigate = vi.fn();
    await page('?tab=settings', navigate);
    fireEvent.click(screen.getByTestId('repo-reindex'));
    const prefill = peekRetryPrefill();
    expect(prefill).toMatchObject({ retryOf: 'o-api', workflowId: 'onboarding', repoRef: 'studio-api', problem: 'Onboard studio-api', clis: ['claude'] });
    expect(navigate).toHaveBeenCalledWith('/runs/new');
    expect(rerunOnboarding).not.toHaveBeenCalled();
  });

  it('a never-onboarded repository has no Re-index (Re-run onboarding builds the first map)', async () => {
    listRuns.mockImplementationOnce(() => Promise.resolve({ runs: [] }));
    await page('?tab=settings');
    expect(screen.queryByTestId('repo-reindex')).toBeNull();
    expect(screen.getByTestId('repo-graph-state')).toHaveAttribute('data-state', 'never');
    expect(screen.getByTestId('repo-capture-state').textContent).toContain('No learnings captured yet');
  });

  it('jobs read newest first (Recent jobs and the Jobs tab)', async () => {
    const S = Math.floor(NOW / 1000);
    listRuns.mockImplementation(() => Promise.resolve({ runs: [
      makeView({ id: 'old', repo_ref: 'studio-api', workflow_id: 'feature', status: 'completed', problem: 'old one', created_at: S - 3 * 86_400 }),
      makeView({ id: 'new', repo_ref: 'studio-api', workflow_id: 'feature', status: 'completed', problem: 'new one', created_at: S - 60 }),
      makeView({ id: 'mid', repo_ref: 'studio-api', workflow_id: 'feature', status: 'completed', problem: 'mid one', created_at: S - 86_400 }),
    ] }));
    await page();
    expect(within(screen.getByTestId('repo-overview-recent')).getAllByTestId('run-link').map((b) => b.getAttribute('data-run-id'))).toEqual(['new', 'mid', 'old']);
    cleanup();
    await page('?tab=jobs');
    expect(within(screen.getByTestId('repo-jobs-all')).getAllByTestId('run-link').map((b) => b.getAttribute('data-run-id'))).toEqual(['new', 'mid', 'old']);
    listRuns.mockImplementation(() => Promise.resolve({ runs: RUNS }));
  });

  it('Jobs: the counts in one line, then every job on the repository', async () => {
    await page('?tab=jobs');
    expect(screen.getByTestId('repo-detail-stats').textContent).toBe('5 jobs · 1 working now · 3 finished · 1 failed or cancelled');
    expect(within(screen.getByTestId('repo-jobs-all')).getAllByTestId('run-link')).toHaveLength(5);
  });
});

describe('the list’s Projects and Trackers columns', () => {
  const panel = async (): Promise<void> => {
    render(<RepositoriesPanel navigate={() => {}} />);
    await screen.findByTestId('repos-list');
  };

  it('with tracker links: a column each, from one read per repository', async () => {
    await panel();
    const card = screen.getAllByTestId('repo-card')[0]!;
    await waitFor(() => expect(within(card).getByTestId('repo-row-projects')).toHaveTextContent('Billing, Ops'));
    expect(within(card).getByTestId('repo-row-trackers')).toHaveTextContent('2');
    expect(within(card).getByTestId('repo-row-phone')).toHaveTextContent('2 projects · 2 trackers');
    expect(screen.getByTestId('repos-columns').textContent).toBe('RepositoryProjectsCode mapTrackersLast activity');
    expect(trackersApi.links).toHaveBeenCalledWith({ repo: 'studio-api' }, expect.any(AbortSignal));
  });

  it('without them: no Trackers column and nothing is read; Projects says only what the jobs say', async () => {
    trackers(false);
    await panel();
    const card = screen.getAllByTestId('repo-card')[0]!;
    expect(within(card).getByTestId('repo-row-projects')).toHaveTextContent('No project');
    expect(within(card).queryByTestId('repo-row-trackers')).toBeNull();
    expect(screen.getByTestId('repos-columns').textContent).toBe('RepositoryProjectsCode mapLast activity');
    expect(within(card).getByTestId('repo-row-phone').textContent).not.toMatch(/project|tracker/u);
    expect(trackersApi.links).not.toHaveBeenCalled();
  });

  it('a repository attached to a project with no tracker linked shows the project (crew’s membership)', async () => {
    vi.mocked(trackersApi.links).mockResolvedValue({ ...LINKS, links: [], projects: [{ id: 'p-mikes', name: 'Mikes' }] });
    await panel();
    const card = screen.getAllByTestId('repo-card')[0]!;
    await waitFor(() => expect(within(card).getByTestId('repo-row-projects')).toHaveTextContent(/^Mikes$/u));
    expect(within(card).getByTestId('repo-row-trackers')).toHaveTextContent('–');
  });

  it('a project whose jobs used the repository without attaching it shows as "(jobs)", as its Repositories tab says', async () => {
    vi.mocked(trackersApi.links).mockResolvedValue({ ...LINKS, links: [], projects: [] });
    useProjectsStore.setState({ projects: [{ id: 'p-mikes', name: 'Mikes', description: null, status: 'active', scope: '', created_at: 0, updated_at: 0 }] });
    listRuns.mockImplementation(() => Promise.resolve({ runs: [...RUNS, makeView({ id: 'r-m', repo_ref: 'studio-api', workflow_id: 'feature', status: 'completed', project_id: 'p-mikes' } as never)] }));
    await panel();
    const card = screen.getAllByTestId('repo-card')[0]!;
    await waitFor(() => expect(within(card).getByTestId('repo-row-projects')).toHaveTextContent('Mikes (jobs)'));
    expect(within(card).getByTestId('repo-row-projects').getAttribute('title')).toContain('not attached');
    expect(within(card).getByTestId('repo-row-phone')).toHaveTextContent('1 project');
    useProjectsStore.setState({ projects: [] });
    listRuns.mockImplementation(() => Promise.resolve({ runs: RUNS }));
  });
});

describe('review folds (codex on #998)', () => {
  it('a registration notice not yet dismissed rides along when the tab changes', async () => {
    window.history.replaceState({ onboardError: 'tool missing' }, '', '/repo-detail/studio-api');
    const navigate = vi.fn();
    await page('', navigate);
    expect(screen.getByTestId('repo-onboard-error')).toHaveTextContent('tool missing');
    fireEvent.click(screen.getByTestId('repo-tab-settings'));
    expect(navigate).toHaveBeenCalledWith('/repo-detail/studio-api?tab=settings', { state: { onboardError: 'tool missing' } });
    window.history.replaceState({}, '', '/');
  });

  it('a capture started from More that fails is said on the tab it started from', async () => {
    launchRun.mockImplementation(() => Promise.reject(new Error('refused')));
    await page();
    fireEvent.click(screen.getByTestId('repo-more-button'));
    fireEvent.click(screen.getByTestId('repo-menu-capture'));
    const err = await screen.findByTestId('repo-capture-error');
    expect(err).toHaveTextContent('Couldn’t start capturing learnings');
    expect(err.closest('[data-testid="repo-alerts"]')).not.toBeNull();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-testid', 'repo-panel-overview');
  });

  it('a capture in flight for one repository does not disable the next one’s', async () => {
    let settle!: () => void;
    launchRun.mockImplementation(() => new Promise((res) => { settle = () => res({ runId: 'r-a' }); }));
    listRepos.mockImplementation(() => Promise.resolve({ repos: [REPO, { ...REPO, id: 'other', name: 'other' }] }));
    const props = { onSelectRun: vi.fn(), navigate: vi.fn(), onOpenGraph: vi.fn(), search: '?tab=settings' };
    const view = render(<RepoDetailPage {...props} repoId="studio-api" />);
    fireEvent.click(await screen.findByTestId('repo-capture-learnings'));
    expect(screen.getByTestId('repo-capture-learnings')).toBeDisabled();
    view.rerender(<RepoDetailPage {...props} repoId="other" />);
    await screen.findByRole('heading', { name: 'other' });
    expect(screen.getByTestId('repo-capture-learnings')).toBeEnabled();
    settle();
    await waitFor(() => expect(screen.getByTestId('repo-capture-learnings')).toBeEnabled());
    expect(props.onSelectRun).not.toHaveBeenCalled(); // the other repository's run is not opened here
    listRepos.mockImplementation(() => Promise.resolve({ repos: [REPO] }));
  });

  it('unread jobs make the index and learnings unknown, never "not indexed", with Try again', async () => {
    listRuns.mockImplementation(() => Promise.reject(new Error('down')));
    await page('?tab=settings');
    expect(screen.getByTestId('repo-runs-failed')).toBeInTheDocument();
    expect(screen.getByTestId('repo-detail-meta')).toHaveTextContent('Code map state unknown');
    expect(screen.getByTestId('repo-detail-meta').textContent).not.toMatch(/Not indexed/u);
    expect(screen.getByTestId('repo-graph-state')).toHaveAttribute('data-state', 'unknown');
    expect(screen.getByTestId('repo-capture-state')).toHaveAttribute('data-state', 'unknown');
    listRuns.mockImplementation(() => Promise.resolve({ runs: RUNS }));
    fireEvent.click(within(screen.getByTestId('repo-runs-failed')).getByRole('button'));
    await waitFor(() => expect(screen.queryByTestId('repo-runs-failed')).toBeNull());
    expect(screen.getByTestId('repo-graph-state')).toHaveAttribute('data-state', 'ready');
  });

  it('failed git reads say so (never "No commits yet"), and Try again reads again', async () => {
    getRepoGitHistory.mockImplementation(() => Promise.reject(new Error('git down')));
    getRepoContributors.mockImplementation(() => Promise.reject(new Error('git down')));
    await page('?tab=history');
    expect(await screen.findByTestId('repo-commits-unread')).toBeInTheDocument();
    expect(screen.getByTestId('repo-contributors-unread')).toBeInTheDocument();
    expect(within(screen.getByTestId('repo-history-commits')).queryByText('No commits yet.')).toBeNull();
    getRepoGitHistory.mockImplementation(() => Promise.resolve({ commits: [] }));
    getRepoContributors.mockImplementation(() => Promise.resolve({ contributors: [] }));
    fireEvent.click(within(screen.getByTestId('repo-history-failed')).getByRole('button'));
    expect(await within(screen.getByTestId('repo-history-commits')).findByText('No commits yet.')).toBeInTheDocument();
    expect(getRepoGitHistory).toHaveBeenCalledTimes(2);
  });

  it('back on the first repository, an older capture’s answer does not land on the newer one (A → B → A)', async () => {
    const settles: Array<() => void> = [];
    launchRun.mockImplementation(() => new Promise((res) => { const id = `r-${settles.length}`; settles.push(() => res({ runId: id })); }));
    listRepos.mockImplementation(() => Promise.resolve({ repos: [REPO, { ...REPO, id: 'other', name: 'other' }] }));
    const props = { onSelectRun: vi.fn(), navigate: vi.fn(), onOpenGraph: vi.fn(), search: '?tab=settings' };
    const view = render(<RepoDetailPage {...props} repoId="studio-api" />);
    fireEvent.click(await screen.findByTestId('repo-capture-learnings')); // A1
    view.rerender(<RepoDetailPage {...props} repoId="other" />);
    await screen.findByRole('heading', { name: 'other' });
    view.rerender(<RepoDetailPage {...props} repoId="studio-api" />);
    await screen.findByRole('heading', { name: 'studio-api' });
    fireEvent.click(screen.getByTestId('repo-capture-learnings')); // A2
    expect(screen.getByTestId('repo-capture-learnings')).toBeDisabled();
    settles[0]!(); // A1 answers late
    await waitFor(() => expect(launchRun).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(props.onSelectRun).not.toHaveBeenCalled();
    expect(screen.getByTestId('repo-capture-learnings')).toBeDisabled(); // A2 still starting
    settles[1]!();
    await waitFor(() => expect(props.onSelectRun).toHaveBeenCalledExactlyOnceWith('r-1'));
    listRepos.mockImplementation(() => Promise.resolve({ repos: [REPO] }));
  });

  it('a modified click on a row or a tab keeps the browser’s own behaviour (a new tab)', async () => {
    const navigate = vi.fn();
    render(<RepositoriesPanel navigate={navigate} />);
    await screen.findByTestId('repos-list');
    fireEvent.click(screen.getAllByTestId('repo-row')[0]!, { metaKey: true });
    expect(navigate).not.toHaveBeenCalled();
    cleanup();
    await page('', navigate);
    fireEvent.click(screen.getByTestId('repo-tab-jobs'), { ctrlKey: true });
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('repo-tab-jobs'));
    expect(navigate).toHaveBeenCalledWith('/repo-detail/studio-api?tab=jobs');
  });
});
describe('an app’s own repository (crew’s apps store): marked App, no Index nag', () => {
  it('reads App, says it is an app’s, offers no Index, and the sentence counts it apart', async () => {
    listApps.mockImplementation(() => Promise.resolve({ apps: [{ slug: 'tickets', name: 'Open tickets', repoId: 'tickets' }] }));
    listRepos.mockImplementation(() => Promise.resolve({ repos: [REPO, { ...REPO, id: 'tickets', name: 'tickets' }] }));
    render(<RepositoriesPanel navigate={() => {}} />);
    await screen.findByTestId('repos-list');
    const card = await waitFor(() => { const c = screen.getAllByTestId('repo-card').find((x) => x.getAttribute('data-repo-id') === 'tickets')!; expect(c).toHaveAttribute('data-app', 'true'); return c; });
    expect(within(card).getByTestId('repo-row-app')).toHaveTextContent('App');
    expect(within(card).getByTestId('repo-row-line')).toHaveTextContent('Not indexed (app)');
    expect(within(card).queryByTestId('repo-row-index')).toBeNull();
    expect(screen.getByTestId('repos-sentence').textContent).toMatch(/^2 repositories, 1 belongs to an app\. The other one is /u);
    expect(screen.getByTestId('repos-sentence').textContent).not.toMatch(/not indexed yet/u);
    listApps.mockImplementation(() => Promise.resolve({ apps: [] }));
    listRepos.mockImplementation(() => Promise.resolve({ repos: [REPO] }));
  });

  it('a crew without the apps route marks none (the list is unchanged)', async () => {
    listApps.mockImplementation(() => Promise.reject(new Error('404')));
    listRepos.mockImplementation(() => Promise.resolve({ repos: [{ ...REPO, id: 'tickets', name: 'tickets' }] }));
    listRuns.mockImplementation(() => Promise.resolve({ runs: [] }));
    render(<RepositoriesPanel navigate={() => {}} />);
    const card = (await screen.findAllByTestId('repo-card'))[0]!;
    expect(card).not.toHaveAttribute('data-app');
    expect(within(card).getByTestId('repo-row-index')).toBeInTheDocument();
    listApps.mockImplementation(() => Promise.resolve({ apps: [] }));
    listRepos.mockImplementation(() => Promise.resolve({ repos: [REPO] }));
    listRuns.mockImplementation(() => Promise.resolve({ runs: RUNS }));
  });
});

describe('the repository page names the projects whose jobs used it', () => {
  it('Overview and the header say "used by Mikes’s jobs" when it is not attached there', async () => {
    vi.mocked(trackersApi.links).mockResolvedValue({ ...LINKS, links: [], projects: [] });
    useProjectsStore.setState({ projects: [{ id: 'p-mikes', name: 'Mikes', description: null, status: 'active', scope: '', created_at: 0, updated_at: 0 }] });
    listRuns.mockImplementation(() => Promise.resolve({ runs: [...RUNS, makeView({ id: 'r-m', repo_ref: 'studio-api', workflow_id: 'feature', status: 'completed', project_id: 'p-mikes' } as never)] }));
    await page();
    expect(screen.getByTestId('repo-detail-meta')).toHaveTextContent('used by Mikes’s jobs');
    expect(await screen.findByTestId('repo-overview-job-projects')).toHaveTextContent('Used by Mikes’s jobs; not attached.');
    useProjectsStore.setState({ projects: [] });
    listRuns.mockImplementation(() => Promise.resolve({ runs: RUNS }));
  });
});


describe('withApps: the sentence when some repositories belong to apps', () => {
  it('reads naturally in each shape, with no possessive', async () => {
    const { withApps } = await import('../src/board/repoListRow.js');
    expect(withApps(14, 7, 'Seven repositories. Three are indexed; four need re-indexing. One job waits on you.'))
      .toBe('14 repositories, 7 belong to apps. Of the other 7, three are indexed; four need re-indexing. One job waits on you.');
    expect(withApps(2, 1, 'One repository, indexed and ready.')).toBe('2 repositories, 1 belongs to an app. The other one is indexed and ready.');
    expect(withApps(5, 2, 'Three repositories, all indexed and ready.')).toBe('5 repositories, 2 belong to apps. The other 3 are all indexed and ready.');
    expect(withApps(3, 3, '')).toBe('3 repositories, all belong to apps.');
    expect(withApps(14, 7, 'Seven repositories. Three are indexed.')).not.toMatch(/’/u);
  });
});
