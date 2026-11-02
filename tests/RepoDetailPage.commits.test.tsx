import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepoDetailPage } from '../src/components/RepoDetailPage.js';
import type { GitCommit } from '../src/api/types.js';

// Lane repo-page: on the rig, wicked-crew's 20 recent commits pushed Contributors (and the page) far
// down. The card shows about six rows and scrolls inside; "Show all" opens the full list.
const getRepoGitHistory = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => Promise.resolve({ repos: [{ id: 'r1', name: 'wicked-crew', root_path: '/repos/wicked-crew', default_branch: 'main', git_url: 'https://github.com/o/wicked-crew.git' }] }),
    listRuns: () => Promise.resolve({ runs: [] }),
    getRepoGraph: () => Promise.resolve({ graph: null }),
    getRepoContributors: () => Promise.resolve({ contributors: [] }),
    getRepoGitHistory: (...a: unknown[]) => getRepoGitHistory(...a),
  },
}));

function commits(n: number): GitCommit[] {
  return Array.from({ length: n }, (_, i) => ({
    sha: `${i.toString(16).padStart(7, '0')}${'0'.repeat(33)}`,
    shortSha: i.toString(16).padStart(7, '0'),
    message: `commit ${i}`,
    author: 'Mika Ellis',
    date: `${i + 1} hours ago`,
  }));
}

function renderPage(): void {
  render(<RepoDetailPage repoId="r1" onSelectRun={() => {}} navigate={() => {}} onOpenGraph={() => {}} />);
}

describe('Recent commits on the repository page', () => {
  beforeEach(() => {
    getRepoGitHistory.mockReset().mockImplementation((_id: string, limit?: number) =>
      Promise.resolve({ commits: commits(limit === undefined ? 20 : 45) }));
  });

  it('keeps the list to a fixed-height card that scrolls, with Show all', async () => {
    renderPage();
    const list = await screen.findByTestId('repo-commits');
    expect(list).toHaveClass('wk-pg-repo-commits--capped');
    expect(list.querySelectorAll('li')).toHaveLength(20);
    expect(screen.getByTestId('repo-commits-show-all')).toHaveTextContent('Show all');
    expect(getRepoGitHistory).toHaveBeenCalledWith('r1');
  });

  it('Show all opens the full list, read with a larger limit', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('repo-commits-show-all'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('wicked-crew · commits')).toBeInTheDocument();
    expect(getRepoGitHistory).toHaveBeenLastCalledWith('r1', 500);
    await waitFor(() => expect(within(dialog).getByTestId('repo-commits-all').querySelectorAll('li')).toHaveLength(45));
    expect(within(dialog).getByTestId('repo-commits-all-note')).toHaveTextContent('The latest 45 commits, newest first.');
    expect(within(dialog).getByTestId('repo-commits-all')).not.toHaveClass('wk-pg-repo-commits--capped');
  });

  it('keeps the commits it has when the longer read fails', async () => {
    const user = userEvent.setup();
    getRepoGitHistory.mockImplementation((_id: string, limit?: number) =>
      limit === undefined ? Promise.resolve({ commits: commits(20) }) : Promise.reject(new Error('down')));
    renderPage();
    await user.click(await screen.findByTestId('repo-commits-show-all'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('repo-commits-all-note')).toHaveTextContent('Couldn’t load more; showing the latest 20.'));
    expect(within(dialog).getByTestId('repo-commits-all').querySelectorAll('li')).toHaveLength(20);
  });

  it('a short history needs no Show all', async () => {
    getRepoGitHistory.mockResolvedValue({ commits: commits(4) });
    renderPage();
    expect(await screen.findByTestId('repo-commits')).toBeInTheDocument();
    expect(screen.queryByTestId('repo-commits-show-all')).not.toBeInTheDocument();
  });
});
