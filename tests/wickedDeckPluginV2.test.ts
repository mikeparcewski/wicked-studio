import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import surfaces from '../src/plugins/wicked-deck/surfaces.json';
import { canonicalSurfaces, parseSurfaces } from '../src/editors/surfaces.js';
import { SAMPLE_DECK } from '../src/editors/fakeAdapter.js';
import { copyTokens, THEMES } from '../src/plugins/_shared/style.js';

type Message = { type?: string; id?: string; re?: string; ok?: boolean; payload?: Record<string, unknown> };
const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id === undefined ? {} : { id }) });
const seen: Message[] = [];
let channel: MessageChannel;
let head = 7;
let moves = 0;
let refuseTheme = false;
let holdReads = false;
let reads: Message[] = [];
let readHtml = SAMPLE_DECK;
let fullscreenGranted = true;
const replyRead = (d: Message): void => channel.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: true, payload: { version: head, content: { type: 'html', html: readHtml } } });
let start: () => void;
const ready = vi.spyOn(window.parent, 'postMessage');
// The one window message, as it arrives (the spy above misses a post made while the module evaluates).
const readyMsgs: Message[] = [];
window.addEventListener('message', (e: MessageEvent) => { if ((e.data as Message | null)?.type === 'plugin.ready') readyMsgs.push(e.data as Message); });
const deck = (): HTMLElement => document.querySelector('[data-testid=deck-editor]')!;
const node = <T extends HTMLElement = HTMLElement>(id: string): T => document.querySelector(`[data-testid="${id}"]`)!;
const stageFrame = (): HTMLIFrameElement => document.querySelector('[data-testid=deck-frame]')!;
const messages = (type: string): Message[] => seen.filter((m) => m.type === type);
const send = (type: string, payload: unknown, id?: string): void => channel.port1.postMessage(env(type, payload, id));
const action = async (id: string): Promise<Record<string, unknown>> => {
  const rid = `action-${seen.length}`; send('host.action', { id }, rid);
  await vi.waitFor(() => expect(seen.find((m) => m.re === rid)).toBeDefined());
  return seen.find((m) => m.re === rid)!.payload!;
};
const hello = async (surface: 'card' | 'options', tab?: string): Promise<void> => {
  channel = new MessageChannel();
  channel.port1.onmessage = (event: MessageEvent<Message>) => {
    const d = event.data; seen.push(d);
    if (d.type === 'artifact.read') {
      if (holdReads) reads.push(d); else replyRead(d);
    } else if (d.type === 'theme.set') {
      if (moves > 0 || refuseTheme) {
        moves = Math.max(0, moves - 1); head += 1;
        channel.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: false, error: { code: 'head_moved', message: 'the artifact changed since' }, payload: { head } });
      } else {
        head += 1;
        channel.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: true, payload: { version: head } });
      }
    } else if (d.type === 'version.write') {
      head += 1;
      channel.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: true, payload: { version: head } });
    } else if (d.type === 'ui.fullscreen') {
      channel.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: true, payload: { entered: true } });
    }
  };
  window.dispatchEvent(Object.assign(new Event('message'), { data: env('host.hello', { protocol: 2, surface, tab, size: 'pane', grants: ['artifact.read', 'artifact.write', 'artifact.theme', 'selection.chip', ...(fullscreenGranted ? ['ui.fullscreen'] : [])], theme: { '--ink-high': '#eee', '--surface-base': '#111' } }), ports: [channel.port2] }));
  await vi.waitFor(() => expect(deck().dataset['head']).toBe(String(head)));
};
const bridge = (data: unknown, source = stageFrame().contentWindow): void => {
  window.dispatchEvent(new MessageEvent('message', { data, source }));
};
afterAll(() => { channel.port1.close(); channel.port2.close(); ready.mockRestore(); });

