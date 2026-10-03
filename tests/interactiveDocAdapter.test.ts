import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * EP-P2 — the `interactive-doc` adapter (DES-EDITOR-PLUGINS-001 §4, §5.6): one feedback batch per
 * write, the edit's own version found in the manifest, Undo as a fork of the version before the
 * change with `expect_head`, and a head that moved under it reported as `head_moved`.
 */
const api = vi.hoisted(() => ({
  manifests: [] as Array<{ head: number; versions: Array<{ version: number; parent: number | null; feedback_file: string | null; html_file: string; created_at: string }> }>,
  events: [] as unknown[],
  forks: [] as unknown[],
  forkAnswer: null as null | { version: number } | { headMoved: number },
}));

vi.mock('../src/api/interactive.js', () => {
  class HeadMovedError extends Error { head: number; constructor(head: number) { super('head_moved'); this.head = head; } }
  return {
    HeadMovedError,
    getVersions: vi.fn(async () => api.manifests.length > 1 ? api.manifests.shift()! : api.manifests[0]!),
    interactiveDocUrl: (p: string, d: string, v: number) => `/api/v1/projects/${p}/interactive/d/${d}/doc/${v}`,
    postEvent: vi.fn(async (_p: string, evt: unknown) => { api.events.push(evt); return { ok: true }; }),
    postFork: vi.fn(async (_p: string, _d: string, from: number, src: unknown, expectHead?: number) => {
      api.forks.push({ from, expectHead });
      const a = api.forkAnswer;
      if (a !== null && 'headMoved' in a) throw new HeadMovedError(a.headMoved);
      return { version: a === null ? 99 : a.version };
    }),
  };
});

import { InteractiveDocAdapter } from '../src/editors/interactiveDocAdapter.js';

const entry = (version: number, parent: number | null, deterministic = false) => ({ version, parent, feedback_file: deterministic ? `f${version}.json` : null, html_file: `v${version}.html`, created_at: '2026-10-03T00:00:00Z' });

beforeEach(() => { api.manifests = []; api.events = []; api.forks = []; api.forkAnswer = null; });
afterEach(() => { vi.restoreAllMocks(); });

