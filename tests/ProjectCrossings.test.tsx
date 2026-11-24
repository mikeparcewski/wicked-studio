import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../src/api/errors.js';
import type { ProjectBlastRadiusWire, ProjectGraphBoundaries, ProjectGraphPath } from '../src/api/projectGraph-wire.js';

/**
 * studio#1079 (estate#414 X3s, the package part): the project page's "Across repositories" card over crew's project
 * graph answers. The fixtures are what crew's writers return (crew `packages/crew/src/projects/graph.ts`):
 * `projectGraphBoundaries` (:1932-1972, its return at :1958-1970, possible rows from each member's
 * `boundaries` map sorted repo/reason/package), `projectBlastRadius` (:1731-1803, its return at :1782-1802,
 * `crossings` estate's id/depth/from/to/hops/evidence, api-types `ProjectGraphCrossing`) and `projectGraphPath`
 * (:1889-1930), with the inputs of crew's own route test (`packages/crew/tests/project-graph-boundaries.test.ts`
 * :33-43: members api and web, a stale link generation 4, a `previous failure`).
 */

const BOUNDARIES: ProjectGraphBoundaries = {
  projectId: 'p1', linked: true, generation: 4, stale: true, stale_labels: ['web'], last_error: 'previous failure',
  members: [
    { repoId: 'r-api', repo: 'api', links_out: 2, package_imports: 3, manifests: 1 },
    { repoId: 'r-web', repo: 'web', links_in: 2, incomplete: true, boundary_counts: { unresolved: 2 } },
  ],
  possible: [
    { repoId: 'r-api', repo: 'api', reason: 'undeclared', package: 'pkg' },
    { repoId: 'r-web', repo: 'web', reason: 'unresolved', package: 'a' },
    { repoId: 'r-web', repo: 'web', reason: 'unresolved', package: 'z' },
  ],
  note: 'possible = imports estate could not prove are links to another member, by reason; never edges',
};

const crossing = {
  id: 'x1', depth: 1, from: { repo: 'web', symbol: 'web::src/board.ts::loadBoard' }, to: { repo: 'api', symbol: 'api::src/routes.ts::listRuns' },
  hops: [{ kind: 'imports', resolved_by: 'package-link' }],
  evidence: { identity: 'path', package: 'wicked-api', ecosystem: 'npm', confidence: 0.95, ranks: 'package-manifest' },
};
const BLAST: ProjectBlastRadiusWire = {
  depth_horizon_reached: true, searched_depth: 3,
  resolved: true,
  freshness: { stale_files: [{ repoId: 'r-web', repo: 'web', file: 'src/board.ts', status: 'modified' }], stale_files_total: 1, checked_files: 40, not_file_backed: 0 },
  projectId: 'p1', target: 'listRuns',
  dependents: [
    { repoId: 'r-api', repo: 'api', id: 'api::src/server.ts::serve', name: 'serve', kind: 'function', file: 'src/server.ts', line: 12, depth: 1 },
    { repoId: 'r-web', repo: 'web', id: 'web::src/board.ts::loadBoard', name: 'loadBoard', kind: 'function', file: 'src/board.ts', line: 30, depth: 2, via_crossing: 'x1', stale: 'modified' },
    { repoId: 'r-web', repo: 'web', id: 'web::src/feed.ts::feed', name: 'feed', kind: 'function', file: 'src/feed.ts', line: 4, depth: 3, via_crossing: 'x9', via_crossing_omitted: true },
  ],
  byRepo: [{ repoId: 'r-api', repo: 'api', count: 1 }, { repoId: 'r-web', repo: 'web', count: 2 }],
  unresolved: 2, reposSearched: ['api', 'web'], missingRepos: ['r-docs'],
  linkage: 'linked', note: 'linked note',
  crossings: [crossing], crossings_total: 2, crossings_truncated: true,
  link_stale: true, link_stale_labels: ['web'],
};
const end = (repo: string, name: string) => ({ repoId: `r-${repo}`, repo, symbol: `sym-${name}`, name, kind: 'Function', file: `src/${name}.ts`, line: 7 });
const PATH: ProjectGraphPath = {
  projectId: 'p1', from: 'a', to: 'b', found: true, resolved: true, unresolved: null,
  hops: [{ source: end('api', 'a'), target: end('api', 'mid'), kind: 'calls' }, { source: end('api', 'mid'), target: end('web', 'b'), kind: 'calls', confidence: 0.9 }],
  depth_bounded: false, node_bounded: false, crossings: [], reposSearched: ['api', 'web'], missingRepos: [],
  linkage: 'co-located', note: 'n',
};

