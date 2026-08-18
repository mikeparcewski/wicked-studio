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

/** Lowercase, one-space, no trailing ellipsis — the filler ships with a trailing `…`. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/[\s….!]+$/u, '').trim();
}

/** True when this status is flavour text and must never reach a rendering surface. */
export function isWhimsy(text: string): boolean {
  return NONSENSE.test(text) || FILLER.has(normalize(text));
}
