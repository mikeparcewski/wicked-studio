import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CoreEvent, SessionView } from '../src/api/types.js';
import { approvedLine, overriddenFloorsOf } from '../src/board/failingChecks.js';

/**
 * Seen live on :7721 (ui-v3 round 2): run 9397a34b's delivered message said "You approved 50 failing tests in the test
 * check: 50 fail only with this change." Its floor record says otherwise: the overrides stand on attempt 1's record
 * (its base run over the same files failed first and passed only on its own retry) and on attempts with
 * `base_red_unseparated` (the base red too, its failing and flaky sets named). Attempt 1's 42 "regressions" were measured
 * against a base whose first pass failed too and passed only on its own retry, so none is change-only.
 */
const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'run-9397a34b-floors.json'), 'utf8')) as {
  events: CoreEvent[];
  floorOverrides: unknown[];
};
const view = { session: { id: '9397a34b-08c9-484d-a97d-57675423c817', assurance: { floorOverrides: fx.floorOverrides } } } as unknown as SessionView;

describe('the delivered sentence for run 9397a34b, from its own floor record', () => {
  it('never says "only with this change" when the change-only set is empty', () => {
    const o = overriddenFloorsOf(null, fx.events, view)!;
    expect(o.checks).toEqual(['test']);
    expect(o.fresh).toBe(0);
    expect(o.onBase).toBe(true);
    expect(o.unseparated).toBe(true);
    expect((o.shared ?? 0) + (o.unknown ?? 0)).toBe(o.failures);
    expect(o.shared).toBeGreaterThan(0);
    const line = approvedLine(o);
    expect(line).not.toMatch(/only with this change/u);
    expect(line).toBe(`You approved ${o.failures} failing tests in the test check: ${o.shared} also fail on the base, and the base is red, so the other ${o.unknown} could not be told apart from this change.`);
  });

  it('names the change-only count from the change-only set when there is one', () => {
    expect(approvedLine({ checks: ['test'], onBase: false, failures: 3, fresh: 1, shared: 2, unknown: 0 }))
      .toBe('You approved 3 failing tests in the test check: 1 fails only with this change, 2 on the base too.');
    expect(approvedLine({ checks: ['test'], onBase: true, failures: 5, fresh: 1, shared: 2, unknown: 2 }))
      .toBe('You approved 5 failing tests in the test check: 1 fails only with this change, 2 on the base too, 2 could not be told apart.');
  });
});
