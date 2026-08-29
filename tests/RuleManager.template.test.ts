import { describe, expect, it } from 'vitest';
import { RULE_TEMPLATE } from '../src/components/RuleManager.js';

/**
 * The "+ New rule" seed JSON must SAVE as-is: the daemon forwards it to the
 * engine's fail-closed write boundary (`wicked-governance::ConformanceRule::
 * validate`, wicked-core/crates/wicked-governance/src/conformance.rs), which
 * rejects out-of-contract rules. The template shipped for a while with
 * `id: ''` (fails INV-C1) and `source_kinds: ['policy']` (fails INV-C4 —
 * 'policy' is not in the wire enum), so every save from the pristine template
 * errored. These tests mirror the engine's invariants so the template can
 * never regress to un-saveable again.
 */

/** The shared `provenance.source_kinds` wire enum (conformance.rs VALID_SOURCE_KINDS). */
const VALID_SOURCE_KINDS = ['code-body', 'type-def', 'comment', 'doc'];

describe('RULE_TEMPLATE engine-invariant conformance', () => {
  it('INV-C1: id matches `^(PAT|POL)-[0-9]{3,6}$` with the prefix agreeing with rule_type', () => {
    expect(RULE_TEMPLATE.id).toMatch(/^(PAT|POL)-[0-9]{3,6}$/);
    const prefix = RULE_TEMPLATE.rule_type === 'pattern' ? 'PAT-' : 'POL-';
    expect(RULE_TEMPLATE.id.startsWith(prefix)).toBe(true);
  });

  it('INV-C2: confidence is a number in [0,1]', () => {
    expect(RULE_TEMPLATE.confidence).toBeGreaterThanOrEqual(0);
    expect(RULE_TEMPLATE.confidence).toBeLessThanOrEqual(1);
  });

  it('INV-C4: every provenance.source_kinds value is in the shared wire enum', () => {
    expect(RULE_TEMPLATE.provenance.source_kinds.length).toBeGreaterThan(0);
    for (const sk of RULE_TEMPLATE.provenance.source_kinds) {
      expect(VALID_SOURCE_KINDS).toContain(sk);
    }
  });

  it('round-trips through the editor: JSON.parse(JSON.stringify(template)) preserves the contract fields', () => {
    // The editor serialises the template into a textarea and parses it back
    // before POSTing — the contract-bearing fields must survive that trip.
    const parsed = JSON.parse(JSON.stringify(RULE_TEMPLATE, null, 2));
    expect(parsed.id).toBe(RULE_TEMPLATE.id);
    expect(parsed.rule_type).toBe(RULE_TEMPLATE.rule_type);
    expect(parsed.provenance.source_kinds).toEqual(RULE_TEMPLATE.provenance.source_kinds);
  });
});
