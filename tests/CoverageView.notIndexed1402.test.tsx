/**
 * studio#1402: Understand → Coverage on a repository not indexed yet. Crew answers its coverage read
 * `404 {code: 'not_indexed'}` (crew#1887 keeps that route's 404), and its graph summary either `200 {kinds: [], code:
 * 'not_indexed', error}` (crew#1887) or, on a daemon before it, the same 404. Both bodies are the route's own
 * (packages/crew/src/api/routes.ts at crew#1887 head d8177de5: NOT_INDEXED = { error: 'this repository has no code
 * graph yet: index it first', code: 'not_indexed' }). The pane says plainly that the repository is not indexed yet:
 * never "Coverage couldn't be read" with Try again, and never the "run wicked-core rules ingest" line.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import { CoverageView } from '../src/components/CoverageView.js';

const NOT_INDEXED = { error: 'this repository has no code graph yet: index it first', code: 'not_indexed' } as const;
const notIndexed404 = (): ApiError => new ApiError(404, NOT_INDEXED.error, NOT_INDEXED);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [{ id: 'fresh', name: 'fresh', root_path: '/r/fresh', default_branch: 'main', registered_at: 1 }] } as never);
  vi.spyOn(client.api, 'getCoverageReport').mockResolvedValue({ report: null } as never);
});
afterEach(cleanup);

async function pick(): Promise<void> {
  render(<CoverageView />);
  await screen.findByRole('option', { name: 'fresh' });
  await waitFor(() => expect(screen.getByLabelText('Coverage repo')).not.toBeDisabled());
  await act(async () => { fireEvent.change(screen.getByLabelText('Coverage repo'), { target: { value: 'fresh' } }); });
}

describe('Coverage on a repository not indexed yet (studio#1402)', () => {
  it.each([
    ['crew#1887: graph 200 not_indexed', () => Promise.resolve({ kinds: [], ...NOT_INDEXED })],
    ['an older daemon: graph 404 not_indexed', () => Promise.reject(notIndexed404())],
  ])('%s, coverage 404 not_indexed: says it is not indexed yet, not a failed read', async (_name, graph) => {
    vi.spyOn(client.api, 'getCoverageReportForRepo').mockRejectedValue(notIndexed404());
    vi.spyOn(client.api, 'getGraphKindsForRepo').mockImplementation(graph as never);
    await pick();
    const note = await screen.findByTestId('coverage-not-indexed');
    expect(note).toHaveTextContent('fresh is not indexed yet, so there is no coverage to measure. Indexing the repository builds its code graph.');
    expect(screen.queryByTestId('coverage-error')).toBeNull();
    expect(screen.queryByText(/rules ingest/)).toBeNull();
  });

  it('any other refusal is still a failed read with Try again', async () => {
    vi.spyOn(client.api, 'getCoverageReportForRepo').mockRejectedValue(new ApiError(404, "no registered repo 'fresh'", { error: "no registered repo 'fresh'" }));
    vi.spyOn(client.api, 'getGraphKindsForRepo').mockResolvedValue({ kinds: [] } as never);
    await pick();
    expect(await screen.findByTestId('coverage-error')).toBeInTheDocument();
    expect(screen.queryByTestId('coverage-not-indexed')).toBeNull();
  });
});
