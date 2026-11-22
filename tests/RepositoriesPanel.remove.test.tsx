import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RepoEntry } from '../src/api/types.js';
import { ApiError } from '../src/api/errors.js';
import { REPO_CLEAN } from './fixtures/wave2.js';

/**
 * studio#1253 (crew#1230): Remove on the Repositories page. crew's `DELETE /api/v1/repos/:id` answers (crew
 * `api/routes.ts` the `app.delete(\`${V}/repos/:id\`)` handler): 200 `{repoId, removed: true}`; 404 `{code: 'repo_not_found'}`
 * (no `error`); 409 `{code: 'repo_in_use', error, runIds}` or `{code: 'repo_in_project', error}`; 501
 * `{code: 'repo_unregister_unsupported', error}`.
 */

/** crew's own finding on a repository whose folder is gone (crew `core/repoPaths.ts` withFolderFindings). */
const GONE: RepoEntry = {
  id: 'tiny-math', name: 'tiny-math', root_path: '/w2/lanes/target/tiny-math', default_branch: 'main', registered_at: 1_757_600_000,
  findings: [{
    code: 'repo_folder_missing',
    message: "This repository's folder is missing: /w2/lanes/target/tiny-math. Re-link it: register it again under the same name at its folder's new place, or put the folder back. Or remove the registration (DELETE /api/v1/repos/tiny-math).",
    path: '/w2/lanes/target/tiny-math',
  }],
};

const listRepos = vi.fn(() => Promise.resolve({ repos: [REPO_CLEAN, GONE] }));
const unregisterRepo = vi.fn<(id: string) => Promise<unknown>>((id) => Promise.resolve({ repoId: id, removed: true }));

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => listRepos(),
    listRuns: () => Promise.resolve({ runs: [] }),
    listProjects: () => Promise.resolve({ projects: [] }),
    unregisterRepo: (id: string) => unregisterRepo(id),
  },
}));

const { RepositoriesPanel } = await import('../src/components/RepositoriesPanel.js');
const { useNeedsSources } = await import('../src/store/needsSources.js');
const { clearRepoCache, fetchReposCached, getCachedRepos } = await import('../src/store/repoCache.js');

const card = (id: string): HTMLElement => screen.getAllByTestId('repo-card').find((c) => c.getAttribute('data-repo-id') === id)!;

async function panel(onSelectRun = vi.fn()): Promise<void> {
  render(<RepositoriesPanel navigate={() => {}} onSelectRun={onSelectRun} />);
  await screen.findByTestId('repos-list');
}

beforeEach(() => { listRepos.mockClear(); unregisterRepo.mockClear(); clearRepoCache(); });
afterEach(() => cleanup());

