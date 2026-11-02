/**
 * The workflow catalog's view model (launch-modal, operator 2026-11-01): crew's catalog
 * (wf-catalog WIRE v1) is read tolerantly, an older daemon's list becomes the same model, and
 * search, filters and "Your top" are plain functions over it.
 */
import { describe, expect, it } from 'vitest';
import type { WorkflowDef } from '../src/api/types.js';
import {
  applyFilters, catalogFromDefs, catalogFromWire, minutesLabel, needsLine, NO_FILTERS, scoreEntry, searchCatalog,
  stem, tokens, topEntries, typingWord, usageScore, withStudioKinds, type CatalogEntry, type CatalogView,
} from '../src/board/workflowCatalog.js';
import fixture from './fixtures/workflowCatalog.json';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const view = (): CatalogView => catalogFromWire(fixture)!;
const entry = (id: string): CatalogEntry => view().entries.find((e) => e.id === id)!;
const ids = (es: readonly CatalogEntry[]): string[] => es.map((e) => e.id);
const extra = (id: string, category: string | null): CatalogEntry => ({
  id, launchId: id, launchKind: 'run', docStyle: null, title: id, category, subcategory: null, gets: id, summary: '', needs: [],
  inputs: [], form: false, time: null, cost: null, delivers: null, tags: [], synonyms: [], status: 'ready', statusNote: null, order: 0,
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
    expect(entry('apps')).toMatchObject({ status: 'soon', statusNote: 'Design in progress', launchKind: 'none' });
    expect(entry('validate-docs')).toMatchObject({ status: 'unavailable', statusNote: 'Needs the next engine release' });
  });

  it('maps each launch kind to how studio starts it', () => {
    expect(entry('demo-video')).toMatchObject({ launchKind: 'demo', launchId: 'demo-video', artKey: 'demo-video' });
    expect(entry('draft-epics')).toMatchObject({ launchKind: 'compose', launchId: 'draft-epics' });
    expect(entry('document-interactive')).toMatchObject({ launchKind: 'document', docStyle: 'web', launchId: 'document:document-interactive' });
    expect(entry('presentation')).toMatchObject({ launchKind: 'document', docStyle: 'ppt' });
    expect(entry('start-chat')).toMatchObject({ launchKind: 'chat', launchId: 'chat:start-chat' });
    expect(entry('apps').launchId).toBe('none:apps');
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
    // No status on the wire: shown, not offered (fail closed).
    expect(v.entries[1]).toMatchObject({ category: 'more', launchId: 'c-wf', status: 'unavailable' });
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
        { id: 'a', title: 'Alpha tool', status: 'available', launch: { kind: 'run', workflow: 'a' } },
        { id: 'b', title: 'Beta tool', status: 'available', launch: { kind: 'run', workflow: 'b' }, usage: { launches: 4, lastUsedAt: '2026-11-01T00:00:00Z' } },
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
      'apps', 'document-interactive', 'document-static', 'presentation', 'demo-video', 'review-recent-work', 'learn', 'draft-epics', 'start-chat',
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

describe('untrusted wire and search text (xreview r1)', () => {
  it('words that are Object.prototype names neither crash search nor read inherited values', () => {
    expect(() => searchCatalog(view(), 'constructor', NOW)).not.toThrow();
    expect(() => searchCatalog(view(), 'write a constructor', NOW)).not.toThrow();
    expect(() => searchCatalog(view(), '__proto__ toString', NOW)).not.toThrow();
    const v = catalogFromWire({
      categories: [{ id: 'constructor' }],
      entries: [{ id: '__proto__', category: 'constructor', status: 'available', cost: 'constructor', delivers: 'toString', needs: ['toString'], launch: { kind: 'run', workflow: 'hasOwnProperty' } }],
    })!;
    // Exact values (agy r2: `typeof` passed even for "function hasOwnProperty() { [native code] }").
    expect(v.categories[0]!.title).toBe('Constructor');
    expect(v.entries[0]!.title).toBe('Hasownproperty');
    expect(v.entries[0]!.gets).toBe('');
    expect(v.entries[0]!.cost).toBeNull();
    expect(needsLine(v.entries[0]!)).toBe('Needs toString');
    // An older daemon's workflows with those names: still words, still searchable.
    const old = catalogFromDefs([{ id: 'constructor', phases: [] }, { id: 'toString', phases: [] }] as unknown as WorkflowDef[], null);
    expect(old.entries.map((e) => typeof e.gets)).toEqual(['string', 'string']);
    expect(() => searchCatalog(old, 'construct', NOW)).not.toThrow();
    expect(ids(searchCatalog(old, 'constructor', NOW))).toEqual(['constructor']);
  });

  it('status fails closed: only "available" is offered', () => {
    const v = catalogFromWire({ entries: [
      { id: 'a', status: 'available', launch: { kind: 'run', workflow: 'a' } },
      { id: 'b', status: 'disabled', launch: { kind: 'run', workflow: 'b' } },
      { id: 'c', launch: { kind: 'run', workflow: 'c' } },
      { id: 'd', status: 7, launch: { kind: 'run', workflow: 'd' } },
      { id: 'e', status: 'coming_soon', launch: { kind: 'none' } },
    ] })!;
    expect(v.entries.map((e) => e.status)).toEqual(['ready', 'unavailable', 'unavailable', 'unavailable', 'soon']);
  });

  it('a run without its workflow, or named like studio’s own kinds, is never offered; launch is by launch.workflow', () => {
    const v = catalogFromWire({ entries: [
      { id: 'run:bug', status: 'available', launch: { kind: 'run' } },
      { id: 'run:demo-video', status: 'available', launch: { kind: 'run', workflow: 'demo-video' } },
      { id: 'run:presentation', title: 'My deck steps', status: 'available', launch: { kind: 'run', workflow: 'presentation' } },
    ] })!;
    expect(v.entries.map((e) => [e.launchKind, e.status])).toEqual([['none', 'unavailable'], ['none', 'unavailable'], ['run', 'ready']]);
    expect(v.entries[2]!.launchId).toBe('presentation');
    // The card id's "run:" is not a word the card answers to.
    expect(scoreEntry(v.entries[2]!, 'run')).toBe(0);
    expect(scoreEntry(v.entries[2]!, 'presentation')).toBeGreaterThan(0);
  });

  it('needs fail closed: missing or malformed means a repository; an explicit list is taken as said', () => {
    const v = catalogFromWire({ entries: [
      { id: 'a', status: 'available', launch: { kind: 'run', workflow: 'a' } },
      { id: 'b', status: 'available', needs: 'repo', launch: { kind: 'run', workflow: 'b' } },
      { id: 'c', status: 'available', needs: [], launch: { kind: 'run', workflow: 'c' } },
      { id: 'd', status: 'available', needs: ['nothing'], launch: { kind: 'run', workflow: 'd' } },
    ] })!;
    expect(v.entries.map((e) => e.needs)).toEqual([['repo'], ['repo'], [], []]);
    // A list with anything in it that is not a word is malformed too (xreview r2).
    const bad = catalogFromWire({ entries: [
      { id: 'e', status: 'available', needs: [null, 7, ' '], launch: { kind: 'run', workflow: 'e' } },
      { id: 'f', status: 'available', needs: ['runs', 5], launch: { kind: 'run', workflow: 'f' } },
    ] })!;
    expect(bad.entries.map((e) => e.needs)).toEqual([['repo'], ['repo']]);
  });

  it('a form is a list on the wire (even empty); an older daemon’s list has none', () => {
    const v = catalogFromWire({ entries: [
      { id: 'a', status: 'available', inputs: [], launch: { kind: 'run', workflow: 'a' } },
      { id: 'b', status: 'available', launch: { kind: 'run', workflow: 'b' } },
    ] })!;
    expect(v.entries.map((e) => e.form)).toEqual([true, false]);
    // A form with an input that cannot be read is no form (the words stay required); `required` is
    // only false when the wire says so.
    const odd = catalogFromWire({ entries: [
      { id: 'g', status: 'available', inputs: [null], launch: { kind: 'run', workflow: 'g' } },
      { id: 'h', status: 'available', inputs: [{ id: 'problem', kind: 'text' }], launch: { kind: 'run', workflow: 'h' } },
    ] })!;
    expect(odd.entries.map((e) => [e.form, e.inputs.map((i) => i.required)])).toEqual([[false, []], [true, [true]]]);
    // An input of a kind studio cannot ask for (or with no kind) makes the form unreadable (codex r3).
    const unknown = catalogFromWire({ entries: [
      { id: 'i', status: 'available', inputs: [{ id: 'goal', kind: 'future-text', required: true }], launch: { kind: 'run', workflow: 'i' } },
      { id: 'j', status: 'available', inputs: [{ id: 'goal', required: false }], launch: { kind: 'run', workflow: 'j' } },
    ] })!;
    expect(unknown.entries.map((e) => e.form)).toEqual([false, false]);
    expect(catalogFromDefs([{ id: 'bug', phases: [] } as unknown as WorkflowDef], null).entries[0]!.form).toBe(false);
  });

  it('studio’s own kinds never shadow the catalog’s disabled card of the same kind', () => {
    const v = withStudioKinds(
      catalogFromWire({ entries: [{ id: 'demo-video', category: 'create', status: 'unavailable', launch: { kind: 'none' } }] })!,
      [extra('demo-video', 'create')],
    );
    expect(v.entries.filter((e) => e.id === 'demo-video')).toHaveLength(1);
    expect(v.entries[0]!.status).toBe('unavailable');
  });

  it('prefix matching only on the word being typed, bonus included', () => {
    const author = catalogFromWire({ entries: [{ id: 'author-docs', title: 'Author documents', status: 'available', launch: { kind: 'run', workflow: 'author-docs' } }] })!.entries[0]!;
    expect(typingWord('auth')).toBe('auth');
    expect(typingWord('auth ')).toBeNull();
    expect(typingWord('auth for')).toBeNull();
    expect(scoreEntry(author, 'auth')).toBeGreaterThan(0);
    expect(scoreEntry(author, 'auth ')).toBe(0);
    expect(scoreEntry(author, 'auth for')).toBe(0);
    // "needs" stems to the stop word "need" (xreview r2): "auth" is still not being typed.
    expect(typingWord('auth needs')).toBeNull();
    expect(scoreEntry(author, 'auth needs')).toBe(0);
  });
});

describe('median run time', () => {
  it('a run under half a minute reads as about 1 min, never 0', () => {
    const v = catalogFromWire({ entries: [{ id: 'a', status: 'available', launch: { kind: 'run', workflow: 'a' }, usage: { launches: 1, medianMinutes: 0.2 } }] })!;
    expect(v.entries[0]!.medianMinutes).toBe(1);
  });
});
