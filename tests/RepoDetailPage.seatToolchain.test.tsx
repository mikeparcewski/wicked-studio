import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepoEntry } from '../src/api/types.js';

/**
 * wicked-core#1043 on the repo page: Settings shows the Seat toolchain card from the row `GET /repos` serves, and a
 * switch replaces the page's row with crew's answer (`PUT /repos/:id/seat-layers` answers the row as `GET /repos`
 * shows it). Rows in core's shape (core src/repo.rs:82-108, src/seat_layers.rs:382-408).
 */

const ROW = (offNode: boolean): RepoEntry => ({
  id: 'shop', name: 'shop', root_path: '/srv/shop', default_branch: 'main', registered_at: 1_764_000_000, findings: [],
  seat_layers: [
    { id: 'node', enabled: !offNode, off_by: offNode ? 'repo' : null },
    { id: 'python', enabled: true, off_by: null },
  ],
  ...(offNode ? { seat_layers_off: ['node'] } : {}),
} as unknown as RepoEntry);

const setRepoSeatLayers = vi.fn(async (_id: string, off: string[]) => ROW(off.includes('node')));

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => Promise.resolve({ repos: [ROW(false)] }),
    listRuns: () => Promise.resolve({ runs: [] }),
    getRepoGraph: () => Promise.resolve({ graph: null }),
    getRepoGitHistory: () => Promise.resolve({ commits: [] }),
    getRepoContributors: () => Promise.resolve({ contributors: [] }),
    getGraphKindsForRepo: () => Promise.resolve({ kinds: [] }),
    listRequirements: () => Promise.reject(new Error('no requirements in this suite')),
    listProjects: () => Promise.resolve({ projects: [] }),
    listApps: () => Promise.resolve({ apps: [] }),
    setRepoSeatLayers: (id: string, off: string[]) => setRepoSeatLayers(id, off),
  },
  apiFetch: () => Promise.reject(new Error('not in this suite')),
}));

const { RepoDetailPage } = await import('../src/components/RepoDetailPage.js');

afterEach(() => { cleanup(); setRepoSeatLayers.mockClear(); });

describe('the repo page\'s Seat toolchain card (core#1043)', () => {
  it('Settings shows the layers, and a switch shows crew\'s answer', async () => {
    render(<RepoDetailPage repoId="shop" onSelectRun={() => {}} navigate={() => {}} onOpenGraph={() => {}} search="?tab=settings" />);
    const card = await screen.findByTestId('repo-seat-layers');
    const node = within(card).getByRole('switch', { name: 'Node.js' });
    expect(node).toHaveAttribute('aria-checked', 'true');
    await act(async () => { fireEvent.click(node); });
    expect(setRepoSeatLayers).toHaveBeenCalledWith('shop', ['node']);
    expect(within(screen.getByTestId('repo-seat-layers')).getByRole('switch', { name: 'Node.js' })).toHaveAttribute('aria-checked', 'false');
  });

  it('other tabs do not show it', async () => {
    render(<RepoDetailPage repoId="shop" onSelectRun={() => {}} navigate={() => {}} onOpenGraph={() => {}} search="?tab=jobs" />);
    await screen.findByRole('heading', { name: 'shop' });
    expect(screen.queryByTestId('repo-seat-layers')).toBeNull();
  });
});