describe('Remove a repository', () => {
  it('every row offers Remove; the confirm says the folder and code map stay; Remove calls DELETE and the row goes', async () => {
    await panel();
    const remove = within(card('billing')).getByTestId('repo-row-remove');
    expect(remove).toHaveAttribute('aria-label', 'Remove billing');
    fireEvent.click(remove);
    const dialog = screen.getByTestId('repo-remove-dialog');
    expect(within(dialog).getByTestId('repo-remove-what').textContent).toMatch(/folder and its code map stay on disk: nothing is deleted/);
    expect(dialog.textContent).toContain('/w2/repos/billing');
    expect(unregisterRepo).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByTestId('repo-remove-confirm'));
    await waitFor(() => expect(screen.queryByTestId('repo-remove-dialog')).toBeNull());
    expect(unregisterRepo).toHaveBeenCalledWith('billing');
    expect(screen.getAllByTestId('repo-card').map((c) => c.getAttribute('data-repo-id'))).toEqual(['tiny-math']);
    expect(useNeedsSources.getState().repos?.map((r) => r.id)).toEqual(['tiny-math']);
  });

  it('Cancel sends nothing', async () => {
    await panel();
    fireEvent.click(within(card('billing')).getByTestId('repo-row-remove'));
    fireEvent.click(screen.getByTestId('repo-remove-cancel'));
    expect(screen.queryByTestId('repo-remove-dialog')).toBeNull();
    expect(unregisterRepo).not.toHaveBeenCalled();
  });

  it('a row whose folder is missing (crew\'s repo_folder_missing) says so, and its step is Remove', async () => {
    await panel();
    const step = within(card('tiny-math')).getByTestId('repo-row-remove');
    expect(step).toHaveAttribute('data-folder-missing', 'true');
    expect(step.textContent).toBe('Remove');
    expect(within(card('tiny-math')).getByTestId('repo-row-line').textContent).toBe('Folder missing');
    expect(within(card('tiny-math')).getByTestId('repo-row-map')).toHaveAttribute('data-tone', 'fail');
    // Indexing a folder that is gone can't run: no Index or Re-index step on that row.
    expect(within(card('tiny-math')).queryByTestId('repo-row-index')).toBeNull();
    expect(within(card('tiny-math')).queryByTestId('repo-row-reindex')).toBeNull();
    expect(step.getAttribute('title')).toMatch(/re-link it: add it again under the same name/);
    expect(within(card('billing')).getByTestId('repo-row-remove')).not.toHaveAttribute('data-folder-missing');
  });

  it('409 repo_in_use: the jobs that hold it are listed, each opens, and the row stays', async () => {
    const onSelectRun = vi.fn();
    unregisterRepo.mockImplementationOnce(() => Promise.reject(new ApiError(409, 'Repository billing is held by non-terminal runs: run-7, run-9',
      { code: 'repo_in_use', error: 'Repository billing is held by non-terminal runs: run-7, run-9', runIds: ['run-7', 'run-9'] })));
    await panel(onSelectRun);
    fireEvent.click(within(card('billing')).getByTestId('repo-row-remove'));
    fireEvent.click(screen.getByTestId('repo-remove-confirm'));
    const refused = await screen.findByTestId('repo-remove-refused');
    expect(refused).toHaveAttribute('data-kind', 'in_use');
    expect(within(refused).getAllByTestId('repo-remove-run').map((b) => b.getAttribute('data-run-id'))).toEqual(['run-7', 'run-9']);
    fireEvent.click(within(refused).getAllByTestId('repo-remove-run')[1]!);
    expect(onSelectRun).toHaveBeenCalledWith('run-9');
    expect(screen.getAllByTestId('repo-card').map((c) => c.getAttribute('data-repo-id'))).toContain('billing');
  });

  it('409 repo_in_project: crew\'s words name the projects', async () => {
    const words = 'repo_in_project: billing belongs to project(s) Payments';
    unregisterRepo.mockImplementationOnce(() => Promise.reject(new ApiError(409, words, { code: 'repo_in_project', error: words })));
    await panel();
    fireEvent.click(within(card('billing')).getByTestId('repo-row-remove'));
    fireEvent.click(screen.getByTestId('repo-remove-confirm'));
    const refused = await screen.findByTestId('repo-remove-refused');
    expect(refused).toHaveAttribute('data-kind', 'in_project');
    expect(within(refused).getByTestId('repo-remove-crew-words').textContent).toBe(words);
    expect(screen.getByTestId('repo-remove-confirm')).not.toBeDisabled();
  });

  it('404 repo_not_found (no error sentence): already gone at crew, so the row goes', async () => {
    unregisterRepo.mockImplementationOnce(() => Promise.reject(new ApiError(404, '', { code: 'repo_not_found' })));
    await panel();
    fireEvent.click(within(card('tiny-math')).getByTestId('repo-row-remove'));
    fireEvent.click(screen.getByTestId('repo-remove-confirm'));
    await waitFor(() => expect(screen.queryByTestId('repo-remove-dialog')).toBeNull());
    expect(screen.getAllByTestId('repo-card').map((c) => c.getAttribute('data-repo-id'))).toEqual(['billing']);
  });

  it('501 repo_unregister_unsupported: says the service is too old', async () => {
    unregisterRepo.mockImplementationOnce(() => Promise.reject(new ApiError(501, 'Removing a repository requires an engine with unregisterRepo; upgrade wicked-core-ts.', { code: 'repo_unregister_unsupported', error: 'x' })));
    await panel();
    fireEvent.click(within(card('billing')).getByTestId('repo-row-remove'));
    fireEvent.click(screen.getByTestId('repo-remove-confirm'));
    expect((await screen.findByTestId('repo-remove-refused')).textContent).toMatch(/can’t remove a repository. Update wicked/);
  });

  it('review r1: a removal empties the pickers\' repository cache, and a list read already out never refills it', async () => {
    await fetchReposCached();
    expect(getCachedRepos()?.map((r) => r.id)).toEqual(['billing', 'tiny-math']);
    let late: (v: unknown) => void = () => undefined;
    await panel();
    // A picker's read goes out (cache cold after this test's clear below), then the removal lands, then the read.
    clearRepoCache();
    listRepos.mockImplementationOnce(() => new Promise((r) => { late = r as (v: unknown) => void; }));
    const out = fetchReposCached();
    fireEvent.click(within(card('billing')).getByTestId('repo-row-remove'));
    fireEvent.click(screen.getByTestId('repo-remove-confirm'));
    await waitFor(() => expect(screen.queryByTestId('repo-remove-dialog')).toBeNull());
    late({ repos: [REPO_CLEAN, GONE] });
    await out;
    expect(getCachedRepos()).toBeNull();
  });

  it('review r1: a removal on its way can\'t be dismissed with Escape', async () => {
    let answer: (v: unknown) => void = () => undefined;
    unregisterRepo.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    await panel();
    fireEvent.click(within(card('billing')).getByTestId('repo-row-remove'));
    fireEvent.click(screen.getByTestId('repo-remove-confirm'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('repo-remove-dialog')).toBeTruthy();
    answer({ repoId: 'billing', removed: true });
    await waitFor(() => expect(screen.queryByTestId('repo-remove-dialog')).toBeNull());
  });
});
