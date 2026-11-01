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

  // Operator 2026-11-01 (round 5): Wicked Sans v2 is the text and UI face (Regular 400, SemiBold for 500-700, Inter as
  // the per-character fallback), Wicked Serif the default wordmark, JetBrains Mono the code face.
  it('the body and UI are Wicked Sans (two weights, no faked bold); the wordmark is Wicked Serif', () => {
    const css = readFileSync(FONTS_CSS, 'utf8');
    for (const f of ['WickedSans-Regular', 'WickedSans-SemiBold', 'WickedSerif-Regular', 'WickedScript-Regular']) {
      expect(existsSync(join(REPO, 'src', 'assets', 'fonts', 'wicked', `${f}.woff2`)), f).toBe(true);
    }
    const sans = [...css.matchAll(/@font-face\s*\{([^}]*)\}/gu)].map((m) => m[1]!).filter((f) => /'Wicked Sans'/u.test(f));
    expect(sans.map((f) => [/font-weight:\s*([^;]+);/u.exec(f)?.[1], /WickedSans-(\w+)\.woff2/u.exec(f)?.[1]])).toEqual([['100 450', 'Regular'], ['451 900', 'SemiBold']]);
    expect(css).toMatch(/html \{ font-synthesis-weight: none; \}/u);
    expect(css).toMatch(/\.wk-wordmark \{ font-family: var\(--font-display\)/u);
    const sansStack = /--font-sans: 'Wicked Sans', 'Inter',/u;
    expect(readFileSync(join(REPO, 'src', 'styles', 'tokens.css'), 'utf8')).toMatch(sansStack);
    for (const t of ['wicked-dark', 'wicked-light']) expect(readFileSync(join(REPO, 'src', 'styles', 'themes', `${t}.css`), 'utf8')).toMatch(sansStack);
    expect(readFileSync(join(REPO, 'src', 'styles', 'tokens.css'), 'utf8')).toMatch(/--font-display: 'Wicked Serif'/u);
    expect(readFileSync(join(REPO, 'src', 'styles', 'tokens.css'), 'utf8')).toMatch(/--font-mono: 'JetBrains Mono'/u);
    // Only the wordmark reads --font-display, and the rail's catch-all text-face rule leaves it alone (round 4).
    const all = readdirSync(join(REPO, 'src', 'styles'), { recursive: true }).filter((p) => String(p).endsWith('.css'))
      .map((p) => readFileSync(join(REPO, 'src', 'styles', String(p)), 'utf8')).join('\n');
    const uses = [...all.matchAll(/([^{}]+)\{[^}]*var\(--font-display\)/gu)].map((m) => m[1]!.replace(/\/\*[\s\S]*?\*\//gu, '').trim());
    expect(uses).toEqual(['.wk-wordmark']);
    expect(all).toMatch(/\[data-testid="desk"\]\) :not\([^)]*\.wk-wordmark, \.wk-wordmark \*\)/u);
  });

  it('each font family ships its OFL licence beside the files', () => {
    for (const f of ['LICENSE-Inter.txt', 'LICENSE-Archivo.txt', 'LICENSE-JetBrainsMono.txt']) {
      const text = readFileSync(join(REPO, 'src', 'assets', 'fonts', f), 'utf8');
      expect(text).toMatch(/SIL Open Font License/);
    }
  });
});