/** The parent's ProjectGraphStatus.repos: crew's member ids, labels, and per-member cause and remedy. */
const REPOS = [
  { repoId: 'r-api', label: 'api', rootPath: '~/src/api', indexed: true },
  { repoId: 'r-web', label: 'web', rootPath: '~/src/web', indexed: true },
  { repoId: 'r-docs', label: 'docs', rootPath: '~/src/docs', indexed: false, reason: 'attached since the last refresh', remedy: 'Refresh the code graph to index it.' },
];

const getProjectGraphBoundaries = vi.fn();
const getProjectBlastRadius = vi.fn();
const getProjectGraphPath = vi.fn();
vi.mock('../src/api/client.js', () => ({ api: { getProjectGraphBoundaries, getProjectBlastRadius, getProjectGraphPath } }));
const { ProjectCrossings } = await import('../src/components/ProjectCrossings.js');

beforeEach(() => {
  getProjectGraphBoundaries.mockReset().mockResolvedValue(BOUNDARIES);
  getProjectBlastRadius.mockReset().mockResolvedValue(BLAST);
  getProjectGraphPath.mockReset().mockResolvedValue(PATH);
});
afterEach(cleanup);

async function ask(name: string): Promise<HTMLElement> {
  fireEvent.change(screen.getByTestId('project-crossings-name'), { target: { value: name } });
  fireEvent.click(screen.getByTestId('project-crossings-ask'));
  return screen.findByTestId('project-crossings-blast');
}

describe('the links between repositories', () => {
  it('names each member\'s links, says the links are stale, and lists what might also depend (never as a dependency)', async () => {
    render(<ProjectCrossings projectId="p1" />);
    const links = await screen.findByTestId('project-crossings-links');
    expect(getProjectGraphBoundaries).toHaveBeenCalledWith('p1');
    expect(within(links).getAllByRole('listitem').map((l) => l.textContent)).toEqual([
      'api: 2 links out', 'web: 2 links in, linking incomplete',
    ]);
    expect(screen.getByTestId('project-crossings-stale').textContent).toBe(
      // codex r1: crew marks links stale for a changed member OR a failed link step; the words cover both.
      'The links between repositories are out of date (web): a repository changed since they were built, or the last linking step failed. A crossing may be missing. Refresh the code graph to relink them.');
    const possible = screen.getByTestId('project-crossings-possible');
    expect(possible.textContent).toContain('Might also depend on another repository: 3 imports estate couldn’t prove are links, so they are not counted as dependencies.');
    expect(within(possible).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['api imports pkg (undeclared)', 'web imports a (unresolved)', 'web imports z (unresolved)']);
    expect(screen.getByText('The last linking step failed; these are the links from before it.')).toBeInTheDocument();
  });

  it('a project never linked says so and how', async () => {
    getProjectGraphBoundaries.mockResolvedValue({ projectId: 'p1', linked: false, possible: [], members: [], note: 'this project has not been linked yet; refresh its code graph' });
    render(<ProjectCrossings projectId="p1" />);
    expect((await screen.findByTestId('project-crossings-unlinked')).textContent).toContain('aren’t linked yet');
    expect(screen.queryByTestId('project-crossings-links')).toBeNull();
  });

  it('a crew without the route says wicked needs an update', async () => {
    getProjectGraphBoundaries.mockRejectedValue(new ApiError(404, 'Not Found', { error: 'Not Found' }));
    render(<ProjectCrossings projectId="p1" />);
    expect((await screen.findByTestId('project-crossings-links-error')).textContent).toContain('Update wicked');
  });
});

