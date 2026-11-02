/**
 * The workflow catalog's view model (launch-modal, operator 2026-11-01): crew's catalog
 * (wf-catalog WIRE v1) is read tolerantly, an older daemon's list becomes the same model, and
 * search, filters and "Your top" are plain functions over it.
 */
import { describe, expect, it } from 'vitest';
import type { WorkflowDef } from '../src/api/types.js';
import {
  applyFilters, catalogFromDefs, catalogFromWire, minutesLabel, needsLine, NO_FILTERS, scoreEntry, searchCatalog,
  stem, tokens, topEntries, usageScore, withStudioKinds, type CatalogEntry, type CatalogView,
} from '../src/board/workflowCatalog.js';
import fixture from './fixtures/workflowCatalog.json';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const view = (): CatalogView => catalogFromWire(fixture)!;
const entry = (id: string): CatalogEntry => view().entries.find((e) => e.id === id)!;
const ids = (es: readonly CatalogEntry[]): string[] => es.map((e) => e.id);
const extra = (id: string, category: string | null): CatalogEntry => ({
  id, launchId: id, launchKind: 'run', docStyle: null, title: id, category, subcategory: null, gets: id, summary: '', needs: [],
  inputs: [], time: null, cost: null, delivers: null, tags: [], synonyms: [], status: 'ready', statusNote: null, order: 0,
  artKey: id, launches: 0, lastUsedAt: null, medianMinutes: null,
});

describe('catalogFromWire (WIRE v1)', () => {
  it('reads categories in order and each entry with its metadata and usage', () => {
    const v = view();
    expect(v.source).toBe('catalog');
    expect(v.categories.map((c) => c.id)).toEqual(['create', 'resolve', 'analyze', 'test', 'more']);
    expect(v.categories[0]).toMatchObject({ title: 'Create', blurb: 'Make something new' });
    expect(entry('feature')).toMatchObject({
      title: 'Build a feature', category: 'create', subcategory: 'Feature', needs: ['repo'], launchKind: 'run', launchId: 'feature',
      gets: 'A pull request with the feature, its tests and a review', time: '30 min–1.5 h', cost: 'medium cost', delivers: 'pr',
      status: 'ready', launches: 14, lastUsedAt: '2026-10-20T10:00:00Z', medianMinutes: 48,
    });
    expect(entry('feature').inputs.map((i) => [i.key, i.kind])).toEqual([['repo', 'repo'], ['problem', 'text'], ['acceptance', 'text']]);
    expect(entry('create-app')).toMatchObject({ status: 'soon', statusNote: 'Design in progress', launchKind: 'none' });
    expect(entry('validate-docs')).toMatchObject({ status: 'unavailable', statusNote: 'Needs the next engine release' });
  });

  it('maps each launch kind to how studio starts it', () => {
    expect(entry('demo-video')).toMatchObject({ launchKind: 'demo', launchId: 'demo-video', artKey: 'demo-video' });
    expect(entry('draft-epics')).toMatchObject({ launchKind: 'compose', launchId: 'draft-epics' });
    expect(entry('document-interactive')).toMatchObject({ launchKind: 'document', docStyle: 'web', launchId: 'document:document-interactive' });
    expect(entry('presentation')).toMatchObject({ launchKind: 'document', docStyle: 'ppt' });
    expect(entry('start-chat')).toMatchObject({ launchKind: 'chat', launchId: 'chat:start-chat' });
    expect(entry('create-app').launchId).toBe('none:create-app');
  });

  it('a launch kind studio does not know is shown as not available, never offered', () => {
    const v = catalogFromWire({ entries: [{ id: 'x', category: 'more', status: 'available', launch: { kind: 'teleport' } }] })!;
    expect(v.entries[0]).toMatchObject({ launchKind: 'none', status: 'unavailable' });
  });

  it('tolerates junk and unknown fields; a body that is not a catalog is null (older daemon)', () => {
    const v = catalogFromWire({
      categories: [{ id: 'create' }, null, { title: 'no id' }, { id: 'create' }],
      entries: [
        { id: 'a', category: 'create', needs: ['repo', 7, 'nothing'], tags: 'x', status: 'coming_soon', usage: { launches: -3 }, extra: { deep: 1 } },
        { id: 'a' }, 'b', { nope: 1 }, { id: 'c', category: 'elsewhere', launch: { kind: 'run', workflow: 'c-wf' } },
      ],
    })!;
    expect(v.categories.map((c) => c.id)).toEqual(['create', 'more']);
    expect(ids(v.entries)).toEqual(['a', 'c']);
    expect(v.entries[0]).toMatchObject({ title: 'A', needs: ['repo'], tags: [], status: 'soon', launches: 0 });
    expect(v.entries[1]).toMatchObject({ category: 'more', launchId: 'c-wf' });
    expect(catalogFromWire(null)).toBeNull();
    expect(catalogFromWire({ error: 'not found' })).toBeNull();
    expect(catalogFromWire('<html>')).toBeNull();
  });

  it('says typical minutes as a range', () => {
    expect(minutesLabel([10, 30])).toBe('10–30 min');
    expect(minutesLabel([45, 120])).toBe('45 min–2 h');
    expect(minutesLabel([60, 180])).toBe('1–3 h');
    expect(minutesLabel([20, 20])).toBe('20 min');
    expect(minutesLabel(null)).toBeNull();
    expect(minutesLabel([30, 10])).toBeNull();
  });
});

