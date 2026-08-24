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
  /** Chord requires Alt/Option (slice BD's in-textarea steer prefixes).
   *  Absent = Alt must be UP, the standing contract every prior entry keeps. */
  alt?: boolean;
  /** Match on `KeyboardEvent.code` (`'Digit1'`) instead of `key`. Required for
   *  Alt chords: macOS Option+key mangles `e.key` into the layout's dead/special
   *  character (`Option+1` reports `key: '¡'`) while `code` stays positional.
   *  `key` is still declared for the overlay's label. */
  code?: string;
}

/** The '?' overlay's section headings (DES-UX-001 §7.7, slice AC). */
export type ShortcutGroup = 'triage' | 'palette' | 'gates' | 'panels';

export interface ShortcutEntry {
  id: string;
  chord: ShortcutChord;
  /** Human-readable — rendered verbatim by the '?' overlay (§7.7). */
  description: string;
  /** Overlay section (§7.7). Untagged entries land under "panels". */
  group?: ShortcutGroup;
  /** Extra availability gate, evaluated after the typing guard. `false` means
   *  the entry YIELDS silently — no preventDefault, no handler (the kill
   *  shortcut's silent-fail contract). */
  guard?: () => boolean;
  handler: (e: KeyboardEvent) => void;
  /** §1.2 precedence: while the palette is open the table yields everything
   *  except the toggle chord itself. Only the palette toggle sets this. */
  allowWhilePaletteOpen?: boolean;
  /** Opt OUT of the shared typing guard (slice BD): the entry fires even while
   *  an editable element holds focus. ONLY for chords whose entire purpose is
   *  acting inside a specific textarea (the steer prefixes) — such an entry
   *  MUST carry a `guard` that scopes it to its own element, or it would act
   *  in every input on the page. */
  allowInTypingContext?: boolean;
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

/** Strict chord match — every modifier must equal the chord's declaration, so
 *  `Ctrl+K` never fires a `Ctrl+Shift+K` entry and an Alt chord never fires a
 *  plain one (the pre-BD "Alt always disqualifies" contract is the `alt`
 *  default). Alt chords match positionally on `code` (see ShortcutChord). */
export function chordMatches(e: KeyboardEvent, chord: ShortcutChord): boolean {
  if (e.altKey !== (chord.alt ?? false)) return false;
  if (chord.code !== undefined) {
    if (e.code !== chord.code) return false;
  } else if ((e.key ?? '').toLowerCase() !== chord.key) {
    return false;
  }
  if ((e.ctrlKey || e.metaKey) !== (chord.ctrlOrMeta ?? false)) return false;
  if (e.shiftKey !== (chord.shift ?? false)) return false;
  return true;
}

/** The ordered handler table — registration order is precedence. */
const table: ShortcutEntry[] = [];

/**
 * The overlay's corpus (§7.7, EC42): a snapshot of what is REGISTERED right
 * now — the '?' overlay renders from this, never from a hand-kept list, so a
 * key that exists is documented and a key that unmounted disappears with its
 * surface. Read on open; entries are live references, never mutated here.
 */
export function listShortcuts(): readonly ShortcutEntry[] {
  return [...table];
}

/** §1.2: while open, the palette owns the keyboard; the table yields. */
let paletteOpen = false;

export function setShortcutsPaletteOpen(open: boolean): void {
  paletteOpen = open;
}

/** §7.7 chain: the modal family's local listeners yield while the palette is
 *  open (palette closes before modal/popover) — this is their read. */
export function isShortcutsPaletteOpen(): boolean {
  return paletteOpen;
}

function dispatch(e: KeyboardEvent): void {
  // The one typing guard, now PER-ENTRY (slice BD): entries that opted in via
  // `allowInTypingContext` (the steer prefixes, element-guarded) still fire;
  // every other entry keeps the EC21 contract — inert while typing.
  const typing = isTypingContext(e);
  for (const entry of table) {
    if (typing && entry.allowInTypingContext !== true) continue;
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
