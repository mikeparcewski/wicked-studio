import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_DECK } from '../src/editors/fakeAdapter.js';

/**
 * P-D1 — the `wicked-deck` plugin (DES-PRESENTATION-EDITOR-001 §3) driven over its port by a scripted
 * host. The plugin is a page script: importing it runs `start()` against this document, once, so the
 * cases below are one session in order.
 */

const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id !== undefined ? { id } : {}) });

// The sample deck, with its first slide MOVED to the end (anchor `section-0` kept): the filmstrip must
// show document order and number slides by place.
const MOVED = SAMPLE_DECK.replace(/(<section[^>]*data-slide-id="s-intro"[\s\S]*?<\/section>)\n([\s\S]*?)(<\/body>)/, '$2$1\n$3');

const ch = new MessageChannel();
const seen: { type?: string; id?: string; payload?: Record<string, unknown> }[] = [];
const versions = new Map<number, string>([[1, SAMPLE_DECK]]);
let head = 1;
let nextWrite: { ok: true } | { ok: false; code: string; message: string } = { ok: true };

ch.port1.onmessage = (m: MessageEvent) => {
  const d = m.data as { type?: string; id?: string; payload?: Record<string, unknown> };
  seen.push(d);
  if (d.type === 'artifact.read') {
    const v = typeof d.payload?.['version'] === 'number' ? d.payload['version'] as number : head;
    ch.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: true, payload: { version: v, content: { type: 'html', html: versions.get(v) ?? SAMPLE_DECK } } });
  } else if (d.type === 'version.write') {
    if (nextWrite.ok) {
      head += 1;
      versions.set(head, head === 2 ? MOVED : versions.get(head - 1)!);
      ch.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: true, payload: { version: head } });
    } else {
      ch.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: false, error: { code: nextWrite.code, message: nextWrite.message } });
      nextWrite = { ok: true };
    }
  } else if (d.type === 'ui.fullscreen') {
    ch.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: true, payload: { entered: true } });
  }
};

const writes = (): Record<string, unknown>[] => seen.filter((m) => m.type === 'version.write').map((m) => m.payload!);
const lastOf = (type: string) => [...seen].reverse().find((m) => m.type === type);
const deck = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="deck-editor"]')!;
const thumbs = (): HTMLButtonElement[] => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="deck-thumb"]'));
const key = (k: string, init: KeyboardEventInit = {}): void => { deck().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })); };
const btn = (id: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;

beforeAll(async () => {
  const ready = new Promise<void>((resolve) => {
    window.addEventListener('message', (e: MessageEvent) => { if ((e.data as { type?: string } | null)?.type === 'plugin.ready') resolve(); });
  });
  await import('../src/plugins/wicked-deck/plugin.js');
  await ready;
  const hello = Object.assign(new Event('message'), {
    data: env('host.hello', { grants: ['artifact.read', 'artifact.write', 'selection.chip', 'ui.fullscreen'], size: 'pane', theme: {} }),
    ports: [ch.port2],
  });
  window.dispatchEvent(hello);
  await vi.waitFor(() => expect(thumbs()).toHaveLength(4));
}, 15_000);

describe('wicked-deck: the filmstrip and moving between slides', () => {
  it('lists the slides in document order, named and numbered by place, the first one current', () => {
    expect(thumbs().map((b) => [b.dataset['n'], b.dataset['slideId']])).toStrictEqual([['1', 's-intro'], ['2', 's-first'], ['3', 's-staff'], ['4', 's-pilot']]);
    expect(thumbs()[0]!.getAttribute('aria-current')).toBe('true');
    expect(thumbs()[2]!.getAttribute('aria-label')).toBe('Slide 3: Staff stay in control');
    // each thumbnail is the slide in a frame that runs NO script
    for (const b of thumbs()) expect(b.querySelector('iframe')!.getAttribute('sandbox')).toBe('');
    // the stage: one nested frame, scripts allowed (the bridge), showing slide 1 only
    const frames = document.querySelectorAll<HTMLIFrameElement>('[data-testid="deck-frame"]');
    expect(frames).toHaveLength(1);
    expect(frames[0]!.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frames[0]!.srcdoc).toMatch(/data-slide-id="s-first"[^>]*data-wi-deck-off|data-wi-deck-off[^>]*data-slide-id="s-first"/);
    expect(btn('deck-count').textContent).toBe('1 of 4');
    expect((document.querySelector<HTMLTextAreaElement>('[data-testid="deck-notes"]'))!.value).toBe('Open with the waiting-list numbers.');
  });
  it('→ / PgDn / End / Home and "3 Enter" move between slides; a printable key goes to the composer', async () => {
    key('ArrowRight');
    expect(deck().dataset['current']).toBe('s-first');
    key('PageDown');
    expect(deck().dataset['current']).toBe('s-staff');
    key('End');
    expect(deck().dataset['current']).toBe('s-pilot');
    key('Home');
    expect(deck().dataset['current']).toBe('s-intro');
    // a number then Enter, in the filmstrip (a focused composite's own keys); elsewhere a digit is typing
    const thumbKey = (k: string): void => { thumbs()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); };
    thumbKey('3');
    thumbKey('Enter');
    expect(deck().dataset['current']).toBe('s-staff');
    expect(btn('deck-count').textContent).toBe('3 of 4');
    key('7');
    await vi.waitFor(() => expect(lastOf('ui.typed')?.payload).toStrictEqual({ grapheme: '7' }));
    expect(deck().dataset['current']).toBe('s-staff');
    key('Escape');
    await vi.waitFor(() => expect(lastOf('ui.key')?.payload).toStrictEqual({ key: 'Escape' }));
    // bare Backspace is never an action
    const before = writes().length;
    key('Backspace');
    expect(writes()).toHaveLength(before);
  });
  it('a click on a thumbnail makes the slide current and the subject (the host writes the chip)', async () => {
    thumbs()[1]!.click();
    expect(deck().dataset['current']).toBe('s-first');
    await vi.waitFor(() => expect(lastOf('selection.set')?.payload).toStrictEqual({ anchors: [{ kind: 'element', id: 'section-1' }] }));
  });
});

