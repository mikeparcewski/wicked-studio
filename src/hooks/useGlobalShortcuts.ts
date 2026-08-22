import { useEffect } from 'react';

/**
 * The global shortcut registry (DES-FEEDBACK-002 §1.2, slice G).
 *
 * ONE `window.addEventListener('keydown')` for the whole app — the EC21
 * contract: every global chord (the palette toggle, the relocated kill-run,
 * slice H's triage keys) registers an entry in the ordered table below, and the
 * shared `isTypingContext` guard runs before ANY entry, so no shortcut — chorded
 * or not — ever acts while something editable has focus. The modal family's
 * document-level Escape-only listeners (§1.1) are local, preserved, and exempt.
 */

export interface ShortcutChord {
  /** `KeyboardEvent.key`, lowercased (`'k'`, `'p'`, `'j'`, `'escape'`). */
  key: string;
  /** Chord requires Ctrl OR Meta (the cross-platform Cmd/Ctrl pairing). */
  ctrlOrMeta?: boolean;
  /** Chord requires Shift. Absent = Shift must be UP — this is what keeps
   *  Ctrl+K (palette) and Ctrl+Shift+K (kill) two different chords. */
  shift?: boolean;
}

export interface ShortcutEntry {
  id: string;
  chord: ShortcutChord;
  /** Human-readable, for future discoverability surfaces. */
  description: string;
  /** Extra availability gate, evaluated after the typing guard. `false` means
   *  the entry YIELDS silently — no preventDefault, no handler (the kill
   *  shortcut's silent-fail contract). */
  guard?: () => boolean;
  handler: (e: KeyboardEvent) => void;
  /** §1.2 precedence: while the palette is open the table yields everything
   *  except the toggle chord itself. Only the palette toggle sets this. */
  allowWhilePaletteOpen?: boolean;
}

/**
 * The one typing-context predicate (the exact App.tsx:71–73 test, spelled once):
 * keys pass through untouched while an input, textarea, select, or
 * contentEditable element has focus.
 */
export function isTypingContext(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  const tag = t?.tagName?.toLowerCase() ?? '';
  return tag === 'input' || tag === 'textarea' || tag === 'select' || (t?.isContentEditable ?? false);
}

/** Strict chord match — Alt always disqualifies; Shift and Ctrl/Meta must equal
 *  the chord's declaration, so `Ctrl+K` never fires a `Ctrl+Shift+K` entry. */
export function chordMatches(e: KeyboardEvent, chord: ShortcutChord): boolean {
  if (e.altKey) return false;
  if ((e.key ?? '').toLowerCase() !== chord.key) return false;
  if ((e.ctrlKey || e.metaKey) !== (chord.ctrlOrMeta ?? false)) return false;
  if (e.shiftKey !== (chord.shift ?? false)) return false;
  return true;
}

/** The ordered handler table — registration order is precedence. */
const table: ShortcutEntry[] = [];

/** §1.2: while open, the palette owns the keyboard; the table yields. */
let paletteOpen = false;

export function setShortcutsPaletteOpen(open: boolean): void {
  paletteOpen = open;
}

function dispatch(e: KeyboardEvent): void {
  if (isTypingContext(e)) return;
  for (const entry of table) {
    if (paletteOpen && entry.allowWhilePaletteOpen !== true) continue;
    if (!chordMatches(e, entry.chord)) continue;
    if (entry.guard !== undefined && !entry.guard()) continue; // yield silently
    entry.handler(e);
    return; // one owner per chord — first matching entry wins
  }
}

let listening = false;

/** Register entries (in order); returns the unregister. Non-hook form for tests. */
export function registerShortcuts(entries: ShortcutEntry[]): () => void {
  if (!listening) {
    listening = true;
    window.addEventListener('keydown', dispatch);
  }
  table.push(...entries);
  return () => {
    for (const entry of entries) {
      const i = table.indexOf(entry);
      if (i >= 0) table.splice(i, 1);
    }
  };
}

/** Mount-scoped registration. Memoize `entries` — re-created arrays re-register. */
export function useGlobalShortcuts(entries: ShortcutEntry[]): void {
  useEffect(() => registerShortcuts(entries), [entries]);
}
