import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_PAGE } from '../src/editors/fakeAdapter.js';
import { copyTokens, THEMES } from '../src/plugins/_shared/style.js';

type Message = { type?: string; id?: string; re?: string; payload?: Record<string, unknown> };
const env = (type: string, payload: unknown) => ({ p: 'wicked.editor', v: 1, type, payload });
let start: () => void;
let channel: MessageChannel;
let head: number;
let moves: number;
let holdReads: boolean;
let reads: Message[];
let seen: Message[];
const node = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id)! as T;
const frame = (): HTMLIFrameElement => document.querySelector('[data-testid=page-frame]')!;
const messages = (type: string): Message[] => seen.filter((m) => m.type === type);
const send = (type: string, payload: unknown): void => channel.port1.postMessage(env(type, payload));
const answer = (m: Message, payload: unknown): void => channel.port1.postMessage({ p: 'wicked.editor', v: 1, re: m.id, ok: true, payload });
const read = (m: Message, version = head): void => answer(m, { version, content: { type: 'html', html: SAMPLE_PAGE } });
const refuse = (m: Message, code: string, message: string): void => channel.port1.postMessage({ p: 'wicked.editor', v: 1, re: m.id, ok: false, error: { code, message }, payload: { head } });
const hello = async (surface: 'card' | 'options' | 'full', protocol = 2): Promise<void> => {
  window.dispatchEvent(Object.assign(new Event('message'), {
    data: env('host.hello', { protocol, surface, ...(surface === 'options' ? { tab: 'style' } : {}), size: surface === 'card' ? 'inline' : 'full', mode: 'advanced', grants: ['artifact.read', 'artifact.write', 'artifact.theme', 'selection.chip'] }),
    ports: [channel.port2],
  }));
  await vi.waitFor(() => expect(node('editor').dataset['head']).toBe(String(head)));
};
const bridge = (data: unknown): void => { window.dispatchEvent(new MessageEvent('message', { data, source: frame().contentWindow })); };
const inventory = (): void => {
  frame().dispatchEvent(new Event('load'));
  bridge({ v: 1, type: 'wid-inventory', scrollX: 0, scrollY: 0,
    widMap: { 'hero-title': { x: 10, y: 20, top: 20, left: 10, right: 210, bottom: 50, width: 200, height: 30 } },
    blocks: { 'hero-title': { text: 'Book a study room in under a minute', composite: false, section: 'section-0' } },
  });
};
const press = (key: string, init: KeyboardEventInit = {}): void => {
  node('handle').dispatchEvent(new KeyboardEvent('keydown', { key, ...init, bubbles: true, cancelable: true }));
};
beforeAll(async () => { ({ start } = await import('../src/plugins/wicked-page/plugin.js')); });
beforeEach(() => {
  document.body.replaceChildren(); start(); head = 7; moves = 0; holdReads = false; reads = []; seen = [];
  channel = new MessageChannel();
  channel.port1.onmessage = (e: MessageEvent<Message>) => {
    const m = e.data; seen.push(m);
    if (m.type === 'artifact.read') { if (holdReads) reads.push(m); else read(m); }
    if (m.type === 'theme.set') {
      head += 1;
      if (moves > 0) { moves -= 1; refuse(m, 'head_moved', 'the artifact changed since'); }
      else answer(m, { version: head });
    }
    if (m.type === 'version.write') answer(m, { version: ++head });
  };
});
afterEach(() => { channel.port1.close(); channel.port2.close(); });

