import { afterEach, describe, expect, it, vi } from 'vitest';
import { chapterInventoryOf, checkOps, inventoryOf } from '../src/editors/ops.js';
import { demoCut4, fakeDemoCutAdapter } from '../src/editors/fixtures/demoCut4.js';
import { EditorHost, type HostAdapter, type HostUi } from '../src/editors/host.js';
import { FakeDocAdapter } from '../src/editors/fakeAdapter.js';
import surfaces from '../src/plugins/wicked-video/surfaces.json';
import { CHAPTER_OPS } from '../src/editors/protocol.js';

const inv = chapterInventoryOf(demoCut4);
const id = 'open-the-scope';
describe('chapter ops validated against the host cut', () => {
  it('maps all four ops to one chapter wire item', () => {
    const ops = [
      { op: 'chapter-move', chapter: id, after: 'pick-a-plan' },
      { op: 'chapter-rename', chapter: id, title: 'New scope' },
      { op: 'chapter-trim', chapter: id, inSec: 0.5, outSec: 7 },
      { op: 'chapter-take', chapter: id, take: '_take-open-the-scope-2.webm' },
    ];
    expect(ops.map(o => o.op)).toEqual(CHAPTER_OPS);
    for (const op of ops) expect(checkOps([op], inv)).toEqual({ ok: true, items: [{ type: 'chapter', selector: id, op }] });
    expect(checkOps([{ op: 'chapter-move', chapter: id, after: null }], inv).ok).toBe(true);
  });
  it('refuses missing, unsafe, duplicate and unknown chapter ids, and self/unknown destinations', () => {
    for (const chapter of ['', 'missing', 'UPPER', 'x'.repeat(65), '../scope']) expect(checkOps([{ op: 'chapter-rename', chapter, title: 'X' }], inv).ok).toBe(false);
    expect(checkOps([{ op: 'chapter-rename', chapter: id, title: 'X' }], inventoryOf('<h1>Page</h1>')).ok).toBe(false);
    const dup = chapterInventoryOf({ ...demoCut4, chapters: [...demoCut4.chapters, demoCut4.chapters[0]!] });
    expect(checkOps([{ op: 'chapter-rename', chapter: id, title: 'X' }], dup).ok).toBe(false);
    for (const after of [id, 'missing', undefined]) expect(checkOps([{ op: 'chapter-move', chapter: id, after }], inv).ok).toBe(false);
  });
  it('requires a single op per write and one-line titles of 1–80 characters', () => {
    const op = { op: 'chapter-rename', chapter: id, title: 'X' };
    expect(checkOps([op, op], inv)).toMatchObject({ ok: false, message: 'a chapter op is a write of its own' });
    expect(checkOps([op, { op: 'remove', anchor: 'x' }], inv).ok).toBe(false);
    for (const title of ['', ' ', 'x'.repeat(81), 'A\nB', 'A\rB', 1]) expect(checkOps([{ ...op, title }], inv).ok).toBe(false);
    expect(checkOps([{ ...op, title: '<b>Literal</b>' }], inv).ok).toBe(true);
  });
  it('requires finite trims within the selected take and at least 0.5 seconds kept', () => {
    for (const [inSec, outSec] of [[-1, 2], [1, 1], [0, 0.49], [0, 8.1], [NaN, 4], [0, Infinity]]) expect(checkOps([{ op: 'chapter-trim', chapter: id, inSec, outSec }], inv).ok).toBe(false);
    expect(checkOps([{ op: 'chapter-trim', chapter: id, inSec: 7.5, outSec: 8 }], inv).ok).toBe(true);
    const missing = chapterInventoryOf({ ...demoCut4, takes: {} });
    expect(checkOps([{ op: 'chapter-trim', chapter: id, inSec: 0, outSec: 2 }], missing).ok).toBe(false);
  });
  it('requires the take filename grammar AND membership in that chapter', () => {
    for (const take of ['_take-pick-a-plan-1.webm', '_take-open-the-scope-99.webm', '../video.webm', '_take-open-the-scope-2.mp4', '_take-X-1.webm']) expect(checkOps([{ op: 'chapter-take', chapter: id, take }], inv).ok).toBe(false);
  });
  it('the fixture applies edits, increments rev and version, serves a blob and supports Undo', async () => {
    const a = fakeDemoCutAdapter();
    const checked = checkOps([{ op: 'chapter-move', chapter: id, after: 'add-a-seat' }], inv);
    if (!checked.ok) throw new Error(checked.message);
    expect(await a.write(1, checked.items, 'Move chapter')).toEqual({ version: 2 });
    const read = await a.read(); if ('error' in read) throw new Error(read.message);
    expect(read.content.rev).toBe(2);
    expect(read.content.chapters.map(c => c.id)).toEqual(['pick-a-plan', 'add-a-seat', id, 'invite-the-team']);
    expect(read.content.chapters[1]?.startSec).toBe(12.5);
    expect(await a.media()).toMatchObject({ type: 'video/webm', blob: expect.any(Blob) });
    expect(await a.undo(2)).toMatchObject({ undone: true, moved: { head: 3 } });
    const undone = await a.read(); if ('error' in undone) throw new Error(undone.message);
    expect(undone.content.chapters[0]?.id).toBe(id);
    expect(undone.content.rev).toBe(3);
  });
});