describe('catalogFromDefs (an older daemon)', () => {
  const def = (id: string, extraFields: Record<string, unknown> = {}): WorkflowDef =>
    ({ id, phases: [{ id: 'build', executes_code: true }], ...extraFields }) as unknown as WorkflowDef;

  it('is today’s list, uncategorised, every workflow taken to need a repository; no system workflow', () => {
    const v = catalogFromDefs([def('bug', { title: 'Fix a bug', summary: 'Reproduce and fix.' }), def('chat', { is_system: true }), def('acme-release')], null);
    expect(v.source).toBe('fallback');
    expect(v.categories).toEqual([]);
    expect(ids(v.entries)).toEqual(['bug', 'acme-release']);
    expect(v.entries.every((e) => e.category === null && e.needs.includes('repo') && e.launchKind === 'run')).toBe(true);
    expect(v.entries[0]!.title).toBe('Fix a bug');
    expect(v.entries[1]!.title).toBe('Acme release');
  });

  it('lists more than the composer menu’s eight rows', () => {
    expect(catalogFromDefs(Array.from({ length: 12 }, (_, i) => def(`wf-${i}`)), null).entries).toHaveLength(12);
  });

  it('is still searchable by the def’s summary and use_when', () => {
    const v = catalogFromDefs([def('bug', { summary: 'Reproduce a crash and fix it' }), def('feature', { use_when: ['adding a capability'] })], null);
    expect(ids(searchCatalog(v, 'crash', NOW))).toEqual(['bug']);
    expect(ids(searchCatalog(v, 'capability', NOW))).toEqual(['feature']);
  });
});

describe('withStudioKinds', () => {
  it('adds nothing crew already lists (demo video and draft epics are crew entries in v1)', () => {
    const v = withStudioKinds(view(), [extra('demo-video', 'create'), extra('draft-epics', 'more')]);
    expect(v.entries.filter((e) => e.launchId === 'demo-video')).toHaveLength(1);
    expect(v.entries.filter((e) => e.launchId === 'draft-epics')).toHaveLength(1);
  });

  it('adds a missing kind under its category, or More (added when the catalog had no use for it)', () => {
    const plain = catalogFromWire({ categories: [{ id: 'create' }], entries: [{ id: 'feature', category: 'create', launch: { kind: 'run', workflow: 'feature' } }] })!;
    const v = withStudioKinds(plain, [extra('demo-video', 'create'), extra('draft-epics', 'more')]);
    expect(v.categories.map((c) => c.id)).toEqual(['create', 'more']);
    expect(v.entries.find((e) => e.id === 'demo-video')!.category).toBe('create');
    expect(v.entries.find((e) => e.id === 'draft-epics')!.category).toBe('more');
    const old = withStudioKinds(catalogFromDefs([], null), [extra('draft-epics', 'more')]);
    expect(old.categories).toEqual([]);
    expect(old.entries[0]!.category).toBeNull();
  });
});

