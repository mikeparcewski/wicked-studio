/** studio#734: one place for a feed sentence's short line — the Watchtower and the Desk's Watchtower card. Pure. */

/** Keep long engine explanations behind a disclosure, with their lead in the feed. */
export function plainWatchLine(sentence: string): { line: string; detail: string | null } {
  const colon = sentence.indexOf(': ');
  // Long engine prose, or a tail carrying internal tokens ("monitors=1", "run_unit", a path), goes
  // behind the disclosure; a short plain sentence stays whole.
  const internal = colon !== -1 && /[=_/\\]/.test(sentence.slice(colon + 2));
  // An env-style token or a relative file path ("WICKED_X=…", "src/a.ts:10") ends the plain line too.
  const token = /\s+(?:in|at|on|from)?\s*(?:[A-Z][A-Z0-9]*_[A-Z0-9_]+=?\S*|[\w.-]+\/[\w./-]+(?::\d+)?)/u.exec(sentence);
  if (colon === -1 && token !== null && token.index > 0) {
    return { line: sentence.slice(0, token.index).trim().replace(/[\p{P}\s]+$/u, ''), detail: sentence };
  }
  // A path in the sentence ("… in /var/…") ends the plain line there; the whole sentence is the detail.
  const path = /\s+(?:in|at|on|under|from)?\s*(?:~|\$TMPDIR|\/)[\w.~$-]*\/[^\s]*/u.exec(sentence);
  if (path !== null && path.index > 0) {
    return { line: sentence.slice(0, path.index).trim().replace(/[\p{P}\s]+$/u, ''), detail: sentence };
  }
  // A parenthetical of internal tokens ("(quota_exhausted)") drops from the line, kept in the detail.
  const paren = /\s*\(([^()]*[=_/\\][^()]*)\)/u;
  if (colon === -1 && paren.test(sentence)) {
    return { line: sentence.replace(paren, '').trim(), detail: sentence };
  }
  if (colon !== -1 && (sentence.length > 60 || internal)) {
    return { line: sentence.slice(0, colon).trim().replace(/[\p{P}\s]+$/u, ''), detail: sentence };
  }
  return { line: sentence, detail: null };
}
