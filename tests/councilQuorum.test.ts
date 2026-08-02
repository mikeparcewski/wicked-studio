import { describe, expect, it } from 'vitest';
import {
  isUnanimous,
  lostQuorum,
  quorumLabel,
  type CouncilRouting,
} from '../src/components/councilQuorum.js';

function council(over: Partial<CouncilRouting> = {}): CouncilRouting {
  return { method: 'council', winner: 'claude', agreement_pct: 100, returned: 3, dissent: 0, ...over };
}

describe('councilQuorum', () => {
  it('reads a full council as unanimous', () => {
    const r = council({ returned: 3, seated: 3, dissent: 0 });
    expect(quorumLabel(r)).toBe('3 of 3 seats');
    expect(lostQuorum(r)).toBe(false);
    expect(isUnanimous(r)).toBe(true);
  });

  it('does not call one surviving seat of three unanimous', () => {
    // The FINDING-026 D artifact: two seats timed out, the survivor's pick was stored as
    // `agreement=100% dissent=0`, and the UI printed "(unanimous)" over it.
    const r = council({ returned: 1, seated: 3, dissent: 0 });
    expect(lostQuorum(r)).toBe(true);
    expect(isUnanimous(r)).toBe(false);
    expect(quorumLabel(r)).toBe('1 of 3 seats');
  });

  it('keeps a majority that agreed', () => {
    // Losing one seat of three must not veto a decision the other two genuinely reached —
    // the fix for a false positive must not manufacture false negatives.
    const r = council({ returned: 2, seated: 3, dissent: 0 });
    expect(lostQuorum(r)).toBe(false);
    expect(isUnanimous(r)).toBe(true);
  });

  it('treats an exact half as lost, matching the engine strict-majority rule', () => {
    expect(lostQuorum(council({ returned: 2, seated: 4 }))).toBe(true);
    expect(lostQuorum(council({ returned: 3, seated: 4 }))).toBe(false);
  });

  it('reports an unknown seat count as unknown, never as lost or as healthy', () => {
    // Runs recorded before the engine carried `seated`. Inferring `seated === returned` would
    // relabel every historical collapsed council as a complete one.
    // `seated` is OMITTED, not set to undefined — `exactOptionalPropertyTypes` is on.
    const r = council({ returned: 1, dissent: 0 });
    expect(quorumLabel(r)).toBe('1 polled');
    expect(lostQuorum(r)).toBe(false);
    expect(isUnanimous(r)).toBe(true);
  });

  it('reads an explicit null seat count the same as an absent one', () => {
    // This is the shape the LIVE API sends, and it is the one an `=== undefined` guard misses.
    // The routing artifact's `seated` is a Rust `Option<u32>` with no `skip_serializing_if`, and
    // the run view reserializes every unit it loads — so a council recorded before the field
    // existed comes back over the wire as `"seated": null`, not as a missing key. Guarding on
    // `=== undefined` rendered that as "1 of null seats".
    const r = council({ returned: 1, seated: null, dissent: 0 });
    expect(quorumLabel(r)).toBe('1 polled');
    expect(lostQuorum(r)).toBe(false);
    expect(isUnanimous(r)).toBe(true);
  });

  it('does not call a council with dissent unanimous even at full quorum', () => {
    expect(isUnanimous(council({ returned: 3, seated: 3, dissent: 1 }))).toBe(false);
  });
});
