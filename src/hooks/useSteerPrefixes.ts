import { useMemo, type RefObject } from 'react';
import { useGlobalShortcuts, type ShortcutEntry } from './useGlobalShortcuts.js';

/**
 * The structured-steer prefixes (DES-UX-002 §4.3, slice BD): three labelled
 * prefixes — `Focus:`, `Skip:`, `Context:` — the operator can inject into a
 * steer textarea at the cursor. NOT enforced structure: they are typed into the
 * freeform field as text; `amend` stays a string on the wire.
 *
 * BINDING DEVIATION from §4.3/§5.4 (operator steer at the design run's gate,
 * applied here): the doc's Ctrl+F / Ctrl+K / Ctrl+X COLLIDE with native
 * bindings — Ctrl+X is cut, Ctrl+K is the palette toggle app-wide and
 * kill-line in macOS text fields, Ctrl+F is find / forward-char. Chosen
 * instead: **Alt+1 / Alt+2 / Alt+3** (Option on macOS), matched positionally
 * on `KeyboardEvent.code` so macOS Option-layer characters ('¡', '™', '£')
 * don't break the match. No platform binds Alt+digit for text editing, and the
 * browser-level collisions of the mnemonic alternatives (Alt+F = the Chrome
 * menu on Windows, Ctrl+Shift+C = DevTools inspect) don't exist for digits.
 * Registered through the ONE shortcut registry with `allowInTypingContext` +
 * an element guard, so the '?' overlay documents them (EC42) and they act in
 * exactly one place: the steer textarea that owns focus.
 */

export const STEER_PREFIXES = [
  { code: 'Digit1', key: '1', prefix: 'Focus: ' },
  { code: 'Digit2', key: '2', prefix: 'Skip: ' },
  { code: 'Digit3', key: '3', prefix: 'Context: ' },
] as const;

/** Insert `prefix` at the caret, pure — returns the next text + caret. */
export function insertPrefix(
  text: string,
  caret: number,
  prefix: string,
): { text: string; caret: number } {
  const at = Math.max(0, Math.min(caret, text.length));
  return { text: text.slice(0, at) + prefix + text.slice(at), caret: at + prefix.length };
}

/**
 * Arm the three prefix chords on one steer textarea. `idPrefix` keeps the two
 * mounting surfaces' entries distinct in the registry; `apply` receives the
 * new text (the caller owns the controlled value). The caret is restored after
 * React commits the value.
 */
export function useSteerPrefixes(
  idPrefix: string,
  ref: RefObject<HTMLTextAreaElement>,
  apply: (text: string) => void,
): void {
  const entries = useMemo<ShortcutEntry[]>(
    () =>
      STEER_PREFIXES.map(({ code, key, prefix }) => ({
        id: `${idPrefix}-steer-prefix-${key}`,
        chord: { key, code, alt: true },
        group: 'gates' as const,
        description: `${prefix.trim()} steer prefix (in the steer note)`,
        allowInTypingContext: true,
        guard: () => ref.current !== null && document.activeElement === ref.current,
        handler: (e) => {
          const el = ref.current;
          if (el === null) return;
          e.preventDefault();
          const next = insertPrefix(el.value, el.selectionStart ?? el.value.length, prefix);
          apply(next.text);
          // After React commits the controlled value, put the caret after the
          // inserted prefix (setting value resets the caret to the end).
          requestAnimationFrame(() => {
            el.setSelectionRange(next.caret, next.caret);
          });
        },
      })),
    [idPrefix, ref, apply],
  );
  useGlobalShortcuts(entries);
}
