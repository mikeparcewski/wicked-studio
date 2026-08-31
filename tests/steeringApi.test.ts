import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STEERING_TYPE,
  isSteeringType,
  isValidRuleId,
  nextRuleId,
  steeringPath,
  STEERING_RULE_TEMPLATE,
  STEERING_TYPES,
  steeringTypeOf,
  type SteeringRule,
} from '../src/api/steering.js';

/**
 * The steering wire helpers, pinned:
 *  - the Add-rule template must SAVE as-is — the daemon forwards it to the engine's fail-closed
 *    write boundary (`wicked-governance::ConformanceRule::validate`), which rejects
 *    out-of-contract rules. The old RuleManager template shipped un-saveable for a while
 *    (id '' fails INV-C1, source_kinds ['policy'] fails INV-C4); these tests keep the steering
 *    successor honest against the same invariants.
 *  - `steeringTypeOf` folds absent (the engine's serde default) AND out-of-enum values to
 *    architecture — a rule the operator cannot see is a rule the operator cannot retire.
 *  - `nextRuleId` suggests the next free INV-C1 id per prefix.
 */

/** The shared `provenance.source_kinds` wire enum (conformance.rs VALID_SOURCE_KINDS). */
const VALID_SOURCE_KINDS = ['code-body', 'type-def', 'comment', 'doc'];

function rule(over: Partial<SteeringRule> = {}): SteeringRule {
  return {
    id: 'PAT-001',
    rule_type: 'pattern',
    statement: 's',
    severity: 'warn',
    confidence: 0.9,
    targets: {},
    provenance: { source: 'manual', source_kinds: ['doc'] },
    ...over,
  };
}

describe('STEERING_RULE_TEMPLATE engine-invariant conformance', () => {
  it('INV-C1: id matches `^(PAT|POL)-[0-9]{3,6}$` with the prefix agreeing with rule_type', () => {
    expect(STEERING_RULE_TEMPLATE.id).toMatch(/^(PAT|POL)-[0-9]{3,6}$/);
    const prefix = STEERING_RULE_TEMPLATE.rule_type === 'pattern' ? 'PAT-' : 'POL-';
    expect(STEERING_RULE_TEMPLATE.id.startsWith(prefix)).toBe(true);
    expect(isValidRuleId(STEERING_RULE_TEMPLATE.id, STEERING_RULE_TEMPLATE.rule_type)).toBe(true);
  });

  it('INV-C2: confidence is a number in [0,1]', () => {
    expect(STEERING_RULE_TEMPLATE.confidence).toBeGreaterThanOrEqual(0);
    expect(STEERING_RULE_TEMPLATE.confidence).toBeLessThanOrEqual(1);
  });

  it('INV-C4: every provenance.source_kinds value is in the shared wire enum', () => {
    expect(STEERING_RULE_TEMPLATE.provenance.source_kinds.length).toBeGreaterThan(0);
    for (const sk of STEERING_RULE_TEMPLATE.provenance.source_kinds) {
      expect(VALID_SOURCE_KINDS).toContain(sk);
    }
  });

  it('carries the unified defaults: architecture type, weight 1.0, no effect (recall-only), provenance source "ui"', () => {
    expect(STEERING_RULE_TEMPLATE.steering_type).toBe(DEFAULT_STEERING_TYPE);
    expect(STEERING_RULE_TEMPLATE.weight).toBe(1.0);
    expect(STEERING_RULE_TEMPLATE.effect).toBeUndefined();
    expect(STEERING_RULE_TEMPLATE.provenance.source).toBe('ui');
  });
});

describe('steeringTypeOf — the serde-default fold, pinned', () => {
  it('absent and empty steering_type read as architecture (the engine default)', () => {
    expect(steeringTypeOf(rule())).toBe('architecture');
    expect(steeringTypeOf(rule({ steering_type: '' }))).toBe('architecture');
    expect(steeringTypeOf(rule({ steering_type: '  ' }))).toBe('architecture');
  });

  it('every enum value reads as itself', () => {
    for (const t of STEERING_TYPES) {
      expect(steeringTypeOf(rule({ steering_type: t }))).toBe(t);
    }
  });

  it('an out-of-enum value folds to architecture — never invisible on all seven pages', () => {
    expect(steeringTypeOf(rule({ steering_type: 'bogus' }))).toBe('architecture');
  });
});

describe('nextRuleId', () => {
  it('suggests max ordinal + 1 per prefix, zero-padded to the 3-digit INV-C1 floor', () => {
    const rules = [rule({ id: 'PAT-001' }), rule({ id: 'PAT-104' }), rule({ id: 'POL-300', rule_type: 'policy' })];
    expect(nextRuleId(rules, 'pattern')).toBe('PAT-105');
    expect(nextRuleId(rules, 'policy')).toBe('POL-301');
  });

  it('starts at 100 on an empty (or foreign-prefix-only) corpus', () => {
    expect(nextRuleId([], 'pattern')).toBe('PAT-100');
    expect(nextRuleId([rule({ id: 'POL-999', rule_type: 'policy' })], 'pattern')).toBe('PAT-100');
  });
});

describe('the type roster and paths', () => {
  it('spells the seven types in nav order', () => {
    expect([...STEERING_TYPES]).toEqual([
      'architecture', 'development', 'security', 'testing', 'operations', 'compliance', 'design-ux',
    ]);
    for (const t of STEERING_TYPES) expect(isSteeringType(t)).toBe(true);
    expect(isSteeringType('wiki')).toBe(false);
  });

  it('steeringPath is the one spelling of a sub-page route', () => {
    expect(steeringPath('design-ux')).toBe('/steering/design-ux');
  });
});
