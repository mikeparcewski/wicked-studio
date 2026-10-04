import type { CodeGraphData } from '../api/types.js';

/**
 * What the repo page can say about its code graph (studio#461). Three different facts read the same
 * on the page before: a graph never built ("run onboarding"), a graph built with nothing to rank
 * here (a Markdown-only repo: symbols indexed, none of them code), and a graph read that failed.
 * "Run onboarding" is the remedy for the first only.
 */
export type RepoGraphRead = { kind: 'ok'; graph: CodeGraphData | null } | { kind: 'failed'; message: string };

export type RepoGraphState =
  | { kind: 'none' }
  | { kind: 'indexed-empty'; symbols: number; files: number }
  | { kind: 'failed'; message: string }
  | { kind: 'ready' };

export function repoGraphState(read: RepoGraphRead, hotspotCount: number): RepoGraphState {
  if (read.kind === 'failed') return { kind: 'failed', message: read.message };
  const g = read.graph;
  if (g === null) return { kind: 'none' };
  const symbols = g.totals?.nodes ?? g.stats?.nodeCount ?? g.nodes.length;
  const files = g.totals?.files ?? g.stats?.fileCount ?? 0;
  if (symbols === 0) return { kind: 'none' };
  if (hotspotCount === 0) return { kind: 'indexed-empty', symbols, files };
  return { kind: 'ready' };
}

const plural = (n: number, w: string): string => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

/** The page's sentences for a state with nothing to show (`ready` has none). */
export function repoGraphWords(s: RepoGraphState): { hotspots: string; languages: string; graph: string } {
  switch (s.kind) {
    case 'none':
      return {
        hotspots: 'Graph not yet indexed — run onboarding to build it.',
        languages: 'Language mix not indexed yet — run onboarding to build the code graph.',
        graph: 'No graph yet — run onboarding to index this repo.',
      };
    case 'indexed-empty':
      return {
        hotspots: `${plural(s.symbols, 'symbol')} indexed across ${plural(s.files, 'file')} — none of them code to rank here.`,
        languages: `No code files in the indexed graph (${plural(s.files, 'file')}).`,
        graph: `${plural(s.symbols, 'symbol')} indexed — none of them code.`,
      };
    case 'failed':
      return {
        hotspots: `Couldn’t read the code graph (${s.message}).`,
        languages: 'Couldn’t read the code graph, so the language mix is unknown.',
        graph: `Couldn’t read the code graph (${s.message}).`,
      };
    case 'ready':
      return { hotspots: '', languages: '', graph: '' };
  }
}