describe('wicked-deck protocol 2 card and full', () => {
  beforeAll(async () => {
    document.body.replaceChildren();
    const template = readFileSync(join(process.cwd(), 'src', 'plugins', 'wicked-deck', 'template.html'), 'utf8');
    const css = document.createElement('style'); css.textContent = template.match(/<style>([\s\S]*?)<\/style>/)![1]!; document.head.append(css);
    ({ start } = await import('../src/plugins/wicked-deck/plugin.js'));
    await hello('card');
  }, 20_000);
  it('announces [1,2] and the unchanged valid surfaces declaration', async () => {
    await vi.waitFor(() => expect(readyMsgs.length).toBeGreaterThan(0));
    const announcement = readyMsgs[0]!;
    expect(announcement.payload?.['protocol']).toEqual([1, 2]);
    const expected = parseSurfaces(surfaces); const actual = parseSurfaces(announcement.payload?.['surfaces']);
    expect(expected.ok).toBe(true); expect(actual.ok).toBe(true);
    if (expected.ok && actual.ok) expect(canonicalSurfaces(actual.value)).toBe(canonicalSurfaces(expected.value));
  });
  it('shows a large 16:9 slide with no strip, tools or notes and supports pointer input', () => {
    expect(deck().dataset['surface']).toBe('card');
    expect(node('deck-strip').hidden).toBe(true); expect(node('deck-tools').hidden).toBe(true);
    expect(node('deck-notes-tab').hidden).toBe(true);
    expect(getComputedStyle(deck()).pointerEvents).toBe('auto');
    const stage = node('deck-stage');
    Object.defineProperties(stage, { clientWidth: { value: 960, configurable: true }, clientHeight: { value: 540, configurable: true } });
    window.dispatchEvent(new Event('resize'));
    expect(stageFrame().srcdoc).toContain('__wickedInstrumentBridge');
    expect(stageFrame().srcdoc).toContain("type:'deck-extents'");
    expect(stageFrame().style.width).toBe('1280px'); expect(stageFrame().style.height).toBe('720px');
    expect(stageFrame().style.transform).toBe('scale(0.75)');
    expect(document.querySelector<HTMLElement>('#slide-box')!.style.width).toBe('960px');
  });
  it('card clicks select a line or slide and keep editing and slide shortcuts inert', async () => {
    stageFrame().dispatchEvent(new Event('load'));
    bridge({ v: 1, type: 'wid-inventory', widMap: { 'slide-0-heading-1': { x: 10, y: 20, top: 20, left: 10, right: 210, bottom: 50, width: 200, height: 30 } }, blocks: { 'slide-0-heading-1': { text: 'Library room booking', composite: false } }, scrollX: 0, scrollY: 0 });
    const writes = messages('version.write').length;
    for (const wid of ['section-0', 'slide-0-heading-1']) {
      bridge({ v: 1, type: 'wid-click', wid });
      await vi.waitFor(() => expect(messages('selection.set').at(-1)?.payload).toEqual({ anchors: [{ kind: 'element', id: wid }] }));
    }
    for (const init of [
      { key: 'Enter' }, { key: 'x' }, { key: 'N', metaKey: true, shiftKey: true },
      { key: 'd', metaKey: true }, { key: 'Backspace', metaKey: true },
      { key: 'ArrowUp', altKey: true }, { key: 'ArrowDown', altKey: true },
    ]) node('deck-handle').dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(messages('ui.typed').at(-1)?.payload).toEqual({ grapheme: 'x' }));
    expect(node('deck-edit-input').hidden).toBe(true); expect(messages('version.write')).toHaveLength(writes);
  });
  it('answers next/prev with status, relays the stable slide anchor, and shows the CURRENT slide', async () => {
    expect(await action('prev')).toEqual({ handled: false });
    expect(await action('next')).toEqual({ handled: true, status: 'Slide 2 of 4' });
    expect(deck().dataset['current']).toBe('s-first'); expect(stageFrame().title).toBe('Slide 2');
    expect(messages('selection.set').at(-1)!.payload).toEqual({ anchors: [{ kind: 'element', id: 'section-1' }] });
    expect(await action('next')).toEqual({ handled: true, status: 'Slide 3 of 4' });
    expect(await action('next')).toEqual({ handled: true, status: 'Slide 4 of 4' });
    expect(await action('next')).toEqual({ handled: false });
    expect(await action('prev')).toEqual({ handled: true, status: 'Slide 3 of 4' });
    expect(await action('unknown')).toEqual({ handled: false });
  });
  it('morphs to full without replacing the frame; fits without a maximum and supports 100%', async () => {
    const frame = stageFrame(); const announcements = ready.mock.calls.length;
    send('host.surface', { surface: 'full' });
    await vi.waitFor(() => expect(deck().dataset['surface']).toBe('full'));
    expect(stageFrame()).toBe(frame); expect(ready.mock.calls.length).toBe(announcements);
    expect(node('deck-strip').hidden).toBe(false); expect(node('deck-tools').hidden).toBe(false);
    expect(node('deck-fit').textContent).toBe('Fit'); expect(node('deck-zoom-100').textContent).toBe('100%');
    const stage = node('deck-stage');
    Object.defineProperties(stage, { clientWidth: { value: 2560, configurable: true }, clientHeight: { value: 1500, configurable: true } });
    window.dispatchEvent(new Event('resize'));
    expect(frame.style.transform).toBe('scale(2)');
    expect(document.querySelector<HTMLElement>('#slide-box')!.style.top).toBe('30px');
    node<HTMLButtonElement>('deck-zoom-100').click();
    expect(frame.style.transform).toBe('scale(1)'); expect(stage.dataset['zoom']).toBe('100');
    expect(getComputedStyle(stage).overflow).toBe('auto');
    expect(node('deck-zoom-100').getAttribute('aria-pressed')).toBe('true');
    stage.scrollLeft = 240; stage.scrollTop = 180;
    node<HTMLButtonElement>('deck-fit').click(); expect(frame.style.transform).toBe('scale(2)');
    expect([stage.scrollLeft, stage.scrollTop]).toEqual([0, 0]);
    expect(node('deck-fit').getAttribute('aria-pressed')).toBe('true');
    expect(node('deck-zoom-100').getAttribute('aria-pressed')).toBe('false');
    expect(getComputedStyle(document.querySelector('#slide-box')!).overflow).toBe('hidden');
    expect(frame.srcdoc).toContain('[data-wi-deck-current]{position:absolute!important;left:0!important;top:0!important;width:1280px!important;height:720px!important');
  });
  it('marks overflowing measured content at the bottom/right and rejects foreign or malformed measurements', () => {
    const frame = stageFrame(); frame.dispatchEvent(new Event('load'));
    const bottom = document.querySelector<HTMLElement>('[data-testid=deck-cutoff][data-edge=bottom]')!;
    const right = document.querySelector<HTMLElement>('[data-testid=deck-cutoff][data-edge=right]')!;
    bridge({ v: 1, type: 'deck-extents', width: 1400, height: 900 }, window);
    expect(bottom.hidden).toBe(true);
    bridge({ v: 1, type: 'wid-inventory', widMap: { text: { x: 50, y: 690, top: 690, left: 50, right: 1350, bottom: 810, width: 1300, height: 120 } }, scrollX: 0, scrollY: 0 });
    expect(bottom.hidden).toBe(false); expect(right.hidden).toBe(false);
    expect(bottom.textContent).toBe('Cut off below'); expect(right.textContent).toBe('Cut off right');
    expect(bottom.style.top).toBe('1469px'); expect(right.style.left).toBe('2559px');
    bridge({ v: 1, type: 'wid-inventory', widMap: {}, scrollX: 0, scrollY: 0 });
    expect(bottom.hidden).toBe(true); expect(right.hidden).toBe(true);
    bridge({ v: 1, type: 'deck-extents', width: 1280, height: Number.NaN }); expect(bottom.hidden).toBe(true);
    bridge({ v: 1, type: 'deck-extents', width: 1280, height: 850 }); expect(bottom.hidden).toBe(false); expect(right.hidden).toBe(true);
  });
  it('Full screen uses the host request and Present still enters and leaves presentation', async () => {
    const before = messages('ui.fullscreen').length;
    node<HTMLButtonElement>('deck-fullscreen').click();
    await vi.waitFor(() => expect(messages('ui.fullscreen')).toHaveLength(before + 1));
    node<HTMLButtonElement>('deck-zoom-100').click();
    const stage = node('deck-stage'); stage.scrollLeft = 240; stage.scrollTop = 180;
    node<HTMLButtonElement>('deck-present').click();
    await vi.waitFor(() => expect(messages('ui.fullscreen')).toHaveLength(before + 2));
    expect(deck().dataset['present']).toBe('true'); expect(node('deck-tools').hidden).toBe(true);
    expect([stage.scrollLeft, stage.scrollTop]).toEqual([0, 0]);
    expect(node('deck-fit').getAttribute('aria-pressed')).toBe('true');
    expect(node('deck-zoom-100').getAttribute('aria-pressed')).toBe('false');
    const writes = messages('version.write').length;
    for (const init of [{ key: 'N', metaKey: true, shiftKey: true }, { key: 'd', metaKey: true }, { key: 'Backspace', metaKey: true }, { key: 'ArrowUp', altKey: true }, { key: 'ArrowDown', altKey: true }]) {
      deck().dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true }));
    }
    channel.port1.postMessage(env('host.ping', {}, 'present-keys'));
    await vi.waitFor(() => expect(seen.some((m) => m.re === 'present-keys')).toBe(true));
    expect(messages('version.write')).toHaveLength(writes);
    deck().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); expect(deck().dataset['present']).toBe('false');
  });
  it('morphs back to the same current card slide with no second ready', async () => {
    const frame = stageFrame(); const stage = node('deck-stage'); stage.scrollLeft = 240; stage.scrollTop = 180;
    send('host.surface', { surface: 'card' });
    await vi.waitFor(() => expect(deck().dataset['surface']).toBe('card'));
    expect(stageFrame()).toBe(frame); expect(deck().dataset['current']).toBe('s-staff');
    expect([stage.scrollLeft, stage.scrollTop]).toEqual([0, 0]);
    expect(node('deck-fit').getAttribute('aria-pressed')).toBe('true');
    expect(node('deck-zoom-100').getAttribute('aria-pressed')).toBe('false');
    expect(node('deck-tools').hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-testid=deck-cutoff][data-edge=bottom]')!.hidden).toBe(true);
  });
});

