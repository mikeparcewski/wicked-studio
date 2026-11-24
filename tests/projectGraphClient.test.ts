import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import type { ProjectBlastRadiusWire, ProjectGraphBoundaries, ProjectGraphPath } from '../src/api/projectGraph-wire.js';

/**
 * studio#1079 part A: the client for crew's cross-repo project graph routes (crew `packages/crew/src/projects/routes.ts`:
 * `/projects/:id/graph/blast-radius?name=`, `/graph/path?from=&to=&maxDepth=`, `/graph/boundaries`). The bodies are
 * what crew's writers return (`packages/crew/src/projects/graph.ts`: `projectBlastRadius` :1782-1802,
 * `projectGraphPath` :1923-1929, `projectGraphBoundaries` :1958-1970) with the inputs of crew's route test
 * (`packages/crew/tests/project-graph-boundaries.test.ts` :33-43), so the wire types are checked against that shape.
 */

const BOUNDARIES: ProjectGraphBoundaries = {
  projectId: 'p1', linked: true, generation: 4, stale: true, stale_labels: ['web'], last_error: 'previous failure',
  members: [
    { repoId: 'r-api', repo: 'api', links_out: 2, package_imports: 3, manifests: 1 },
    { repoId: 'r-web', repo: 'web', links_in: 2, incomplete: true, boundary_counts: { unresolved: 2 } },
  ],
  possible: [{ repoId: 'r-api', repo: 'api', reason: 'undeclared', package: 'pkg' }],
  note: 'possible = imports estate could not prove are links to another member, by reason; never edges',
};
const end = (repo: string, name: string) => ({ repoId: `r-${repo}`, repo, symbol: `sym-${name}`, name, kind: 'Function', file: `src/${name}.ts`, line: 7 });
const PATH: ProjectGraphPath = {
  projectId: 'p1', from: 'a', to: 'b', found: true, resolved: true, unresolved: null,
  hops: [{ source: end('api', 'a'), target: end('web', 'b'), kind: 'calls', confidence: 0.9 }],
  depth_bounded: false, node_bounded: false, crossings: [], reposSearched: ['api', 'web'], missingRepos: [],
  linkage: 'co-located', note: 'n',
};
const BLAST: ProjectBlastRadiusWire = {
  resolved: true, searched_depth: 3,
  freshness: { stale_files: [{ repoId: 'r-web', repo: 'web', file: 'src/b.ts', status: 'modified' }], stale_files_total: 1, checked_files: 40, not_file_backed: 0 },
  coverage: BOUNDARIES.members,
  projectId: 'p1', target: 'a',
  dependents: [{ repoId: 'r-web', repo: 'web', id: 'web::src/b.ts::b', name: 'b', kind: 'function', file: 'src/b.ts', line: 7, depth: 1, via_crossing: 'x1', stale: 'modified' }],
  byRepo: [{ repoId: 'r-web', repo: 'web', count: 1 }], unresolved: 0, reposSearched: ['api', 'web'], missingRepos: [],
  linkage: 'linked', note: 'n',
  crossings: [{ id: 'x1', depth: 1, from: { repo: 'web', symbol: 'web::src/b.ts::b' }, to: { repo: 'api', symbol: 'api::src/a.ts::a' }, hops: [{ kind: 'imports', resolved_by: 'package-link' }], evidence: { identity: 'path', package: 'pkg' } }],
  crossings_total: 1, link_stale: true, link_stale_labels: ['web'],
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('VITE_API_HOST', '');
  Object.defineProperty(window, 'location', { value: new URL('http://127.0.0.1:7788/'), writable: true, configurable: true });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const answer = (body: unknown): void => { fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(body) }); };
const url = (i = 0): string => String(fetchMock.mock.calls[i]?.[0]);

describe('the project graph client (studio#1079 A)', () => {
  it('getProjectBlastRadius asks with the project and the name encoded and returns crew\'s body', async () => {
    answer(BLAST);
    expect(await api.getProjectBlastRadius('p 1', 'a/b')).toEqual(BLAST);
    expect(url()).toBe('http://127.0.0.1:7788/api/v1/projects/p%201/graph/blast-radius?name=a%2Fb');
  });

  it('getProjectGraphPath sends from and to encoded, and maxDepth only when given', async () => {
    answer(PATH);
    answer(PATH);
    expect(await api.getProjectGraphPath('p1', 'x&y', 'z', 6)).toEqual(PATH);
    await api.getProjectGraphPath('p1', 'a', 'b');
    expect(url(0)).toBe('http://127.0.0.1:7788/api/v1/projects/p1/graph/path?from=x%26y&to=z&maxDepth=6');
    expect(url(1)).toBe('http://127.0.0.1:7788/api/v1/projects/p1/graph/path?from=a&to=b');
  });

  it('getProjectGraphBoundaries reads the links and the possible imports', async () => {
    answer(BOUNDARIES);
    expect(await api.getProjectGraphBoundaries('p 1')).toEqual(BOUNDARIES);
    expect(url()).toBe('http://127.0.0.1:7788/api/v1/projects/p%201/graph/boundaries');
  });
});
