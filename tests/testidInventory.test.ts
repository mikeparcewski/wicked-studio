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

import {
  collectTestidInventory,
  INVENTORY_VERSION,
  type TestidInventory,
} from '../scripts/testid-inventory.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INVENTORY_PATH = fileURLToPath(new URL('../testid-inventory.json', import.meta.url));

function committed(): TestidInventory {
  return JSON.parse(readFileSync(INVENTORY_PATH, 'utf8')) as TestidInventory;
}

describe('testid-inventory.json (TH-13)', () => {
  it('matches a live scan of src/ exactly — drift fails CI until regenerated + reviewed', () => {
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

  it('declares the selectors the 2026-08 campaign drifted on (both must stay declared)', () => {
    // The campaign hit exactly this class of drift: the shipped bundle had `connection-dot`
    // where the spec said `connection-status` (studio-campaign-results.json env_notes).
    // Both exist in src today as distinct affordances; losing either is a contract change
    // a generator must see in this file's diff, not discover at runtime.
    const ids = new Set(committed().static.map((e) => e.testId));
    expect(ids.has('connection-dot')).toBe(true);
    expect(ids.has('connection-status')).toBe(true);
  });

  it('covers the whole declared surface and stays deterministically ordered', () => {
    const inv = committed();
    // The UI declares a large surface; a sudden shrink to a handful of rows means the
    // scanner walked the wrong tree.
    expect(inv.counts.static).toBeGreaterThan(400);
    expect(inv.counts.occurrences).toBeGreaterThanOrEqual(
      inv.counts.static + inv.counts.dynamic,
    );
    // counts must agree with the lists they summarise.
    expect(inv.static).toHaveLength(inv.counts.static);
    expect(inv.dynamic).toHaveLength(inv.counts.dynamic);
    expect(inv.computed).toHaveLength(inv.counts.computed);
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
    // Representative template-literal testid: `gate-approve-${runId}` in GateChip.
    expect(patterns.has('gate-approve-*')).toBe(true);
    for (const p of patterns) expect(p).toContain('*');
  });
});
