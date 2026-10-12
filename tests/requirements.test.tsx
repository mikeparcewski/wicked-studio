import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import { useState } from 'react';
import type { ChosenRequirement } from '../src/components/product/RequirementsBrowser.js';

/**
 * A project's requirements (crew#371's fold) and the Draft-epics wizard step's picker — the browser the
 * retired Product page (studio#157) handed over (operator 2026-10-12): rows per repository, an unread
 * repo named with crew's reason, crew's window for search and paging, at most COMPOSE_MAX picks, an
 * older daemon said so. The /product address only redirects.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a), apiBase: () => '/api/v1', api: { listProjects: () => Promise.resolve({ projects: [] }) } }));

const { RequirementsBrowser, COMPOSE_MAX, reqKey } = await import('../src/components/product/RequirementsBrowser.js');
const { ProjectRequirementsPage } = await import('../src/components/product/ProjectRequirementsPage.js');
const { useLaunchWizard, resetLaunchWizard, DRAFT_EPICS_ID } = await import('../src/store/launchWizard.js');

/** The browser with its own selection, the way the wizard step and the requirements page hold it. */
function Picker({ navigate = vi.fn() }: { navigate?: (p: string) => void }): React.ReactElement {
  const [chosen, setChosen] = useState<ChosenRequirement[]>([]);
  const map = new Map(chosen.map((r) => [reqKey(r.repoId, r.key), r] as const));
  return <>
    <RequirementsBrowser projectId="shop" navigate={navigate} selection={{ chosen: map, onToggle: (r) => setChosen((c) => c.some((x) => x.key === r.key && x.repoId === r.repoId) ? c.filter((x) => !(x.key === r.key && x.repoId === r.repoId)) : c.length >= COMPOSE_MAX ? c : [...c, r]) }} />
    <p data-testid="picked">{chosen.map((c) => c.title).join(' · ')}</p>
  </>;
}
const { useProjectsStore } = await import('../src/store/projects.js');

const NOW = 1;
const project = (id: string, name: string, status = 'active') => ({ id, name, description: null, status, scope: `project:${id}`, created_at: NOW, updated_at: NOW });
const req = (n: number, extra: Record<string, unknown> = {}) => ({ key: `k${n}`, domain: 'billing', reqId: `REQ-${n}`, title: `Requirement ${n}`, category: 'functional', statement: 's', status: 'draft', risk: false, riskSource: null, edited: false, ...extra });
const totals = { repos: 2, ok: 1, absent: 1, errors: 0, dangling: 0 };
function page(items: unknown[], over: Record<string, unknown> = {}) {
  return {
    projectId: 'shop', offset: 0, limit: 50,
    totals: { ...totals, total: items.length, corpus: items.length },
    rows: [
      { repo: { id: 'r-api', name: 'shop-api' }, state: 'ok', total: items.length, corpus: items.length, orphanedOverrides: 0, items },
      { repo: { id: 'r-web', name: 'shop-web' }, state: 'absent', reason: 'no requirements artifact yet', total: 0, corpus: 0, orphanedOverrides: 0, items: [] },
    ],
    ...over,
  };
}

function wire(handler: (path: string, init?: { method?: string; body?: string }) => unknown): void {
  apiFetch.mockImplementation((path: string, init?: { method?: string; body?: string }) => Promise.resolve().then(() => handler(path, init)));
}

beforeEach(() => {
  apiFetch.mockReset();
  useProjectsStore.setState({ projects: [project('default', 'Unfiled'), project('shop', 'Shop'), project('old', 'Old', 'archived')] as never, loading: false });
});
afterEach(cleanup);

