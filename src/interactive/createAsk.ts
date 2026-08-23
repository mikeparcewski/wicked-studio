/**
 * Quoted-name extraction for the create flows (DES-UX-001 §7.3, slice X2).
 *
 * The brief's gaslight: `a deck named "uxr-quarterly-brief" …` used to have the
 * WHOLE sentence slugified into the doc's name by the bridge. The fix is a
 * client-side parse: a quoted name in the ask BECOMES the name, the rest of the
 * sentence stays the brief — and the parse is SHOWN before submit (the
 * `create-parse` line under the composer), so the operator sees what will be
 * created before pressing Enter.
 *
 * Deliberately conservative: only a quoted span parses (straight or curly
 * quotes), 1–60 chars, no newline — and BOTH quote marks must sit on word
 * edges, so apostrophe contractions ("last week's numbers, don't…") never
 * false-parse as a name. An unquoted ask is untouched — the existing
 * first-six-words derivation stays the fallback. When removing the quoted span
 * (and an immediately preceding naming cue: named/called/titled) empties the
 * sentence, the full ask stays the brief — a name alone is not a brief.
 */

export interface CreateAskParse {
  /** The quoted name, exactly as the operator wrote it (quotes stripped). */
  name: string;
  /** The ask with the quoted span (and its naming cue) removed — the brief. */
  brief: string;
}

// `\b` on the cue keeps "renamed" from half-matching as a cue; the lookarounds
// keep an apostrophe INSIDE a word (week's, don't) from opening/closing a span.
const QUOTED = /(?:\b(?:named|called|titled)\s+)?(?<!\w)["“”'‘’]([^"“”'‘’\n]{1,60})["“”'‘’](?!\w)/i;

export function parseCreateAsk(ask: string): CreateAskParse | null {
  const m = QUOTED.exec(ask);
  if (m === null) return null;
  const name = (m[1] ?? '').trim();
  if (name === '') return null;
  const brief = (ask.slice(0, m.index) + ' ' + ask.slice(m.index + m[0].length))
    .replace(/\s+/g, ' ')
    .trim();
  return { name, brief: brief === '' ? ask.trim() : brief };
}
