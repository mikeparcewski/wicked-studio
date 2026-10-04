// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { repoGraphState, repoGraphWords } from '../src/board/repoGraphState.js';

/**
 * studio#461: the repo page tells apart a graph that was never built, one that is built but holds
 * nothing to rank here (a Markdown-only repo: 7 symbols, none of them code), and a read that failed
 * — and says "run onboarding" only in the first case.
 */
const DOCS = { nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0, fileCount: 0 }, totals: { nodes: 7, edges: 5, files: 2 } };

describe('repoGraphState', () => {
  it('no graph: not indexed', () => {
    expect(repoGraphState({ kind: 'ok', graph: null }, 0)).toStrictEqual({ kind: 'none' });
  });
  it('a built graph with symbols but nothing to rank here is indexed, not "not indexed"', () => {
    expect(repoGraphState({ kind: 'ok', graph: DOCS as never }, 0)).toStrictEqual({ kind: 'indexed-empty', symbols: 7, files: 2 });
  });
  it('a failed read is said as one', () => {
    expect(repoGraphState({ kind: 'failed', message: 'HTTP 502' }, 0)).toStrictEqual({ kind: 'failed', message: 'HTTP 502' });
  });
  it('hotspots to show: ready', () => {
    expect(repoGraphState({ kind: 'ok', graph: { ...DOCS, stats: { nodeCount: 3, edgeCount: 1, fileCount: 1 } } as never }, 3)).toStrictEqual({ kind: 'ready' });
  });
});

describe('repoGraphWords — "run onboarding" only when nothing was built', () => {
  it('each state its own sentence', () => {
    expect(repoGraphWords({ kind: 'none' }).hotspots).toBe('Graph not yet indexed — run onboarding to build it.');
    const docs = repoGraphWords({ kind: 'indexed-empty', symbols: 7, files: 2 });
    expect(docs.hotspots).toBe('7 symbols indexed across 2 files — none of them code to rank here.');
    expect(docs.languages).toBe('No code files in the indexed graph (2 files).');
    expect(`${docs.hotspots} ${docs.languages}`).not.toMatch(/onboarding/);
    const failed = repoGraphWords({ kind: 'failed', message: 'HTTP 502' });
    expect(failed.hotspots).toBe('Couldn’t read the code graph (HTTP 502).');
    expect(failed.hotspots).not.toMatch(/onboarding/);
  });
});
