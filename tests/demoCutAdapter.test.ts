import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoCutAdapter } from '../src/editors/demoCutAdapter.js';
import { demoCut4 } from '../src/editors/fixtures/demoCut4.js';
import { chapterInventoryOf, checkOps } from '../src/editors/ops.js';
import type { ChapterOp } from '../src/editors/demoCutModel.js';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const item = (op: ChapterOp) => { const c = checkOps([op], chapterInventoryOf(demoCut4)); if (!c.ok) throw new Error(c.message); return c.items; };
const chapters = demoCut4.chapters.map(({ id, title, take, inSec, outSec }) => ({ id, title, take, inSec, outSec }));
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
    expect(r).toMatchObject({ version: 1, content: { type: 'demo-cut', title: 'Doc title', style: { captions: { on: true }, theme: { titleCard: { title: 'Doc title' } } }, chapters: [{ startSec: 2.5, durationSec: 8 }, {}, {}, {}] } });
  });
  it('fetches MP4 and chapter takes as Blobs through the contained recording route', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(demoCut4)).mockResolvedValueOnce(new Response('video', { headers: { 'Content-Type': 'video/mp4' } })).mockResolvedValueOnce(json(demoCut4)).mockResolvedValueOnce(new Response('', { headers: { 'Content-Type': 'video/webm' } })); vi.stubGlobal('fetch', fetchMock);
    const a = new DemoCutAdapter('p', 'demo', 'Demo');
    expect(await a.media('video')).toMatchObject({ type: 'video/mp4', blob: expect.any(NodeBlob) });
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
});
