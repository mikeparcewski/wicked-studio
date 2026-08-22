import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The global shortcut registry (DES-FEEDBACK-002 §1.2, slice G): ONE
 * window-level keydown listener, an ordered entry table, the shared
 * `isTypingContext` guard before EVERY entry (EC21), strict chord matching
 * (Ctrl+K ≠ Ctrl+Shift+K), and the paletteOpen yield.
 */

import {
  chordMatches,
  isTypingContext,
  registerShortcuts,
  setShortcutsPaletteOpen,
  type ShortcutEntry,
} from '../src/hooks/useGlobalShortcuts.js';

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
}

const cleanups: Array<() => void> = [];
function register(entries: ShortcutEntry[]): void {
  cleanups.push(registerShortcuts(entries));
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  setShortcutsPaletteOpen(false);
  document.body.innerHTML = '';
});

describe('chordMatches — strict, shift-discriminating (§1.2)', () => {
  const plainK = { key: 'k', ctrlOrMeta: true };
  const shiftK = { key: 'k', ctrlOrMeta: true, shift: true };

  it('Ctrl+K matches the plain chord, never the shift chord', () => {
    const e = key({ key: 'k', ctrlKey: true });
    expect(chordMatches(e, plainK)).toBe(true);
    expect(chordMatches(e, shiftK)).toBe(false);
  });

  it('Ctrl+Shift+K matches the shift chord, never the plain chord', () => {
    const e = key({ key: 'K', ctrlKey: true, shiftKey: true });
    expect(chordMatches(e, shiftK)).toBe(true);
    expect(chordMatches(e, plainK)).toBe(false);
  });

  it('Meta stands in for Ctrl (the Cmd pairing); bare K and Alt chords never match', () => {
    expect(chordMatches(key({ key: 'k', metaKey: true }), plainK)).toBe(true);
    expect(chordMatches(key({ key: 'k' }), plainK)).toBe(false);
    expect(chordMatches(key({ key: 'k', ctrlKey: true, altKey: true }), plainK)).toBe(false);
  });
});

describe('isTypingContext — the one shared guard (EC21)', () => {
  for (const tag of ['input', 'textarea', 'select']) {
    it(`${tag} focus is a typing context`, () => {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      let seen: boolean | null = null;
      el.addEventListener('keydown', (e) => {
        seen = isTypingContext(e);
      });
      el.dispatchEvent(key({ key: 'k', ctrlKey: true }));
      expect(seen).toBe(true);
    });
  }

  it('contentEditable focus is a typing context; a plain div is not', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    Object.defineProperty(div, 'isContentEditable', { value: true });
    let seen: boolean | null = null;
    div.addEventListener('keydown', (e) => {
      seen = isTypingContext(e);
    });
    div.dispatchEvent(key({ key: 'k', ctrlKey: true }));
    expect(seen).toBe(true);

    const plain = document.createElement('div');
    document.body.appendChild(plain);
    plain.addEventListener('keydown', (e) => {
      seen = isTypingContext(e);
    });
    plain.dispatchEvent(key({ key: 'k', ctrlKey: true }));
    expect(seen).toBe(false);
  });
});

describe('registerShortcuts — dispatch, order, unregistration', () => {
  it('fires the handler on a matching chord; unregistration stops it', () => {
    const handler = vi.fn();
    const off = registerShortcuts([
      { id: 't', chord: { key: 'k', ctrlOrMeta: true }, description: 't', handler },
    ]);
    window.dispatchEvent(key({ key: 'k', ctrlKey: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    window.dispatchEvent(key({ key: 'k', ctrlKey: true }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('the typing guard runs before EVERY entry: keys from a textarea pass through', () => {
    const handler = vi.fn();
    register([{ id: 't', chord: { key: 'k', ctrlOrMeta: true }, description: 't', handler }]);
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.dispatchEvent(key({ key: 'k', ctrlKey: true }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('shift discrimination end-to-end: Ctrl+Shift+K fires kill, plain Ctrl+K fires palette', () => {
    const palette = vi.fn();
    const kill = vi.fn();
    register([
      { id: 'palette', chord: { key: 'k', ctrlOrMeta: true }, description: 'p', handler: palette },
      { id: 'kill', chord: { key: 'k', ctrlOrMeta: true, shift: true }, description: 'k', handler: kill },
    ]);
    window.dispatchEvent(key({ key: 'K', ctrlKey: true, shiftKey: true }));
    expect(kill).toHaveBeenCalledTimes(1);
    expect(palette).not.toHaveBeenCalled();
    window.dispatchEvent(key({ key: 'k', ctrlKey: true }));
    expect(palette).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('a false guard yields silently — no handler, and later entries still run', () => {
    const first = vi.fn();
    const second = vi.fn();
    register([
      {
        id: 'a',
        chord: { key: 'j' },
        description: 'a',
        guard: () => false,
        handler: first,
      },
      { id: 'b', chord: { key: 'j' }, description: 'b', handler: second },
    ]);
    window.dispatchEvent(key({ key: 'j' }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('first matching entry wins — one owner per chord', () => {
    const first = vi.fn();
    const second = vi.fn();
    register([
      { id: 'a', chord: { key: 'j' }, description: 'a', handler: first },
      { id: 'b', chord: { key: 'j' }, description: 'b', handler: second },
    ]);
    window.dispatchEvent(key({ key: 'j' }));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('while the palette is open the table yields everything except the toggle (§1.2)', () => {
    const toggle = vi.fn();
    const kill = vi.fn();
    register([
      {
        id: 'toggle',
        chord: { key: 'k', ctrlOrMeta: true },
        description: 't',
        handler: toggle,
        allowWhilePaletteOpen: true,
      },
      { id: 'kill', chord: { key: 'k', ctrlOrMeta: true, shift: true }, description: 'k', handler: kill },
    ]);
    setShortcutsPaletteOpen(true);
    window.dispatchEvent(key({ key: 'K', ctrlKey: true, shiftKey: true }));
    expect(kill).not.toHaveBeenCalled();
    window.dispatchEvent(key({ key: 'k', ctrlKey: true }));
    expect(toggle).toHaveBeenCalledTimes(1);
    setShortcutsPaletteOpen(false);
    window.dispatchEvent(key({ key: 'K', ctrlKey: true, shiftKey: true }));
    expect(kill).toHaveBeenCalledTimes(1);
  });
});