describe('wicked-deck protocol 2 options', () => {
  beforeAll(async () => {
    channel.port1.close(); channel.port2.close(); seen.length = 0;
    document.body.replaceChildren(); start(); holdReads = true; reads = [];
    const loaded = hello('options', 'style');
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    send('host.selection', { anchors: [{ kind: 'element', id: 'slide-2-paragraph-1' }] });
    channel.port1.postMessage(env('host.ping', {}, 'early-selection'));
    await vi.waitFor(() => expect(seen.some((m) => m.re === 'early-selection')).toBe(true));
    holdReads = false; replyRead(reads[0]!); await loaded;
  }, 20_000);
  it('resolves an early line anchor to its containing slide and retains that slide after the line disappears', async () => {
    expect(deck().dataset['current']).toBe('s-staff');
    readHtml = SAMPLE_DECK.replace('data-wid="slide-2-paragraph-1"', 'data-wid="replacement-line"');
    head += 1; send('artifact.changed', { version: head });
    await vi.waitFor(() => expect(deck().dataset['head']).toBe(String(head)));
    expect(deck().dataset['current']).toBe('s-staff'); readHtml = SAMPLE_DECK;
  });
  it('forwards host chords and boundary Tab from Style while leaving native typing alone', async () => {
    const controls = Array.from(node('deck-style').querySelectorAll<HTMLElement>('button, input, select'));
    const before = messages('ui.key').length;
    for (const [target, init] of [
      [controls[0]!, { key: 'Tab', shiftKey: true }], [controls.at(-1)!, { key: 'Tab' }],
      [controls[3]!, { key: 'Escape' }], [controls[3]!, { key: 'k', metaKey: true }],
      [controls[3]!, { key: 's', code: 'KeyS', altKey: true }],
    ] as const) target.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }));
    const typing = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }); controls[3]!.dispatchEvent(typing);
    expect(typing.defaultPrevented).toBe(false);
    await vi.waitFor(() => expect(messages('ui.key').slice(before).map((m) => m.payload?.['key'])).toEqual(['Shift+Tab', 'Tab', 'Escape', 'Mod+K', 'Alt+S']));
  });
  it('mounts Style for the hello tab, readable in the host theme', () => {
    expect(node('deck-style').hidden).toBe(false); expect(node('deck-style').textContent).toContain('Corporate Light');
    expect(node('deck-stage').hidden).toBe(true); expect(node('deck-strip').hidden).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--ink-high')).toBe('#eee');
  });
  it('sends one theme.set with the current head and exact selected theme tokens', async () => {
    const base = head;
    node('deck-style').querySelector<HTMLButtonElement>('[data-theme="midnight-purple"]')!.click();
    await vi.waitFor(() => expect(node('deck-style').querySelector('[role=status]')?.textContent).toBe('Theme applied.'));
    expect(messages('theme.set')).toHaveLength(1);
    expect(messages('theme.set')[0]!.payload).toEqual({ base, tokens: copyTokens(THEMES[1]!) });
    expect(deck().dataset['head']).toBe(String(head));
  });
  it('re-reads a moved head and retries theme.set only once with the same tokens', async () => {
    const before = messages('theme.set').length; const base = head; moves = 1;
    node('deck-style').querySelector<HTMLButtonElement>('[data-theme="warm-dark"]')!.click();
    await vi.waitFor(() => expect(messages('theme.set')).toHaveLength(before + 2));
    await vi.waitFor(() => expect(node('deck-style').querySelector('[role=status]')?.textContent).toBe('Theme applied.'));
    const writes = messages('theme.set').slice(before);
    expect(writes.map((m) => m.payload?.['base'])).toEqual([base, base + 1]);
    expect(writes.map((m) => m.payload?.['tokens'])).toEqual([copyTokens(THEMES[2]!), copyTokens(THEMES[2]!)]);
    const first = seen.indexOf(writes[0]!); const retry = seen.indexOf(writes[1]!);
    expect(seen.slice(first + 1, retry).some((m) => m.type === 'artifact.read' && Object.keys(m.payload!).length === 0)).toBe(true);
  });
  it('waits for the retry read and stops if that read fails', async () => {
    const before = messages('theme.set').length; moves = 1; holdReads = true; reads = [];
    node('deck-style').querySelector<HTMLButtonElement>('[data-theme="warm-dark"]')!.click();
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    expect(messages('theme.set')).toHaveLength(before + 1);
    channel.port1.postMessage({ p: 'wicked.editor', v: 1, re: reads[0]!.id, ok: false, error: { code: 'unavailable', message: 'Cannot read the deck' } });
    await vi.waitFor(() => expect(node('deck-style').querySelector('[role=status]')?.textContent).toContain('Cannot read the deck'));
    expect(messages('theme.set')).toHaveLength(before + 1); holdReads = false;
  });
  it('stops after a second moved-head refusal and shows the outcome', async () => {
    const before = messages('theme.set').length; refuseTheme = true;
    node('deck-style').querySelector<HTMLButtonElement>('[data-theme="corporate-light"]')!.click();
    await vi.waitFor(() => expect(node('deck-style').querySelector('[role=status]')?.textContent).toContain('the artifact changed since'));
    expect(messages('theme.set')).toHaveLength(before + 2);
    expect(deck().dataset['head']).toBe(String(head)); refuseTheme = false;
  });
  it('host.tab switches to notes, follows slide selection without echoing, and saves notes-set on blur', async () => {
    send('host.tab', { tab: 'notes' }); send('host.selection', { anchors: [{ kind: 'element', id: 's-intro' }] });
    await vi.waitFor(() => expect(node('deck-notes-tab').hidden).toBe(false));
    expect(node('deck-style').hidden).toBe(true);
    const notes = node<HTMLTextAreaElement>('deck-notes'); expect(notes.value).toBe('Open with the waiting-list numbers.');
    const before = messages('selection.set').length;
    send('host.selection', { anchors: [{ kind: 'element', id: 's-first' }] });
    await vi.waitFor(() => expect(deck().dataset['current']).toBe('s-first'));
    expect(notes.value).toBe(''); expect(messages('selection.set')).toHaveLength(before);
    const forwarded = messages('ui.key').length;
    for (const init of [{ key: 'Escape' }, { key: 'Tab', shiftKey: true }, { key: 'Tab' }, { key: 'k', metaKey: true }, { key: 's', code: 'KeyS', altKey: true }]) {
      notes.focus(); notes.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }));
      expect(document.activeElement).not.toBe(node('deck-handle'));
    }
    await vi.waitFor(() => expect(messages('ui.key').slice(forwarded).map((m) => m.payload?.['key'])).toEqual(['Escape', 'Shift+Tab', 'Tab', 'Mod+K', 'Alt+S']));
    const base = head; notes.focus(); notes.value = '<b>Speaker words</b>'; notes.blur();
    await vi.waitFor(() => expect(messages('version.write')).toHaveLength(1));
    expect(messages('version.write')[0]!.payload).toEqual({ base, ops: [{ op: 'notes-set', slide: 's-first', text: '<b>Speaker words</b>' }], summary: 'slide 2’s notes' });
    expect(node('deck-notes-tab').querySelector('b')).toBeNull();
    await vi.waitFor(() => expect(deck().dataset['head']).toBe(String(head)));
    send('host.tab', { tab: 'style' }); await vi.waitFor(() => expect(node('deck-style').hidden).toBe(false));
    expect(node('deck-notes-tab').hidden).toBe(true);
  });
});


describe('wicked-deck with no frame or fullscreen grant', () => {
  beforeAll(async () => {
    channel.port1.close(); channel.port2.close(); seen.length = 0;
    document.body.replaceChildren(); start(); fullscreenGranted = false; readHtml = '';
    await hello('card'); send('host.surface', { surface: 'full' });
    await vi.waitFor(() => expect(deck().dataset['surface']).toBe('full'));
  });
  it('hides Full screen without its grant and updates Fit/100% without a mounted frame', () => {
    expect(stageFrame()).toBeNull(); expect(node('deck-fullscreen').hidden).toBe(true);
    node<HTMLButtonElement>('deck-zoom-100').click();
    expect(node('deck-fit').getAttribute('aria-pressed')).toBe('false');
    expect(node('deck-zoom-100').getAttribute('aria-pressed')).toBe('true');
    const stage = node('deck-stage'); stage.scrollLeft = 100; stage.scrollTop = 120;
    node<HTMLButtonElement>('deck-fit').click();
    expect([stage.scrollLeft, stage.scrollTop]).toEqual([0, 0]);
    expect(node('deck-fit').getAttribute('aria-pressed')).toBe('true');
    expect(node('deck-zoom-100').getAttribute('aria-pressed')).toBe('false');
  });
});
