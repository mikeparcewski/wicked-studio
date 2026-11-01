/**
 * The workflow catalog's view model (launch-modal, operator 2026-11-01): the wire is read
 * tolerantly, an older daemon's list becomes the same model, and search, filters and "Your top"
 * are plain functions over it.
 */
import { describe, expect, it } from 'vitest';
import type { WorkflowDef } from '../src/api/types.js';
import {
  applyFilters, catalogFromDefs, catalogFromWire, MORE_CATEGORY, needsLine, NO_FILTERS, scoreEntry, searchCatalog,
  stem, tokens, topEntries, usageScore, withStudioKinds, type CatalogEntry, type CatalogView,
} from '../src/board/workflowCatalog.js';
import fixture from './fixtures/workflowCatalog.json';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const view = (): CatalogView => catalogFromWire(fixture)!;
const ids = (es: readonly CatalogEntry[]): string[] => es.map((e) => e.id);
const extra = (id: string, category: string | null): CatalogEntry => ({
  id, launchId: id, title: id, category, gets: id, summary: '', needs: [], inputs: [], time: null, cost: null, tags: [], synonyms: [],
  status: 'ready', order: 0, artKey: id, launches: 0, lastUsedAt: null,
});

describe('catalogFromWire', () => {
  it('reads categories in their order, workflows with their metadata, and usage per workflow', () => {
    const v = view();
    expect(v.source).toBe('catalog');
    expect(v.categories.map((c) => c.id)).toEqual(['create', 'resolve', 'analyze', 'test', 'more']);
    const feature = v.entries.find((e) => e.id === 'feature')!;
    expect(feature).toMatchObject({ title: 'Feature', category: 'create', needs: ['repo'], time: '30–90 min', cost: '$$', status: 'ready', launches: 14 });
    expect(feature.inputs.map((i) => i.key)).toEqual(['intent', 'acceptance']);
    expect(v.entries.find((e) => e.id === 'vibe')!.status).toBe('soon');
    expect(v.entries.find((e) => e.id === 'validate-docs')!.status).toBe('beta');
  });

  it('an entry in a category the catalog did not list goes under More', () => {
    expect(view().entries.find((e) => e.id === 'learn')!.category).toBe(MORE_CATEGORY.id);
  });

  it('crew’s demo is launched as studio’s Demo video', () => {
    const demo = view().entries.find((e) => e.id === 'demo')!;
    expect(demo.launchId).toBe('demo-video');
    expect(demo.artKey).toBe('demo-video');
  });

  it('tolerates junk and unknown fields; a body that is not a catalog is null (older daemon)', () => {
    const v = catalogFromWire({
      categories: [{ id: 'create', order: 2 }, null, { title: 'no id' }, { id: 'test', order: 1 }],
      workflows: [{ id: 'a', category: 'create', needs: ['repository', 7], tags: 'x', status: 'coming-soon', extra: { deep: 1 } }, { id: 'a' }, 'b', { nope: 1 }],
      usage: [{ workflowId: 'a', launches: -3 }, 'z'],
    })!;
    expect(v.categories.map((c) => c.id)).toEqual(['test', 'create']);
    expect(v.entries).toHaveLength(1);
    expect(v.entries[0]).toMatchObject({ id: 'a', title: 'A', needs: ['repo'], tags: [], status: 'soon', launches: 0 });
    expect(catalogFromWire(null)).toBeNull();
    expect(catalogFromWire({ error: 'Not found' })).toBeNull();
    expect(catalogFromWire('<html>')).toBeNull();
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
    expect(v.entries.every((e) => e.category === null && e.needs.includes('repo'))).toBe(true);
    expect(v.entries[0]!.title).toBe('Fix a bug');
    expect(v.entries[1]!.title).toBe('Acme release');
  });

  it('lists more than the composer menu’s eight rows', () => {
    const defs = Array.from({ length: 12 }, (_, i) => def(`wf-${i}`));
    expect(catalogFromDefs(defs, null).entries).toHaveLength(12);
  });

  it('is still searchable by the def’s summary', () => {
    const v = catalogFromDefs([def('bug', { summary: 'Reproduce a crash and fix it' }), def('feature')], null);
    expect(ids(searchCatalog(v, 'crash', NOW))).toEqual(['bug']);
  });
});

