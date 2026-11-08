import { describe, expect, it } from 'vitest';
import type { ArtifactProposal, ProposalToken } from '../src/api/types.js';
import { inputTokenChoices } from '../src/board/jobInputs.js';
import { jobProposal } from './jobFixtures.js';

/**
 * DES-CATALOG-002 CS12 (the new job inputs on the job passage), slice P: the listbox a `documents` or `sources` token
 * opens — its choices (one revision each), its unavailable rows, and the defensive read of a list the pinned
 * `wicked-crew-api-types` does not carry.
 */

/** A proposal carrying a token and the matching `inputs` arm (the CS12 fields are read defensively, so they are added
 *  past the pinned type). */
function withToken(token: unknown, inputs?: Record<string, unknown>): ArtifactProposal {
  const p = jobProposal() as unknown as Record<string, unknown>;
  const sentence = { ...(p['sentence'] as Record<string, unknown>), tokens: [token] };
  return { ...p, sentence, ...(inputs !== undefined ? { inputs } : {}) } as unknown as ArtifactProposal;
}

const asToken = (t: unknown): ProposalToken => t as ProposalToken;

describe('inputTokenChoices — documents', () => {
  const token = {
    id: 'documents', kind: 'documents', label: '2 documents', swap: null,
    documents: [
      { token: 'doc:_unfiled/brief', label: 'the brief', status: 'ok' },
      { token: 'doc:_unfiled/notes', label: 'the notes', status: 'ok' },
      { token: 'doc:_unfiled/old', label: 'the old plan', status: 'struck', reason: 'not in this chat' },
    ],
  };

  it('one choice per ok document, each leaving it out of the whole new list; the struck one is unavailable with its reason', () => {
    const inputs = { documents: { kind: 'documents', tokens: ['doc:_unfiled/brief', 'doc:_unfiled/notes'] } };
    const res = inputTokenChoices(asToken(token), withToken(token, inputs))!;
    expect(res.choices.map((c) => c.label)).toEqual(['Leave out the brief', 'Leave out the notes']);
    // Leaving out the brief sends the whole remaining list.
    expect(res.choices[0]!.edit).toEqual({ inputs: { documents: { kind: 'documents', tokens: ['doc:_unfiled/notes'] } } });
    expect(res.choices[1]!.edit).toEqual({ inputs: { documents: { kind: 'documents', tokens: ['doc:_unfiled/brief'] } } });
    expect(res.unavailable).toEqual([{ label: 'the old plan', reason: 'not in this chat' }]);
  });

  it('the last ok document is not a choice (crew’s documents input takes one token at least): it is shown with why', () => {
    const one = { ...token, documents: [
      { token: 'doc:_unfiled/brief', label: 'the brief', status: 'ok' },
      { token: 'doc:_unfiled/old', label: 'the old plan', status: 'struck', reason: 'not in this chat' },
    ] };
    const res = inputTokenChoices(asToken(one), withToken(one, { documents: { kind: 'documents', tokens: ['doc:_unfiled/brief'] } }))!;
    expect(res.choices).toEqual([]);
    expect(res.unavailable).toEqual([
      { label: 'the brief', reason: 'the job’s only document' }, { label: 'the old plan', reason: 'not in this chat' },
    ]);
  });

  it('a token listed twice (one ok, one struck) is no list at all: no edit can name a struck token', () => {
    const dup = { ...token, documents: [
      { token: 'a', label: 'A', status: 'ok' }, { token: 'a', label: 'A', status: 'struck', reason: 'gone' }, { token: 'b', label: 'B', status: 'ok' },
    ] };
    expect(inputTokenChoices(asToken(dup), withToken(dup))).toBeNull();
  });

  it('falls back to the ok documents when the proposal carries no inputs arm (an older daemon)', () => {
    const res = inputTokenChoices(asToken(token), withToken(token))!;
    expect(res.choices[0]!.edit).toEqual({ inputs: { documents: { kind: 'documents', tokens: ['doc:_unfiled/notes'] } } });
  });
});

