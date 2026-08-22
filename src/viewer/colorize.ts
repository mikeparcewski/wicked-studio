/**
 * Zero-dependency diff/file colorizers for the in-studio viewer
 * (DES-FEEDBACK-002 §3.5 — the §2.3 precedent: NO grammar library ships).
 *
 * Two pure string passes, nothing else:
 *
 *  1. `classifyDiff` — a STATEFUL unified-diff line classifier. State matters:
 *     inside a hunk, content lines start with exactly one of `+`/`-`/` `/`\`,
 *     so an added line whose own text begins `++ …` renders as `+++ …` in the
 *     diff and must classify as an ADDITION, never as a `+++ b/…` file header.
 *     Headers are only legal BETWEEN `diff --git` and the first `@@`.
 *
 *  2. `isDimLine` — the file-view comment dimmer: separates prose from code
 *     (~80% of readability) without pretending to tokenize any language; an
 *     unrecognized language degrades to plain mono, never mis-colors.
 *
 * The classifier emits KINDS; the CSS maps kinds to tokens (EC15 — the diff
 * colors ARE the status layer: added = --status-run family, removed =
 * --status-fail family, hunk headers --ink-dim on --surface-raised).
 */

export type DiffLineKind = 'add' | 'del' | 'hunk' | 'file' | 'meta' | 'ctx';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/** Header/metadata lines legal only OUTSIDE hunks (git's extended headers). */
const HEADER_META = /^(index |old mode|new mode|new file mode|deleted file mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to|Binary files )/;

/**
 * Classify every line of a unified `git diff` for token-mapped rendering.
 * Pure: string in, kinds out — no DOM, no colors, no dependencies.
 */
export function classifyDiff(diff: string): DiffLine[] {
  if (diff === '') return [];
  const out: DiffLine[] = [];
  let inHunk = false;
  for (const text of diff.split('\n')) {
    let kind: DiffLineKind;
    if (text.startsWith('diff --git ')) {
      // A new file section: header territory until its first @@.
      inHunk = false;
      kind = 'file';
    } else if (text.startsWith('@@')) {
      inHunk = true;
      kind = 'hunk';
    } else if (!inHunk) {
      if (text.startsWith('--- ') || text.startsWith('+++ ')) kind = 'file';
      else if (HEADER_META.test(text)) kind = 'meta';
      else kind = 'ctx';
    } else if (text.startsWith('+')) {
      kind = 'add';
    } else if (text.startsWith('-')) {
      kind = 'del';
    } else if (text.startsWith('\\')) {
      // "\ No newline at end of file"
      kind = 'meta';
    } else {
      kind = 'ctx';
    }
    out.push({ kind, text });
  }
  return out;
}

/**
 * File-view comment dimmer (§3.5 item 2): line comments and block-comment
 * lines render `--ink-dim`; everything else `--ink-body`. Deliberately NOT
 * syntax highlighting — a line this misses just stays body-colored.
 */
export function isDimLine(line: string): boolean {
  const t = line.trimStart();
  return (
    t.startsWith('//') ||
    t.startsWith('#') ||
    t.startsWith('/*') ||
    t.startsWith('*/') ||
    t.startsWith('* ') ||
    t === '*' ||
    t.startsWith('<!--')
  );
}
