import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { useRoute } from '../src/hooks/useRoute.js';

/**
 * S16a-4f/4h — a project's tests: `/p/:id/campaigns` moved onto Testing (`?project=`), whose launch
 * panel preselects the project (T12's contract, reached through the address). Successor of the
 * retired ProjectCampaignsView suite (T13).
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

const { TestingPage } = await import('../src/components/TestingPage.js');
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

describe('S16a-4f — /p/:projectId/campaigns MOVED onto Testing (?project=)', () => {
  it('parses to the Testing landing — no project shell (useMovedRoutes replaces it)', () => {
    expect(routeAt('/p/proj-1/campaigns')).toMatchObject({
      panel: 'testing', testingPage: 'campaigns', runId: null, artifactId: null, showLaunch: false,
    });
    expect(routeAt('/p/proj-1/campaigns/x').panel).toBe('not-found');
    expect(routeAt('/testing/campaigns')).toMatchObject({ panel: 'testing', projectId: null });
  });

  it('the Testing landing\'s `?project=` preselects THIS project in a new test\'s launch panel', async () => {
    render(<TestingPage page="campaigns" campaignId={null} runs={[]} navigate={() => {}} projectId="proj-1" />);
    await screen.findByTestId('campaigns-page');
    fireEvent.click(screen.getByTestId('testing-campaign-open'));
    const panel = await screen.findByTestId('testing-launch-panel');
    const select = within(panel).getByTestId('testing-launch-project') as HTMLSelectElement;
    await within(select).findByRole('option', { name: 'Merge the skins' });
    expect(select.value).toBe('proj-1');
  });

  it('without `?project=` nothing is preselected', async () => {
    render(<TestingPage page="campaigns" campaignId={null} runs={[]} navigate={() => {}} />);
    await screen.findByTestId('campaigns-page');
    fireEvent.click(screen.getByTestId('testing-campaign-open'));
    const panel = await screen.findByTestId('testing-launch-panel');
    const select = within(panel).getByTestId('testing-launch-project') as HTMLSelectElement;
    await within(select).findByRole('option', { name: 'Merge the skins' });
    expect(select.value).toBe('');
  });
});
