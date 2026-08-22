// Unit tests: the zero-dependency diff/file colorizers (DES-FEEDBACK-002 §3.5,
// slice I). Pure functions — given a unified diff string, the right line KINDS,
// including the adversarial shapes the classifier must not fumble: `+++`-leading
// content INSIDE hunks, diff headers, no-newline markers.
import { describe, expect, it } from 'vitest';
import { classifyDiff, isDimLine } from '../src/viewer/colorize.js';

const kinds = (diff: string): string[] => classifyDiff(diff).map((l) => l.kind);

describe('classifyDiff — the stateful unified-diff classifier', () => {
  it('classifies a plain one-hunk git diff', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index 1111111..2222222 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -61,6 +61,9 @@ export function x() {',
      '   const res = await fetch(url);',
      '-  return res;',
      '+  return res.json();',
    ].join('\n');
    expect(kinds(diff)).toEqual(['file', 'meta', 'file', 'file', 'hunk', 'ctx', 'del', 'add']);
  });

  it('ADVERSARIAL: a line starting "+++" INSIDE a hunk is an addition, not a header', () => {
    // An added content line that itself begins "++ …" renders as "+++ …".
    const diff = [
      'diff --git a/notes.md b/notes.md',
      '--- a/notes.md',
      '+++ b/notes.md',
      '@@ -1,2 +1,4 @@',
      ' context',
      '+++ this added line starts with plus-plus',
      '--- this REMOVED line starts with dash-dash',
      '+diff --git is fine as content too? no: leading + wins',
    ].join('\n');
    expect(kinds(diff)).toEqual(['file', 'file', 'file', 'hunk', 'ctx', 'add', 'del', 'add']);
  });

  it('ADVERSARIAL: "diff --git" as a NEW section resets hunk state', () => {
    const diff = [
      'diff --git a/a b/a',
      '@@ -1 +1 @@',
      '+x',
      'diff --git a/b b/b',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/b',
      '@@ -0,0 +1 @@',
      '+y',
    ].join('\n');
    expect(kinds(diff)).toEqual(
      ['file', 'hunk', 'add', 'file', 'meta', 'file', 'file', 'hunk', 'add'],
    );
  });

  it('the no-newline marker is metadata, never a removal', () => {
    const diff = [
      'diff --git a/a b/a',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '\\ No newline at end of file',
    ].join('\n');
    expect(kinds(diff)).toEqual(['file', 'hunk', 'del', 'add', 'meta']);
  });

  it('a header-block "--- a/…" line is a file header, not a deletion', () => {
    const diff = ['diff --git a/f b/f', '--- a/f', '+++ b/f', '@@ -1 +1 @@', '-gone'].join('\n');
    const lines = classifyDiff(diff);
    expect(lines[1]?.kind).toBe('file');
    expect(lines[4]?.kind).toBe('del');
  });

  it('binary-file notices and rename headers classify as metadata', () => {
    const diff = [
      'diff --git a/img.png b/img.png',
      'similarity index 100%',
      'rename from img.png',
      'rename to assets/img.png',
      'Binary files a/img.png and b/img.png differ',
    ].join('\n');
    expect(kinds(diff)).toEqual(['file', 'meta', 'meta', 'meta', 'meta']);
  });

  it('an empty diff (clean tree) classifies to nothing', () => {
    expect(classifyDiff('')).toEqual([]);
  });

  it('preserves every line verbatim (text is never rewritten)', () => {
    const diff = 'diff --git a/a b/a\n@@ -1 +1 @@\n+  spaced   text  ';
    expect(classifyDiff(diff).map((l) => l.text)).toEqual([
      'diff --git a/a b/a', '@@ -1 +1 @@', '+  spaced   text  ',
    ]);
  });
});

describe('isDimLine — the comment dimmer (NOT syntax highlighting)', () => {
  it('dims line comments and block-comment lines', () => {
    expect(isDimLine('// a comment')).toBe(true);
    expect(isDimLine('  # python-style')).toBe(true);
    expect(isDimLine('/* block open')).toBe(true);
    expect(isDimLine(' * block middle')).toBe(true);
    expect(isDimLine(' */')).toBe(true);
    expect(isDimLine('<!-- html -->')).toBe(true);
  });

  it('leaves code lines body-colored', () => {
    expect(isDimLine('const x = 1;')).toBe(false);
    expect(isDimLine('a #= weird-but-code')).toBe(false);
    expect(isDimLine('x *= 2')).toBe(false);
    expect(isDimLine('')).toBe(false);
  });
});