describe('withStudioKinds', () => {
  it('adds studio’s own kinds once: under their category when the catalog has it, else More', () => {
    const v = withStudioKinds(view(), [extra('demo-video', 'create'), extra('draft-epics', 'more'), extra('studio-x', 'nowhere')]);
    // crew lists demo (aliased to demo-video): no second Demo video.
    expect(v.entries.filter((e) => e.launchId === 'demo-video')).toHaveLength(1);
    expect(v.entries.find((e) => e.id === 'draft-epics')!.category).toBe('more');
    expect(v.entries.find((e) => e.id === 'studio-x')!.category).toBe('more');
  });

  it('adds More when the catalog had no use for it, and leaves an older daemon’s list uncategorised', () => {
    const plain = catalogFromWire({ categories: [{ id: 'create' }], workflows: [{ id: 'feature', category: 'create' }] })!;
    expect(withStudioKinds(plain, [extra('draft-epics', 'more')]).categories.map((c) => c.id)).toEqual(['create', 'more']);
    const old = withStudioKinds(catalogFromDefs([], null), [extra('draft-epics', 'more')]);
    expect(old.categories).toEqual([]);
    expect(old.entries[0]!.category).toBeNull();
  });
});

describe('search ranking', () => {
  const top = (q: string): string | undefined => searchCatalog(view(), q, NOW)[0]?.id;

  it('ranks the operator’s sentences to the right workflow', () => {
    expect(top('write docs for the auth service')).toBe('documentation');
    expect(top('why did run X fail')).toBe('review-recent-work');
    expect(top('make slides for the board')).toBe('presentation');
    expect(top('upgrade to react 19')).toBe('migration');
    expect(top('the login page crashes')).toBe('bug');
    expect(top('record a video of the checkout')).toBe('demo');
    expect(top('give agents a tool for jira')).toBe('mcp-server');
    expect(top('are our docs still accurate')).toBe('validate-docs');
  });

  it('matches titles by prefix as you type', () => {
    expect(top('feat')).toBe('feature');
    expect(top('mig')).toBe('migration');
    expect(top('Run rev')).toBe('review-recent-work');
  });

  it('matches tags and synonyms, and the catalog’s own words beat the lexicon', () => {
    expect(top('postmortem')).toBe('review-recent-work');
    expect(top('regression')).toBe('bug');
    expect(scoreEntry(view().entries.find((e) => e.id === 'documentation')!, 'docs'))
      .toBeGreaterThan(scoreEntry(view().entries.find((e) => e.id === 'presentation')!, 'docs'));
  });

  it('nothing for words no workflow has; nothing for stop words alone', () => {
    expect(searchCatalog(view(), 'zzqx', NOW)).toEqual([]);
    expect(searchCatalog(view(), 'the and of', NOW)).toEqual([]);
    expect(searchCatalog(view(), '   ', NOW)).toEqual([]);
  });

  it('a tie goes to what this operator uses more', () => {
    const v = catalogFromWire({
      workflows: [{ id: 'a', title: 'Alpha tool' }, { id: 'b', title: 'Beta tool' }],
      usage: [{ workflowId: 'b', launches: 4, lastUsedAt: '2026-11-01T00:00:00Z' }],
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
    const without = applyFilters(v.entries, { ...NO_FILTERS, repo: 'without' });
    expect(ids(without)).toEqual(['vibe', 'presentation', 'demo', 'review-recent-work', 'learn']);
    expect(applyFilters(v.entries, { ...NO_FILTERS, repo: 'needs' }).every((e) => e.needs.includes('repo'))).toBe(true);
    const ready = applyFilters(v.entries, { ...NO_FILTERS, showSoon: false });
    expect(ready.some((e) => e.status === 'soon')).toBe(false);
    expect(ready.some((e) => e.status === 'beta')).toBe(true);
    expect(ids(applyFilters(v.entries, { category: 'test', repo: 'needs', showSoon: false }))).toEqual(['qe-author-tests']);
  });

  it('says what a workflow needs in plain words', () => {
    expect(needsLine({ needs: [] })).toBe('Works without a repository');
    expect(needsLine({ needs: ['repo'] })).toBe('Needs a repository');
    expect(needsLine({ needs: ['repo', 'documents'] })).toBe('Needs a repository and documents');
    expect(needsLine({ needs: ['runs', 'url', 'project'] })).toBe('Needs runs to review, a running app and a project');
  });
});

describe('Your top', () => {
  it('what this operator launches most, recency-weighted, at most four, never a coming-soon one', () => {
    // bug 9 launches yesterday outranks feature's 14 twelve days ago; migration's two in August trail.
    expect(ids(topEntries(view().entries, NOW))).toEqual(['bug', 'feature', 'review-recent-work', 'migration']);
    expect(ids(topEntries(view().entries, NOW, 2))).toEqual(['bug', 'feature']);
    const soon = catalogFromWire({ workflows: [{ id: 's', status: 'soon' }], usage: [{ workflowId: 's', launches: 5 }] })!;
    expect(topEntries(soon.entries, NOW)).toEqual([]);
  });

  it('is empty for a new user', () => {
    const fresh = catalogFromWire({ ...fixture, usage: [] })!;
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