describe('inputTokenChoices — sources', () => {
  const token = {
    id: 'sources', kind: 'sources', label: 'the web and support-pg', swap: null,
    sources: [
      { id: 'web', label: 'the web', picked: true },
      { id: 'support-pg', label: 'support-pg', picked: false },
      { id: 'intranet', label: 'the intranet', picked: false, reason: 'not reachable from here' },
    ],
  };

  it('Add for a not-picked source, Leave out for a picked one; each builds the exact new pick in the token’s order', () => {
    const inputs = { sources: { kind: 'sources', ids: ['web'] } };
    const res = inputTokenChoices(asToken(token), withToken(token, inputs))!;
    expect(res.choices.map((c) => c.label)).toEqual(['Leave out the web', 'Add support-pg']);
    // Leaving out web empties the pick; adding support-pg keeps web first (order kept).
    expect(res.choices[0]!.edit).toEqual({ inputs: { sources: { kind: 'sources', ids: [] } } });
    expect(res.choices[1]!.edit).toEqual({ inputs: { sources: { kind: 'sources', ids: ['web', 'support-pg'] } } });
  });

  it('an unpickable source is unavailable with its reason and is never a choice', () => {
    const res = inputTokenChoices(asToken(token), withToken(token, { sources: { kind: 'sources', ids: ['web'] } }))!;
    expect(res.choices.some((c) => c.label.includes('the intranet'))).toBe(false);
    expect(res.unavailable).toEqual([{ label: 'the intranet', reason: 'not reachable from here' }]);
  });

  it('the proposal’s inputs decide what is picked, not the token’s flags; stale and unpickable ids never go back', () => {
    const inputs = { sources: { kind: 'sources', ids: ['support-pg', 'gone', 'intranet'] } };
    const res = inputTokenChoices(asToken(token), withToken(token, inputs))!;
    expect(res.choices.map((c) => c.label)).toEqual(['Add the web', 'Leave out support-pg']);
    expect(res.choices[0]!.edit).toEqual({ inputs: { sources: { kind: 'sources', ids: ['web', 'support-pg'] } } });
    expect(res.choices[1]!.edit).toEqual({ inputs: { sources: { kind: 'sources', ids: [] } } });
  });

  it.each([undefined, { kind: 'text', value: 'web' }, { kind: 'sources', ids: [3] }])('without a valid inputs arm (%j) the token’s picked flags decide', (arm) => {
    const res = inputTokenChoices(asToken(token), withToken(token, arm === undefined ? {} : { sources: arm }))!;
    expect(res.choices.map((c) => c.label)).toEqual(['Leave out the web', 'Add support-pg']);
    expect(res.choices[1]!.edit).toEqual({ inputs: { sources: { kind: 'sources', ids: ['web', 'support-pg'] } } });
  });

  it('a source id listed twice (one pickable, one not) is no list at all: no pick can name a source crew refuses', () => {
    const dup = { ...token, sources: [
      { id: 'web', label: 'the web', picked: true }, { id: 'web', label: 'the web', picked: false, reason: 'switched off' },
    ] };
    expect(inputTokenChoices(asToken(dup), withToken(dup))).toBeNull();
  });

  it('keeps the token’s own order when adding, not the current pick’s order', () => {
    const reordered = {
      ...token,
      sources: [
        { id: 'support-pg', label: 'support-pg', picked: false },
        { id: 'web', label: 'the web', picked: true },
      ],
    };
    const res = inputTokenChoices(asToken(reordered), withToken(reordered, { sources: { kind: 'sources', ids: ['web'] } }))!;
    // Adding support-pg (listed first) puts it before web, the token's order, not [web, support-pg].
    expect(res.choices[0]!.edit).toEqual({ inputs: { sources: { kind: 'sources', ids: ['support-pg', 'web'] } } });
  });
});

describe('inputTokenChoices — not an input token or a malformed list', () => {
  it('returns null for an ordinary token (not documents or sources)', () => {
    expect(inputTokenChoices(asToken({ id: 'repo', kind: 'repo', label: 'reporting-api', swap: null }), withToken({}))).toBeNull();
  });

  it('returns null when a documents token carries no list (an older daemon: the token stays a plain fact)', () => {
    const bare = { id: 'documents', kind: 'documents', label: '2 documents', swap: null };
    expect(inputTokenChoices(asToken(bare), withToken(bare))).toBeNull();
  });

  it('returns null when the list is malformed (an entry missing its label)', () => {
    const bad = { id: 'sources', kind: 'sources', label: 'x', swap: null, sources: [{ id: 'web', picked: true }] };
    expect(inputTokenChoices(asToken(bad), withToken(bad))).toBeNull();
  });
});
