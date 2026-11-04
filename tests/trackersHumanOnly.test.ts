/**
 * Tracker links are a person's only (DES-PM-001 §3.3: every tracker-links route answers 403 `tracker_links_human_only`
 * to any other actor). studio adds that a link is made or removed only on a person's click: `trackersApi.link` has ONE
 * caller (the Link a tracker picker) and `trackersApi.unlink` ONE (the Remove button), and neither reads a URL, storage
 * or message, or acts from an effect.
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

describe('tracker links are made and removed only by a person’s click', () => {
  it('link has one caller, the picker; unlink has one, Remove', () => {
    expect(all.filter((f) => /trackersApi\.link\s*\(/.test(f.text)).map((f) => f.path)).toEqual(['src/components/trackers/LinkTrackerPicker.tsx']);
    expect(all.filter((f) => /trackersApi\.unlink\s*\(/.test(f.text)).map((f) => f.path)).toEqual(['src/components/trackers/TrackerParts.tsx']);
    // No other module spells the write routes.
    const writers = all.filter((f) => f.path !== 'src/api/trackers.ts' && /['"`]\/tracker-links['"`/]/.test(f.text) && /method:\s*'(POST|DELETE)'/.test(f.text));
    expect(writers.map((f) => f.path)).toEqual([]);
  });
  it('neither caller reads a URL, storage or message, and no effect links or removes', () => {
    for (const path of ['src/components/trackers/LinkTrackerPicker.tsx', 'src/components/trackers/TrackerParts.tsx']) {
      const c = all.find((f) => f.path === path)!.text;
      for (const banned of ['location', 'URLSearchParams', 'localStorage', 'sessionStorage', 'postMessage', 'addEventListener']) expect(c, `${path}: ${banned}`).not.toContain(banned);
      const effects = c.split('useEffect(').slice(1).map((chunk) => chunk.slice(0, chunk.search(/\}, \[[^\]]*\]\);/)));
      for (const e of effects) expect(e, path).not.toMatch(/trackersApi\.(link|unlink)|void link\(|remove\(\)/);
    }
    // The picker links from its Link button's click only; Remove removes from its click only.
    const picker = all.find((f) => f.path === 'src/components/trackers/LinkTrackerPicker.tsx')!.text;
    expect([...picker.matchAll(/void link\(t\)/g)]).toHaveLength(1);
    expect(picker).toMatch(/onClick=\{\(\) => void link\(t\)\}/);
    const parts = all.find((f) => f.path === 'src/components/trackers/TrackerParts.tsx')!.text;
    expect(parts).toMatch(/onClick=\{\(\) => void remove\(\)\}/);
  });
});
