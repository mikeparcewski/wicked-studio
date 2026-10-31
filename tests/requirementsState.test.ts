import { describe, it, expect } from 'vitest';
import { ApiError } from '../src/api/errors.js';
import { requirementsNotGenerated } from '../src/board/requirementsState.js';

describe('requirementsNotGenerated (lane repo-page)', () => {
  it('reads crew\'s typed 404 and the workflow it names', () => {
    const e = new ApiError(404, 'No requirements graph yet for this repository', { error: 'x', code: 'notGenerated', workflow: 'map-it' });
    expect(requirementsNotGenerated(e)).toEqual({ workflow: 'map-it' });
  });
  it('defaults the workflow when the body names none', () => {
    expect(requirementsNotGenerated(new ApiError(404, 'x', { code: 'notGenerated' }))).toEqual({ workflow: 'domain-extraction' });
  });
  it('reads an older daemon\'s sentence', () => {
    expect(requirementsNotGenerated(new ApiError(404, 'requirements_graph.json not generated for this repo yet', { error: 'requirements_graph.json not generated for this repo yet' })))
      .toEqual({ workflow: 'domain-extraction' });
  });
  it('anything else is not this state', () => {
    expect(requirementsNotGenerated(new ApiError(404, 'Repo r1 not found', { error: 'Repo r1 not found' }))).toBeNull();
    expect(requirementsNotGenerated(new ApiError(500, 'boom', { code: 'notGenerated' }))).toBeNull();
    expect(requirementsNotGenerated(new Error('requirements_graph.json not generated'))).toBeNull();
    expect(requirementsNotGenerated(null)).toBeNull();
  });
});

describe('corroboration + coverage readers (operator ruling 2026-10-31)', () => {
  it('reads a mark and says it in plain words', async () => {
    const { corroborationOf, corroborationSentence } = await import('../src/board/requirementsState.js');
    const c = corroborationOf({ corroboration: { status: 'validated', sources: 2, callSites: 2, tests: 0, docs: 0, extraExtractors: 0 } });
    expect(c?.status).toBe('validated');
    expect(corroborationSentence(c!)).toBe('Validated by 2 independent sources: 2 callers.');
    const u = corroborationOf({ corroboration: { status: 'unconfirmed', sources: 1, callSites: 1, tests: 0, docs: 0, extraExtractors: 0, why: { code: 'single_caller', text: 'One caller, and no test or doc touches it.' } } });
    expect(corroborationSentence(u!)).toBe('One caller, and no test or doc touches it.');
  });
  it('an older daemon or an unreadable record reads null, never a guess', async () => {
    const { corroborationOf, coverageOf, corroborationCounts } = await import('../src/board/requirementsState.js');
    expect(corroborationOf({})).toBeNull();
    expect(corroborationOf({ corroboration: null })).toBeNull();
    expect(corroborationOf({ corroboration: { status: 'validated' } })).toBeNull();
    expect(coverageOf({ coverage: { mappedPct: 82 } })).toBeNull();
    expect(corroborationCounts({ corroboration: { validated: 0, unconfirmed: 0 } })).toBeNull();
    expect(coverageOf({ coverage: { mappedPct: 82, minPct: 80, behaviorBearing: 10, mapped: 8, resolved: 8, unmapped: 2 } })?.mappedPct).toBe(82);
  });
});
