import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { CodeGraphData, RepoEntry } from '../src/api/types.js';

/**
 * studio#1406: the Languages bar counts the files in the graph slice the page fetched (`GET /repos/:id/graph`, capped
 * by the node limit), not the repository: crew sends no per-language count for the whole index. The bar names the
 * files its percentages count against the repository's whole-store count ("in 24 of the 217 files indexed"), and
 * only a count of every indexed file reads as plain "by number of files". Shape: CodeGraphData as crew's
 * `/repos/:id/graph` serves it (api-types CodeGraphData: `stats` = the served slice, `totals` = the whole store,
 * absent when the stats line did not parse; CodeGraphNode = {id, name, kind, file, inDeg, outDeg, lang}).
 */

const REPO: RepoEntry = { id: 'carddemo', name: 'carddemo', root_path: '/tmp/carddemo', default_branch: 'main', registered_at: 1_700_000_000 };

/** The CardDemo sample: 23 COBOL files and 1 JCL file among 150 nodes, of 217 files indexed. */
function cardDemo(totals: CodeGraphData['totals'] | undefined): CodeGraphData {
  const fileCount = 24;
  const nodes: CodeGraphData['nodes'] = [];
  for (let i = 0; i < 150; i++) {
    const f = i % fileCount;
    const jcl = f === fileCount - 1;
    nodes.push({ id: `n${i}`, name: `P${i}`, kind: 'function', file: jcl ? `app/jcl/J${f}.jcl` : `app/cbl/C${f}.cbl`, inDeg: 1 + (i % 5), outDeg: 1, lang: jcl ? 'jcl' : 'cobol' });
  }
  return { nodes, edges: [], stats: { nodeCount: 150, edgeCount: 0, fileCount }, ...(totals !== undefined ? { totals } : {}) };
}

/** A slice of one TypeScript source file and nine dependency files under node_modules/ (the bar leaves those out). */
function withDeps(totals: NonNullable<CodeGraphData['totals']>): CodeGraphData {
  const nodes: CodeGraphData['nodes'] = [{ id: 's', name: 'main', kind: 'function', file: 'src/main.ts', inDeg: 3, outDeg: 1, lang: 'typescript' }];
  for (let i = 0; i < 9; i++) nodes.push({ id: `d${i}`, name: `dep${i}`, kind: 'function', file: `node_modules/dep${i}/index.js`, inDeg: 1, outDeg: 0, lang: 'javascript' });
  return { nodes, edges: [], stats: { nodeCount: 10, edgeCount: 0, fileCount: 10 }, totals };
}

let graph: CodeGraphData | null = null;

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => Promise.resolve({ repos: [REPO] }),
    listRuns: () => Promise.resolve({ runs: [] }),
    getRepoGraph: () => Promise.resolve({ graph }),
    getRepoGitHistory: () => Promise.resolve({ commits: [] }),
    getRepoContributors: () => Promise.resolve({ contributors: [] }),
    getGraphKindsForRepo: () => Promise.resolve({ kinds: [{ kind: 'Function', count: 12906 }] }),
    listRequirements: () => Promise.reject(new Error('no requirements in this suite')),
    listProjects: () => Promise.resolve({ projects: [] }),
    listApps: () => Promise.resolve({ apps: [] }),
  },
  apiFetch: () => Promise.reject(new Error('not in this suite')),
}));

const { RepoDetailPage } = await import('../src/components/RepoDetailPage.js');
const { resetRepoKnowledge } = await import('../src/store/repoKnowledge.js');

async function languages(g: CodeGraphData): Promise<HTMLElement> {
  graph = g;
  resetRepoKnowledge();
  render(<RepoDetailPage repoId="carddemo" onSelectRun={() => {}} navigate={() => {}} onOpenGraph={() => {}} search="?tab=knowledge" />);
  await screen.findByRole('heading', { name: 'carddemo' });
  const section = await screen.findByTestId('repo-languages');
  return within(section).getByTestId('language-bar');
}

afterEach(() => { cleanup(); graph = null; });

describe('the Languages bar says what it counts (studio#1406)', () => {
  it('a sample of the repository: the label names the files shown and the files indexed', async () => {
    const bar = await languages(cardDemo({ nodes: 12906, edges: 40000, files: 217 }));
    expect(bar.textContent).toMatch(/Cobol 96%/);
    expect(within(bar).getByTestId('language-basis').textContent).toBe('in 24 of the 217 files indexed');
    expect(bar).toHaveAttribute('data-sample', 'true');
  });

  it('no whole-repository count on the wire (an older daemon): the label names the files shown only', async () => {
    const bar = await languages(cardDemo(undefined));
    expect(within(bar).getByTestId('language-basis').textContent).toBe('in the 24 files shown');
    expect(bar).toHaveAttribute('data-sample', 'true');
  });

  it('the label counts the files the percentages count: dependency files left out are not counted as shown (r1)', async () => {
    const bar = await languages(withDeps({ nodes: 500, edges: 900, files: 100 }));
    expect(bar.textContent).toMatch(/TypeScript 100%/);
    expect(within(bar).getByTestId('language-basis').textContent).toBe('in 1 of the 100 files indexed');
    cleanup();
    // A whole graph whose dependency files the bar leaves out is still not "every file".
    const whole = await languages(withDeps({ nodes: 10, edges: 0, files: 10 }));
    expect(within(whole).getByTestId('language-basis').textContent).toBe('in 1 of the 10 files indexed');
    expect(whole).toHaveAttribute('data-sample', 'true');
  });

  it('a whole-store count smaller than the files counted (read at another moment) is not taken as the whole repository (r1)', async () => {
    const bar = await languages(cardDemo({ nodes: 140, edges: 0, files: 23 }));
    expect(within(bar).getByTestId('language-basis').textContent).toBe('in the 24 files shown');
    expect(bar).toHaveAttribute('data-sample', 'true');
  });

  it('the whole repository is in the graph: plain "by number of files"', async () => {
    const bar = await languages(cardDemo({ nodes: 150, edges: 0, files: 24 }));
    expect(within(bar).getByTestId('language-basis').textContent).toBe('by number of files');
    expect(bar).toHaveAttribute('data-sample', 'false');
  });
});
