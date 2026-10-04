// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildEditors, EDITORS, externalReferences } from '../scripts/build-editors.mjs';

/**
 * EP-P2 — the first-party editor bundles as crew's registry reads them (DES-EDITOR-PLUGINS-001 §5.2,
 * §8.6; crew `registry.ts` `discoverStudioEditors`): one self-contained HTML entry beside its manifest,
 * under the host cap, loading nothing from outside itself, named `wicked-*` in a directory of its id.
 */
const out = mkdtempSync(join(tmpdir(), 'wicked-editors-'));
let written: Awaited<ReturnType<typeof buildEditors>>;

beforeAll(async () => { written = await buildEditors(out, { version: '9.9.9' }); }, 60_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('the first-party editor bundles', () => {
  it('builds every declared editor into <outDir>/editors/<id>/ with its manifest', () => {
    expect(written.map((w) => w.id)).toEqual(EDITORS.map((e) => e.id));
    for (const w of written) {
      const manifest = JSON.parse(readFileSync(join(w.dir, 'editor.json'), 'utf8')) as Record<string, unknown>;
      expect(manifest['id']).toBe(w.id);
      expect(manifest['version']).toBe('9.9.9');
      expect(manifest['entry']).toBe('index.html');
      expect(/^wicked-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(w.id)).toBe(true);
      expect((manifest['sizes'] as string[]).includes('inline')).toBe(true);
      expect((manifest['kinds'] as string[]).length).toBeGreaterThan(0);
      expect(w.dir.endsWith(join('editors', w.id))).toBe(true);
    }
  });
  it('each entry is ONE file: inline script only, nothing loaded from outside, under the 5 MB cap, the version stamped', () => {
    for (const w of written) {
      const html = readFileSync(join(w.dir, 'index.html'), 'utf8');
      expect(externalReferences(html)).toEqual([]);
      expect(/<script\b[^>]*\bsrc=/i.test(html)).toBe(false);
      expect(/<link\b[^>]*rel=["']?stylesheet/i.test(html)).toBe(false);
      expect(w.bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
      expect(html).toContain('<meta name="wicked-editor-version" content="9.9.9">');
      expect(html).toContain(`type:"plugin.ready"`.replace(/"/g, '"')); // the one window message is in the bundle
    }
  });
  it('the page editor speaks wicked.editor/1 for `page` and asks only for what it uses', () => {
    const page = EDITORS.find((e) => e.id === 'wicked-page');
    expect(page?.kinds).toEqual(['page']);
    expect(page?.protocol).toEqual([1]);
    expect(page?.permissions.map((p) => p.id).sort()).toEqual(['artifact.read', 'artifact.write', 'network.media', 'selection.chip']);
  });
});
