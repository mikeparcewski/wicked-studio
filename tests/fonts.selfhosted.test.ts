// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Self-hosted fonts (DES-STUDIO-REBUILD-001 S1): the app makes 0 requests to a font CDN.
 * Inter, Archivo and JetBrains Mono (SIL OFL) ship as woff2 under src/assets/fonts and are
 * declared by src/styles/fonts.css; nothing in index.html or the stylesheets points at a
 * font host. The no-request half in a real browser is e2e/wicked_theme_test.py.
 */

const REPO = join(__dirname, '..');
const FONT_CDN = /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net|cdn\.jsdelivr\.net\/npm\/@fontsource/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('fonts are self-hosted', () => {
  it('index.html and every source file name no font CDN', () => {
    const files = [join(REPO, 'index.html'), ...walk(join(REPO, 'src')).filter((f) => /\.(css|tsx?|html)$/.test(f))];
    const hits = files.filter((f) => FONT_CDN.test(readFileSync(f, 'utf8'))).map((f) => relative(REPO, f));
    expect(hits).toEqual([]);
  }, 120_000);

  const FONTS_CSS = join(REPO, 'src', 'styles', 'fonts.css');

  it('global.css imports fonts.css first', () => {
    const global = readFileSync(join(REPO, 'src', 'styles', 'global.css'), 'utf8');
    expect(global).toMatch(/@import '\.\/fonts\.css';/);
  });

  it('declares Inter (normal + italic), Archivo and JetBrains Mono (normal + italic) from local woff2', () => {
    expect(existsSync(FONTS_CSS)).toBe(true);
    const css = readFileSync(FONTS_CSS, 'utf8');
    const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]!);
    const seen = new Set<string>();
    for (const face of faces) {
      const family = /font-family:\s*'([^']+)'/.exec(face)?.[1];
      const style = /font-style:\s*(\w+)/.exec(face)?.[1];
      const url = /url\(\s*'([^']+)'\s*\)\s*format\('woff2(?:-variations)?'\)/.exec(face)?.[1];
      expect(family, face).toBeDefined();
      expect(url, face).toBeDefined();
      expect(url!.endsWith('.woff2')).toBe(true);
      expect(existsSync(join(REPO, 'src', 'styles', url!)), url).toBe(true);
      expect(face).toMatch(/font-display:\s*swap/);
      seen.add(`${family}/${style}`);
    }
    expect([...seen].sort()).toEqual([
      'Archivo/normal', 'Inter/italic', 'Inter/normal', 'JetBrains Mono/italic', 'JetBrains Mono/normal',
      'Wicked Sans/normal', 'Wicked Script/normal', 'Wicked Serif/normal',
    ]);
  });

  // Operator 2026-10-31: the Wicked faces draw 2-9 as one glyph and most punctuation as a bar, so they are brand faces
  // only. Text is Inter through --font-sans; Wicked Serif reaches the page through --font-display, on the default
  // wordmark alone.
  it('the Wicked faces are bundled, ASCII-only, and only the wordmark uses the display face', () => {
    const css = readFileSync(FONTS_CSS, 'utf8');
    for (const f of ['WickedSerif', 'WickedScript', 'WickedSans']) expect(existsSync(join(REPO, 'src', 'assets', 'fonts', 'wicked', `${f}-Regular.woff2`))).toBe(true);
    expect(css).toMatch(/\.wk-wordmark \{ font-family: var\(--font-display\)/u);
    const tokens = readFileSync(join(REPO, 'src', 'styles', 'tokens.css'), 'utf8');
    expect(tokens).toMatch(/--font-sans: 'Inter'/u);
    expect(tokens).toMatch(/--font-display: 'Wicked Serif'/u);
    // No stylesheet sets text in a Wicked face directly, and only .wk-wordmark reads --font-display.
    const all = readdirSync(join(REPO, 'src', 'styles'), { recursive: true }).filter((p) => String(p).endsWith('.css'))
      .map((p) => readFileSync(join(REPO, 'src', 'styles', String(p)), 'utf8')).join('\n');
    const uses = [...all.matchAll(/([^{}]+)\{[^}]*var\(--font-display\)/gu)].map((m) => m[1]!.replace(/\/\*[\s\S]*?\*\//gu, '').trim());
    expect(uses).toEqual(['.wk-wordmark']);
    expect(all.replace(/@font-face\s*\{[^}]*\}/gu, '')).not.toMatch(/font-family:[^;]*Wicked (Sans|Serif|Script)/u);
    // The rail's catch-all text-face rule (every descendant of the rail and the desk) must leave the wordmark alone, or
    // its higher specificity sets the wordmark in Inter (seen live on :7721, round 4).
    expect(all).toMatch(/\[data-testid="desk"\]\) :not\([^)]*\.wk-wordmark, \.wk-wordmark \*\)/u);
  });

  it('each font family ships its OFL licence beside the files', () => {
    for (const f of ['LICENSE-Inter.txt', 'LICENSE-Archivo.txt', 'LICENSE-JetBrainsMono.txt']) {
      const text = readFileSync(join(REPO, 'src', 'assets', 'fonts', f), 'utf8');
      expect(text).toMatch(/SIL Open Font License/);
    }
  });
});
