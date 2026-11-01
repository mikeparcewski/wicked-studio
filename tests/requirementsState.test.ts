import { describe, it, expect } from 'vitest';
import { ApiError } from '../src/api/errors.js';
import { requirementsNotGenerated } from '../src/board/requirementsState.js';

describe('requirementsNotGenerated (lane repo-page)', () => {
  it('reads crew\'s typed 404 and the workflow it names', () => {
    const e = new ApiError(404, 'No requirements graph yet for this repository', { error: 'x', code: 'notGenerated', workflow: 'map-it' });
    expect(requirementsNotGenerated(e)).toEqual({ workflow: 'map-it', share: null });
  });
  it('defaults the workflow when the body names none', () => {
    expect(requirementsNotGenerated(new ApiError(404, 'x', { code: 'notGenerated' }))).toEqual({ workflow: 'domain-extraction', share: null });
  });
  it('reads an older daemon\'s sentence', () => {
    expect(requirementsNotGenerated(new ApiError(404, 'requirements_graph.json not generated for this repo yet', { error: 'requirements_graph.json not generated for this repo yet' })))
      .toEqual({ workflow: 'domain-extraction', share: null });
  });
  it('carries the real share so far when crew counted it (api-types 0.164.0)', () => {
    const e = new ApiError(404, 'x', { code: 'notGenerated', workflow: 'domain-extraction',
      coverage: { realPct: 3, minPct: 80, behaviorBearing: 8109, real: 300, placeholders: 7700, unmapped: 109, notProduct: 40 } });
    expect(requirementsNotGenerated(e)).toEqual({ workflow: 'domain-extraction',
      share: { realPct: 3, minPct: 80, behaviorBearing: 8109, real: 300, placeholders: 7700, unmapped: 109, notProduct: 40 } });
  });
  it('anything else is not this state', () => {
    expect(requirementsNotGenerated(new ApiError(404, 'Repo r1 not found', { error: 'Repo r1 not found' }))).toBeNull();
    expect(requirementsNotGenerated(new ApiError(500, 'boom', { code: 'notGenerated' }))).toBeNull();
    expect(requirementsNotGenerated(new Error('requirements_graph.json not generated'))).toBeNull();
    expect(requirementsNotGenerated(null)).toBeNull();
  });
});

// wicked-crew on the rig, 2026-11-01 (domain-real WIRE): 5,786 behaviour-bearing, 54% real.
const LIVE = { realPct: 54, minPct: 80, behaviorBearing: 5786, real: 3182, placeholders: 2577, unmapped: 27, notProduct: 2380 };

describe('the real-requirements label (domain-real WIRE 2026-11-01)', () => {
  it('says the real share against the minimum, and what the rest is', async () => {
    const { coverageHeadline, coverageBreakdown } = await import('../src/board/requirementsState.js');
    expect(coverageHeadline(LIVE)).toBe('54% real requirements · minimum 80%');
    expect(coverageBreakdown(LIVE)).toBe('3,182 real · 2,577 placeholders · 27 unmapped · 2,380 not product code');
  });
  it('leaves out the parts there are none of; real is always said', async () => {
    const { coverageHeadline, coverageBreakdown } = await import('../src/board/requirementsState.js');
    // pi-governance on the rig: 3 of 3 real, 117 not product code
    const pi = { realPct: 100, minPct: 80, behaviorBearing: 3, real: 3, placeholders: 0, unmapped: 0, notProduct: 117 };
    expect(coverageHeadline(pi)).toBe('100% real requirements · minimum 80%');
    expect(coverageBreakdown(pi)).toBe('3 real · 117 not product code');
    expect(coverageBreakdown({ ...pi, real: 0, realPct: 0, placeholders: 1, notProduct: 0 })).toBe('0 real · 1 placeholder');
  });
  it('placeholders are never progress: only real counts, so a share that rounds to 0 with some real says under 1%', async () => {
    const { coverageHeadline } = await import('../src/board/requirementsState.js');
    expect(coverageHeadline({ ...LIVE, realPct: 0, real: 40, placeholders: 5700 })).toBe('Under 1% real requirements · minimum 80%');
    expect(coverageHeadline({ ...LIVE, realPct: 0, real: 0, placeholders: 5786 })).toBe('0% real requirements · minimum 80%');
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
    // the retired shape (mappedPct / mapped / resolved) is not read as the new one
    expect(coverageOf({ coverage: { mappedPct: 82, minPct: 80, behaviorBearing: 10, mapped: 8, resolved: 8, unmapped: 2 } })).toBeNull();
    expect(corroborationCounts({ corroboration: { validated: 0, unconfirmed: 0 } })).toBeNull();
    expect(coverageOf({ coverage: { ...LIVE, realPct: 101 } })).toBeNull();
    expect(coverageOf({ coverage: { ...LIVE, minPct: 0 } })).toBeNull();
    expect(coverageOf({ coverage: { ...LIVE, real: '3182' } })).toBeNull();
    expect(coverageOf({ coverage: LIVE })).toEqual(LIVE);
  });
});

describe('a placeholder in the list (operator 2026-11-01)', () => {
  it('is a statement on the engine\'s risk floor, nothing else', async () => {
    const { isPlaceholder } = await import('../src/board/requirementsState.js');
    expect(isPlaceholder({ statement: '[RISK] devDependencies: empty statement (model could not state a rule)' })).toBe(true);
    expect(isPlaceholder({ statement: ' [RISK] x: below confidence threshold — y' })).toBe(true);
    expect(isPlaceholder({ statement: 'RISK: approval threshold unverified' })).toBe(false);
    expect(isPlaceholder({ statement: 'The workspace requires Node.js 22.12.0 or newer.' })).toBe(false);
  });
});
