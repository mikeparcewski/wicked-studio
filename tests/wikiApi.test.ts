import { describe, expect, it } from 'vitest';
import {
  isWikiUnsupported,
  parseProvenanceRef,
  scoreboardVerdict,
  type WikiScoreboard,
} from '../src/api/wiki.js';
import { ApiError } from '../src/api/errors.js';

/**
 * The wiki wire's pure halves, pinned:
 *  - `parseProvenanceRef` mirrors the engine's `parse_provenance_ref` (provenance.rs, AW-10)
 *    exactly — every HISTORICAL ref shape keeps parsing, and a stray `@` inside a path never
 *    false-positives as a digest (the right-hand side must be exactly 40 lowercase hex);
 *  - `scoreboardVerdict` is studio's populated-vs-decaying reading of the AW-23 raw signals
 *    (the engine deliberately reports signals, not adjectives) — decay signals dominate;
 *  - `isWikiUnsupported` folds the TWO adoption-gap answers (bare unknown-route 404 = crew
 *    predates the wiki routes; 501 = crew has the route, its engine predates the method) and
 *    keeps a NAMED 404 as the real answer it is.
 */

const SHA = 'a'.repeat(40);

describe('parseProvenanceRef — every historical ref shape', () => {
  it('parses the full digest-bearing form path@sha#anchor', () => {
    expect(parseProvenanceRef(`docs/agent-behavior.md@${SHA}#PAT-001`)).toEqual({
      path: 'docs/agent-behavior.md',
      sha: SHA,
      anchor: 'PAT-001',
    });
  });

  it('parses a legacy pre-digest ref path#anchor to sha: null (drift residue, never a crash)', () => {
    expect(parseProvenanceRef('docs/a.md#POL-042')).toEqual({ path: 'docs/a.md', sha: null, anchor: 'POL-042' });
  });

  it('parses path@sha with no anchor', () => {
    expect(parseProvenanceRef(`docs/a.md@${SHA}`)).toEqual({ path: 'docs/a.md', sha: SHA, anchor: null });
  });

  it('parses a bare path', () => {
    expect(parseProvenanceRef('docs/a.md')).toEqual({ path: 'docs/a.md', sha: null, anchor: null });
  });

  it('does not mistake an @ inside an ordinary ref for a digest', () => {
    // The right-hand side must be exactly a 40-hex blob sha — `1.2.3` is not one.
    expect(parseProvenanceRef('pkg@1.2.3#X')).toEqual({ path: 'pkg@1.2.3', sha: null, anchor: 'X' });
  });

  it('rejects a 40-char right-hand side that is not lowercase hex', () => {
    const notSha = 'A'.repeat(40);
    expect(parseProvenanceRef(`docs/a.md@${notSha}`)).toEqual({ path: `docs/a.md@${notSha}`, sha: null, anchor: null });
  });
});

/** A healthy baseline scoreboard the cases below perturb one signal at a time. */
function sb(over: Partial<WikiScoreboard> = {}): WikiScoreboard {
  return {
    rules_total: 10,
    rules_active: 9,
    rules_retired: 1,
    typing: {
      available: true,
      docs_scanned: 4,
      statements_total: 20,
      statements_typed: 18,
      percent: 90,
      by_class: { policy: 10, guidance: 8 },
      docs_untyped: [],
    },
    connection: { rules_with_ref: 3, refs_resolving: 3, refs_unresolvable: 0, percent: 100, rules_linked: 3 },
    evidence: { denial_claims: 2, rules_evidenced: 2, evidenced_by_edges: 2, governs_evidence_total: 5, per_rule: [] },
    recall_volume: { available: false, reason: 'nothing writes recall telemetry yet' },
    ...over,
  };
}

describe('scoreboardVerdict — the populated-vs-decaying derivation', () => {
  it('no active rules → empty', () => {
    expect(scoreboardVerdict(sb({ rules_active: 0 }))).toBe('empty');
  });

  it('typed + connected + cited by enforcement → populated', () => {
    expect(scoreboardVerdict(sb())).toBe('populated');
  });

  it('an unresolvable symbol ref → decaying, even with evidence (decay dominates)', () => {
    const s = sb();
    s.connection = { ...s.connection, refs_unresolvable: 1, refs_resolving: 2, percent: 66.7 };
    expect(scoreboardVerdict(s)).toBe('decaying');
  });

  it('measured typing under half → decaying', () => {
    const s = sb();
    s.typing = { ...s.typing, statements_typed: 5, percent: 25 };
    expect(scoreboardVerdict(s)).toBe('decaying');
  });

  it('UNMEASURED typing (no docs root) is not decay — the daemon could not tell', () => {
    const s = sb();
    s.typing = { available: false, reason: 'no docs root', docs_scanned: 0, statements_total: 0, statements_typed: 0, by_class: {}, docs_untyped: [] };
    expect(scoreboardVerdict(s)).toBe('populated');
  });

  it('rules with no live links or enforcement evidence → unproven (the honest middle)', () => {
    const s = sb();
    s.connection = { ...s.connection, rules_linked: 0 };
    s.evidence = { ...s.evidence, denial_claims: 0, governs_evidence_total: 0 };
    expect(scoreboardVerdict(s)).toBe('unproven');
  });
});

describe('isWikiUnsupported — the two adoption-gap answers, and only those', () => {
  it('501 (route present, engine method absent) → unsupported', () => {
    expect(isWikiUnsupported(new ApiError(501, 'engine predates wiki scoreboard'))).toBe(true);
  });

  it("Fastify's bare unknown-route 404 (crew predates the wiki routes) → unsupported", () => {
    expect(isWikiUnsupported(new ApiError(404, 'Not Found'))).toBe(true);
  });

  it('a NAMED 404 from a daemon WITH the route is a real answer, never an adoption gap', () => {
    expect(isWikiUnsupported(new ApiError(404, 'unknown rule: PAT-999'))).toBe(false);
  });

  it('an ordinary error is not an adoption gap', () => {
    expect(isWikiUnsupported(new Error('boom'))).toBe(false);
  });
});
