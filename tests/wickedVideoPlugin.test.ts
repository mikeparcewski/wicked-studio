import { Blob as NodeBlob } from 'node:buffer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoCut4, fakeDemoCutAdapter } from '../src/editors/fixtures/demoCut4.js';
import { chapterInventoryOf, checkOps } from '../src/editors/ops.js';
import { canonicalSurfaces, parseSurfaces } from '../src/editors/surfaces.js';
import surfaces from '../src/plugins/wicked-video/surfaces.json';
import { videoValues, type DemoCut } from '../src/editors/demoCutModel.js';
import { cutOfRecording } from '../src/editors/adapters/recording.js';
import type { Recording } from '../src/board/walkthroughModel.js';

const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id === undefined ? {} : { id }) });
interface Message { type?: string; id?: string; re?: string; ok?: boolean; payload?: Record<string, unknown> }
let start: () => void, initial = true, ch: MessageChannel;
let adapter: ReturnType<typeof fakeDemoCutAdapter>;
let seen: Message[] = [];
const ready: Message[] = [];
let refuseTheme = false, refuseMedia = false;
const createUrl = vi.fn(() => `blob:video-${Math.random()}`), revokeUrl = vi.fn();
const root = () => document.querySelector<HTMLElement>('[data-testid="video-editor"]')!;
const node = <T extends HTMLElement = HTMLButtonElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`)!;
const messages = (type: string) => seen.filter(m => m.type === type);
const values = (tab: string) => messages('options.values').filter(m => m.payload?.['tab'] === tab).at(-1)?.payload?.['values'];
const send = (type: string, payload: unknown, id?: string) => ch.port1.postMessage(env(type, payload, id));
const settled = async (version: number) => vi.waitFor(() => { expect(root().dataset['head']).toBe(String(version)); expect(node('video-rename')?.hasAttribute('disabled') ?? false).toBe(false); });
function recordingCut(): DemoCut {
  const rec: Recording = {
    kind: 'walkthrough', runId: 'run', step: 'review', planStep: 'plan', state: 'failed', cause: null,
    seat: { evaluator: 'reviewer', builders: [] }, sealed: true, video: 'take/video.mp4', poster: null,
    markers: [{ at: '0:00', sec: 0, title: 'Scope' }, { at: '0:12', sec: 12, title: 'Plan' }],
    script: null, exportable: false, scriptEditable: false,
    chapters: ['Scope', 'Missing', 'Plan'].map((title, i) => ({
      key: `ch${i + 1}`, title, blurb: `Say ${title}`, index: i + 1, total: 3,
      startSec: [0, null, 12][i]!, verdict: i === 2 ? 'FAIL' : i === 0 ? 'PASS' : null,
      recorded: i !== 1, takes: 1, failedAtSec: i === 2 ? 4 : null, failedAbsSec: i === 2 ? 16 : null,
      failedFrame: null, proves: [],
      checks: [{ id: 'screen', kind: 'on_screen', sentence: i === 2 ? '<b>Check Plan</b>' : `Check ${title}`,
        passed: i === 2 ? false : i === 0 ? true : null, atSec: i === 2 ? 4 : i === 0 ? 3 : null,
        atAbsSec: i === 2 ? 16 : i === 0 ? 3 : null, evidence: i === 2 ? ['plan/screen.png'] : [], detail: null, vaultEntry: null }],
    })),
  };
  return cutOfRecording(rec, 'Run');
}
async function show(cut: DemoCut): Promise<HTMLVideoElement> {
  await vi.waitFor(() => expect(node('video-player').getAttribute('src')).toMatch(/^blob:/));
  const oldSrc = node('video-player').getAttribute('src');
  adapter = fakeDemoCutAdapter({ ...cut, version: 2 }); send('artifact.changed', { head: 2 });
  await settled(2);
  await vi.waitFor(() => expect(node('video-player').getAttribute('src')).not.toBe(oldSrc));
  return node<HTMLVideoElement>('video-player');
}

async function open(protocol = 2, surface = 'card', size = surface === 'card' ? 'inline' : surface === 'options' ? 'pane' : 'full', initialSeek?: number): Promise<void> {
  adapter = fakeDemoCutAdapter(); seen = []; refuseTheme = false; refuseMedia = false;
  ch = new MessageChannel();
  ch.port1.onmessage = async (event: MessageEvent) => {
    const d = event.data as Message; seen.push(d);
    let result: unknown;
    if (d.type === 'artifact.read') {
      // Deliver evidence before the first read reply: the plugin has a port but no cut or media yet.
      if (initialSeek !== undefined) { send('host.selection', { anchors: [{ kind: 'time', atSec: initialSeek }] }); initialSeek = undefined; }
      result = await adapter.read();
    }
    else if (d.type === 'artifact.media') result = refuseMedia ? { error: 'unsupported', message: 'No video' } : await adapter.media();
    else if (d.type === 'version.write') {
      const r = await adapter.read(); if ('error' in r) throw new Error(r.message);
      const checked = checkOps(d.payload?.['ops'] as unknown[], chapterInventoryOf(r.content));
      result = checked.ok ? await adapter.write(d.payload?.['base'] as number, checked.items, d.payload?.['summary'] as string) : { error: checked.code, message: checked.message };
    } else if (d.type === 'theme.set') {
      if (refuseTheme) {
        refuseTheme = false;
        await adapter.theme(adapter.artifact().head, { kind: 'video-style', style: { ...demoCut4.style, theme: { ...demoCut4.style.theme, palette: 'custom', accent: '#112233' } } });
        result = { error: 'head_moved', message: 'The cut moved.' };
      } else result = await adapter.theme(d.payload?.['base'] as number, d.payload?.['tokens'] as Record<string, unknown>);
    } else return;
    const r = result as { error?: string; message?: string };
    ch.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: r.error === undefined, ...(r.error === undefined ? { payload: result } : { error: { code: r.error, message: r.message } }) });
  };
  window.dispatchEvent(Object.assign(new Event('message'), { data: env('host.hello', { protocol, size, surface, ...(surface === 'options' ? { tab: 'chapters' } : {}), mode: 'simple', grants: ['artifact.read', 'artifact.write', 'artifact.theme', 'media.read', 'selection.chip'], theme: { '--accent': '#123456' } }), ports: [ch.port2] }));
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
  it('seeks to an exact host time anchor on a loaded player without echoing a selection or writing', async () => {
    const player = node<HTMLVideoElement>('video-player');
    await vi.waitFor(() => expect(player.getAttribute('src')).toMatch(/^blob:/));
    Object.defineProperty(player, 'readyState', { configurable: true, value: 1 });
    player.dispatchEvent(new Event('loadedmetadata'));
    send('host.selection', { anchors: [{ kind: 'time', atSec: 34 }] });
    await vi.waitFor(() => expect(player.currentTime).toBe(34));
    expect(root().dataset['current']).toBe('invite-the-team');
    send('host.surface', { surface: 'full', mode: 'simple' });
    await vi.waitFor(() => expect(root().dataset['surface']).toBe('full'));
    expect(node('video-player')).toBe(player);
    expect(player.currentTime).toBe(34);
    player.currentTime = 0;
    send('host.selection', { anchors: [{ kind: 'time', atSec: 34 }] });
    await vi.waitFor(() => expect(player.currentTime).toBe(34));
    expect(messages('selection.set')).toHaveLength(0);
    expect(messages('version.write')).toHaveLength(0);
  });

  it('buffers a seek received before the initial read through media loading and metadata', async () => {
    send('host.teardown', {}); await new Promise(r => setTimeout(r, 30)); ch.port1.close(); ch.port2.close();
    document.body.replaceChildren(); start(); await open(2, 'card', 'inline', 34);
    const player = node<HTMLVideoElement>('video-player');
    await vi.waitFor(() => expect(player.getAttribute('src')).toMatch(/^blob:/));
    expect(player.currentTime).toBe(0);
    send('host.surface', { surface: 'full', mode: 'simple' });
    await vi.waitFor(() => expect(root().dataset['surface']).toBe('full'));
    player.dispatchEvent(new Event('loadedmetadata'));
    expect(player.currentTime).toBe(34);
    expect(root().dataset['current']).toBe('invite-the-team');
    expect(messages('selection.set')).toHaveLength(0);
    expect(messages('version.write')).toHaveLength(0);
  });

  it('keeps the newest pending time through metadata and ignores invalid times', async () => {
    const player = node<HTMLVideoElement>('video-player');
    await vi.waitFor(() => expect(player.getAttribute('src')).toMatch(/^blob:/));
    for (const atSec of [34, 13, -1, Infinity, NaN]) send('host.selection', { anchors: [{ kind: 'time', atSec }] });
    send('host.ping', {}, 'seeks-delivered');
    await vi.waitFor(() => expect(seen.some(m => m.re === 'seeks-delivered')).toBe(true));
    player.dispatchEvent(new Event('loadedmetadata'));
    expect(player.currentTime).toBe(13);
    expect(root().dataset['current']).toBe('pick-a-plan');
  });

  it('leaves a take preview and seeks on the combined recording when the host names a time', async () => {
    send('host.surface', { surface: 'full', mode: 'advanced' });
    await vi.waitFor(() => expect(node('video-preview-take')).toBeTruthy());
    const player = node<HTMLVideoElement>('video-player');
    await vi.waitFor(() => expect(player.getAttribute('src')).toMatch(/^blob:/));
    const combinedSrc = player.getAttribute('src');
    node('video-preview-take').click();
    await vi.waitFor(() => expect(player.getAttribute('src')).not.toBe(combinedSrc));
    player.dispatchEvent(new Event('loadedmetadata'));
    const previewSrc = player.getAttribute('src');
    send('host.selection', { anchors: [{ kind: 'time', atSec: 34 }] });
    await vi.waitFor(() => expect(player.getAttribute('src')).not.toBe(previewSrc));
    player.dispatchEvent(new Event('loadedmetadata'));
    expect(player.currentTime).toBe(34);
    expect(messages('artifact.media').at(-1)?.payload).toEqual({ ref: 'video' });
    expect(messages('selection.set')).toHaveLength(0);
  });

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
    // No playable video: the plugin asks for the still (a failed walkthrough's failing frame) instead.
    await vi.waitFor(() => expect(messages('artifact.media').some(m => m.payload?.['ref'] === 'poster')).toBe(true));
    expect(document.getElementById('poster')).toHaveAttribute('hidden');
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
    await new Promise(r => setTimeout(r, 30)); expect(messages('ui.key')).toHaveLength(0);
  });
  it('preserves rename text, selection, focus and original chapter across playback redraws and ignores a second Rename', async () => {
    node('video-rename').click();
    const input = node<HTMLInputElement>('video-rename-input'); input.value = 'Keep my title';
    input.dispatchEvent(new Event('input')); input.setSelectionRange(4, 7);
    node('video-rename').click();
    expect(document.querySelectorAll('[data-testid="video-rename-input"]')).toHaveLength(1);
    expect(node('video-rename-input')).toBe(input);
    const player = node<HTMLVideoElement>('video-player');
    player.currentTime = demoCut4.chapters[1]!.startSec + 1; player.dispatchEvent(new Event('timeupdate'));
    const restored = node<HTMLInputElement>('video-rename-input');
    expect(restored.value).toBe('Keep my title'); expect(document.activeElement).toBe(restored);
    expect([restored.selectionStart, restored.selectionEnd]).toEqual([4, 7]);
    expect(root().dataset['current']).toBe('pick-a-plan');
    node('video-rename').click(); expect(document.querySelectorAll('[data-testid="video-rename-input"]')).toHaveLength(1);
    restored.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settled(2);
    expect(messages('version.write')[0]?.payload?.['ops']).toEqual([{ op: 'chapter-rename', chapter: 'open-the-scope', title: 'Keep my title' }]);
    expect(node('video-rename-input')).toBeNull();
  });
  it('restores focused chapter ids containing selector punctuation by literal dataset equality', async () => {
    const id = 'scope"[odd]\\id';
    const cut = { ...demoCut4, chapters: demoCut4.chapters.map((c, i) => i === 0 ? { ...c, id } : c) };
    const player = await show(cut);
    const focused = node('video-chapter'); focused.focus(); expect(focused.dataset['chapter']).toBe(id);
    player.currentTime = cut.chapters[1]!.startSec + 1;
    expect(() => player.dispatchEvent(new Event('timeupdate'))).not.toThrow();
    expect((document.activeElement as HTMLElement).dataset['chapter']).toBe(id);
  });
  it.each([-1, 0])('does not trim a chapter with duration %s using pointer or keyboard handles', async durationSec => {
    const chapter = { ...demoCut4.chapters[0]!, inSec: 0, outSec: durationSec };
    await show({ ...demoCut4, chapters: [chapter], takes: {} });
    const handle = node('video-trim-out'); expect(handle).toBeDisabled();
    handle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 100 }));
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await new Promise(r => setTimeout(r, 30)); expect(messages('version.write')).toHaveLength(0);
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

describe('native control host keys', () => {
  beforeEach(async () => {
    send('host.surface', { surface: 'full', mode: 'advanced' });
    await vi.waitFor(() => expect(node('video-take')).toBeTruthy());
  });
  it.each(['say', 'video-in', 'video-out', 'video-take'])('forwards Escape from %s', async id => {
    const control = id === 'say' ? document.getElementById(id)! : node(id);
    control.focus();
    const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); control.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(messages('ui.key').at(-1)?.payload).toEqual({ key: 'Escape' }));
  });
  it('forwards boundary Tab from the caption textarea and keeps interior Tab and arrows native', async () => {
    const caption = document.getElementById('say')!; caption.focus();
    caption.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(messages('ui.key')).toHaveLength(1));
    expect(messages('ui.key')[0]?.payload).toEqual({ key: 'Tab' });
    const input = node('video-in'); input.focus();
    for (const key of ['Tab', 'ArrowRight']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    await new Promise(r => setTimeout(r, 30)); expect(messages('ui.key')).toHaveLength(1); expect(messages('version.write')).toHaveLength(0);
  });
  it.each(['video-in', 'video-out', 'video-take'])('forwards Tab and Shift+Tab when %s is at the boundary', async id => {
    send('host.surface', { surface: 'options' }); send('host.tab', { tab: 'chapters' });
    await vi.waitFor(() => expect(root().dataset['surface']).toBe('options'));
    const control = node(id);
    // Only this native control is in the focus ring: exercise both boundaries for each kind.
    root().querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]').forEach(c => { if (c !== control) c.tabIndex = -1; });
    control.focus();
    for (const shiftKey of [false, true]) {
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }); control.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    await vi.waitFor(() => expect(messages('ui.key').map(m => m.payload)).toEqual([{ key: 'Tab' }, { key: 'Shift+Tab' }]));
  });
  it('forwards host chords from native controls', async () => {
    const control = node('video-take'); control.focus();
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', altKey: true, bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(messages('ui.key').map(m => m.payload)).toEqual([{ key: 'Mod+K' }, { key: 'Alt+J' }]));
  });
});

describe('walkthrough proof in the video editor', () => {
  it('shows verdicts and check marks at absolute moments, with evidence as literal text in Advanced', async () => {
    const player = await show(recordingCut());
    send('host.surface', { surface: 'full', mode: 'advanced' });
    await vi.waitFor(() => expect(root().dataset['mode']).toBe('advanced'));
    Object.defineProperty(player, 'duration', { configurable: true, value: 20 }); player.dispatchEvent(new Event('loadedmetadata'));
    expect(Array.from(document.querySelectorAll('.chapter-verdict')).map(n => n.textContent)).toEqual(['✓', '✗']);
    expect(document.getElementById('proof-summary')?.textContent).toBe('FAIL · Failed at 16.0s');
    const marks = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="video-check-mark"]'));
    expect(marks.map(m => [m.dataset['sec'], m.dataset['state'], m.style.left])).toEqual([['3', 'PASS', '15%'], ['16', 'FAIL', '80%']]);
    marks[1]!.click(); expect(player.currentTime).toBe(16); expect(root().dataset['current']).toBe('ch3');
    expect(document.getElementById('inspectors')).not.toHaveAttribute('hidden');
    const checks = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="video-check"]'));
    expect(checks).toHaveLength(3);
    expect(checks[1]?.textContent).toBe('PENDING · Missing · Check Missing');
    expect(checks[2]?.textContent).toBe('FAIL · Plan · <b>Check Plan</b> · Evidence: plan/screen.png · 16.0s');
    expect(document.getElementById('check-list')?.querySelector('b, a, img, script')).toBeNull();
    send('host.mode', { mode: 'simple' }, 'proof-simple');
    await vi.waitFor(() => expect(document.getElementById('inspectors')).toHaveAttribute('hidden'));
    expect(document.querySelectorAll('[data-testid="video-check-mark"]')).toHaveLength(2);
  });
  it('marks the failure moment even when no check has a time', async () => {
    const cut = recordingCut(); cut.proof!.checks = cut.proof!.checks.map(k => ({ ...k, atSec: null }));
    const player = await show(cut);
    send('host.surface', { surface: 'full', mode: 'advanced' });
    await vi.waitFor(() => expect(root().dataset['mode']).toBe('advanced'));
    Object.defineProperty(player, 'duration', { configurable: true, value: 20 }); player.dispatchEvent(new Event('loadedmetadata'));
    expect(document.querySelectorAll('[data-testid="video-check-mark"]')).toHaveLength(0);
    expect(node('video-failure-mark').dataset).toMatchObject({ sec: '16', state: 'FAIL' });
    expect(node('video-failure-mark').style.left).toBe('80%');
  });
});

describe('video timing and caption overlays', () => {
  it('keeps [0, null, 12] chapters visible but never seeks or captions the absent chapter, even after metadata', async () => {
    const player = await show(recordingCut());
    const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="video-chip"]'));
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="video-chapter"]'));
    expect(chips).toHaveLength(3); expect(rows).toHaveLength(3);
    for (const control of [chips[1]!, rows[1]!]) { expect(control).toBeDisabled(); expect(control.title).toBe('Not in this recording'); }
    player.currentTime = 5;
    chips[1]!.click(); rows[1]!.click();
    send('host.selection', { anchors: [{ kind: 'chapter', id: 'ch2' }] });
    await new Promise(r => setTimeout(r, 30)); expect(player.currentTime).toBe(5); expect(root().dataset['current']).toBe('ch1');
    player.currentTime = 13; player.dispatchEvent(new Event('timeupdate'));
    expect(root().dataset['current']).toBe('ch3'); expect(document.getElementById('caption')?.textContent).toBe('Say Plan');
    Object.defineProperty(player, 'duration', { configurable: true, value: 20 }); player.dispatchEvent(new Event('loadedmetadata'));
    expect(document.querySelectorAll('.duration')[1]?.textContent).toBe('—');
    expect(document.querySelectorAll('.duration')[2]?.textContent).toBe('8.0s');
    player.currentTime = 20; player.dispatchEvent(new Event('timeupdate')); expect(document.getElementById('caption')).toHaveAttribute('hidden');
    send('host.action', { id: 'prev' }, 'skip-missing');
    await vi.waitFor(() => expect(seen.find(m => m.re === 'skip-missing')?.payload).toEqual({ handled: true, status: 'Chapter 1 of 3 · Scope' }));
    expect(player.currentTime).toBe(0);
    root().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); expect(player.currentTime).toBe(12);
  });
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
  it('publishes crew’s resolved skin colours and Archivo and ignores later host colour tokens', async () => {
    const resolvedTheme = { background: '#101112', foreground: '#fafafa', accent: '#abcdef', font: 'Archivo' as const };
    await show({ ...demoCut4, resolvedTheme });
    await vi.waitFor(() => expect(values('theme')).toMatchObject({ palette: 'studio', ...resolvedTheme, font: 'archivo' }));
    expect(root().style.getPropertyValue('--video-accent')).toBe(resolvedTheme.accent);
    expect(root().style.getPropertyValue('--video-font')).toBe('Archivo');
    send('host.theme', { theme: { '--surface-base': '#000000', '--ink-high': '#ffffff', '--accent': '#112233' } });
    await vi.waitFor(() => expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#112233'));
    expect(values('theme')).toMatchObject({ background: resolvedTheme.background, accent: resolvedTheme.accent });
    const fontControl = surfaces.options.tabs.find(t => t.id === 'theme')?.controls?.find(c => c.id === 'font');
    expect(fontControl?.options).toContainEqual({ id: 'archivo', label: 'Archivo' });
  });
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
    send('host.size', { size: 'pane' }); await vi.waitFor(() => expect(root().dataset['surface']).toBe('full'));
    expect(document.getElementById('work')).not.toHaveAttribute('hidden');
    send('host.size', { size: 'inline' }); await vi.waitFor(() => expect(root().dataset['surface']).toBe('card'));
    send('host.size', { size: 'full' }); await vi.waitFor(() => expect(root().dataset['surface']).toBe('full'));
  });
  it('keeps a protocol-1 pane hello and later pane resize on the full editor', async () => {
    send('host.teardown', {}); await new Promise(r => setTimeout(r, 30)); ch.port1.close(); ch.port2.close();
    document.body.replaceChildren(); start(); await open(1, 'full', 'pane');
    expect(root().dataset['surface']).toBe('full'); expect(document.getElementById('work')).not.toHaveAttribute('hidden');
    send('host.size', { size: 'inline' }); await vi.waitFor(() => expect(root().dataset['surface']).toBe('card'));
    send('host.size', { size: 'pane' }); await vi.waitFor(() => expect(root().dataset['surface']).toBe('full'));
    await vi.waitFor(() => expect(node('video-player').getAttribute('src')).toMatch(/^blob:/));
  });
  it.each(['host.size', 'host.surface'])('requests media when %s moves an options-only instance to card or full', async type => {
    send('host.teardown', {}); await new Promise(r => setTimeout(r, 30)); ch.port1.close(); ch.port2.close();
    document.body.replaceChildren(); start(); await open(2, 'options');
    expect(root().dataset['surface']).toBe('options'); expect(messages('artifact.media')).toHaveLength(0);
    send(type, type === 'host.size' ? { size: 'inline' } : { surface: 'card' });
    await vi.waitFor(() => expect(node('video-player').getAttribute('src')).toMatch(/^blob:/));
    expect(document.getElementById('work')).not.toHaveAttribute('hidden');
    const before = messages('artifact.media').length;
    send('host.surface', { surface: 'options' }); await vi.waitFor(() => expect(root().dataset['surface']).toBe('options'));
    send(type, type === 'host.size' ? { size: 'full' } : { surface: 'full' });
    await vi.waitFor(() => expect(messages('artifact.media')).toHaveLength(before + 1));
    expect(document.getElementById('work')).not.toHaveAttribute('hidden');
  });
});