describe('InteractiveDocAdapter', () => {
  it('a write is ONE feedback batch on the base, and its own deterministic child is the version returned', async () => {
    const heads: number[] = [];
    const a = new InteractiveDocAdapter('notes', 'plan', 'The plan', 'page', (h) => heads.push(h));
    api.manifests = [{ head: 1, versions: [entry(1, null)] }, { head: 1, versions: [entry(1, null)] }, { head: 2, versions: [entry(1, null), entry(2, 1, true)] }];
    await a.refresh();
    const r = await a.write(1, [{ selector: 'headline', type: 'content-edit', value: 'New', before: 'Old' }]);
    expect(r).toEqual({ version: 2 });
    expect(api.events).toEqual([{ event_type: 'wicked.interactive.feedback.submitted', payload: { document_id: 'plan', version: 1, author: 'studio', items: [{ selector: 'headline', type: 'content-edit', value: 'New', before: 'Old' }] } }]);
    expect(a.head).toBe(2);
    expect(heads).toEqual([1, 2]);
    expect(a.artifact()).toEqual({ kind: 'page', title: 'The plan', version: 2, head: 2, readonly: false, lockedParts: [] });
  });
  it('the head moving by another hand (no deterministic child of the base) is `stale`, and the head follows', async () => {
    // The landing window is the adapter's (20 s); here it is short, so the test waits it out.
    const a = new InteractiveDocAdapter('notes', 'plan', 'The plan', 'page', undefined, { pollForMs: 900 });
    api.manifests = [{ head: 1, versions: [entry(1, null)] }, { head: 1, versions: [entry(1, null)] }, { head: 2, versions: [entry(1, null), entry(2, 1)] }];
    await a.refresh();
    const r = await a.write(1, [{ selector: 'headline', type: 'content-edit', value: 'New', before: 'Old' }]);
    expect(r).toMatchObject({ error: 'stale', head: 2 });
    expect(a.head).toBe(2);
  });
  it('codex r1: a deterministic child of the base that ALREADY existed before the post is never claimed as this write', async () => {
    // Another tab made v2 off v1 before this edit was posted; the bridge records no correlation id (the
    // real one drops source_message_id), so the manifest read before the post is the fence: the head is
    // already past the base, nothing is sent (r2), and v2 is nobody's to undo here.
    const a = new InteractiveDocAdapter('notes', 'plan', 'The plan', 'page', undefined, { pollForMs: 900 });
    api.manifests = [{ head: 2, versions: [entry(1, null), entry(2, 1, true)] }];
    await a.refresh();
    const r = await a.write(1, [{ selector: 'headline', type: 'content-edit', value: 'New', before: 'Old' }]);
    expect(r).toMatchObject({ error: 'head_moved', head: 2 });
    expect(api.events).toHaveLength(0);
    expect(a.writes.size).toBe(0);
  });
  it('codex r1: two new deterministic children of the base in the window cannot be told apart — neither is claimed, and it says so', async () => {
    const a = new InteractiveDocAdapter('notes', 'plan', 'The plan', 'page', undefined, { pollForMs: 900 });
    api.manifests = [{ head: 1, versions: [entry(1, null)] }, { head: 1, versions: [entry(1, null)] }, { head: 3, versions: [entry(1, null), entry(2, 1, true), entry(3, 1, true)] }];
    await a.refresh();
    const r = await a.write(1, [{ selector: 'headline', type: 'content-edit', value: 'New', before: 'Old' }]);
    expect(r).toMatchObject({ error: 'unavailable', head: 3, moved: { head: 3, kind: 'deterministic' } });
    expect((r as { message: string }).message).toContain('versions 2 and 3');
    expect(a.writes.size).toBe(0);
    expect(a.head).toBe(3);
  });
  it('codex r1: the head follows the manifest, not the match — this edit at v2 with a helper’s v3 already the head; r2: the result says the head moved on, so the plugin is told', async () => {
    const a = new InteractiveDocAdapter('notes', 'plan', 'The plan', 'page');
    api.manifests = [{ head: 1, versions: [entry(1, null)] }, { head: 1, versions: [entry(1, null)] }, { head: 3, versions: [entry(1, null), entry(2, 1, true), entry(3, 2)] }];
    await a.refresh();
    expect(await a.write(1, [{ selector: 'headline', type: 'content-edit', value: 'New', before: 'Old' }])).toEqual({ version: 2, moved: { head: 3, kind: 'generated' } });
    expect(a.head).toBe(3);
    expect(a.writes.get(2)).toBe(1);
  });
  it('codex r2: the manifest read before the post failing is fail-CLOSED — nothing is sent, nothing can be claimed', async () => {
    const a = new InteractiveDocAdapter('notes', 'plan', 'The plan', 'page', undefined, { pollForMs: 900 });
    api.manifests = [{ head: 1, versions: [entry(1, null)] }];
    await a.refresh();
    api.manifests = []; // the next read throws
    const r = await a.write(1, [{ selector: 'headline', type: 'content-edit', value: 'New', before: 'Old' }]);
    expect(r).toMatchObject({ error: 'unavailable' });
    expect((r as { message: string }).message).toContain('nothing was changed');
    expect(api.events).toHaveLength(0);
    expect(a.writes.size).toBe(0);
  });
  it('codex r2: a head that already moved past the base before the post is head_moved — nothing is sent', async () => {
    const a = new InteractiveDocAdapter('notes', 'plan', 'The plan', 'page');
    api.manifests = [{ head: 1, versions: [entry(1, null)] }, { head: 2, versions: [entry(1, null), entry(2, 1)] }];
    await a.refresh();
    expect(await a.write(1, [{ selector: 'headline', type: 'content-edit', value: 'New', before: 'Old' }])).toMatchObject({ error: 'head_moved', head: 2 });
    expect(api.events).toHaveLength(0);
    expect(a.head).toBe(2);
  });
  it('Undo forks the version BEFORE the change with expect_head = the change (C5); a helper in between is head_moved', async () => {
    const a = new InteractiveDocAdapter('notes', 'plan', 'The plan');
    api.manifests = [{ head: 1, versions: [entry(1, null)] }, { head: 1, versions: [entry(1, null)] }, { head: 2, versions: [entry(1, null), entry(2, 1, true)] }];
    await a.refresh();
    await a.write(1, [{ selector: 'headline', type: 'content-edit', value: 'New', before: 'Old' }]);
    api.forkAnswer = { version: 3 };
    expect(await a.undo(2)).toEqual({ undone: true });
    expect(api.forks).toEqual([{ from: 1, expectHead: 2 }]);
    expect(a.head).toBe(3);
    api.forkAnswer = { headMoved: 5 };
    const r = await a.undo(2);
    expect(r).toMatchObject({ error: 'head_moved', head: 5 });
    expect(a.head).toBe(5);
    expect(await a.undo(42)).toMatchObject({ error: 'refused' });
  });
  it('refresh says how the head moved: a deterministic version, a generated one, or a fork', async () => {
    const a = new InteractiveDocAdapter('notes', 'plan', 'The plan');
    api.manifests = [{ head: 1, versions: [entry(1, null)] }];
    expect(await a.refresh()).toEqual({ head: 1, kind: 'generated' });
    api.manifests = [{ head: 2, versions: [entry(1, null), entry(2, 1, true)] }];
    expect(await a.refresh()).toEqual({ head: 2, kind: 'deterministic' });
    api.manifests = [{ head: 3, versions: [entry(1, null), entry(2, 1, true), entry(3, 1)] }];
    expect(await a.refresh()).toEqual({ head: 3, kind: 'fork' });
    expect(await a.refresh()).toBeNull();
  });
  it('read serves the version HTML as the proxy does, and names a missing version', async () => {
    const a = new InteractiveDocAdapter('notes', 'plan', 'The plan');
    api.manifests = [{ head: 2, versions: [entry(1, null), entry(2, 1, true)] }];
    const fetchMock = vi.fn(async (url: string) => ({ ok: !url.endsWith('/7'), status: url.endsWith('/7') ? 404 : 200, text: async () => `<p data-wid="x">${url}</p>` }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await a.read()).toEqual({ version: 2, content: { type: 'html', html: '<p data-wid="x">/api/v1/projects/notes/interactive/d/plan/doc/2</p>' } });
    expect(await a.read(7)).toMatchObject({ error: 'bad_request' });
    vi.unstubAllGlobals();
  });
});
