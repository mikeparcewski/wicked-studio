import { Blob as NodeBlob } from 'node:buffer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoCut4, fakeDemoCutAdapter } from '../src/editors/fixtures/demoCut4.js';
import { chapterInventoryOf, checkOps } from '../src/editors/ops.js';
import { canonicalSurfaces, parseSurfaces } from '../src/editors/surfaces.js';
import surfaces from '../src/plugins/wicked-video/surfaces.json';
import { videoValues, type DemoCut } from '../src/editors/demoCutModel.js';

const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id === undefined ? {} : { id }) });
interface Message { type?: string; id?: string; re?: string; ok?: boolean; payload?: Record<string, unknown> }
let start: () => void, initial = true, ch: MessageChannel;
let adapter: ReturnType<typeof fakeDemoCutAdapter>;
let seen: Message[] = [], ready: Message[] = [];
let refuseTheme = false, refuseMedia = false;
const createUrl = vi.fn(() => `blob:video-${Math.random()}`), revokeUrl = vi.fn();
const root = () => document.querySelector<HTMLElement>('[data-testid="video-editor"]')!;
const node = <T extends HTMLElement = HTMLButtonElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`)!;
const messages = (type: string) => seen.filter(m => m.type === type);
const values = (tab: string) => messages('options.values').filter(m => m.payload?.['tab'] === tab).at(-1)?.payload?.['values'];
const send = (type: string, payload: unknown, id?: string) => ch.port1.postMessage(env(type, payload, id));
const settled = async (version: number) => vi.waitFor(() => { expect(root().dataset['head']).toBe(String(version)); expect(node('video-rename')?.hasAttribute('disabled') ?? false).toBe(false); });
async function show(cut: DemoCut): Promise<HTMLVideoElement> {
  await vi.waitFor(() => expect(node('video-player').getAttribute('src')).toMatch(/^blob:/));
  const oldSrc = node('video-player').getAttribute('src');
  adapter = fakeDemoCutAdapter({ ...cut, version: 2 }); send('artifact.changed', { head: 2 });
  await settled(2);
  await vi.waitFor(() => expect(node('video-player').getAttribute('src')).not.toBe(oldSrc));
  return node<HTMLVideoElement>('video-player');
}

async function open(protocol = 2, surface = 'card'): Promise<void> {
  adapter = fakeDemoCutAdapter(); seen = []; refuseTheme = false; refuseMedia = false;
  ch = new MessageChannel();
  ch.port1.onmessage = async (event: MessageEvent) => {
    const d = event.data as Message; seen.push(d);
    let result: unknown;
    if (d.type === 'artifact.read') result = await adapter.read();
    else if (d.type === 'artifact.media') result = refuseMedia ? { error: 'unsupported', message: 'No video' } : await adapter.media();
    else if (d.type === 'version.write') {
      const r = await adapter.read(); if ('error' in r) throw new Error(r.message);
      const checked = checkOps(d.payload?.['ops'] as unknown[], chapterInventoryOf(r.content));
      result = checked.ok ? await adapter.write(d.payload?.['base'] as number, checked.items, d.payload?.['summary'] as string) : { error: checked.code, message: checked.message };
    } else if (d.type === 'theme.set') {
      if (refuseTheme) {
        refuseTheme = false;
        await adapter.theme(adapter.artifact().head, { kind: 'video-style', style: { ...demoCut4.style, theme: { ...demoCut4.style.theme, accent: '#112233' } } });
        result = { error: 'head_moved', message: 'The cut moved.' };
      } else result = await adapter.theme(d.payload?.['base'] as number, d.payload?.['tokens'] as Record<string, unknown>);
    } else return;
    const r = result as { error?: string; message?: string };
    ch.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: r.error === undefined, ...(r.error === undefined ? { payload: result } : { error: { code: r.error, message: r.message } }) });
  };
  window.dispatchEvent(Object.assign(new Event('message'), { data: env('host.hello', { protocol, size: surface === 'card' ? 'inline' : 'full', surface, mode: 'simple', grants: ['artifact.read', 'artifact.write', 'artifact.theme', 'media.read', 'selection.chip'], theme: { '--accent': '#123456' } }), ports: [ch.port2] }));
  await vi.waitFor(() => expect(document.querySelectorAll('[data-testid="video-chip"]')).toHaveLength(4));
}
beforeAll(async () => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => { const m = message as Message; if (m.type === 'plugin.ready') ready.push(m); });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
  ({ start } = await import('../src/plugins/wicked-video/plugin.js'));
});
beforeEach(async () => { if (!initial) { document.body.replaceChildren(); start(); } initial = false; await open(); });
afterEach(async () => { send('host.teardown', {}); await new Promise(r => setTimeout(r, 30)); ch.port1.close(); ch.port2.close(); });
afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('wicked-video protocol 2 surfaces and player', () => {
  it('announces [1,2] and the same canonical surfaces as its manifest declaration', () => {
    expect(ready[0]?.payload?.['protocol']).toEqual([1, 2]);
    const actual = parseSurfaces(ready[0]?.payload?.['surfaces']), expected = parseSurfaces(surfaces);
    expect(actual.ok).toBe(true); expect(expected.ok).toBe(true);
    if (!actual.ok || !expected.ok) throw new Error('Invalid declaration');
    expect(canonicalSurfaces(actual.value)).toBe(canonicalSurfaces(expected.value));
  });
  it('renders numbered chapter chips with text kept literal and obtains video through artifact.media', async () => {
    const chips = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="video-chip"]'));
    expect(chips.map(n => n.textContent)).toEqual(demoCut4.chapters.map((c, i) => `${i + 1} · ${c.title}`));
    expect(chips[0]?.getAttribute('aria-current')).toBe('true');
    expect(root().dataset['surface']).toBe('card');
    expect(document.getElementById('chapters')).toHaveAttribute('hidden');
    await vi.waitFor(() => expect(messages('artifact.media')[0]?.payload).toEqual({ ref: 'video' }));
    expect(node<HTMLVideoElement>('video-player').getAttribute('src')).toMatch(/^blob:/);
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#123456');
  });
  it('answers next/prev, seeks and tells the host which chapter is selected', async () => {
    send('host.action', { id: 'next' }, 'next-1');
    await vi.waitFor(() => expect(seen.find(m => m.re === 'next-1')?.payload).toEqual({ handled: true, status: 'Chapter 2 of 4 · Pick a plan' }));
    expect(node<HTMLVideoElement>('video-player').currentTime).toBe(demoCut4.chapters[1]!.startSec);
    expect(messages('selection.set').at(-1)?.payload).toEqual({ anchors: [{ kind: 'chapter', id: 'pick-a-plan' }] });
    send('host.action', { id: 'prev' }, 'prev-1');
    await vi.waitFor(() => expect(seen.find(m => m.re === 'prev-1')?.payload).toEqual({ handled: true, status: 'Chapter 1 of 4 · Open the scope' }));
  });
  it('morphs with the same video element, and echoes the displayed Simple/Advanced mode', async () => {
    const player = node('video-player'); send('host.surface', { surface: 'full', mode: 'simple' });
    await vi.waitFor(() => expect(root().dataset['surface']).toBe('full'));
    expect(document.getElementById('inspectors')).toHaveAttribute('hidden'); expect(node('video-rename')).toBeNull();
    send('host.mode', { mode: 'advanced' }, 'mode-1');
    await vi.waitFor(() => expect(seen.find(m => m.re === 'mode-1')?.payload).toEqual({ mode: 'advanced' }));
    expect(document.getElementById('inspectors')).not.toHaveAttribute('hidden'); expect(node('video-trim-in')).toBeTruthy();
    expect(document.getElementById('say')).toHaveAttribute('readonly'); expect(node('video-player')).toBe(player);
    expect(document.getElementById('hint')?.textContent).toBe("Re-record this chapter: the host's button");
    send('host.mode', { mode: 'simple' }, 'mode-2');
    await vi.waitFor(() => expect(seen.find(m => m.re === 'mode-2')?.payload).toEqual({ mode: 'simple' }));
  });
  it('keeps chapters usable when media is unsupported and ignores older change announcements', async () => {
    refuseMedia = true;
    send('artifact.changed', { head: 2 });
    // A changed cut causes a new media request; use a real fixture write to advance it.
    await adapter.theme(1, { kind: 'video-style', style: demoCut4.style });
    send('artifact.changed', { head: 2 });
    await vi.waitFor(() => expect(document.getElementById('unavailable')).not.toHaveAttribute('hidden'));
    node('video-chip').click(); expect(root().dataset['current']).toBe('open-the-scope');
    await vi.waitFor(() => expect(root().dataset['head']).toBe('2'));
    const before = messages('artifact.read').length; send('artifact.changed', { head: 1 });
    await new Promise(r => setTimeout(r, 30)); expect(messages('artifact.read')).toHaveLength(before);
  });
});

describe('chapter edits are one operation in one write', () => {
  beforeEach(async () => { send('host.surface', { surface: 'full', mode: 'advanced' }); await vi.waitFor(() => expect(node('video-rename')).toBeTruthy()); });
  it('renames inline on Enter, cancels on Escape, and renders markup as text', async () => {
    node('video-rename').click(); const input = node<HTMLInputElement>('video-rename-input'); input.value = '<b>Scope</b>';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settled(2);
    expect(messages('version.write')[0]?.payload).toEqual({ base: 1, ops: [{ op: 'chapter-rename', chapter: 'open-the-scope', title: '<b>Scope</b>' }], summary: 'chapter 1' });
    expect(node('video-chapter').textContent).toContain('<b>Scope</b>'); expect(node('video-chapter').querySelector('b')).toBeNull();
    node('video-rename').click(); node('video-rename-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); expect(node('video-rename-input')).toBeNull(); expect(messages('version.write')).toHaveLength(1);
  });
  it('trims on number input release and refuses invalid trim values locally', async () => {
    const input = node<HTMLInputElement>('video-in'); input.value = '0.5'; input.dispatchEvent(new Event('change')); await settled(2);
    expect(messages('version.write')[0]?.payload?.['ops']).toEqual([{ op: 'chapter-trim', chapter: 'open-the-scope', inSec: 0.5, outSec: 8 }]);
    node<HTMLInputElement>('video-out').value = '0.6'; node('video-out').dispatchEvent(new Event('change')); expect(messages('version.write')).toHaveLength(1);
  });
  it('reorders through the button and Alt+Arrow, preserving selected chapter id', async () => {
    node('video-move-down').click(); await settled(2);
    expect(messages('version.write')[0]?.payload?.['ops']).toEqual([{ op: 'chapter-move', chapter: 'open-the-scope', after: 'pick-a-plan' }]);
    expect(root().dataset['current']).toBe('open-the-scope');
    root().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true })); await settled(3);
    expect(messages('version.write')[1]?.payload?.['ops']).toEqual([{ op: 'chapter-move', chapter: 'open-the-scope', after: null }]);
  });
  it('picks a take and requests chapter media, while options chapters expose all editors without a player', async () => {
    const select = node<HTMLSelectElement>('video-take'); select.value = '_take-open-the-scope-2.webm'; select.dispatchEvent(new Event('change')); await settled(2);
    expect(messages('version.write')[0]?.payload?.['ops']).toEqual([{ op: 'chapter-take', chapter: 'open-the-scope', take: select.value }]);
    await vi.waitFor(() => expect(messages('artifact.media').some(m => (m.payload?.['ref'] as { chapter?: string })?.chapter === 'open-the-scope')).toBe(true));
    send('host.surface', { surface: 'options' }); send('host.tab', { tab: 'chapters' });
    await vi.waitFor(() => expect(root().dataset['surface']).toBe('options'));
    expect(document.getElementById('work')).toHaveAttribute('hidden'); expect(node('video-rename')).toBeTruthy();
    send('host.tab', { tab: 'captions' }); await vi.waitFor(() => expect(document.getElementById('chapters')).toHaveAttribute('hidden'));
  });
});

describe('video timing and caption overlays', () => {
  it('keeps the overlay hidden on a burned MP4 across chapter playback updates', async () => {
    expect(document.getElementById('caption')).toHaveAttribute('hidden');
    const player = node<HTMLVideoElement>('video-player');
    player.currentTime = demoCut4.chapters[1]!.startSec + 1; player.dispatchEvent(new Event('timeupdate'));
    expect(root().dataset['current']).toBe('pick-a-plan');
    expect(document.getElementById('caption')).toHaveAttribute('hidden');
  });
  it.each([
    { burnIn: true, ffmpeg: { ok: true, burnIn: false } },
    { burnIn: false, ffmpeg: { ok: true, burnIn: true } },
    { burnIn: true, ffmpeg: undefined },
  ])('overlays captions when style burnIn=$burnIn and ffmpeg=$ffmpeg', async ({ burnIn, ffmpeg }) => {
    const cut = { ...demoCut4 };
    if (ffmpeg === undefined) delete cut.ffmpeg; else cut.ffmpeg = ffmpeg;
    const player = await show({ ...cut, style: { ...cut.style, captions: { ...cut.style.captions, burnIn } } });
    const caption = document.getElementById('caption')!;
    expect(caption).not.toHaveAttribute('hidden'); expect(caption.textContent).toContain('Open the scope');
    player.currentTime = demoCut4.chapters[1]!.startSec + 1; player.dispatchEvent(new Event('timeupdate'));
    expect(caption).not.toHaveAttribute('hidden'); expect(caption.textContent).toContain('Pick the plan');
    player.currentTime = 0; player.dispatchEvent(new Event('timeupdate'));
    expect(caption).toHaveAttribute('hidden');
  });
  it('overlays a raw take preview and suppresses it again on the rendered MP4', async () => {
    send('host.surface', { surface: 'full', mode: 'advanced' });
    await vi.waitFor(() => expect(node('video-preview-take')).toBeTruthy());
    node('video-preview-take').click();
    await vi.waitFor(() => expect(document.getElementById('caption')).not.toHaveAttribute('hidden'));
    expect(messages('artifact.media').at(-1)?.payload).toEqual({ ref: { chapter: 'open-the-scope' } });
    node('video-chapter').click();
    await vi.waitFor(() => expect(messages('artifact.media').at(-1)?.payload).toEqual({ ref: 'video' }));
    expect(document.getElementById('caption')).toHaveAttribute('hidden');
  });
  it('honors captions off even when the video has no burned captions', async () => {
    const player = await show({ ...demoCut4, ffmpeg: { ok: true, burnIn: false }, style: { ...demoCut4.style, captions: { ...demoCut4.style.captions, on: false } } });
    player.currentTime = demoCut4.chapters[0]!.startSec + 1; player.dispatchEvent(new Event('timeupdate'));
    expect(document.getElementById('caption')).toHaveAttribute('hidden');
  });
  it.each([1, 4])('resolves the final duration of a %s-chapter recording from loadedmetadata and updates captions and timeline', async count => {
    const chapters = demoCut4.chapters.slice(0, count).map((c, i) => ({ ...c, startSec: i * 5, inSec: 0, outSec: i === count - 1 ? -1 : 5, durationSec: i === count - 1 ? -1 : 5 }));
    const player = await show({ ...demoCut4, takes: {}, chapters, ffmpeg: { ok: false, burnIn: false } });
    send('host.surface', { surface: 'full', mode: 'simple' });
    await vi.waitFor(() => expect(root().dataset['surface']).toBe('full'));
    const lastStart = (count - 1) * 5;
    player.currentTime = lastStart + 1; player.dispatchEvent(new Event('timeupdate'));
    expect(root().dataset['current']).toBe(chapters.at(-1)!.id);
    expect(document.getElementById('caption')).not.toHaveAttribute('hidden');
    expect(document.querySelectorAll('.duration')[count - 1]?.textContent).toBe('—');
    // Invalid metadata must leave the unknown duration intact.
    Object.defineProperty(player, 'duration', { configurable: true, value: Infinity }); player.dispatchEvent(new Event('loadedmetadata'));
    expect(document.querySelectorAll('.duration')[count - 1]?.textContent).toBe('—');
    Object.defineProperty(player, 'duration', { configurable: true, value: lastStart + 9 }); player.dispatchEvent(new Event('loadedmetadata'));
    expect(document.querySelectorAll('.duration')[count - 1]?.textContent).toBe('9.0s');
    expect((document.querySelectorAll<HTMLElement>('.segment-box')[count - 1]!.style.flex).split(' ')[0]).toBe('9');
    expect(player.currentTime).toBe(lastStart);
    player.currentTime = lastStart + 8; player.dispatchEvent(new Event('timeupdate'));
    expect(document.getElementById('caption')).not.toHaveAttribute('hidden');
    expect(document.getElementById('caption')?.textContent).toContain(chapters.at(-1)!.say.split(' ').slice(0, 3).join(' '));
    player.currentTime = lastStart + 9; player.dispatchEvent(new Event('timeupdate'));
    expect(document.getElementById('caption')).toHaveAttribute('hidden');
  });
});

describe('controls tabs publish and confirm the cut style', () => {
  it('publishes values on hello, applies one theme.set and confirms whole-tab truth', async () => {
    await vi.waitFor(() => expect(values('captions')).toEqual(videoValues(demoCut4.style, 'captions')));
    expect(values('theme')).toEqual(videoValues(demoCut4.style, 'theme'));
    send('options.changed', { tab: 'captions', id: 'on', value: false }, 'option-1');
    await vi.waitFor(() => expect(seen.find(m => m.re === 'option-1')?.payload).toMatchObject({ applied: true, rev: expect.any(Number), values: { ...videoValues(demoCut4.style, 'captions'), on: false } }));
    expect(messages('theme.set')).toHaveLength(1);
    expect(messages('theme.set')[0]?.payload).toEqual({ base: 1, tokens: { kind: 'video-style', style: { ...demoCut4.style, captions: { ...demoCut4.style.captions, on: false } } } });
    expect(values('captions')).toMatchObject({ on: false });
  });
  it('re-reads and retries once on head_moved, preserving another writer’s style changes', async () => {
    refuseTheme = true; send('options.changed', { tab: 'theme', id: 'titletext', value: 'A new title' }, 'option-2');
    await vi.waitFor(() => expect(seen.find(m => m.re === 'option-2')?.payload).toMatchObject({ applied: true, values: { titletext: 'A new title', accent: '#112233' } }));
    expect(messages('theme.set')).toHaveLength(2);
    expect(messages('theme.set')[1]?.payload?.['base']).toBe(2);
  });
  it('answers invalid options with the confirmed truth and performs no write', async () => {
    send('options.changed', { tab: 'captions', id: 'size', value: 99 }, 'invalid');
    await vi.waitFor(() => expect(seen.find(m => m.re === 'invalid')?.payload).toMatchObject({ applied: false, values: videoValues(demoCut4.style, 'captions') }));
    expect(messages('theme.set')).toHaveLength(0);
  });
  it('accepts a v1 hello and maps inline/full without v2 options events', async () => {
    send('host.teardown', {}); await new Promise(r => setTimeout(r, 30)); ch.port1.close(); ch.port2.close();
    document.body.replaceChildren(); start(); await open(1);
    expect(root().dataset['surface']).toBe('card'); expect(messages('options.values')).toHaveLength(0);
    send('host.size', { size: 'full' }); await vi.waitFor(() => expect(root().dataset['surface']).toBe('full'));
  });
});
