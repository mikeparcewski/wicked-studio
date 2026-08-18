// The one narration rule, in code (DES-MERGE-001 §3.2/§3.3): every status line is
// either actionable or informative, and rotating flavour text is neither.
//
// wicked-interactive's `Thread.jsx` rotates a fixed WHIMSY list every 4 s while the
// agent works, because its status channel could go silent. Studio relays real output,
// so the filler is DELETED (§4.9's only outright deletion) — and deleted at the SEAM,
// not just at its old emit site: an upstream bridge that still speaks it must not put
// it back on screen. Every surface that renders a relayed status routes through here.

/** The verbatim WHIMSY list, normalized. Matching the phrase (not a keyword) keeps a
 *  real status that happens to mention a gate or a lane from being swallowed. */
const FILLER: ReadonlySet<string> = new Set([
  'wiring the harness',
  'pondering the loop',
  'tightening the bolts',
  'consulting the spine',
  'aligning the lanes',
  'reticulating splines',
  'checking the gates',
]);

/** Words that cannot name a subject in any real document status, in any phrasing. */
const NONSENSE = /reticulat|splines/i;

/**
 * §3.3's other banned shape: a status with no subject. "Working…" is not informative —
 * it says nothing about THIS run — and it is not actionable. The whole phrase is matched,
 * anchored: "Working on the hero section" names its subject and must survive untouched.
 */
const BARE = /^(working|processing|thinking|running|busy|loading|please wait|one moment)$/u;

/** Lowercase, one-space, no trailing ellipsis — the filler ships with a trailing `…`. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/[\s….!]+$/u, '').trim();
}

/** True when this status is flavour text and must never reach a rendering surface. */
export function isWhimsy(text: string): boolean {
  return NONSENSE.test(text) || FILLER.has(normalize(text));
}

/** True when this status names no subject — §3.3's bare `Working…`, in any casing. */
export function isBare(text: string): boolean {
  return BARE.test(normalize(text));
}

/** Neither informative nor actionable, so it never reaches a surface (§3.2's deletion). */
export function isFiller(text: string): boolean {
  return isWhimsy(text) || isBare(text);
}

/**
 * §3.4's derivation, for one line: the last streamed status that actually names
 * something, and otherwise the caller's derived subject (rule 3 — there is always a
 * truthful subject available from state the client already has, which is precisely why
 * a bare `Working…` is never needed).
 */
export function statusLine(streamed: readonly string[], subject: string): string {
  for (let i = streamed.length - 1; i >= 0; i -= 1) {
    const text = (streamed[i] ?? '').trim();
    if (text !== '' && !isFiller(text)) return text;
  }
  return subject;
}