const liveHosts: EditorHost[] = [];
afterEach(() => { for (const host of liveHosts.splice(0)) host.teardown('Test ended'); vi.restoreAllMocks(); });
async function videoHost(adapter: HostAdapter) {
  await adapter.read();
  const ui: HostUi = { chips: vi.fn(), draft: vi.fn(), typed: vi.fn(), key: vi.fn(), morph: vi.fn(), status: vi.fn(), notes: vi.fn(), thread: vi.fn(), fullscreen: vi.fn(async () => true), torn: vi.fn(), log: vi.fn() };
  const container = document.createElement('div'); document.body.append(container);
  const host = new EditorHost({ container, src: 'about:blank', editor: 'wicked-video', version: '0.1.0', name: 'Video', title: 'Video', size: 'inline', grants: ['artifact.read', 'artifact.write', 'media.read', 'selection.chip'], theme: {}, prefs: { reducedMotion: false, techDetails: false, locale: 'en' }, firstParty: true, adapter, ui });
  host.mount(); liveHosts.push(host);
  let port: MessagePort | undefined;
  vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((message: unknown, origin: unknown, transfers?: Transferable[]) => { void message; void origin; port = transfers?.[0] as MessagePort; }) as never);
  window.dispatchEvent(new MessageEvent('message', { data: { p: 'wicked.editor', v: 1, type: 'plugin.ready', payload: { editor: 'wicked-video', version: '0.1.0', protocol: [1, 2], surfaces } }, source: host.frame.contentWindow }));
  if (port === undefined) throw new Error('No port');
  const seen: Array<{ re?: string; ok?: boolean; payload?: Record<string, unknown>; error?: { code: string } }> = [];
  port.onmessage = e => { seen.push(e.data); };
  const request = async (type: string, payload: unknown) => {
    const id = `test-${seen.length}`;
    port!.postMessage({ p: 'wicked.editor', v: 1, type, id, payload });
    await vi.waitFor(() => expect(seen.some(m => m.re === id)).toBe(true));
    return seen.find(m => m.re === id)!;
  };
  return { host, port, ui, request };
}
describe('video edits through the real host', () => {
  it('validates chapter writes from the adapter cut and produces real versions', async () => {
    const adapter = fakeDemoCutAdapter(), h = await videoHost(adapter);
    expect(await h.request('version.write', { base: 1, ops: [{ op: 'chapter-rename', chapter: 'open-the-scope', title: 'Scope' }], summary: 'chapter 1' })).toMatchObject({ ok: true, payload: { version: 2 } });
    expect(await h.request('version.write', { base: 2, ops: [{ op: 'chapter-trim', chapter: 'open-the-scope', inSec: 0, outSec: 99 }], summary: 'chapter 1' })).toMatchObject({ ok: false, error: { code: 'bad_request' } });
    expect(adapter.writes).toHaveLength(1);
    h.port.postMessage({ p: 'wicked.editor', v: 1, type: 'selection.set', payload: { anchors: [{ kind: 'chapter', id: 'open-the-scope' }] } });
    await vi.waitFor(() => expect(h.ui.chips).toHaveBeenCalledWith([{ anchor: { kind: 'chapter', id: 'open-the-scope' }, label: 'Scope' }]));
  });
  it('calls the optional media method and returns unsupported when it is absent', async () => {
    const adapter = fakeDemoCutAdapter();
    const media = vi.fn(async () => ({ type: 'video/webm', blob: new Blob([]) }));
    const h = await videoHost({ ...adapter, media });
    expect(await h.request('artifact.media', { ref: { chapter: 'open-the-scope' } })).toMatchObject({ ok: true, payload: { type: 'video/webm' } });
    expect(media).toHaveBeenCalledWith({ chapter: 'open-the-scope' });
    const absent = await videoHost(new FakeDocAdapter());
    expect(await absent.request('artifact.media', { ref: 'video' })).toMatchObject({ ok: false, error: { code: 'unsupported' } });
  });
});
