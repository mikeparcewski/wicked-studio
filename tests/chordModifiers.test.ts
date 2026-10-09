import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { isBarePrintable, registerShortcuts, type ShortcutChord } from '../src/hooks/useGlobalShortcuts.js';

/**
 * DES-STUDIO-REBUILD-001 §5.6 rule 1 (slice S2a): no global shortcut is a printable key
 * without a modifier. Letters type; chords use ⌥ (or Ctrl/⌘ where the platform convention
 * is stronger). This file enumerates EVERY chord literal registered anywhere under src/ and
 * fails on any printable key with no modifier; the registry itself also refuses one at
 * registration, so a computed chord the scan cannot read still cannot slip through.
 */

const SRC = join(__dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

interface Found { file: string; literal: string; chord: ShortcutChord | null }

/** Classify every `chord:` initializer in one source text. Readable forms: an object literal
 *  or a plain `altChord('x')` call, each ENDING the initializer (`,` or `}` next).
 *  Anything else — a constant, another helper, `altChord('j' + s)`, `altChord('j') && {…}` —
 *  is reported with `chord: null`: the scan fails closed instead of skipping it. */
function scanChords(text: string, file: string): Found[] {
  const found: Found[] = [];
  // An initializer ends at `,` or `}` — a newline does not end one (`altChord('j')\n && {…}`).
  const END = String.raw`(?=\s*[,}])`;
  for (const m of text.matchAll(new RegExp(String.raw`chord:\s*(\{[^}]*\})` + END, 'g'))) {
    const literal = m[1]!;
    const key = /key:\s*'((?:\\'|[^'])*)'/.exec(literal)?.[1];
    const modified = /(alt|ctrlOrMeta):\s*true/.test(literal);
    found.push({
      file,
      literal,
      // A computed key is readable only when the literal carries a modifier anyway.
      chord: key === undefined ? (modified ? { key: '(computed)', alt: true } : null) : {
        key: key.replace(/\\'/g, "'"),
        alt: /alt:\s*true/.test(literal),
        ctrlOrMeta: /ctrlOrMeta:\s*true/.test(literal),
        shift: /shift:\s*true/.test(literal),
      },
    });
  }
  // Chords built through the helper (`chord: altChord('j')`) are modified by construction.
  for (const m of text.matchAll(new RegExp(String.raw`chord:\s*altChord\(\s*'([^']+)'\s*\)` + END, 'g'))) {
    found.push({ file, literal: m[0], chord: { key: m[1]!, alt: true } });
  }
  const readable = new RegExp(String.raw`^\s*(?:\{[^}]*\}|altChord\(\s*'[^']+'\s*\))` + END);
  for (const m of text.matchAll(/chord:([^\n]*)/g)) {
    const rest = text.slice(m.index! + 'chord:'.length);
    if (readable.test(rest)) continue;
    if (/^\s*ShortcutChord\b/.test(m[1]!)) continue; // a type annotation, not a value
    found.push({ file, literal: m[0], chord: null });
  }
  return found;
}

/** Every chord initializer under src/. */
function enumerateChords(): Found[] {
  return sourceFiles(SRC).flatMap((f) => scanChords(readFileSync(f, 'utf8'), relative(SRC, f)));
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('§5.6 rule 1 — every global chord carries a modifier', () => {
  it('isBarePrintable: a single printable key with no modifier is bare; named keys and modified chords are not', () => {
    for (const key of ['j', 'k', 'a', 'r', 'x', ' ', '?', '/', '1', 'n']) {
      expect(isBarePrintable({ key }), key).toBe(true);
      expect(isBarePrintable({ key, shift: true }), `Shift+${key}`).toBe(true);
    }
    for (const key of ['escape', 'enter', 'arrowdown', 'arrowup']) {
      expect(isBarePrintable({ key }), key).toBe(false);
    }
    expect(isBarePrintable({ key: 'j', alt: true })).toBe(false);
    expect(isBarePrintable({ key: 'k', ctrlOrMeta: true })).toBe(false);
  });

  it('the chord enumeration finds no printable key without a modifier anywhere under src/', () => {
    const all = enumerateChords();
    // The scan must actually see the registry's users (guards against a regex that matches nothing).
    // S16a-4h/4i: the deleted shell, gate card and chat page registered their own chords (20+ → 17).
    expect(all.length).toBeGreaterThan(12);
    const unreadable = all.filter((f) => f.chord === null).map((f) => `${f.file}: ${f.literal}`);
    const bare = all
      .filter((f) => f.chord !== null && isBarePrintable(f.chord))
      .map((f) => `${f.file}: ${f.literal}`);
    // `unreadable`: spell the key literally (or through altChord) so the scan can judge it.
    expect({ bare, unreadable }).toEqual({ bare: [], unreadable: [] });
  }, 120_000);

  it('the scan fails closed on initializers it cannot judge (Copilot review on #418)', () => {
    const unreadable = (src: string): boolean => scanChords(src, 'x.ts').some((f) => f.chord === null);
    expect(unreadable("{ id: 'a', chord: altChord('j' + suffix), handler }")).toBe(true);
    expect(unreadable("{ id: 'a', chord: altChord('j') && { key: 'a' }, handler }")).toBe(true);
    expect(unreadable("{ id: 'a', chord: SOME_CHORD, handler }")).toBe(true);
    expect(unreadable("{ id: 'a', chord: { key: 'j' } && x, handler }")).toBe(true);
    expect(unreadable("{ id: 'a', chord: altChord('j')\n    && { key: 'a' }, handler }")).toBe(true);
    expect(unreadable("{ id: 'a', chord: altChord('j'), handler }")).toBe(false);
    expect(unreadable("{ id: 'a', chord: { key: 'escape' },\n handler }")).toBe(false);
    expect(unreadable('function f(chord: ShortcutChord): void {}')).toBe(false);
  });

  it('the registry refuses a bare printable chord at registration', () => {
    expect(() =>
      registerShortcuts([{ id: 'bare-j', chord: { key: 'j' }, description: 'x', handler: () => {} }]),
    ).toThrow(/modifier/);
    // An Alt letter chord matched on `key` would never fire on macOS (Option+J reports '∆').
    expect(() =>
      registerShortcuts([{ id: 'alt-j-by-key', chord: { key: 'j', alt: true }, description: 'x', handler: () => {} }]),
    ).toThrow(/code/);
    // Named keys and modified chords register fine.
    cleanups.push(registerShortcuts([
      { id: 'esc', chord: { key: 'escape' }, description: 'x', handler: () => {} },
      { id: 'alt-j', chord: { key: 'j', code: 'KeyJ', alt: true }, description: 'x', handler: () => {} },
    ]));
  });
});
