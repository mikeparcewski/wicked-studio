import { describe, expect, it } from 'vitest';
import { analysisScopeChips, askScopeWords, chatWorkflowFor, defaultAskRepos, indexOfferFor } from '../src/board/analyzeChat.js';
import { chipsOpenFields } from '../src/board/chatScopes.js';
import type { ChatScope } from '../src/api/types.js';

describe('analysis chat (crew#1157, pure)', () => {
  it('sends a workflow only when crew runs it', () => {
    expect(chatWorkflowFor('analyze', ['analyze'])).toBe('analyze');
    expect(chatWorkflowFor('analyze', [])).toBeNull();
    expect(chatWorkflowFor(undefined, ['analyze'])).toBeNull();
  });

  it('scopes the chat to the chosen repositories, the project when asked from one, else every repository', () => {
    const repos = analysisScopeChips([{ id: 'r1', name: 'alpha' }, { id: 'r2', name: 'beta' }], null);
    expect(chipsOpenFields(repos)).toEqual({ repoRefs: ['r1', 'r2'] });
    expect(repos.find((c) => c.kind === 'page')?.on).toBe(false);
    expect(chipsOpenFields(analysisScopeChips([{ id: 'r1', name: 'alpha' }], { id: 'p1', name: 'P' }))).toEqual({ repoRefs: ['r1'], projectId: 'p1' });
    expect(chipsOpenFields(analysisScopeChips([], { id: 'p1', name: 'P' }))).toEqual({ projectId: 'p1' });
    expect(chipsOpenFields(analysisScopeChips([], null))).toEqual({ scopeKind: 'everything' });
  });

  it('offers indexing only for ONE unbound repository', () => {
    const scope = (bound: boolean, n: number) => ({
      kind: 'repos', cwd: '/x', dangling: [], graph: { bound, reason: '' },
      repos: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `n${i}`, rootPath: `/r${i}` })),
    }) as unknown as ChatScope;
    expect(indexOfferFor(scope(false, 1))).toEqual({ repoId: 'r0', name: 'n0' });
    expect(indexOfferFor(scope(true, 1))).toBeNull();
    expect(indexOfferFor(scope(false, 2))).toBeNull();
    expect(indexOfferFor(null)).toBeNull();
  });

  it('starts with the newest repository off a project, none on a project, and says what it asks about', () => {
    expect(defaultAskRepos([{ id: 'a', registered_at: 1 }, { id: 'b', registered_at: 5 }], null)).toEqual(['b']);
    expect(defaultAskRepos([{ id: 'a', registered_at: 1 }], 'p1')).toEqual([]);
    expect(defaultAskRepos([], null)).toEqual([]);
    expect(askScopeWords(0, true)).toBe('Asks about this project’s repositories.');
    expect(askScopeWords(0, false)).toBe('Asks about all repositories.');
    expect(askScopeWords(1, false)).toBe('Asks about 1 repository.');
    expect(askScopeWords(3, false)).toBe('Asks about 3 repositories.');
  });
});
