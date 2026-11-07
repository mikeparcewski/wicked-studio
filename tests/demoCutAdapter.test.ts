import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoCutAdapter } from '../src/editors/demoCutAdapter.js';
import { DemoCutSurfaceAdapter } from '../src/editors/adapters/recording.js';
import { demoCut4 } from '../src/editors/fixtures/demoCut4.js';
import { chapterInventoryOf, checkOps } from '../src/editors/ops.js';
import type { ChapterOp } from '../src/editors/demoCutModel.js';
import type { ArtifactBinding } from '../src/editors/hostApi.js';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const item = (op: ChapterOp) => { const c = checkOps([op], chapterInventoryOf(demoCut4)); if (!c.ok) throw new Error(c.message); return c.items; };
const chapters = demoCut4.chapters.map(({ id, title, take, inSec, outSec }) => ({ id, title, take, inSec, outSec }));
const binding: ArtifactBinding = { artifactKey: 'demo', title: 'Demo', kind: 'demo-video', source: 'demo', projectId: 'p', composerKey: 'run', docId: 'team demo' };
afterEach(() => vi.unstubAllGlobals());
describe('demo cut adapter over the E1 proxy', () => {
  it.each<ChapterOp>([
    { op: 'chapter-move', chapter: 'open-the-scope', after: 'add-a-seat' },
    { op: 'chapter-rename', chapter: 'open-the-scope', title: 'Open it' },
    { op: 'chapter-trim', chapter: 'open-the-scope', inSec: 0.5, outSec: 7 },
    { op: 'chapter-take', chapter: 'open-the-scope', take: '_take-open-the-scope-2.webm' },
  ])('maps $op to a complete recut with the cut rev, not the editor head', async op => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ ...demoCut4, rev: 3, version: 7 })).mockResolvedValueOnce(json({ rev: 4, version: 8 }));
    vi.stubGlobal('fetch', fetchMock);
    const a = new DemoCutAdapter('p', 'team demo', 'Team demo');
    expect(await a.write(7, item(op))).toEqual({ version: 8 });
    expect(fetchMock.mock.calls[0]![0]).toContain('/api/v1/projects/p/interactive/d/team%20demo/api/demo/cut');
    const [url, init] = fetchMock.mock.calls[1]! as [string, RequestInit];
    expect(url).toContain('/api/demo/recut'); expect(init.method).toBe('POST');
    const expected = chapters.map(c => ({ ...c }));
    const c = expected[0]!;
    if (op.op === 'chapter-move') { expected.shift(); expected.splice(2, 0, c); }
    if (op.op === 'chapter-rename') c.title = op.title;
    if (op.op === 'chapter-trim') { c.inSec = op.inSec; c.outSec = op.outSec; }
    if (op.op === 'chapter-take') { c.take = op.take; c.inSec = 0; c.outSec = 9; }
    expect(JSON.parse(init.body as string)).toEqual({ rev: 3, chapters: expected });
    expect(a.artifact().head).toBe(8);
  });
  it('maps rev_moved to head_moved using a fresh cut version, never the rev', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ ...demoCut4, rev: 3, version: 7 })).mockResolvedValueOnce(json({ error: 'rev_moved', rev: 4 }, 409)).mockResolvedValueOnce(json({ ...demoCut4, rev: 4, version: 9 })));
    const a = new DemoCutAdapter('p', 'demo', 'Demo');
    expect(await a.write(7, item({ op: 'chapter-rename', chapter: 'open-the-scope', title: 'New title' }))).toMatchObject({ error: 'head_moved', head: 9, moved: { head: 9 } });
    expect(a.artifact().head).toBe(9);
  });
  it('PUTs the whole style and publishes the rendered version', async () => {
    const style = { ...demoCut4.style, captions: { ...demoCut4.style.captions, on: false } };
    const fetchMock = vi.fn().mockResolvedValueOnce(json(demoCut4)).mockResolvedValueOnce(json({ rev: 2, version: 2 })); vi.stubGlobal('fetch', fetchMock);
    const a = new DemoCutAdapter('p', 'demo', 'Demo');
    expect(await a.theme(1, { kind: 'video-style', style })).toEqual({ version: 2 });
    const [url, init] = fetchMock.mock.calls[1]! as [string, RequestInit];
    expect(url).toContain('/api/demo/style'); expect(init.method).toBe('PUT'); expect(JSON.parse(init.body as string)).toEqual({ rev: 1, style });
  });
  it('reads effective defaults, the document title and chapter start/duration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...demoCut4, style: {} })));
    const a = new DemoCutAdapter('p', 'demo', 'Doc title'); const r = await a.read();
    expect(r).toMatchObject({ version: 1, content: { type: 'demo-cut', title: 'Doc title', ffmpeg: { ok: true, burnIn: true }, style: { captions: { on: true }, theme: { palette: 'skin', background: '#16181d', foreground: '#f5f6f8', accent: '#b8bec9', font: 'system-ui', titleCard: { title: 'Doc title' } } }, chapters: [{ startSec: 2.5, durationSec: 8 }, {}, {}, {}] } });
  });
  it('carries crew’s resolvedTheme through reads and snapshots without replacing the stored theme', async () => {
    const resolvedTheme = { background: '#101112', foreground: '#fafafa', accent: '#abcdef', font: 'Archivo' };
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ ...demoCut4, resolvedTheme }))
      .mockResolvedValueOnce(json({ ...demoCut4, version: 2, resolvedTheme: { ...resolvedTheme, accent: '#123456' } }));
    vi.stubGlobal('fetch', fetchMock);
    const a = new DemoCutAdapter('p', 'demo', 'Demo');
    expect(await a.read()).toMatchObject({ content: { resolvedTheme, style: { theme: demoCut4.style.theme } } });
    expect(await a.read(1)).toMatchObject({ version: 1, content: { resolvedTheme, style: { theme: demoCut4.style.theme } } });
  });
  it('fetches MP4 and chapter takes as Blobs through the contained recording route', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(demoCut4)).mockResolvedValueOnce(new Response('video', { headers: { 'Content-Type': 'video/mp4' } })).mockResolvedValueOnce(json(demoCut4)).mockResolvedValueOnce(new Response('', { headers: { 'Content-Type': 'video/webm' } })); vi.stubGlobal('fetch', fetchMock);
    const a = new DemoCutAdapter('p', 'demo', 'Demo');
    expect(await a.media('video')).toMatchObject({ type: 'video/mp4', blob: expect.objectContaining({ size: expect.any(Number) }) });
    expect(fetchMock.mock.calls[1]![0]).toContain('/api/demo/recording/_v1.mp4');
    expect(await a.media({ chapter: 'open-the-scope' })).toMatchObject({ type: 'video/webm' });
    expect(fetchMock.mock.calls[3]![0]).toContain('/api/demo/recording/_take-open-the-scope-1.webm');
  });
  it('reports unsupported media/engine paths and rejects an unknown chapter', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(demoCut4)).mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(json(demoCut4)).mockResolvedValueOnce(json(demoCut4)); vi.stubGlobal('fetch', fetchMock);
    const a = new DemoCutAdapter('p', 'demo', 'Demo');
    expect(await a.media('video')).toMatchObject({ error: 'unsupported' });
    expect(await a.media('poster')).toMatchObject({ error: 'unsupported' });
    expect(await a.media({ chapter: 'nope' })).toMatchObject({ error: 'bad_request' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it('refuses stale edits before recut and has no one-chapter retake (a demo re-record is a whole new take, D3)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ ...demoCut4, version: 8 })); vi.stubGlobal('fetch', fetchMock);
    const a = new DemoCutAdapter('p', 'demo', 'Demo');
    expect(await a.write(7, item({ op: 'chapter-rename', chapter: 'open-the-scope', title: 'New' }))).toMatchObject({ error: 'head_moved', head: 8 });
    expect('retake' in a).toBe(false);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/demo/takes'))).toBe(false);
  });
  it('reads an older version from interactive’s kept cut, so history survives a reload (G7 piece 3)', async () => {
    const v2 = { ...demoCut4, rev: 2, version: 2, chapters: demoCut4.chapters.map((c, i) => (i === 0 ? { ...c, title: 'Renamed' } : c)) };
    const fetchMock = vi.fn(async (url: string) => (String(url).includes('cut?version=1') ? json(demoCut4) : json({ ...v2, rev: 3, version: 3 })));
    vi.stubGlobal('fetch', fetchMock);
    // A fresh adapter: nothing from an earlier session.
    const a = new DemoCutAdapter('p', 'demo', 'Demo');
    const r = await a.read(1);
    expect(r).toMatchObject({ version: 1, content: { chapters: [{ title: demoCut4.chapters[0]!.title }, {}, {}, {}] } });
    expect(fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('cut?version='))).toEqual([expect.stringContaining('/api/demo/cut?version=1')]);
  });
  it('an older version with no kept cut is said in words, not as a missing route', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('cut?version=') ? json({ error: 'no_snapshot', field: 'version' }, 404) : json({ ...demoCut4, rev: 3, version: 3 }))));
    const a = new DemoCutAdapter('p', 'demo', 'Demo');
    expect(await a.read(1)).toMatchObject({ error: 'unsupported', message: expect.stringContaining('before the cut kept its history') });
  });
  it('restore, fork and undo are one durable write: POST restore {rev, from}, never the HTML fork', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    let head = { ...demoCut4, rev: 5, version: 3 };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body === undefined ? undefined : JSON.parse(init.body as string) });
      if (String(url).endsWith('/api/versions')) return json({ head: head.version, versions: [{ version: 1, parent: 0, created_at: 't' }, { version: 2, parent: 1, created_at: 't' }, { version: 3, parent: 2, created_at: 't' }] });
      if (init?.method === 'POST') { head = { ...head, rev: head.rev + 1, version: head.version + 1 }; return json({ rev: head.rev, version: head.version, parent: head.version - 1 }); }
      return json(head);
    }));
    const a = new DemoCutSurfaceAdapter(binding);
    expect(await a.restoreVersion(1, 3)).toEqual({ version: 4 });
    expect(calls.at(-1)).toEqual({ url: expect.stringContaining('/d/team%20demo/api/demo/restore'), body: { rev: 5, from: 1 } });
    // Undo after a reload: the parent comes from the document's own lineage, not a session snapshot.
    const fresh = new DemoCutSurfaceAdapter(binding);
    expect(await fresh.undo(3)).toMatchObject({ error: 'head_moved', head: 4 });
    expect(await fresh.undo(4)).toMatchObject({ error: 'unsupported' });
    head = { ...head, version: 3, rev: 9 };
    expect(await new DemoCutSurfaceAdapter(binding).undo(3)).toEqual({ undone: true, moved: { head: 4, kind: 'fork' } });
    expect(calls.at(-1)).toEqual({ url: expect.stringContaining('/api/demo/restore'), body: { rev: 9, from: 2 } });
    expect(await new DemoCutSurfaceAdapter(binding).fork(1)).toEqual({ version: 5 });
    expect(calls.some((c) => c.url.includes('/api/fork'))).toBe(false);
    expect(await new DemoCutSurfaceAdapter(binding).restoreVersion(5, 5)).toMatchObject({ error: 'bad_request' });
    expect(await new DemoCutSurfaceAdapter(binding).restoreVersion(1, 2)).toMatchObject({ error: 'head_moved', head: 5 });
  });
  it('versions reuse the document manifest', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ head: 7, versions: [{ version: 7, parent: 6, created_at: 'today' }] })));
    const a = new DemoCutAdapter('p', 'demo', 'Demo');
    expect(await a.versions()).toEqual({ head: 7, versions: [{ version: 7, parent: 6, createdAt: 'today' }] });
  });
  it('exports a rendered version as MP4, GIF and poster (G7 piece 4)', async () => {
    const fetchMock = vi.fn(async () => json({ ok: true, file: '_v7.gif', bytes: 10, cached: false, download: '/api/demo/recording/_v7.gif' }));
    vi.stubGlobal('fetch', fetchMock);
    const a = new DemoCutSurfaceAdapter(binding);
    expect(a.exports()).toEqual([{ format: 'mp4', label: 'Video' }, { format: 'gif', label: 'GIF' }, { format: 'poster', label: 'Poster' }]);
    expect(a.capabilities()).toContain('export');
    expect(await a.exportFile('mp4', 7)).toEqual({ ok: true, text: 'Video ready.', file: '_v7.mp4', href: expect.stringContaining('/api/v1/projects/p/interactive/d/team%20demo/api/demo/recording/_v7.mp4') });
    expect(await a.exportFile('poster', 7)).toEqual({ ok: true, text: 'Poster ready.', file: '_v7-poster.jpg', href: expect.stringContaining('/d/team%20demo/api/demo/recording/_v7-poster.jpg') });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await a.exportFile('gif', 7)).toEqual({ ok: true, text: 'GIF ready.', file: '_v7.gif', href: expect.stringContaining('/d/team%20demo/api/demo/recording/_v7.gif') });
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain('/d/team%20demo/api/demo/gif'); expect(init.method).toBe('POST'); expect(JSON.parse(init.body as string)).toEqual({ version: 7 });
    fetchMock.mockImplementationOnce(async () => json({ error: 'ffmpeg not found' }, 400));
    expect(await a.exportFile('gif', 7)).toEqual({ ok: false, text: 'The GIF was not made: ffmpeg not found' });
    fetchMock.mockImplementationOnce(async () => json({ ok: true, file: '../x.gif' }));
    expect(await a.exportFile('gif', 7)).toMatchObject({ ok: false });
    expect(await a.exportFile('webm', 7)).toMatchObject({ ok: false });
    expect(await a.exportFile('mp4', 0)).toMatchObject({ ok: false });
    const empty = new DemoCutSurfaceAdapter({ ...binding, docId: '' });
    expect(empty.exports()).toEqual([]); expect(empty.capabilities()).not.toContain('export');
    expect(await empty.exportFile('mp4', 1)).toMatchObject({ ok: false });
  });
  it('announces a local write once even after the new head has been read', async () => {
    let cut = demoCut4;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { cut = { ...cut, rev: 2, version: 2 }; return json({ rev: 2, version: 2 }); }
      return json(cut);
    });
    vi.stubGlobal('fetch', fetchMock);
    const a = new DemoCutSurfaceAdapter(binding); await a.read();
    const changed = vi.fn(), unsubscribe = a.subscribe(changed);
    expect(await a.refresh()).toBeNull();
    expect(await a.write(1, item({ op: 'chapter-rename', chapter: 'open-the-scope', title: 'Scope' }))).toEqual({ version: 2 });
    await a.read(); expect(a.artifact().head).toBe(2);
    expect(await a.refresh()).toEqual({ head: 2, kind: 'generated' });
    expect(await a.refresh()).toBeNull(); expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe(); cut = { ...cut, rev: 3, version: 3 };
    expect(await a.refresh()).toEqual({ head: 3, kind: 'generated' });
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it('re-reads external renders, notifies subscribers, and announces once', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(demoCut4)).mockImplementation(async () => json({ ...demoCut4, rev: 4, version: 9 }));
    vi.stubGlobal('fetch', fetchMock);
    const a = new DemoCutSurfaceAdapter(binding); await a.read(); const changed = vi.fn(); a.subscribe(changed);
    expect(await a.refresh()).toEqual({ head: 9, kind: 'generated' });
    expect(await a.refresh()).toBeNull(); expect(changed).toHaveBeenCalledTimes(1);
  });
});
