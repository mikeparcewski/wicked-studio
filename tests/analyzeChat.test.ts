import { describe, expect, it } from 'vitest';
import { analysisScopeChips, askScopeWords, chatWorkflowFor, defaultAskRepos, indexOfferFor, mostActiveRepo } from '../src/board/analyzeChat.js';
import { suggestedQuestions } from '../src/board/understandModel.js';
import { chipsOpenFields } from '../src/board/chatScopes.js';
import type { ChatScope } from '../src/api/types.js';

describe('analysis chat (crew#1157, pure)', () => {
  it('the suggested questions name every chosen repository and no other', () => {
    expect(suggestedQuestions(['a', 'b', 'c'])[0]).toBe('How do a, b and c fit together?');
    expect(suggestedQuestions(['a', 'b', 'c', 'd', 'e'])[0]).toBe('How do a, b, c, d and e fit together?');
    for (const names of [['a'], ['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e']]) {
      const text = suggestedQuestions(names).join(' ');
      for (const n of names) expect(text).toContain(n);
    }
  });

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

  it('starts with the project’s repositories, else the week’s most active one, else none; says what it asks about', () => {
    const now = Date.UTC(2026, 9, 27);
    const at = (days: number) => now / 1000 - days * 86_400;
    const repos = [{ id: 'test-repo' }, { id: 'core' }, { id: 'math' }];
    const runs = [
      { session: { repo_ref: 'core', created_at: at(1) } },
      { session: { repo_ref: 'core', created_at: at(3) } },
      { session: { repo_ref: 'math', created_at: at(2) } },
      { session: { repo_ref: 'test-repo', created_at: at(30) } },
      { session: { repo_ref: 'test-repo', created_at: at(31) } },
      { session: { repo_ref: 'test-repo', created_at: at(32) } },
      { session: { repo_ref: 'math', created_at: at(1), archived_at: 1 } },
      { session: { repo_ref: 'gone', created_at: at(1) } },
    ];
    expect(mostActiveRepo(repos, runs, now)).toBe('core');
    expect(mostActiveRepo(repos, [{ session: { repo_ref: 'core', created_at: at(2) } }, { session: { repo_ref: 'math', created_at: at(1) } }], now)).toBe('math');
    expect(mostActiveRepo(repos, [{ session: { repo_ref: 'core', created_at: at(8) } }], now)).toBeNull();
    expect(defaultAskRepos(repos, { projectRepoIds: null, runs, now })).toEqual(['core']);
    expect(defaultAskRepos(repos, { projectRepoIds: ['math', 'test-repo', 'elsewhere'], runs, now })).toEqual(['test-repo', 'math']);
    expect(defaultAskRepos(repos, { projectRepoIds: [], runs, now })).toEqual([]);
    expect(defaultAskRepos(repos, { projectRepoIds: null, runs: [], now })).toEqual([]);
    expect(askScopeWords(0, true)).toBe('Asks about this project’s repositories.');
    expect(askScopeWords(0, false)).toBe('Asks about all repositories.');
    expect(askScopeWords(1, false)).toBe('Asks about 1 repository.');
    expect(askScopeWords(3, false)).toBe('Asks about 3 repositories.');
  });
});