describe('wicked-deck: each slide op is one write', () => {
  it('Move up names the slide and the one it goes after; the new version is read and shown in document order', async () => {
    btn('deck-move-up').click();
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toStrictEqual({ base: 1, ops: [{ op: 'slide-move', slide: 's-first', after: null }], summary: 'slide 2' });
    // the host's v2 has slide 1 moved to the end: the strip follows the DOCUMENT, numbers by place
    await vi.waitFor(() => expect(deck().dataset['head']).toBe('2'));
    expect(thumbs().map((b) => b.dataset['slideId'])).toStrictEqual(['s-first', 's-staff', 's-pilot', 's-intro']);
    expect(thumbs()[3]!.dataset['n']).toBe('4');
    expect(deck().dataset['current']).toBe('s-first');
  });
  it('⌘D duplicates, Add slide adds one laid out like a chosen slide after the current one, ⌥↓ moves down', async () => {
    key('d', { metaKey: true });
    await vi.waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]!['ops']).toStrictEqual([{ op: 'slide-duplicate', slide: 's-first' }]);
    await vi.waitFor(() => expect(deck().dataset['head']).toBe('3'));
    btn('deck-add').click();
    const like = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="deck-add-like"]'));
    expect(like.map((b) => b.dataset['slideId'])).toStrictEqual(['s-first', 's-staff', 's-pilot', 's-intro']);
    like[2]!.click();
    await vi.waitFor(() => expect(writes()).toHaveLength(3));
    // after the duplicate the next slide is current (this scripted host returns the deck unchanged: s-staff)
    expect(writes()[2]!['ops']).toStrictEqual([{ op: 'slide-insert', slide: 's-pilot', after: 's-staff' }]);
    await vi.waitFor(() => expect(deck().dataset['head']).toBe('4'));
    key('Home');
    key('ArrowDown', { altKey: true });
    await vi.waitFor(() => expect(writes()).toHaveLength(4));
    expect(writes()[3]!['ops']).toStrictEqual([{ op: 'slide-move', slide: 's-first', after: 's-staff' }]);
    await vi.waitFor(() => expect(deck().dataset['head']).toBe('5'));
  });
  it('Delete removes the slide by its own anchor; speaker notes are saved when the field is left', async () => {
    key('End');
    btn('deck-delete').click();
    await vi.waitFor(() => expect(writes()).toHaveLength(5));
    expect(writes()[4]!['ops']).toStrictEqual([{ op: 'remove', anchor: 'section-0' }]);
    await vi.waitFor(() => expect(deck().dataset['head']).toBe('6'));
    key('Home');
    const notes = document.querySelector<HTMLTextAreaElement>('[data-testid="deck-notes"]')!;
    notes.focus();
    notes.value = 'Say the margin number';
    notes.dispatchEvent(new Event('input'));
    notes.blur();
    await vi.waitFor(() => expect(writes()).toHaveLength(6));
    expect(writes()[5]!['ops']).toStrictEqual([{ op: 'notes-set', slide: 's-first', text: 'Say the margin number' }]);
    await vi.waitFor(() => expect(deck().dataset['head']).toBe('7'));
    // leaving the field without a change writes nothing
    notes.focus();
    notes.blur();
    await new Promise((r) => setTimeout(r, 50));
    expect(writes()).toHaveLength(6);
  });
  it('a refused write says why on the status line and changes nothing', async () => {
    nextWrite = { ok: false, code: 'refused', message: 'Not changed: that slide is not in this version.' };
    btn('deck-duplicate').click();
    await vi.waitFor(() => expect(writes()).toHaveLength(7));
    await vi.waitFor(() => expect(lastOf('ui.status')?.payload).toStrictEqual({ line: 'Not changed: that slide is not in this version.' }));
    expect(deck().dataset['head']).toBe('7');
  });
});

