import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerShortcuts, setShortcutsPaletteOpen } from '../src/hooks/useGlobalShortcuts.js';

vi.mock('../src/api/client.js', () => ({ api: {}, apiFetch: () => Promise.resolve({}) }));
const { paletteShortcutEntries } = await import('../src/components/CommandPalette.js');

/**
 * studio#473: ⌘K / ⌘P (and ⌘⇧F) open the palette from a focused text field — a page that focuses
 * its composer on arrival (`/chat/new`) must not leave the palette unreachable from the keyboard.
 * A modifier chord cannot be typed text. A field that handles the chord itself (the palette's own
 * input closes on it; an editor may bind ⌘K) says so with preventDefault, and the toggle yields.
 */
const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length > 0) cleanups.pop()!(); setShortcutsPaletteOpen(false); document.body.innerHTML = ''; });

function mount() {
  let open = false;
  const setOpen = vi.fn((v: boolean) => { open = v; });
  const openSearch = vi.fn();
  cleanups.push(registerShortcuts(paletteShortcutEntries({
    isOpen: () => open, setOpen, openSearch, killEligible: () => false, kill: () => undefined,
  })));
  return { setOpen, openSearch };
}

function press(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

describe('the palette chords reach the palette from a text field (studio#473)', () => {
  for (const [name, el] of [['textarea', 'textarea'], ['input', 'input']] as const) {
    it(`⌘K and ⌘P open it from a focused ${name}`, () => {
      const { setOpen } = mount();
      const field = document.body.appendChild(document.createElement(el));
      field.focus();
      press(field, { key: 'k', metaKey: true });
      expect(setOpen).toHaveBeenLastCalledWith(true);
      setOpen.mockClear();
      press(field, { key: 'p', ctrlKey: true });
      expect(setOpen).toHaveBeenCalledTimes(1);
    });
  }

  it('⌘⇧F opens search from a focused composer', () => {
    const { openSearch } = mount();
    const field = document.body.appendChild(document.createElement('textarea'));
    press(field, { key: 'f', metaKey: true, shiftKey: true });
    expect(openSearch).toHaveBeenCalledTimes(1);
  });

  it('a field that handled the chord itself (preventDefault) keeps it', () => {
    const { setOpen } = mount();
    const field = document.body.appendChild(document.createElement('textarea'));
    field.addEventListener('keydown', (e) => { if (e.key === 'k') e.preventDefault(); });
    press(field, { key: 'k', metaKey: true });
    expect(setOpen).not.toHaveBeenCalled();
  });

  it('a plain letter typed in the field is still the field\'s', () => {
    const { setOpen } = mount();
    const field = document.body.appendChild(document.createElement('textarea'));
    press(field, { key: 'k' });
    expect(setOpen).not.toHaveBeenCalled();
  });
});
