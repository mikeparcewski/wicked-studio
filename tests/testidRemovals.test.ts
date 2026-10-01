/**
 * DES-STUDIO-REBUILD-001 §6.3 (S0) — no data-testid is removed without a named successor.
 *
 * `testidInventory.test.ts` proves the committed `testid-inventory.json` matches a live scan
 * of src/. This test diffs that committed inventory against the merge base's copy and fails
 * on any testid (static id or dynamic pattern) that the base declared and this tree no
 * longer does, unless `e2e/testid-successors.json` maps it to a successor that this tree
 * does declare. Generators and recorded QE specs select by these ids, so a removal is a
 * contract change that has to say where the selector went.
 *
 * Until the S16 deletion slices that file is empty, so every removal fails.
 *
 * The base: `TESTID_BASE_REF` if set (CI pins it to the PR's base parent, `HEAD^1`), else
 * `git merge-base HEAD origin/main`. With no resolvable base the repo check is skipped
 * locally and fails under CI or with an unresolvable TESTID_BASE_REF, so the guard
 * cannot silently pass where it matters.
 *
 * On failure: keep the testid, or add `"<removed>": "<successor>"` to
 * `e2e/testid-successors.json` and review it with the UI change.
 *
 * @vitest-environment node
 *   (pure filesystem + git test; see testidInventory.test.ts for why not jsdom)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { TestidInventory } from '../scripts/testid-inventory.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INVENTORY_PATH = fileURLToPath(new URL('../testid-inventory.json', import.meta.url));
const SUCCESSORS_PATH = fileURLToPath(new URL('../e2e/testid-successors.json', import.meta.url));

type Inventory = Pick<TestidInventory, 'static' | 'dynamic'>;

interface SuccessorsFile {
  $doc: string[];
  successors: Record<string, string>;
}

/**
 * Every selector an inventory declares, keyed by kind: a static id and a dynamic pattern with
 * the same text select differently, so swapping one for the other is a removal.
 */
function declared(inv: Inventory): Map<string, string> {
  return new Map([
    ...inv.static.map((e): [string, string] => [`static:${e.testId}`, e.testId]),
    ...inv.dynamic.map((e): [string, string] => [`dynamic:${e.pattern}`, e.pattern]),
  ]);
}

/**
 * The testids `base` declares and `head` does not, minus those with a successor `head`
 * declares (as either kind). A successor that is itself missing does not excuse the removal.
 */
function removalsWithoutSuccessor(
  base: Inventory,
  head: Inventory,
  successors: Record<string, string>,
): string[] {
  const now = declared(head);
  const nowIds = new Set(now.values());
  return [...declared(base)]
    .filter(([key]) => !now.has(key))
    .map(([, id]) => id)
    .filter((id) => {
      const next = successors[id];
      return typeof next !== 'string' || !nowIds.has(next);
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** The base commit to diff against, or null when none can be resolved. */
function baseCommit(): string | null {
  const pinned = process.env.TESTID_BASE_REF;
  if (pinned) return git(['rev-parse', '--verify', `${pinned}^{commit}`]);
  return git(['merge-base', 'HEAD', 'origin/main']);
}

function inv(staticIds: string[], patterns: string[] = []): Inventory {
  return {
    static: staticIds.map((testId) => ({ testId, files: ['src/x.tsx'] })),
    dynamic: patterns.map((pattern) => ({ pattern, files: ['src/x.tsx'] })),
  };
}

describe('removalsWithoutSuccessor', () => {
  it('flags a removed static testid with no successor', () => {
    expect(removalsWithoutSuccessor(inv(['a', 'b']), inv(['a']), {})).toEqual(['b']);
  });

  it('flags a removed dynamic pattern with no successor', () => {
    expect(removalsWithoutSuccessor(inv([], ['gate-*']), inv([]), {})).toEqual(['gate-*']);
  });

  it('accepts a removal whose successor the new tree declares', () => {
    expect(removalsWithoutSuccessor(inv(['old']), inv(['new']), { old: 'new' })).toEqual([]);
  });

  it('rejects a successor the new tree does not declare', () => {
    expect(removalsWithoutSuccessor(inv(['old']), inv(['other']), { old: 'new' })).toEqual(['old']);
  });

  it('flags a dynamic pattern replaced by the same string as a static id (and vice versa)', () => {
    expect(removalsWithoutSuccessor(inv([], ['gate-*']), inv(['gate-*']), {})).toEqual(['gate-*']);
    expect(removalsWithoutSuccessor(inv(['gate-*']), inv([], ['gate-*']), {})).toEqual(['gate-*']);
  });

  it('ignores additions and kept ids', () => {
    expect(removalsWithoutSuccessor(inv(['a']), inv(['a', 'b'], ['c-*']), {})).toEqual([]);
  });
});

describe('testid removals vs the merge base (DES-STUDIO-REBUILD-001 §6.3)', () => {
  const successorsFile = JSON.parse(readFileSync(SUCCESSORS_PATH, 'utf8')) as SuccessorsFile;

  it('e2e/testid-successors.json maps ids to ids', () => {
    expect(Array.isArray(successorsFile.$doc)).toBe(true);
    for (const [from, to] of Object.entries(successorsFile.successors)) {
      expect(typeof to, `successor of ${from}`).toBe('string');
      expect(to.length, `successor of ${from}`).toBeGreaterThan(0);
    }
  });

  it('removes no testid without a successor this tree declares', { timeout: 30_000 }, (ctx) => {
    const base = baseCommit();
    if (base === null) {
      if (process.env.CI || process.env.TESTID_BASE_REF) {
        throw new Error(
          'testidRemovals: no base commit (set TESTID_BASE_REF, or fetch origin/main with history) — the guard must not skip in CI',
        );
      }
      ctx.skip();
      return;
    }
    const baseText = git(['show', `${base}:testid-inventory.json`]);
    // A base from before the inventory existed has nothing to lose.
    if (baseText === null) return;
    const head = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8')) as Inventory;
    const missing = removalsWithoutSuccessor(JSON.parse(baseText) as Inventory, head, successorsFile.successors);
    expect(
      missing,
      `testids removed since ${base.slice(0, 12)} with no successor — keep them, or list each in e2e/testid-successors.json as "<removed>": "<successor>"`,
    ).toEqual([]);
  });
});