describe('the requirements browser', () => {
  it('lists the requirements per repo and names the unread repo with crew\'s reason', async () => {
    wire(() => page([req(1, { risk: true }), req(2)]));
    render(<RequirementsBrowser projectId="shop" navigate={vi.fn()} />);
    expect(await screen.findByTestId('requirements-totals')).toHaveTextContent('1–2 of 2 requirements · 1 of 2 repositories read');
    expect(apiFetch).toHaveBeenCalledWith('/projects/shop/requirements?limit=50');
    const repo = screen.getByTestId('requirements-repo');
    expect(within(repo).getAllByTestId('requirement').map((r) => r.textContent)).toEqual(['Requirement 1REQ-1 · billing · At risk', 'Requirement 2REQ-2 · billing']);
    expect(screen.getByTestId('requirements-repo-unread')).toHaveTextContent('No requirements map yet for shop-web.');
  });

  it('a project with no repository says so and offers Attach', async () => {
    wire(() => page([], { rows: [], totals: { ...totals, repos: 0, ok: 0, total: 0, corpus: 0 } }));
    const navigate = vi.fn();
    render(<RequirementsBrowser projectId="shop" navigate={navigate} />);
    await screen.findByTestId('requirements-empty');
    await userEvent.click(screen.getByRole('link', { name: 'Attach a repository' }));
    expect(navigate).toHaveBeenCalledWith('/repos/new?project=shop');
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  });

  it('a window past a shrunk corpus keeps Previous (codex on #157)', async () => {
    wire((path) => (path.includes('offset=50')
      ? page([], { offset: 50, totals: { ...totals, total: 40, corpus: 40 } })
      : page([req(1)], { totals: { ...totals, total: 60, corpus: 60 } })));
    render(<RequirementsBrowser projectId="shop" navigate={vi.fn()} />);
    await screen.findByTestId('requirements-repo');
    await userEvent.click(screen.getByTestId('requirements-next'));
    await waitFor(() => expect(screen.getByTestId('requirements-totals')).toHaveTextContent('Past the last of 40 requirements: the list shrank, so go back a page'));
    expect(screen.getByTestId('requirements-prev')).toBeEnabled();
    expect(screen.getByTestId('requirements-next')).toBeDisabled();
  });

  it(`at most ${COMPOSE_MAX} can be chosen; the rest are disabled`, async () => {
    wire(() => page(Array.from({ length: COMPOSE_MAX + 2 }, (_, i) => req(i))));
    render(<Picker />);
    await screen.findByTestId('requirements-repo');
    const picks = screen.getAllByTestId('requirement-pick') as HTMLInputElement[];
    for (const p of picks.slice(0, COMPOSE_MAX)) fireEvent.click(p);
    expect(picks[COMPOSE_MAX]).toBeDisabled();
    expect(picks[0]).toBeEnabled();
  });

  it('search and paging read crew\'s window; the choice survives a page turn', async () => {
    wire((path) => (path.includes('offset=50') ? page([req(51)], { offset: 50, totals: { ...totals, total: 60, corpus: 60 } }) : page([req(1)], { totals: { ...totals, total: 60, corpus: 60 } })));
    render(<Picker />);
    await screen.findByTestId('requirements-repo');
    await userEvent.click(screen.getAllByTestId('requirement-pick')[0]!);
    await userEvent.click(screen.getByTestId('requirements-next'));
    expect(await screen.findByText('Requirement 51')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/projects/shop/requirements?offset=50&limit=50');
    expect(screen.getByTestId('picked')).toHaveTextContent('Requirement 1');
    await userEvent.type(screen.getByTestId('requirements-search'), 'refund{Enter}');
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/projects/shop/requirements?q=refund&limit=50'));
  });

  it('an older daemon (route absent) says so; a refusal says why', async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(404, 'Not Found'));
    render(<RequirementsBrowser projectId="shop" navigate={vi.fn()} />);
    expect(await screen.findByTestId('requirements-absent')).toHaveTextContent('Update Studio’s service');
    cleanup();
    apiFetch.mockRejectedValueOnce(new ApiError(404, 'project shop not found'));
    render(<RequirementsBrowser projectId="shop" navigate={vi.fn()} />);
    expect(await screen.findByTestId('requirements-error')).toHaveTextContent('project shop not found');
  });
});

describe('the requirements page', () => {
  it('Draft epics opens the launch wizard on its Draft epics step with the project and the picks', async () => {
    resetLaunchWizard();
    wire(() => page([req(1), req(2)]));
    render(<ProjectRequirementsPage projectId="shop" navigate={vi.fn()} />);
    await screen.findByTestId('requirements-repo');
    await userEvent.click(screen.getAllByTestId('requirement-pick')[1]!);
    expect(screen.getByTestId('requirements-draft')).toHaveTextContent('Draft epics from 1');
    await userEvent.click(screen.getByTestId('requirements-draft'));
    expect(useLaunchWizard.getState()).toMatchObject({ open: true, draft: { workflowId: DRAFT_EPICS_ID, projectId: 'shop', requirements: [{ repoId: 'r-api', key: 'k2', title: 'Requirement 2' }] } });
  });
});

describe('the retired /product address', () => {
  it('parses to the redirect panel and redirects to the project dashboard or the projects list', async () => {
    const { parseRoute, productRedirectPath, projectRequirementsPath } = await import('../src/hooks/useRoute.js');
    expect(parseRoute('/product').panel).toBe('product');
    expect(parseRoute('/product?project=shop').panel).toBe('product');
    expect(parseRoute('/product/shop').panel).toBe('not-found');
    expect(productRedirectPath('?project=a b')).toBe('/projects/a%20b#requirements');
    expect(productRedirectPath('')).toBe('/everything?tab=projects');
    expect(productRedirectPath('?project=default')).toBe('/everything?tab=projects');
    expect(projectRequirementsPath('a b')).toBe('/projects/a%20b/requirements');
    expect(parseRoute('/projects/shop/requirements')).toMatchObject({ panel: 'project-requirements', projectId: 'shop' });
    expect(parseRoute('/projects/shop').panel).toBe('project-detail');
  });
});

