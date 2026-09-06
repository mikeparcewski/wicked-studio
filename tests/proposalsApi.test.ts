import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The proposal-queue wire (DES-MEM-FACETED-001), pinned:
 *  - `proposalKind` folds `kind_type` to memory / policy / other; an unrecognized kind is still
 *    classified `other` (LISTED under `all`, never invisible) and `policySteeringType` pulls the
 *    steering type out of `policy:<type>`;
 *  - the payload narrowers read `unknown` payloads defensively — a non-object payload, or a
 *    missing field, degrades to null, never a throw;
 *  - `listProposals` / `approveProposal` / `rejectProposal` hit the crew `/api/v1/proposals*`
 *    paths with the right query + method;
 *  - `isProposalsUnsupported` folds the two adoption-gap answers (bare 404 / 501) and keeps a
 *    NAMED 404 as the real answer it is — the same seam as the wiki/steering reads.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const {
  approveProposal,
  isProposalsUnsupported,
  listProposals,
  memoryPayload,
  policyPayload,
  policySteeringType,
  proposalKind,
  proposalMatchesKind,
  proposalsPath,
  PROPOSAL_KINDS,
  readProposalKind,
  rejectProposal,
} = await import('../src/api/proposals.js');
const { ApiError } = await import('../src/api/errors.js');
type Proposal = import('../src/api/proposals.js').Proposal;

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: 'p1',
    kind_type: 'memory',
    payload: { content: 'remember X', tier: 'session' },
    facets: { project: 'wicked' },
    provenance: { run_id: 'run-1', agent: 'claude' },
    state: 'pending',
    created_at: 1_700_000_000,
    ...over,
  };
}

beforeEach(() => {
  apiFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('proposalKind + policySteeringType — the kind fold', () => {
  it('classifies memory, policy:<type>, bare policy, and unknown', () => {
    expect(proposalKind(proposal({ kind_type: 'memory' }))).toBe('memory');
    expect(proposalKind(proposal({ kind_type: 'policy:security' }))).toBe('policy');
    expect(proposalKind(proposal({ kind_type: 'policy' }))).toBe('policy');
    // An unrecognized kind is classified `other` — LISTED under `all`, never invisible.
    expect(proposalKind(proposal({ kind_type: 'insight:foo' }))).toBe('other');
  });

  it('pulls the steering type out of policy:<type>, null otherwise', () => {
    expect(policySteeringType(proposal({ kind_type: 'policy:security' }))).toBe('security');
    expect(policySteeringType(proposal({ kind_type: 'policy' }))).toBeNull();
    expect(policySteeringType(proposal({ kind_type: 'memory' }))).toBeNull();
  });
});

describe('proposalMatchesKind — the filter predicate', () => {
  it('all matches everything; a specific kind matches only its own', () => {
    const mem = proposal({ kind_type: 'memory' });
    const pol = proposal({ kind_type: 'policy:testing' });
    expect(proposalMatchesKind(mem, 'all')).toBe(true);
    expect(proposalMatchesKind(pol, 'all')).toBe(true);
    expect(proposalMatchesKind(mem, 'memory')).toBe(true);
    expect(proposalMatchesKind(mem, 'policy')).toBe(false);
    expect(proposalMatchesKind(pol, 'policy')).toBe(true);
  });
});

describe('payload narrowers — read unknown payloads defensively', () => {
  it('memoryPayload reads content + tier, null-degrading a non-object or missing field', () => {
    expect(memoryPayload(proposal({ payload: { content: 'X', tier: 'project' } }))).toEqual({ content: 'X', tier: 'project' });
    expect(memoryPayload(proposal({ payload: { content: 'X' } }))).toEqual({ content: 'X', tier: null });
    expect(memoryPayload(proposal({ payload: 'not-an-object' }))).toEqual({ content: null, tier: null });
    expect(memoryPayload(proposal({ payload: null }))).toEqual({ content: null, tier: null });
  });

  it('policyPayload reads rule (or the statement fallback) + severity', () => {
    expect(policyPayload(proposal({ payload: { rule: 'do X', severity: 'error' } }))).toEqual({ rule: 'do X', severity: 'error' });
    // The steering wire spells the rule text `statement` — fall back to it.
    expect(policyPayload(proposal({ payload: { statement: 'do Y', severity: 'warn' } }))).toEqual({ rule: 'do Y', severity: 'warn' });
    expect(policyPayload(proposal({ payload: 42 }))).toEqual({ rule: null, severity: null });
  });
});

describe('proposalsPath + readProposalKind — the one URL spelling', () => {
  it('bare /proposals for all, ?type= for a kind', () => {
    expect(proposalsPath('all')).toBe('/proposals');
    expect(proposalsPath('memory')).toBe('/proposals?type=memory');
    expect(proposalsPath('policy')).toBe('/proposals?type=policy');
  });

  it('reads the filter back from a search string; unknown/absent → all', () => {
    expect(readProposalKind('?type=memory')).toBe('memory');
    expect(readProposalKind('?type=policy')).toBe('policy');
    expect(readProposalKind('')).toBe('all');
    expect(readProposalKind('?type=bogus')).toBe('all');
    for (const k of PROPOSAL_KINDS) expect(readProposalKind(proposalsPath(k).replace('/proposals', ''))).toBe(k);
  });
});

describe('the wire calls — path + method', () => {
  it('listProposals GETs /proposals with the state (and kind_type) query, unwrapping proposals[]', async () => {
    const rows = [proposal()];
    apiFetch.mockResolvedValue({ proposals: rows });

    await expect(listProposals({ state: 'pending' })).resolves.toEqual(rows);
    expect(apiFetch).toHaveBeenCalledWith('/proposals?state=pending');

    apiFetch.mockClear();
    apiFetch.mockResolvedValue({ proposals: [] });
    await listProposals({ kind_type: 'memory', state: 'pending' });
    expect(apiFetch).toHaveBeenCalledWith('/proposals?kind_type=memory&state=pending');

    apiFetch.mockClear();
    apiFetch.mockResolvedValue({ proposals: [] });
    await listProposals();
    expect(apiFetch).toHaveBeenCalledWith('/proposals');
  });

  it('approveProposal POSTs /proposals/:id/approve', async () => {
    apiFetch.mockResolvedValue({ ok: true, id: 'p1' });
    await expect(approveProposal('p1')).resolves.toEqual({ ok: true, id: 'p1' });
    expect(apiFetch).toHaveBeenCalledWith('/proposals/p1/approve', { method: 'POST' });
  });

  it('rejectProposal POSTs /proposals/:id/reject', async () => {
    apiFetch.mockResolvedValue({ ok: true });
    await expect(rejectProposal('p2')).resolves.toEqual({ ok: true });
    expect(apiFetch).toHaveBeenCalledWith('/proposals/p2/reject', { method: 'POST' });
  });
});

describe('isProposalsUnsupported — the two adoption-gap answers, and only those', () => {
  it('501 and the bare unknown-route 404 → unsupported', () => {
    expect(isProposalsUnsupported(new ApiError(501, 'engine predates proposals'))).toBe(true);
    expect(isProposalsUnsupported(new ApiError(404, 'Not Found'))).toBe(true);
    expect(isProposalsUnsupported(new ApiError(404, 'not found'))).toBe(true);
  });

  it('a NAMED 404 is a real answer, and an ordinary error is not an adoption gap', () => {
    expect(isProposalsUnsupported(new ApiError(404, 'unknown proposal: p9'))).toBe(false);
    expect(isProposalsUnsupported(new Error('boom'))).toBe(false);
  });
});
