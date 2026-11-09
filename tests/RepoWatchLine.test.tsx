// crew-0183 (codex r3): the repo page's linked "waiting" line keeps the stale-read qualifier.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { RepoWatchLine } from '../src/components/RepoWatchLine.js';
import { resetRepoWatch, useRepoWatchStore, type RepoWatchStatus } from '../src/api/repoWatch.js';

afterEach(() => { cleanup(); resetRepoWatch(); });

const status: RepoWatchStatus = {
  enabled: true, disabledBy: null, cap: 24, covers: 'x',
  repos: [{ repoId: 'r1', state: 'waiting-runs', enabled: true, lastIndexedAt: null, lastPolledAt: null, changedAt: null, waitingOn: [{ runId: '08f62510-aaaa', reason: 'executing' }], error: null, remedy: null }],
};

describe('RepoWatchLine', () => {
  it('names the job and says when the read is stale', () => {
    useRepoWatchStore.setState({ status, failed: true });
    render(<RepoWatchLine status={status} repoId="r1" now={1} navigate={() => undefined} />);
    expect(screen.getByTestId('repo-watch-run')).toHaveTextContent('job 08f62510');
    expect(screen.getByTestId('repo-watch')).toHaveTextContent('couldn’t refresh this just now');
  });

  it('says nothing stale when the read is fine', () => {
    useRepoWatchStore.setState({ status, failed: false });
    render(<RepoWatchLine status={status} repoId="r1" now={1} navigate={() => undefined} />);
    expect(screen.getByTestId('repo-watch')).not.toHaveTextContent('couldn’t refresh');
  });
});
