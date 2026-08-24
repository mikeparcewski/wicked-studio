import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  chordMatches,
  registerShortcuts,
  type ShortcutEntry,
} from '../src/hooks/useGlobalShortcuts.js';
import { insertPrefix, STEER_PREFIXES } from '../src/hooks/useSteerPrefixes.js';
import { chordLabel } from '../src/components/ShortcutOverlay.js';

/**
 * Slice BD — the structured-steer prefixes and their registry plumbing.
 * Bindings are Alt+1/2/3 on `KeyboardEvent.code` (NOT the doc's Ctrl+F/K/X —
 * operator steer: those collide with cut / the palette / find).
 */

const kbd = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init);

describe('insertPrefix (pure caret math)', () => {
  it('inserts at the caret and reports the new caret', () => {
    expect(insertPrefix('keep tests green', 0, 'Focus: ')).toEqual({
      text: 'Focus: keep tests green',
      caret: 7,
    });
  });

  it('inserts mid-text and clamps an out-of-range caret', () => {
    expect(insertPrefix('ab', 1, 'Skip: ').text).toBe('aSkip: b');
    expect(insertPrefix('ab', 99, 'Context: ')).toEqual({ text: 'abContext: ', caret: 11 });
  });
});

describe('Alt chords in the one registry (slice BD extensions)', () => {
  it('matches on code with Alt down — macOS Option-mangled key does not break it', () => {
    const chord = { key: '1', code: 'Digit1', alt: true };
    // macOS reports Option+1 as key '¡'; the positional code still matches.
    expect(chordMatches(kbd({ key: '¡', code: 'Digit1', altKey: true }), chord)).toBe(true);
    expect(chordMatches(kbd({ key: '1', code: 'Digit1', altKey: false }), chord)).toBe(false);
    expect(chordMatches(kbd({ key: '2', code: 'Digit2', altKey: true }), chord)).toBe(false);
  });

  it('plain chords still refuse Alt (the pre-BD contract is the default)', () => {
    expect(chordMatches(kbd({ key: 'a', altKey: true }), { key: 'a' })).toBe(false);
  });

  it('the three prefixes label as Alt/⌥+digit in the overlay', () => {
    expect(STEER_PREFIXES.map((p) => chordLabel({ key: p.key, code: p.code, alt: true })))
      .toEqual(['Alt/⌥+1', 'Alt/⌥+2', 'Alt/⌥+3']);
  });
});

describe('allowInTypingContext (per-entry typing guard)', () => {
  let unregister: (() => void) | null = null;
  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  function arm(entry: Partial<ShortcutEntry>): ReturnType<typeof vi.fn> {
    const handler = vi.fn();
    unregister = registerShortcuts([
      {
        id: 'test-typing-optin',
        chord: { key: '1', code: 'Digit1', alt: true },
        description: 'test',
        handler,
        ...entry,
      } as ShortcutEntry,
    ]);
    return handler;
  }

  function fireFromTextarea(): void {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    ta.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '1', code: 'Digit1', altKey: true, bubbles: true,
      }),
    );
    ta.remove();
  }

  it('an opted-in entry fires from inside a textarea', () => {
    const handler = arm({ allowInTypingContext: true });
    fireFromTextarea();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a default entry stays inert while typing (EC21 holds)', () => {
    const handler = arm({});
    fireFromTextarea();
    expect(handler).not.toHaveBeenCalled();
  });
});