describe('search ranking', () => {
  const top = (q: string): string | undefined => searchCatalog(view(), q, NOW)[0]?.id;

  it('ranks the operator’s sentences to the right workflow', () => {
    expect(top('write docs for the auth service')).toBe('docs');
    expect(top('why did run X fail')).toBe('review-recent-work');
    expect(top('make slides for the board')).toBe('presentation');
    expect(top('upgrade to react 19')).toBe('migration');
    expect(top('the login crashes on submit')).toBe('bug');
    expect(top('record a video of the checkout')).toBe('demo-video');
    expect(top('give agents a tool for jira')).toBe('mcp-server');
    expect(top('find the gaps in our test coverage')).toBe('test-analysis');
  });

  it('matches titles by prefix as you type, only on the word being typed', () => {
    expect(top('feat')).toBe('feature');
    expect(top('mig')).toBe('migration');
    expect(top('Review r')).toBe('review-recent-work');
    // "auth" is a whole earlier word: it is not "author" (qe-author-tests).
    expect(scoreEntry(entry('qe-author-tests'), 'auth service docs')).toBe(0);
    expect(scoreEntry(entry('qe-author-tests'), 'auth')).toBeGreaterThan(0);
  });

  it('matches tags and synonyms; a sentence that matches more words beats one strong word', () => {
    expect(top('postmortem')).toBe('review-recent-work');
    expect(top('regression')).toBe('bug');
    expect(scoreEntry(entry('docs'), 'write docs')).toBeGreaterThan(scoreEntry(entry('qe-author-tests'), 'write docs'));
  });

  it('what cannot start now ranks after what can', () => {
    const r = ids(searchCatalog(view(), 'are our docs accurate', NOW));
    expect(r).toContain('validate-docs');
    expect(r[r.length - 1]).toBe('validate-docs');
  });

  it('nothing for words no workflow has; nothing for stop words alone', () => {
    expect(searchCatalog(view(), 'zzqx', NOW)).toEqual([]);
    expect(searchCatalog(view(), 'the and of', NOW)).toEqual([]);
    expect(searchCatalog(view(), '   ', NOW)).toEqual([]);
  });

  it('a tie goes to what this operator uses more', () => {
    const v = catalogFromWire({
      entries: [
        { id: 'a', title: 'Alpha tool', launch: { kind: 'run', workflow: 'a' } },
        { id: 'b', title: 'Beta tool', launch: { kind: 'run', workflow: 'b' }, usage: { launches: 4, lastUsedAt: '2026-11-01T00:00:00Z' } },
      ],
    })!;
    expect(ids(searchCatalog(v, 'tool', NOW))).toEqual(['b', 'a']);
  });

  it('tokens and stems in plain English', () => {
    expect(tokens('Write the Docs!')).toEqual(['write', 'doc']);
    expect(stem('failed')).toBe('fail');
    expect(stem('crashes')).toBe('crash');
    expect(stem('testing')).toBe('test');
    expect(stem('stories')).toBe('story');
    expect(stem('access')).toBe('access');
  });
});

describe('filters', () => {
  it('by category, by repository need and by status', () => {
    const v = view();
    expect(ids(applyFilters(v.entries, { ...NO_FILTERS, category: 'resolve' }))).toEqual(['bug', 'migration']);
    expect(ids(applyFilters(v.entries, { ...NO_FILTERS, repo: 'without' }))).toEqual([
      'create-app', 'document-interactive', 'document-static', 'presentation', 'demo-video', 'review-recent-work', 'learn', 'draft-epics', 'start-chat',
    ]);
    expect(applyFilters(v.entries, { ...NO_FILTERS, repo: 'needs' }).every((e) => e.needs.includes('repo'))).toBe(true);
    const ready = applyFilters(v.entries, { ...NO_FILTERS, showSoon: false });
    expect(ready.every((e) => e.status === 'ready')).toBe(true);
    expect(ids(applyFilters(v.entries, { category: 'test', repo: 'needs', showSoon: false }))).toEqual(['test-plan', 'test-analysis', 'qe-author-tests']);
  });

  it('says what a workflow needs in plain words', () => {
    expect(needsLine({ needs: [] })).toBe('Works without a repository');
    expect(needsLine({ needs: ['repo'] })).toBe('Needs a repository');
    expect(needsLine({ needs: ['repo', 'document'] })).toBe('Needs a repository and a document');
    expect(needsLine({ needs: ['runs', 'running_app', 'project'] })).toBe('Needs runs to review, a running app and a project');
  });
});

describe('Your top', () => {
  it('what this operator launches most, recency-weighted, one row of three, only what can start', () => {
    // Fix a bug (9, yesterday) outranks Build a feature (14, twelve days ago); Migrate (2, August) trails.
    expect(ids(topEntries(view().entries, NOW))).toEqual(['bug', 'feature', 'review-recent-work']);
    expect(ids(topEntries(view().entries, NOW, 4))).toEqual(['bug', 'feature', 'review-recent-work', 'migration']);
    const soon = catalogFromWire({ entries: [{ id: 's', status: 'coming_soon', launch: { kind: 'none' }, usage: { launches: 5 } }] })!;
    expect(topEntries(soon.entries, NOW)).toEqual([]);
  });

  it('is empty for a new user', () => {
    const fresh = catalogFromWire({ ...fixture, entries: fixture.entries.map((e) => ({ ...e, usage: { launches: 0, lastUsedAt: null, medianMinutes: null } })) })!;
    expect(topEntries(fresh.entries, NOW)).toEqual([]);
    expect(topEntries(catalogFromDefs([{ id: 'bug', phases: [] } as unknown as WorkflowDef], null).entries, NOW)).toEqual([]);
  });

  it('the score halves after two weeks; an unknown last use counts as a year ago', () => {
    expect(usageScore({ launches: 10, lastUsedAt: '2026-11-01T12:00:00Z' }, NOW)).toBe(10);
    expect(usageScore({ launches: 10, lastUsedAt: '2026-10-18T12:00:00Z' }, NOW)).toBeCloseTo(5);
    expect(usageScore({ launches: 10, lastUsedAt: null }, NOW)).toBeLessThan(1);
    expect(usageScore({ launches: 0, lastUsedAt: '2026-11-01T12:00:00Z' }, NOW)).toBe(0);
  });
});
