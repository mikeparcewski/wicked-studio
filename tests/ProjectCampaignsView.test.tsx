import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { useRoute } from '../src/hooks/useRoute.js';
import { expectTestVocabulary } from './renameGuard.js';

/**
 * T13 — the project-shell route wiring for the project-scoped Test surface (`/p/:id/campaigns`):
 * `useRoute` parses the address to `{projectId, campaignsView: true}` with NO mode (a project-scoped
 * VIEW, not a fifth verb), and `ProjectCampaignsView` — what App renders for that route — frames
 * `CampaignsPage` with the project, so a "New test" there pre-selects it (T12's contract, reached
 * through the route). The breadcrumb speaks Test (#203); the route + testids keep the backend's
 * `campaigns` vocabulary.
 */

const listCampaigns = vi.fn();
vi.mock('../src/api/campaigns.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/campaigns.js')>()),
  listCampaigns: () => listCampaigns() as Promise<unknown>,
}));

const listProjectMembers = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjects: () => Promise.resolve({
      projects: [{
        id: 'proj-1', name: 'Merge the skins', description: null, status: 'active',
        scope: 'project:proj-1', created_at: 1, updated_at: 1,
      }],
    }),
    listProjectMembers: (...a: unknown[]) => listProjectMembers(...a),
  },
  apiFetch: () => Promise.reject(new Error('not wired in this suite')),
}));

const { ProjectCampaignsView } = await import('../src/components/ProjectCampaignsView.js');
const { useCampaignsStore } = await import('../src/store/campaigns.js');

function routeAt(path: string): ReturnType<typeof useRoute> {
  window.history.replaceState(null, '', path);
  return renderHook(() => useRoute()).result.current;
}

beforeEach(() => {
  listCampaigns.mockReset();
  listCampaigns.mockResolvedValue({ campaigns: [], groups: [] });
  listProjectMembers.mockReset();
  listProjectMembers.mockResolvedValue({
    members: [{ id: 1, project_id: 'proj-1', member_kind: 'crew.repo', member_ref: 'r-1' }],
  });
  useCampaignsStore.setState({ support: 'unknown', campaigns: [], groups: [], live: {} });
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('T13 — useRoute: /p/:projectId/campaigns', () => {
  it('T13 — parses to the project with campaignsView and NO mode/run — the flag selects the surface', () => {
    expect(routeAt('/p/proj-1/campaigns')).toMatchObject({
      projectId: 'proj-1', campaignsView: true, mode: null, runId: null, artifactId: null, showLaunch: false,
    });
  });

  it('T13 — decodes the project id; a mode route and the top-level landing never claim campaignsView', () => {
    expect(routeAt('/p/my%20proj/campaigns')).toMatchObject({ projectId: 'my proj', campaignsView: true });
    expect(routeAt('/p/proj-1/build')).toMatchObject({ projectId: 'proj-1', campaignsView: false, mode: 'build' });
    expect(routeAt('/testing/campaigns')).toMatchObject({ panel: 'testing', projectId: null, campaignsView: false });
  });
});

describe('T13 — ProjectCampaignsView: the project frames the test landing', () => {
  it('T13 — renders the project-campaigns container for the project, a "Tests" crumb, and a back door to the dashboard', async () => {
    const navigate = vi.fn();
    render(<ProjectCampaignsView projectId="proj-1" runs={[]} navigate={navigate} />);
    expect(screen.getByTestId('project-campaigns')).toHaveAttribute('data-project-id', 'proj-1');
    expect(screen.getByTestId('project-campaigns-crumb')).toHaveTextContent('Tests');
    fireEvent.click(screen.getByTestId('project-campaigns-back'));
    expect(navigate).toHaveBeenCalledWith('/p/proj-1');
    // The landing mounts inside it — its probe runs and the page renders.
    await screen.findByTestId('campaigns-page');
  });

  it('T13 → T12 — "New test" from the project shell pre-selects THIS project and resolves its repos as via-project chips', async () => {
    render(<ProjectCampaignsView projectId="proj-1" runs={[]} navigate={() => {}} />);
    await screen.findByTestId('campaigns-page');
    fireEvent.click(screen.getByTestId('testing-campaign-open'));
    const panel = await screen.findByTestId('testing-launch-panel');
    const select = within(panel).getByTestId('testing-launch-project') as HTMLSelectElement;
    await within(select).findByRole('option', { name: 'Merge the skins' });
    expect(select.value).toBe('proj-1');
    expect(listProjectMembers).toHaveBeenCalledWith('proj-1');
    const chips = await within(panel).findAllByTestId('testing-launch-chip');
    expect(chips.map((c) => c.dataset.repo)).toEqual(['r-1']);
    expect(chips[0]!.dataset.source).toBe('project');
  });

  it('T30 — nothing rendered in the project frame says "Campaign" (the route + testids keep the word; the copy does not)', async () => {
    render(<ProjectCampaignsView projectId="proj-1" runs={[]} navigate={() => {}} />);
    await screen.findByTestId('campaigns-page');
    expectTestVocabulary(screen.getByTestId('project-campaigns'));
  });
});
