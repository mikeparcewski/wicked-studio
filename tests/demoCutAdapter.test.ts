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
  it('refuses stale edits before recut and gives the host a targeted retake method', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ ...demoCut4, version: 8 })).mockResolvedValueOnce(json(demoCut4)).mockResolvedValueOnce(json({ rev: 2, version: 2, takes: [] })); vi.stubGlobal('fetch', fetchMock);
    const a = new DemoCutAdapter('p', 'demo', 'Demo');
    expect(await a.write(7, item({ op: 'chapter-rename', chapter: 'open-the-scope', title: 'New' }))).toMatchObject({ error: 'head_moved', head: 8 });
    expect(await a.retake('open-the-scope')).toEqual({ version: 2 });
    const [url, init] = fetchMock.mock.calls[2]! as [string, RequestInit];
    expect(url).toContain('/api/demo/takes'); expect(JSON.parse(init.body as string)).toEqual({ chapter: 'open-the-scope' });
  });
  it('versions reuse the document manifest', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ head: 7, versions: [{ version: 7, parent: 6, created_at: 'today' }] })));
    const a = new DemoCutAdapter('p', 'demo', 'Demo');
    expect(await a.versions()).toEqual({ head: 7, versions: [{ version: 7, parent: 6, createdAt: 'today' }] });
  });
  it('exports every advertised format for the requested rendered version', async () => {
    const a = new DemoCutSurfaceAdapter(binding);
    expect(a.exports()).toEqual([{ format: 'mp4', label: 'Video' }]);
    expect(a.capabilities()).toContain('export');
    for (const { format } of a.exports()) expect(await a.exportFile(format, 7)).toEqual({
      ok: true, text: 'Video ready.', file: '_v7.mp4',
      href: expect.stringContaining('/api/v1/projects/p/interactive/d/team%20demo/api/demo/recording/_v7.mp4'),
    });
    expect(await a.exportFile('gif', 7)).toMatchObject({ ok: false });
    expect(await a.exportFile('poster', 7)).toMatchObject({ ok: false });
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