describe('the retired Testing landing (/testing/campaigns)', () => {
  it('opens the launch wizard on the test workflow with the address’s project, over the Desk', async () => {
    const { CampaignsRedirect, TEST_WORKFLOW_ID } = await import('../src/components/RouteRedirect.js');
    const navigate = vi.fn();
    render(<CampaignsRedirect search="?project=shop" navigate={navigate} />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
    expect(useLaunchWizard.getState().draft).toMatchObject({ workflowId: TEST_WORKFLOW_ID, projectId: 'shop' });
    expect(TEST_WORKFLOW_ID).toBe('qe-author-tests');
  });

  it('without a project (or the synthesized default) the wizard opens with none chosen', async () => {
    const { CampaignsRedirect } = await import('../src/components/RouteRedirect.js');
    for (const search of ['', '?project=default']) {
      resetLaunchWizard();
      const { unmount } = render(<CampaignsRedirect search={search} navigate={vi.fn()} />);
      await waitFor(() => expect(useLaunchWizard.getState().draft).not.toBeNull());
      expect(useLaunchWizard.getState().draft?.projectId ?? null).toBeNull();
      unmount();
    }
  });
});

describe('the dashboard’s Requirements section', () => {
  it('counts them, names the repositories not counted, and offers the list and Draft epics', async () => {
    const { ProjectRequirementsSection } = await import('../src/components/product/ProjectRequirementsSection.js');
    const failedRow = { repo: { id: 'r-ops', name: 'shop-ops' }, state: 'error', error: 'read failed', total: 0, corpus: 0, orphanedOverrides: 0, items: [] };
    wire(() => { const p = page([req(1), req(2), req(3)]); return { ...p, totals: { ...p.totals, repos: 3, errors: 1 }, rows: [...p.rows, failedRow] }; });
    const navigate = vi.fn();
    render(<ProjectRequirementsSection projectId="shop" navigate={navigate} />);
    expect(await screen.findByTestId('project-requirements-line')).toHaveTextContent('3 requirements across 1 repository');
    expect(screen.getByTestId('project-requirements-unread')).toHaveTextContent('shop-web has no requirements map yet · shop-ops could not be read.');
    fireEvent.click(screen.getByTestId('project-requirements-link'));
    expect(navigate).toHaveBeenCalledWith('/projects/shop/requirements');
    fireEvent.click(screen.getByTestId('project-draft-epics'));
    expect(useLaunchWizard.getState().draft).toMatchObject({ workflowId: DRAFT_EPICS_ID, projectId: 'shop', requirements: [] });
  });

  it('no repository says so, offers neither the list nor Draft epics; an older daemon draws nothing', async () => {
    const { ProjectRequirementsSection } = await import('../src/components/product/ProjectRequirementsSection.js');
    wire(() => ({ projectId: 'shop', offset: 0, limit: 1, totals: { repos: 0, ok: 0, absent: 0, errors: 0, dangling: 0, total: 0, corpus: 0 }, rows: [] }));
    const { unmount } = render(<ProjectRequirementsSection projectId="shop" navigate={vi.fn()} />);
    expect(await screen.findByTestId('project-requirements-line')).toHaveTextContent('No repository attached yet');
    expect(screen.queryByTestId('project-draft-epics')).toBeNull();
    expect(screen.queryByTestId('project-requirements-unread')).toBeNull();
    unmount();
    wire(() => { throw new ApiError(404, 'Not Found'); });
    const { container } = render(<ProjectRequirementsSection projectId="shop" navigate={vi.fn()} />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('[data-testid="project-requirements"]')).toBeNull());
  });
});

describe('S5 codex code review', () => {
  it('the section, every read failed: the count is incomplete, never "none yet", and the list stays reachable', async () => {
    const { ProjectRequirementsSection } = await import('../src/components/product/ProjectRequirementsSection.js');
    wire(() => ({ projectId: 'shop', offset: 0, limit: 1, totals: { repos: 1, ok: 0, absent: 0, errors: 1, dangling: 0, total: 0, corpus: 0 },
      rows: [{ repo: { id: 'r-api', name: 'shop-api' }, state: 'error', error: 'boom', total: 0, corpus: 0, orphanedOverrides: 0, items: [] }] }));
    render(<ProjectRequirementsSection projectId="shop" navigate={vi.fn()} />);
    expect(await screen.findByTestId('project-requirements-line')).toHaveTextContent('No requirements counted yet.');
    expect(screen.getByTestId('project-requirements-unread')).toHaveTextContent('shop-api could not be read.');
    expect(screen.getByTestId('project-requirements-link')).toBeInTheDocument();
    expect(screen.queryByTestId('project-draft-epics')).toBeNull();
  });

  it('a wizard open naming another project starts fresh, whatever the job', () => {
    resetLaunchWizard();
    useLaunchWizard.getState().openWith({ workflowId: 'qe-author-tests', projectId: 'a' });
    useLaunchWizard.getState().update({ intent: 'cover checkout' });
    useLaunchWizard.getState().openWith({ workflowId: 'qe-author-tests', projectId: 'b' });
    expect(useLaunchWizard.getState().draft).toMatchObject({ projectId: 'b', intent: '' });
    useLaunchWizard.getState().update({ intent: 'cover refunds' });
    useLaunchWizard.getState().openWith({ workflowId: 'qe-author-tests' });
    expect(useLaunchWizard.getState().draft).toMatchObject({ projectId: 'b', intent: 'cover refunds' });
  });
});
