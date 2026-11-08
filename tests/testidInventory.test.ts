/**
 * TH-13 — the committed data-testid inventory matches a live scan of src/, or this fails.
 *
 * `testid-inventory.json` (repo root, committed; also emitted into the built dist by
 * vite.config.ts) is the machine-readable record of every data-testid the UI declares —
 * the selector contract test generators and the model-free campaign runner build against.
 * It is produced by the same scanner this test runs (scripts/testid-inventory.mjs), so the
 * ONLY way it can disagree with a live scan is that a testid changed after the last
 * `npm run manifest:testids`. That is the point: an added, removed, or renamed testid
 * fails CI here until the inventory is regenerated and its diff is reviewed alongside the
 * UI change. The inventory diff IS the selector regression trigger.
 *
 * Drift strategy downstream (test-R13): a selector miss in the deterministic executor
 * FAILS the run — the model-free runner never decides what to click, so there is no
 * agentic fallback inside it. The authoring agent re-authors the spec against the live
 * DOM, the runner re-records deterministically, and the substitution lands in the spec
 * diff for review.
 *
 * On failure: `npm run manifest:testids`, review the JSON diff, commit both.
 *
 * @vitest-environment node
 *   (pure filesystem test — the suite-wide jsdom env rewrites import.meta.url to a
 *   non-file scheme, which breaks fileURLToPath here and buys nothing for this test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  collectTestidInventory,
  collectTestidScan,
  INVENTORY_VERSION,
  withCounts,
  type TestidInventory,
} from '../scripts/testid-inventory.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INVENTORY_PATH = fileURLToPath(new URL('../testid-inventory.json', import.meta.url));

function committed(): TestidInventory {
  return JSON.parse(readFileSync(INVENTORY_PATH, 'utf8')) as TestidInventory;
}

describe('testid-inventory.json (TH-13)', () => {
  // A filesystem scan of src/ — 6 s on a loaded host (independent review of #263, F-13); the
  // default 5 s budget is a load-shaped flake, not a signal.
  it('matches a live scan of src/ exactly — drift fails CI until regenerated + reviewed', { timeout: 120_000 }, () => {
    const live = collectTestidInventory(ROOT);
    // toEqual over the whole artifact: any testid added/removed/renamed, any file moved,
    // any count change shows up as a structural diff naming the exact entry.
    expect(
      live,
      'testid-inventory.json is stale — run `npm run manifest:testids`, review the diff, and commit it with the UI change',
    ).toEqual(committed());
  });

  it('carries the inventory format version and this package version', () => {
    const inv = committed();
    expect(inv.version).toBe(INVENTORY_VERSION);
    const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')) as { version: string };
    expect(inv.studioVersion).toBe(pkg.version);
    // The drift strategy travels inside the artifact itself.
    expect(inv.$doc.join(' ').toLowerCase()).toContain('no agentic fallback');
  });

  it('declares the connection-status selector the 2026-08 campaign drifted on', () => {
    // The campaign hit exactly this class of drift: the shipped bundle had `connection-dot`
    // where the spec said `connection-status` (studio-campaign-results.json env_notes). The
    // chrome `connection-dot` was since removed (nav-ui-tweaks); `connection-status` remains
    // the live affordance — losing it is a contract change a generator must see in this
    // file's diff, not discover at runtime.
    const ids = new Set(committed().static.map((e) => e.testId));
    expect(ids.has('connection-status')).toBe(true);
    // The retired dot must NOT reappear as a silent duplicate of connection-status.
    expect(ids.has('connection-dot')).toBe(false);
  });

  // A src/ scan (the counts are computed on read): the same budget as the drift test.
  it('covers the whole declared surface and stays deterministically ordered', { timeout: 120_000 }, () => {
    const inv = committed();
    // The UI declares a large surface; a sudden shrink to a handful of rows means the
    // scanner walked the wrong tree.
    expect(inv.static.length).toBeGreaterThan(400);
    // The counts are computed on read (the dist copy): they agree with the lists and the scan.
    const scan = collectTestidScan(ROOT);
    expect(scan.inventory.static).toHaveLength(inv.static.length);
    expect(scan.inventory.dynamic).toHaveLength(inv.dynamic.length);
    expect(scan.inventory.computed).toHaveLength(inv.computed.length);
    const { counts } = withCounts(inv, scan);
    expect(counts.occurrences).toBeGreaterThanOrEqual(counts.static + counts.dynamic);
    expect(counts.files).toBeGreaterThan(100);
    // Stable codepoint ordering — what makes drift diffs reviewable and byte-identical
    // across macOS/Linux/Windows (no localeCompare anywhere).
    const codepointSorted = (xs: string[]) =>
      xs.every((x, i) => i === 0 || String(xs[i - 1]) <= x);
    expect(codepointSorted(inv.static.map((e) => e.testId))).toBe(true);
    expect(codepointSorted(inv.dynamic.map((e) => e.pattern))).toBe(true);
    expect(codepointSorted(inv.computed.map((e) => e.expression))).toBe(true);
    for (const entry of [...inv.static, ...inv.dynamic, ...inv.computed]) {
      expect(codepointSorted(entry.files)).toBe(true);
      for (const f of entry.files) expect(f.startsWith('src/')).toBe(true);
    }
  });

  it('normalises dynamic template testids to * patterns (live-DOM-only selectors are marked)', () => {
    const inv = committed();
    const patterns = new Set(inv.dynamic.map((e) => e.pattern));
    // Representative template-literal testid: `editor-size-${…}` (the retired gate card's
    // `gate-escalation-${o.action}` went with it, S16a-4i).
    expect(patterns.has('editor-size-*')).toBe(true);
    for (const p of patterns) expect(p).toContain('*');
  });

  it('commits no aggregate: nothing in the file changes with every testid (studio PRs conflicted on the counts)', () => {
    const raw = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(raw)).toEqual(['$doc', 'version', 'studioVersion', 'static', 'dynamic', 'computed']);
    expect(raw).not.toHaveProperty('counts');
  });

  it('two branches that each add a disjoint testid merge without a conflict', { timeout: 60_000 }, () => {
    // A tiny repo: the same scanner and the same serialisation the generator writes.
    const tmp = mkdtempSync(join(tmpdir(), 'testid-inv-'));
    try {
      const write = (files: Record<string, string>): string => {
        rmSync(join(tmp, 'src'), { recursive: true, force: true });
        mkdirSync(join(tmp, 'src'), { recursive: true });
        writeFileSync(join(tmp, 'package.json'), JSON.stringify({ version: '0.0.0' }));
        for (const [name, text] of Object.entries(files)) writeFileSync(join(tmp, 'src', name), text);
        return `${JSON.stringify(collectTestidInventory(tmp), null, 2)}\n`;
      };
      const el = (id: string): string => `<div data-testid="${id}" />\n`;
      const base = { 'a.tsx': el('apple') + el('banana'), 'm.tsx': el('mango') + el('melon'), 'z.tsx': el('yam') + el('zucchini') };
      const baseJson = write(base);
      // Branch A adds one testid in a.tsx, branch B two in z.tsx — disjoint in the sorted list. (With the old
      // committed counts both branches rewrote the same header lines to different numbers: a conflict every time.)
      // Two ids adjacent in sort order still meet at the same place, as any sorted list does.
      const ours = write({ ...base, 'a.tsx': base['a.tsx'] + el('cherry') });
      const theirs = write({ ...base, 'z.tsx': base['z.tsx'] + el('tomato') + el('turnip') });
      const both = write({ ...base, 'a.tsx': base['a.tsx'] + el('cherry'), 'z.tsx': base['z.tsx'] + el('tomato') + el('turnip') });
      for (const [name, text] of [['base.json', baseJson], ['ours.json', ours], ['theirs.json', theirs]]) writeFileSync(join(tmp, name!), text!);
      // git merge-file exits with the number of conflicts (0 = clean) and prints the merge.
      let merged = '';
      let conflicts = 0;
      try {
        merged = execFileSync('git', ['merge-file', '-p', join(tmp, 'ours.json'), join(tmp, 'base.json'), join(tmp, 'theirs.json')], { encoding: 'utf8' });
      } catch (e) {
        conflicts = (e as { status?: number }).status ?? -1;
        merged = String((e as { stdout?: unknown }).stdout ?? '');
      }
      expect(conflicts).toBe(0);
      // …and the clean merge is exactly what regenerating with both changes writes.
      expect(merged).toBe(both);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
