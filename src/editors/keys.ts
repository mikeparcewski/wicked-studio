/**
 * Keys a plugin may hand to the host (DES-EDITOR-PLUGINS-001 §5.5 `ui.key` / `ui.typed`, §5.10;
 * EP-P1). A frame is its own document, so the host never sees its keys; the plugin forwards a few,
 * and the host honours one only when:
 *
 *  - it is on the forwardable list: Esc, ⌘K / Ctrl+K, Tab, Shift+Tab, and the ⌥ chords the chord
 *    table marks `forwardable` — navigation only. A chord whose verb approves, decides, sends,
 *    delivers, remembers, stops or retires is NEVER forwardable;
 *  - the host holds real user activation at receipt (a key press in a child frame activates its
 *    ancestors);
 *  - for `ui.typed`: exactly one grapheme, and focus is still in the plugin's frame.
 *
 * Anything else is dropped and counted; three drops in a session tear the frame down.
 */

export type ChordVerb = 'navigate' | 'approve' | 'decide' | 'send' | 'deliver' | 'remember' | 'stop' | 'retire' | 'compose';

/** EVERY ⌥ chord studio registers (hooks/useGlobalShortcuts `altChord` callers), classified. A new
 *  chord must be added here: `tests/editorKeys.test.ts` fails on an unclassified one. */
export const CHORD_TABLE: Readonly<Record<string, { verb: ChordVerb; what: string }>> = {
  'Alt+J': { verb: 'navigate', what: 'next card or row' },
  'Alt+K': { verb: 'navigate', what: 'previous card or row' },
  'Alt+/': { verb: 'navigate', what: 'the keyboard shortcuts overlay' },
  'Alt+P': { verb: 'navigate', what: 'peek at the top item that needs you' },
  'Alt+G': { verb: 'navigate', what: 'jump to the top item that needs you' },
  'Alt+B': { verb: 'navigate', what: 'back to where you were' },
  'Alt+T': { verb: 'navigate', what: 'the run’s evidence timeline' },
  'Alt+U': { verb: 'navigate', what: 'the run’s unit list' },
  'Alt+A': { verb: 'approve', what: 'approve the open gate' },
  'Alt+R': { verb: 'decide', what: 'reject the open gate' },
  'Alt+X': { verb: 'decide', what: 'select a gate for batch resolution' },
  'Alt+N': { verb: 'compose', what: 'compose a steer note' },
};

const PLAIN_FORWARDABLE: ReadonlySet<string> = new Set(['Escape', 'Mod+K', 'Tab', 'Shift+Tab']);

/** Whether a forwarded key may be honoured at all (before activation). */
export function isForwardable(key: string): boolean {
  if (PLAIN_FORWARDABLE.has(key)) return true;
  const c = CHORD_TABLE[normalizeChord(key)];
  return c !== undefined && c.verb === 'navigate';
}

/** `alt+j` / `Alt+j` → `Alt+J`; anything else unchanged. */
export function normalizeChord(key: string): string {
  const m = /^alt\+(.)$/i.exec(key);
  return m === null ? key : `Alt+${m[1]!.toUpperCase()}`;
}

/** Exactly one user-perceived character, printable. */
export function isOneGrapheme(s: string): boolean {
  if (s === '' || /[\u0000-\u001f\u007f]/.test(s)) return false;
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<unknown> } }).Segmenter;
  if (Seg !== undefined) return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(s)).length === 1;
  return Array.from(s).length === 1;
}

export type KeyVerdict = { ok: true } | { ok: false; why: string };

/** `ui.key`: forwardable and under real activation. */
export function judgeKey(key: string, activation: boolean): KeyVerdict {
  if (!isForwardable(key)) return { ok: false, why: `${key} is not forwardable` };
  if (!activation) return { ok: false, why: 'no user activation' };
  return { ok: true };
}

/** `ui.typed`: one grapheme, under real activation, with focus still in the plugin's frame. */
export function judgeTyped(grapheme: string, activation: boolean, focusInFrame: boolean): KeyVerdict {
  if (!isOneGrapheme(grapheme)) return { ok: false, why: 'not exactly one character' };
  if (!activation) return { ok: false, why: 'no user activation' };
  if (!focusInFrame) return { ok: false, why: 'focus is not in the editor' };
  return { ok: true };
}
