import { describe, expect, it } from 'vitest';
import { editedFrom, notAccepted } from '../src/board/notAccepted.js';
import type { Proposal } from '../src/api/proposals.js';

/** The Not accepted fold (operator 2026-11-01): what a person turned down, from every proposal the store kept. */
const p = (id: string, state: Proposal['state'], kind_type: string, payload: Record<string, unknown> = {}, created_at = 1): Proposal =>
  ({ id, kind_type, payload, facets: {}, provenance: {}, state, created_at });

describe('notAccepted', () => {
  it('keeps only rejected proposals of the asked kind, newest first', () => {
    const all = [
      p('m-old', 'rejected', 'memory', { content: 'a' }, 10), p('m-new', 'rejected', 'memory', { content: 'b' }, 20),
      p('m-pending', 'pending', 'memory'), p('m-approved', 'approved', 'memory'),
      p('r1', 'rejected', 'policy:security', { rule: 'x' }, 5), p('r2', 'rejected', 'policy', { rule: 'y' }, 6), p('k', 'rejected', 'knowledge'),
    ];
    expect(notAccepted(all, 'memory').rows).toEqual([all[1], all[0]]);
    expect(notAccepted(all, 'policy').rows.map((x) => x.id)).toEqual(['r2', 'r1']);
  });
  it('hides nothing: an accepted edit\'s original is listed and mapped to its copy; a rejected copy is listed too', () => {
    const all = [
      p('orig', 'rejected', 'memory', { content: 'serial tests' }, 1),
      p('copy', 'approved', 'memory', { content: 'tests with --runInBand', edited_from: 'orig' }, 2),
      p('stray', 'rejected', 'memory', { content: 'withdrawn or rejected copy', edited_from: 'still-pending' }, 3),
      p('still-pending', 'pending', 'memory'),
      p('real', 'rejected', 'memory', { content: 'turned down' }, 4),
    ];
    const out = notAccepted(all, 'memory');
    expect(out.rows.map((x) => x.id)).toEqual(['real', 'stray', 'orig']);
    expect([...out.replacedBy]).toEqual([['orig', 'copy']]);
  });
  it('only an APPROVED copy of the SAME kind maps an original (a rejected copy, or a policy naming a memory, does not)', () => {
    const all = [
      p('orig', 'rejected', 'memory', {}, 1), p('rej-copy', 'rejected', 'memory', { edited_from: 'orig' }, 2),
      p('policy-copy', 'approved', 'policy:testing', { edited_from: 'orig' }, 3),
    ];
    expect([...notAccepted(all, 'memory').replacedBy]).toEqual([]);
    // Crew edits memory proposals only: on a policy page, nothing is named an accepted edit's original.
    const rules = [p('r-orig', 'rejected', 'policy:security', {}, 1), p('r-copy', 'approved', 'policy:testing', { edited_from: 'r-orig' }, 2)];
    expect([...notAccepted(rules, 'policy').replacedBy]).toEqual([]);
  });
  it('reads edited_from defensively', () => {
    expect(editedFrom(p('a', 'approved', 'memory', { edited_from: 'x' }))).toBe('x');
    expect(editedFrom(p('a', 'approved', 'memory', { edited_from: '' }))).toBeNull();
    expect(editedFrom({ ...p('a', 'approved', 'memory'), payload: 'text' })).toBeNull();
    expect(editedFrom({ ...p('a', 'approved', 'memory'), payload: null })).toBeNull();
  });
});
