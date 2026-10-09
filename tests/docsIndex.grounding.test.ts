import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * crew#896, studio half: the daemon-wide docs index (GET /interactive/docs) carries each row's
 * `style` and `grounding` record (crew#900, api-types 0.100.1); the reader keeps them and the Made
 * cache stores them, so the grounding chip shows on a daemon that serves the index. Read
 * defensively: a missing or malformed record is left out, never invented.
 */

vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: () => () => Promise.resolve({}) }),
  apiFetch: vi.fn(),
  apiBase: () => '/api/v1',
}));

const client = await import('../src/api/client.js');
const { docsIndexOf } = await import('../src/api/wave6-wire.js');
const { useDocsCache } = await import('../src/store/docsCache.js');

const GROUNDING = { repo_refs: ['offsite-plan'], source: 'named', skipped: [{ ref: 'gone', reason: 'not-a-member' }], member_count: 2 };
const row = (extra: Record<string, unknown>) => ({ projectId: 'notes', name: 'brochure', kind: 'source', head: 2, versions: 2, updatedAt: 't', kinds: [], runs: [], ...extra });

describe('docsIndexOf carries style and grounding (crew#896)', () => {
  it('keeps both when the daemon sends them', () => {
    const [r] = docsIndexOf({ docs: [row({ style: 'brochure', grounding: GROUNDING })] })!;
    expect(r).toEqual({ project_id: 'notes', name: 'brochure', kind: 'source', head: 2, versions: 2, updated_at: 't', style: 'brochure', grounding: GROUNDING });
  });

  it('an older daemon (neither field) yields the same row without them', () => {
    const [r] = docsIndexOf({ docs: [row({})] })!;
    expect(r).not.toHaveProperty('style');
    expect(r).not.toHaveProperty('grounding');
  });

  it('a malformed grounding record is left out; malformed skip entries are dropped', () => {
    expect(docsIndexOf({ docs: [row({ grounding: { repo_refs: 'x', source: 'named', member_count: 1 } })] })![0]).not.toHaveProperty('grounding');
    expect(docsIndexOf({ docs: [row({ grounding: { repo_refs: [], source: 'none' } })] })![0]).not.toHaveProperty('grounding');
    const [r] = docsIndexOf({ docs: [row({ grounding: { ...GROUNDING, skipped: [{ ref: 1 }, 'x', { ref: 'a', reason: 'ambiguous' }] } })] })!;
    expect(r!.grounding!.skipped).toEqual([{ ref: 'a', reason: 'ambiguous' }]);
  });
});

describe('the Made cache keeps them from the index', () => {
  beforeEach(() => {
    useDocsCache.setState({ byProject: {}, unavailable: {}, census: 'opened', index: 'untried', fanoutDone: false, fanoutProgress: null });
  });

  it('loadIndex stores grounding and style on the project row', async () => {
    vi.mocked(client.apiFetch).mockResolvedValue({ docs: [row({ style: 'brochure', grounding: GROUNDING }), row({ name: 'plain' })] });
    await useDocsCache.getState().loadIndex();
    const docs = useDocsCache.getState().byProject['notes']!;
    expect(docs.find((d) => d.name === 'brochure')).toMatchObject({ style: 'brochure', grounding: GROUNDING });
    expect(docs.find((d) => d.name === 'plain')).not.toHaveProperty('grounding');
  });
});