describe('what depends on a symbol across repositories', () => {
  it('groups dependents by repository, lists the package crossing, and marks a dependent reached through one', async () => {
    render(<ProjectCrossings projectId="p1" />);
    await screen.findByTestId('project-crossings-links');
    const ans = await ask(' listRuns ');
    expect(getProjectBlastRadius).toHaveBeenCalledWith('p1', 'listRuns');
    expect(ans).toHaveAttribute('data-linkage', 'linked');
    expect(ans.textContent).toContain('3 dependents of listRuns in 2 repositories: api 1 · web 2');
    // agy r1: the heading sits outside the list, so the list holds only crossings.
    expect(within(screen.getByTestId('project-crossings-crossings')).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Crossings between repositories')).toBeInTheDocument();
    expect(screen.getByTestId('project-crossings-crossing').textContent).toBe('web → api through package wicked-api (matched by path, confidence 0.95)');
    const web = screen.getAllByTestId('project-crossings-repo').find((r) => r.dataset.repo === 'web')!;
    expect(within(web).getAllByRole('listitem')[0]!.textContent).toBe('loadBoard src/board.ts:30 · reached from another repository · file modified since indexed');
    // agy r1: a dependent whose crossing is omitted (no id) is still marked.
    expect(within(web).getAllByRole('listitem')[1]!.textContent).toBe('feed src/feed.ts:4 · reached from another repository');
  });

  it('says what it could not place, that the links are stale and that files changed', async () => {
    render(<ProjectCrossings projectId="p1" repos={REPOS} />);
    await ask('listRuns');
    // The links card already says the links are stale (BOUNDARIES.stale): the answer does not repeat it.
    expect(screen.getByTestId('project-crossings-stale')).toBeInTheDocument();
    expect(screen.queryByTestId('project-crossings-blast-stale')).toBeNull();
    expect(screen.getByTestId('project-crossings-blast-changed').textContent).toBe('Files have changed since they were indexed (1 counted; a file can count more than once). This answer may be out of date; refresh the code graph.');
    expect(within(screen.getByTestId('project-crossings-unplaced')).getAllByRole('listitem').map((l) => l.textContent)).toEqual([
      // codex r1: crew's missingRepos are member ids; each is named with crew's own cause and remedy.
      'Not searched: docs (attached since the last refresh). Refresh the code graph to index it.',
      'Linking is incomplete for web, so a crossing may be missing.',
      '2 crossings were taken; 1 is listed.',
      '1 dependent was reached through a crossing that is not listed.',
      'The search stopped at 3 hops; more dependents lie beyond it.',
      '2 references to it couldn’t be placed on any symbol, so the impact may be larger.',
    ]);
  });

  it('stale links are said on the answer when the links card could not say them', async () => {
    getProjectGraphBoundaries.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<ProjectCrossings projectId="p1" />);
    await screen.findByTestId('project-crossings-links-error');
    await ask('listRuns');
    expect(screen.getByTestId('project-crossings-blast-stale').textContent).toContain('out of date (web)');
    // Whether the links are built is unknown here, so nothing is said to cross or not.
    expect(screen.getByTestId('project-crossings-unplaced').textContent).toContain('Whether the repositories are linked couldn’t be read');
  });

  it('a co-located answer says no crossing was taken; an unknown name says it must match exactly', async () => {
    // Built and complete links (the answer's own coverage): only then is "no crossing" said.
    getProjectBlastRadius.mockResolvedValueOnce({ ...BLAST, crossings: [], crossings_total: 0, crossings_truncated: undefined, linkage: 'co-located', dependents: BLAST.dependents.slice(0, 1), byRepo: [BLAST.byRepo[0]!], coverage: [{ repoId: 'r-api', repo: 'api', links_out: 0 }, { repoId: 'r-web', repo: 'web', links_in: 0 }] });
    render(<ProjectCrossings projectId="p1" />);
    await ask('listRuns');
    expect(screen.getByTestId('project-crossings-none')).toBeInTheDocument();
    getProjectBlastRadius.mockResolvedValueOnce({ ...BLAST, resolved: false, target: 'nope', dependents: [], byRepo: [], freshness: undefined });
    fireEvent.change(screen.getByTestId('project-crossings-name'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByTestId('project-crossings-ask'));
    await waitFor(() => expect(screen.getByTestId('project-crossings-blast')).toHaveAttribute('data-resolved', 'false'));
    // codex r1: scoped to the repositories searched, with the member that was not.
    expect(screen.getByTestId('project-crossings-blast').textContent).toBe('No symbol is named nope in the repositories searched (api, web). The name must match exactly.Not searched: r-docs.');
  });

  it('codex r1: new files not yet indexed are said, even with no changed file and no dependent', async () => {
    getProjectBlastRadius.mockResolvedValueOnce({ ...BLAST, dependents: [], byRepo: [], freshness: { stale_files_total: 0, unindexed_files: 1, checked_files: 40, not_file_backed: 0 } });
    render(<ProjectCrossings projectId="p1" />);
    await ask('listRuns');
    expect(screen.getByTestId('project-crossings-blast-changed').textContent).toBe('1 file isn’t indexed yet, so symbols and dependents in it are missing. This answer may be out of date; refresh the code graph.');
    expect(screen.getByTestId('project-crossings-blast').textContent).toContain('Nothing found that depends on listRuns in the repositories searched (api, web).');
  });

  it('codex r1 + agy r1: an empty crossing list is never "nothing crossed" when crossings were taken, or the links are not built', async () => {
    getProjectBlastRadius.mockResolvedValueOnce({ ...BLAST, crossings: [], crossings_total: 1, crossings_truncated: true, coverage: [{ repoId: 'r-api', repo: 'api' }, { repoId: 'r-web', repo: 'web' }] });
    render(<ProjectCrossings projectId="p1" />);
    await ask('listRuns');
    expect(screen.queryByTestId('project-crossings-none')).toBeNull();
    expect(screen.getByTestId('project-crossings-unplaced').textContent).toContain('1 crossing was taken; 0 are listed.');
    cleanup();
    getProjectGraphBoundaries.mockResolvedValue({ projectId: 'p1', linked: false, possible: [], members: [], note: 'n' });
    getProjectBlastRadius.mockResolvedValueOnce({ ...BLAST, crossings: [], crossings_total: 0, crossings_truncated: undefined, linkage: 'co-located', dependents: BLAST.dependents.slice(0, 1) });
    render(<ProjectCrossings projectId="p1" />);
    await screen.findByTestId('project-crossings-unlinked');
    await ask('listRuns');
    expect(screen.queryByTestId('project-crossings-none')).toBeNull();
    expect(screen.getByTestId('project-crossings-unplaced').textContent).toContain('The repositories aren’t linked, so nothing reached through another repository could be followed.');
  });

  it('codex r2: a miss keeps the freshness that explains it (the symbol may be in a file not indexed yet)', async () => {
    getProjectBlastRadius.mockResolvedValueOnce({ ...BLAST, resolved: false, target: 'brandNew', dependents: [], byRepo: [], missingRepos: [], freshness: { stale_files_total: 0, unindexed_files: 2, indexing: ['web'], checked_files: 40, not_file_backed: 0 } });
    render(<ProjectCrossings projectId="p1" />);
    await ask('brandNew');
    expect(screen.getByTestId('project-crossings-blast-changed').textContent).toBe('2 files aren’t indexed yet, so symbols and dependents in them are missing. Indexing is running or was interrupted for web. This answer may be out of date; refresh the code graph.');
  });

  it('codex r2: a first link that published nothing (generation 0) is not built, and member rows without counts prove nothing', async () => {
    getProjectGraphBoundaries.mockResolvedValue({ ...BOUNDARIES, generation: 0, stale: false, members: [{ repoId: 'r-api', repo: 'api' }, { repoId: 'r-web', repo: 'web' }] });
    getProjectBlastRadius.mockResolvedValueOnce({ ...BLAST, crossings: [], crossings_total: 0, crossings_truncated: undefined, linkage: 'co-located', dependents: BLAST.dependents.slice(0, 1), link_stale: undefined });
    render(<ProjectCrossings projectId="p1" />);
    await screen.findByTestId('project-crossings-links');
    await ask('listRuns');
    expect(screen.queryByTestId('project-crossings-none')).toBeNull();
    expect(screen.getByTestId('project-crossings-unplaced').textContent).toContain('The repositories aren’t linked');
    cleanup();
    // Built, but crew's rows carry no estate counts: completeness is unknown, so "no crossing" is not said either.
    getProjectGraphBoundaries.mockResolvedValue({ ...BOUNDARIES, stale: false, members: [{ repoId: 'r-api', repo: 'api' }, { repoId: 'r-web', repo: 'web' }] });
    getProjectBlastRadius.mockResolvedValueOnce({ ...BLAST, crossings: [], crossings_total: 0, crossings_truncated: undefined, linkage: 'co-located', dependents: BLAST.dependents.slice(0, 1), link_stale: undefined });
    render(<ProjectCrossings projectId="p1" />);
    await screen.findByTestId('project-crossings-links');
    await ask('listRuns');
    expect(screen.queryByTestId('project-crossings-none')).toBeNull();
    expect(screen.getByTestId('project-crossings-unplaced').textContent).toContain('Whether linking covered every repository isn’t known');
  });

  it('a graph that cannot answer shows crew\'s own standing sentence', async () => {
    getProjectBlastRadius.mockRejectedValue(new ApiError(404, 'x', { error: 'x', status: { detail: 'This project’s code graph has not been built yet. Build it from the project page.' } }));
    render(<ProjectCrossings projectId="p1" />);
    await screen.findByTestId('project-crossings-links');
    fireEvent.change(screen.getByTestId('project-crossings-name'), { target: { value: 'listRuns' } });
    fireEvent.click(screen.getByTestId('project-crossings-ask'));
    expect((await screen.findByTestId('project-crossings-blast-error')).textContent).toContain('has not been built yet');
  });

  it('a late answer for an earlier question never replaces the latest', async () => {
    let first: (v: ProjectBlastRadiusWire) => void = () => undefined;
    getProjectBlastRadius.mockImplementationOnce(() => new Promise((r) => { first = r; }));
    render(<ProjectCrossings projectId="p1" />);
    await screen.findByTestId('project-crossings-links');
    fireEvent.change(screen.getByTestId('project-crossings-name'), { target: { value: 'old' } });
    fireEvent.submit(screen.getByTestId('project-crossings-name').closest('form')!);
    getProjectBlastRadius.mockResolvedValueOnce({ ...BLAST, target: 'newer' });
    fireEvent.change(screen.getByTestId('project-crossings-name'), { target: { value: 'newer' } });
    fireEvent.submit(screen.getByTestId('project-crossings-name').closest('form')!);
    await waitFor(() => expect(screen.getByTestId('project-crossings-blast').textContent).toContain('of newer'));
    first({ ...BLAST, target: 'old' });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('project-crossings-blast').textContent).toContain('of newer');
  });
});

