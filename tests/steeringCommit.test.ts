// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { planCommit } from '../src/board/steeringCommit.js';
import type { SteeringRule } from '../src/api/steering.js';

/**
 * studio#476: a grid save is planned against the row as it is NOW. In the reel, Enter saved
 * excludes ["tests/", "vendor"]; a second save 3 s later carried the copy from before it
 * (["tests/"]) and, refused, the cell "reverted" to that stale copy, which the form then re-saved.
 */
const base: SteeringRule = {
  id: 'PAT-301', rule_type: 'pattern', statement: 'Keep vendored code out', severity: 'error', confidence: 0.9,
  targets: {}, provenance: { source: 'ui', source_kinds: ['doc'] }, steering_type: 'architecture',
  applies_to: [], excludes: ['tests/'], weight: 1,
} as SteeringRule;
const saved = { ...base, excludes: ['tests/', 'vendor'] } as SteeringRule;

describe('planCommit', () => {
  it('a save made from the current row sends the row with its change', () => {
    const next = { ...saved, severity: 'critical' } as SteeringRule;
    expect(planCommit(next, saved, saved)).toStrictEqual({ kind: 'send', rule: next, revertTo: saved });
  });

  it('a save that changes nothing against the row it was edited from sends nothing (the stale re-send in #476)', () => {
    expect(planCommit({ ...base }, base, saved)).toStrictEqual({ kind: 'nothing' });
  });

  it('a save whose field moved on since the edit began is refused, named, and the row is left as the daemon has it', () => {
    const stale = { ...base, excludes: ['tests/', 'docs/'] } as SteeringRule; // edited from the pre-vendor copy
    const plan = planCommit(stale, base, saved);
    expect(plan.kind).toBe('stale');
    expect(plan.kind === 'stale' ? plan.fields : []).toStrictEqual(['excludes']);
  });

  it('a save from an old copy changes only its own field: the fields saved since are kept', () => {
    const next = { ...base, severity: 'critical' } as SteeringRule; // base predates the vendor save
    const plan = planCommit(next, base, saved);
    expect(plan.kind).toBe('send');
    expect(plan.kind === 'send' ? plan.rule.excludes : null).toStrictEqual(['tests/', 'vendor']);
    expect(plan.kind === 'send' ? plan.rule.severity : null).toBe('critical');
    // A refusal reverts to the row as it was when this save was made — never to the older copy.
    expect(plan.kind === 'send' ? plan.revertTo : null).toBe(saved);
  });

  it('with no current row known, the save is sent as made', () => {
    const next = { ...base, severity: 'critical' } as SteeringRule;
    expect(planCommit(next, base, undefined)).toStrictEqual({ kind: 'send', rule: next, revertTo: base });
  });

  it('codex on #491: a save that changes every field it carries still keeps what only the current row has', () => {
    // Every key the edit carries changes (here: its only one) — the case the old shortcut sent as made.
    const prev = { statement: 'a' } as unknown as SteeringRule;
    const next = { statement: 'b' } as unknown as SteeringRule;
    const current = { id: 'R1', statement: 'a', serverOnly: 'keep-me' } as unknown as SteeringRule;
    const plan = planCommit(next, prev, current);
    expect(plan.kind === 'send' ? (plan.rule as unknown as Record<string, unknown>)['serverOnly'] : null).toBe('keep-me');
  });

  it('codex on #491: equality is by value — an object\'s key order is not a change', () => {
    const prev = { ...base, targets: { repo: true, path: false } } as unknown as SteeringRule;
    const next = { ...base, targets: { path: false, repo: true } } as unknown as SteeringRule;
    expect(planCommit(next, prev, prev)).toStrictEqual({ kind: 'nothing' });
  });
});

