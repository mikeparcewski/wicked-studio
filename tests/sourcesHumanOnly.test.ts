/**
 * Allow writes is human-only in the UI (DES-APPS-001 §7.4: "Turning it on or off is human-only and
 * audited"). crew refuses a non-human actor (403 `writes_switch_human_only`); studio adds that the switch
 * is reached only by a person's click: `sourcesApi.setAllowWrites` has ONE caller, the switch component,
 * which reads no URL, storage or message to decide anything, and no other module names the route.
 * @vitest-environment node
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
});
const rel = (p: string): string => relative(join(__dirname, '..'), p).replace(/\\/g, '/');
const all = files(SRC).map((p) => ({ path: rel(p), text: readFileSync(p, 'utf8') }));

describe('Allow writes is reached only by the switch', () => {
  it('only src/api/sources.ts names the allow-writes route', () => {
    // The route segment (`'allow-writes'`, `/allow-writes`), not a testid like `source-allow-writes`.
    expect(all.filter((f) => /['"`/]allow-writes\b/.test(f.text)).map((f) => f.path)).toEqual(['src/api/sources.ts']);
  });
  it('setAllowWrites is called only by AllowWritesSwitch', () => {
    const callers = all.filter((f) => /\.setAllowWrites\s*\(/.test(f.text)).map((f) => f.path);
    expect(callers).toEqual(['src/components/sources/AllowWritesSwitch.tsx']);
  });
  it('the switch acts on clicks only: no URL, storage, message or timer decides it', () => {
    const sw = all.find((f) => f.path === 'src/components/sources/AllowWritesSwitch.tsx')!.text;
    for (const banned of ['location', 'URLSearchParams', 'localStorage', 'sessionStorage', 'postMessage', 'addEventListener', 'setTimeout', 'useEffect']) {
      expect(sw, banned).not.toContain(banned);
    }
    // Both directions go through the confirmation step: `apply` is called only from the confirm buttons.
    expect([...sw.matchAll(/apply\(/g)]).toHaveLength(2);
    expect(sw).toMatch(/confirm-on`\} onClick=\{\(\) => void apply\(true\)\}/);
    expect(sw).toMatch(/confirm-off`\} onClick=\{\(\) => void apply\(false\)\}/);
  });
  it('no plugin, editor host or chat module imports the sources API', () => {
    const importers = all.filter((f) => /from ['"][./]*(?:\.\.\/)*api\/sources\.js['"]/.test(f.text)).map((f) => f.path).sort();
    expect(importers.every((p) => p.startsWith('src/components/sources/'))).toBe(true);
  });
});