describe('wicked-page protocol 2', () => {
  it('selects on a card without editing, peeks, hints, swatches or writes; typing reaches the composer', async () => {
    await hello('card'); inventory();
    bridge({ v: 1, type: 'wid-click', wid: 'hero-title' });
    await vi.waitFor(() => expect(messages('selection.set').at(-1)?.payload).toEqual({ anchors: [{ kind: 'element', id: 'hero-title' }] }));
    expect(node('editor').dataset['selected']).toBe('hero-title');
    for (const id of ['input', 'peek', 'hint', 'fills', 'inks', 'remove']) expect(node(id).hidden).toBe(true);
    press('Enter'); press('x'); press('Backspace', { metaKey: true });
    node<HTMLButtonElement>('remove').click(); node('fills').querySelector<HTMLButtonElement>('button')!.click();
    await vi.waitFor(() => expect(messages('ui.typed').at(-1)?.payload).toEqual({ grapheme: 'x' }));
    expect(node('input').hidden).toBe(true); expect(messages('version.write')).toHaveLength(0);
  });
  it('keeps protocol 1 inline clicks with the host hit layer', async () => {
    await hello('card', 1); inventory(); bridge({ v: 1, type: 'wid-click', wid: 'hero-title' }); press('x');
    await vi.waitFor(() => expect(messages('ui.typed')).toHaveLength(1));
    expect(messages('selection.set')).toHaveLength(0); expect(node('editor').dataset['selected']).toBe('');
  });
  it('buffers host selection before inventory, applies without echo, and clears it with empty anchors', async () => {
    await hello('full'); send('host.selection', { anchors: [{ kind: 'element', id: 'hero-title' }] });
    // A ping after selection confirms both messages were handled before inventory is delivered.
    channel.port1.postMessage({ ...env('host.ping', {}), id: 'selection-delivered' });
    await vi.waitFor(() => expect(seen.some((m) => m.re === 'selection-delivered')).toBe(true));
    inventory(); expect(node('editor').dataset['selected']).toBe('hero-title'); expect(messages('selection.set')).toHaveLength(0);
    send('host.selection', { anchors: [] });
    await vi.waitFor(() => expect(node('editor').dataset['selected']).toBe(''));
  });
  it('keeps a host selection received before the first read until its inventory arrives', async () => {
    holdReads = true;
    const loaded = hello('card');
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    send('host.selection', { anchors: [{ kind: 'element', id: 'hero-title' }] });
    channel.port1.postMessage({ ...env('host.ping', {}), id: 'early-selection' });
    await vi.waitFor(() => expect(seen.some((m) => m.re === 'early-selection')).toBe(true));
    holdReads = false; read(reads[0]!); await loaded; inventory();
    expect(node('editor').dataset['selected']).toBe('hero-title'); expect(messages('selection.set')).toHaveLength(0);
  });
  it('empty host selection cancels a selection buffered before the first read', async () => {
    holdReads = true;
    const loaded = hello('card');
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    send('host.selection', { anchors: [{ kind: 'element', id: 'hero-title' }] }); send('host.selection', { anchors: [] });
    channel.port1.postMessage({ ...env('host.ping', {}), id: 'clear-delivered' });
    await vi.waitFor(() => expect(seen.some((m) => m.re === 'clear-delivered')).toBe(true));
    holdReads = false; read(reads[0]!); await loaded; inventory();
    expect(node('editor').dataset['selected']).toBe('');
  });
  it('edits text in full Simple mode but rejects style and remove, including hidden buttons', async () => {
    await hello('full'); inventory(); bridge({ v: 1, type: 'wid-click', wid: 'hero-title' });
    channel.port1.postMessage({ ...env('host.mode', { mode: 'simple' }), id: 'simple' });
    await vi.waitFor(() => expect(node('editor').dataset['mode']).toBe('simple'));
    node<HTMLButtonElement>('remove').click(); node('fills').querySelector<HTMLButtonElement>('button')!.click();
    press('Enter'); expect(node('input').hidden).toBe(false);
    node<HTMLTextAreaElement>('input').value = 'Changed title';
    node('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(messages('version.write')).toHaveLength(1));
    expect(messages('version.write')[0]!.payload?.['ops']).toEqual([{ op: 'text', anchor: 'hero-title', value: 'Changed title', before: 'Book a study room in under a minute' }]);
  });
  it('awaits a successful head read even while another render is pending, then retries with that version', async () => {
    await hello('options'); const base = head; holdReads = true;
    send('artifact.changed', { version: base + 1 });
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    moves = 1; node('style').querySelector<HTMLButtonElement>('[data-theme="warm-dark"]')!.click();
    await vi.waitFor(() => expect(reads).toHaveLength(2));
    expect(messages('theme.set')).toHaveLength(1); expect(reads[1]!.payload).toEqual({});
    holdReads = false; read(reads[1]!);
    await vi.waitFor(() => expect(messages('theme.set')).toHaveLength(2));
    expect(messages('theme.set').map((m) => m.payload?.['base'])).toEqual([base, base + 1]);
    expect(messages('theme.set').map((m) => m.payload?.['tokens'])).toEqual([copyTokens(THEMES[2]!), copyTokens(THEMES[2]!)]);
    // The older render must not replace the successful retry's head when it finishes late.
    read(reads[0]!, base);
    await vi.waitFor(() => expect(node('style').querySelector('[role=status]')?.textContent).toBe('Theme applied.'));
    await vi.waitFor(() => expect(node('editor').dataset['head']).toBe(String(head)));
  });
  it('does not retry after the head read fails and shows its reason', async () => {
    await hello('options'); holdReads = true; moves = 1;
    node('style').querySelector<HTMLButtonElement>('button')!.click();
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    expect(messages('theme.set')).toHaveLength(1);
    refuse(reads[0]!, 'unavailable', 'Cannot read the page');
    await vi.waitFor(() => expect(node('style').querySelector('[role=status]')?.textContent).toContain('Cannot read the page'));
    expect(messages('theme.set')).toHaveLength(1);
  });
  it('forwards host keys and boundary Tab from the Style panel and keeps control typing native', async () => {
    await hello('options');
    const controls = Array.from(node('style').querySelectorAll<HTMLElement>('button, input, select'));
    for (const [target, init] of [
      [controls[0]!, { key: 'Tab', shiftKey: true }], [controls.at(-1)!, { key: 'Tab' }],
      [controls[3]!, { key: 'Escape' }], [controls[3]!, { key: 'k', metaKey: true }],
      [controls[3]!, { key: 'j', code: 'KeyJ', altKey: true }],
    ] as const) target.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }));
    const typing = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }); controls[3]!.dispatchEvent(typing);
    expect(typing.defaultPrevented).toBe(false);
    await vi.waitFor(() => expect(messages('ui.key').map((m) => m.payload?.['key'])).toEqual(['Shift+Tab', 'Tab', 'Escape', 'Mod+K', 'Alt+J']));
    expect(messages('ui.typed')).toHaveLength(0);
  });
});