describe('a route from one symbol to another', () => {
  it('lists each step with its repository and file, and marks the step into another repository', async () => {
    render(<ProjectCrossings projectId="p1" />);
    await screen.findByTestId('project-crossings-links');
    fireEvent.change(screen.getByTestId('project-crossings-from'), { target: { value: 'a' } });
    fireEvent.change(screen.getByTestId('project-crossings-to'), { target: { value: 'b' } });
    fireEvent.click(screen.getByTestId('project-crossings-route'));
    const hops = await screen.findAllByTestId('project-crossings-hop');
    expect(getProjectGraphPath).toHaveBeenCalledWith('p1', 'a', 'b');
    expect(hops.map((h) => h.dataset.crosses)).toEqual(['false', 'true']);
    expect(hops[1]!.textContent).toBe('mid (api, src/mid.ts:7) calls b (web, src/b.ts:7) · confidence 0.9 · crosses into web');
  });

  it('no route, and a search that stopped at its bound, are told apart', async () => {
    getProjectGraphPath.mockResolvedValue({ ...PATH, found: false, hops: [], depth_bounded: true });
    render(<ProjectCrossings projectId="p1" />);
    await screen.findByTestId('project-crossings-links');
    fireEvent.change(screen.getByTestId('project-crossings-from'), { target: { value: 'a' } });
    fireEvent.change(screen.getByTestId('project-crossings-to'), { target: { value: 'b' } });
    fireEvent.click(screen.getByTestId('project-crossings-route'));
    expect((await screen.findByTestId('project-crossings-path')).textContent).toBe('No route from a to b was found in the repositories searched. The search stopped at its depth or size limit, so a longer route may still exist.Linking is incomplete for web, so a crossing may be missing.');
  });
});