describe('wicked-deck: codex r1 — versions only move forward; notes are saved against the version they began on', () => {
  it('an older version announced after a newer one is never shown, nor made the next base', async () => {
    const h = Number(deck().dataset['head']);
    versions.set(h + 2, versions.get(h)!);
    versions.set(h + 1, versions.get(h)!);
    head = h + 2;
    ch.port1.postMessage(env('artifact.changed', { version: h + 2, head: h + 2, by: 'agent', kind: 'generated' }));
    ch.port1.postMessage(env('artifact.changed', { version: h + 1, head: h + 2, by: 'other', kind: 'deterministic' }));
    await vi.waitFor(() => expect(deck().dataset['head']).toBe(String(h + 2)));
    await new Promise((r) => setTimeout(r, 100));
    expect(deck().dataset['head']).toBe(String(h + 2));
    expect(seen.filter((m) => m.type === 'artifact.read' && m.payload?.['version'] === h + 1)).toHaveLength(0);
  });
  it('notes begun on version N are written with base N; a moved head refuses, keeps the draft and says so', async () => {
    const h = Number(deck().dataset['head']);
    const notes = document.querySelector<HTMLTextAreaElement>('[data-testid="deck-notes"]')!;
    notes.focus();
    // a helper's version lands while the notes are being typed
    versions.set(h + 1, versions.get(h)!);
    head = h + 1;
    ch.port1.postMessage(env('artifact.changed', { version: h + 1, head: h + 1, by: 'agent', kind: 'generated' }));
    await vi.waitFor(() => expect(deck().dataset['head']).toBe(String(h + 1)));
    notes.value = 'Mine, typed meanwhile';
    nextWrite = { ok: false, code: 'head_moved', message: 'the artifact changed since' };
    const before = writes().length;
    notes.blur();
    await vi.waitFor(() => expect(writes()).toHaveLength(before + 1));
    expect(writes()[before]!['base']).toBe(h);
    await vi.waitFor(() => expect(String(lastOf('ui.status')?.payload?.['line'])).toMatch(/^Not saved: the deck changed while you typed/));
    expect(notes.value).toBe('Mine, typed meanwhile');
    // codex r2: visiting another slide's notes and leaving them unchanged keeps THIS slide's draft
    const here = deck().dataset['current'];
    key('ArrowRight');
    notes.focus();
    notes.blur();
    key('ArrowLeft');
    expect(deck().dataset['current']).toBe(here);
    expect(notes.value).toBe('Mine, typed meanwhile');
    expect(writes()).toHaveLength(before + 1);
    // leaving the field again saves the draft, now on the newer version
    notes.focus();
    notes.blur();
    await vi.waitFor(() => expect(writes()).toHaveLength(before + 2));
    expect(writes()[before + 1]!['base']).toBe(h + 1);
  });
});

describe('wicked-deck: present and the inline preview', () => {
  it('Present asks the host for full screen, hides the chrome, → moves, Esc leaves first', async () => {
    btn('deck-present').click();
    await vi.waitFor(() => expect(deck().dataset['present']).toBe('true'));
    await vi.waitFor(() => expect(lastOf('ui.fullscreen')).toBeDefined());
    expect(btn('deck-tools').hidden).toBe(true);
    const was = deck().dataset['current'];
    key('ArrowRight');
    expect(deck().dataset['current']).not.toBe(was);
    const keysBefore = seen.filter((m) => m.type === 'ui.key').length;
    key('Escape');
    expect(deck().dataset['present']).toBe('false');
    await new Promise((r) => setTimeout(r, 30));
    expect(seen.filter((m) => m.type === 'ui.key').length).toBe(keysBefore);
  });
  it('inline: slide 1 alone with the count, no tools, no pointing', async () => {
    ch.port1.postMessage(env('host.size', { size: 'inline' }));
    await vi.waitFor(() => expect(deck().dataset['size']).toBe('inline'));
    expect(btn('deck-inline-count').hidden).toBe(false);
    expect(btn('deck-inline-count').textContent).toMatch(/^\d+ slides$/);
    expect(btn('deck-tools').hidden).toBe(true);
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="deck-frame"]')!;
    expect(frame.title).toBe('Slide 1');
  });
});