describe('a route: confidence and the zero-step answer', () => {
  async function route(): Promise<HTMLElement> {
    render(<ProjectCrossings projectId="p1" />);
    await screen.findByTestId('project-crossings-links');
    fireEvent.change(screen.getByTestId('project-crossings-from'), { target: { value: 'a' } });
    fireEvent.change(screen.getByTestId('project-crossings-to'), { target: { value: 'b' } });
    fireEvent.click(screen.getByTestId('project-crossings-route'));
    return screen.findByTestId('project-crossings-path');
  }

  it('codex r1: a step under 0.5 confidence is shown and the route is said to be a lead, not proof', async () => {
    getProjectGraphPath.mockResolvedValue({ ...PATH, hops: [{ ...PATH.hops[1]!, confidence: 0.2 }] });
    await route();
    expect(screen.getByTestId('project-crossings-hop').textContent).toContain('· confidence 0.2');
    expect(screen.getByTestId('project-crossings-path-unsure').textContent).toBe('1 step is uncertain (confidence under 0.5): treat this route as a lead to check, not as proof.');
  });

  it('codex r1 + agy r1: found with no steps says so instead of an empty answer', async () => {
    getProjectGraphPath.mockResolvedValue({ ...PATH, hops: [] });
    await route();
    expect(screen.getByTestId('project-crossings-path-same').textContent).toBe('a and b were found at the same symbol, so there is no step between them.');
  });
});

describe('the client', () => {
  it('asks crew\'s three project graph routes with the names encoded', async () => {
    vi.resetModules();
    vi.doUnmock('../src/api/client.js');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('../src/api/client.js');
    await api.getProjectBlastRadius('p 1', 'a/b');
    await api.getProjectGraphPath('p 1', 'x&y', 'z', 6);
    await api.getProjectGraphBoundaries('p 1');
    const urls = fetchMock.mock.calls.map((c) => new URL(String(c[0]), 'http://h').pathname + new URL(String(c[0]), 'http://h').search);
    expect(urls).toEqual([
      '/api/v1/projects/p%201/graph/blast-radius?name=a%2Fb',
      '/api/v1/projects/p%201/graph/path?from=x%26y&to=z&maxDepth=6',
      '/api/v1/projects/p%201/graph/boundaries',
    ]);
    vi.unstubAllGlobals();
  });
});
