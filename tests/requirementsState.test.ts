import { describe, it, expect } from 'vitest';
import { ApiError } from '../src/api/errors.js';
import { requirementsNotGenerated } from '../src/board/requirementsState.js';
import * as m from '../src/board/requirementsState.js';

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

describe('the list against the header: an older graph build (crew api-types 0.165.0 graphBuild)', () => {
  // wicked-crew on the rig, 2026-11-01: 61% real, the list a graph built before real requirements were counted
  const live = { realPct: 61, minPct: 80, behaviorBearing: 5786, real: 3585, placeholders: 2174, unmapped: 27, notProduct: 2380 };
  it('reads graphBuild, and claims nothing when it is absent or malformed', async () => {
    const { graphBuildOf } = await import('../src/board/requirementsState.js');
    expect(graphBuildOf({ graphBuild: { generation: 2, coverage: null, behind: true } })).toEqual({ generation: 2, coverage: null, behind: true });
    expect(graphBuildOf({})).toBeNull();
    expect(graphBuildOf({ graphBuild: null })).toBeNull();
    expect(graphBuildOf({ graphBuild: { generation: 2, behind: 'yes' } })).toBeNull();
    expect(graphBuildOf({ graphBuild: { generation: -1, coverage: null, behind: true } })).toBeNull();
  });
  it('says the three cases in one sentence each, and nothing when the list is current', async () => {
    const { graphBuildNote } = await import('../src/board/requirementsState.js');
    expect(graphBuildNote(live, { generation: 2, coverage: null, behind: true })).toBe(
      'This list is a graph built before real requirements were counted. The 3,585 real requirements mapped now are kept, not listed: '
      + "the graph is built at 80% real, or when you lower this repository's minimum at the job's ask.");
    expect(graphBuildNote(live, { generation: 3, coverage: { ...live, real: 1383, realPct: 23 }, behind: true })).toBe(
      'This list is the graph as last built (1,383 real). 2,202 real requirements mapped since are kept, not listed: '
      + "the graph is built at 80% real, or when you lower this repository's minimum at the job's ask.");
    expect(graphBuildNote({ ...live, realPct: 85 }, { generation: 3, coverage: { ...live, realPct: 85 }, behind: true })).toBe(
      'The repository changed since this graph was built: build the graph to list what it holds now.');
    expect(graphBuildNote({ ...live, realPct: 85 }, { generation: 3, coverage: null, behind: true })).toBe(
      'This list is a graph built before real requirements were counted. The 3,585 real requirements mapped now are kept, not listed: build the graph to list them.');
    expect(graphBuildNote(live, { generation: 2, coverage: live, behind: false })).toBeNull();
    expect(graphBuildNote(live, null)).toBeNull();
  });
});

describe('a placeholder follows the engine when crew says so', () => {
  it('the item\'s own placeholder flag wins; the risk floor only stands in for a daemon without it', async () => {
    const { isPlaceholder } = await import('../src/board/requirementsState.js');
    // a plain rule at confidence 0.7: the engine counts it a placeholder, the statement does not show it
    expect(isPlaceholder({ statement: 'Raising rigor is refused unless the actor is a human operator.', placeholder: true })).toBe(true);
    expect(isPlaceholder({ statement: 'Raising rigor is refused unless the actor is a human operator.' })).toBe(false);
    expect(isPlaceholder({ statement: '[RISK] x: empty statement (model could not state a rule)', placeholder: false })).toBe(false);
  });
});

describe('not counted (crew api-types 0.167.0)', () => {
  it('reads the reason and the page counts, and says them in one line', async () => {
    const { uncountedOf, pageUncountedOf, uncountedLine, configDataCountOf } = await import('../src/board/requirementsState.js');
    expect(uncountedOf({ uncounted: 'structural' })).toBe('structural');
    expect(uncountedOf({ uncounted: null })).toBeNull();
    expect(uncountedOf({ uncounted: 'whatever' })).toBeNull();
    expect(uncountedOf({})).toBeNull();
    expect(pageUncountedOf({ uncounted: { stated: 441, placeholders: 1017 } })).toEqual({ stated: 441, placeholders: 1017 });
    expect(pageUncountedOf({ uncounted: { stated: -1, placeholders: 2 } })).toBeNull();
    expect(uncountedLine({ stated: 441, placeholders: 1017 })).toBe('441 stated rules and 1,017 placeholders sit on type shapes and are not counted.');
    expect(uncountedLine({ stated: 0, placeholders: 1 })).toBe('1 placeholder sits on a type shape and is not counted.');
    expect(uncountedLine({ stated: 2, placeholders: 0 })).toBe('2 stated rules sit on type shapes and are not counted.');
    expect(uncountedLine({ stated: 0, placeholders: 0 })).toBeNull();
    expect(configDataCountOf({ categories: { functional: 5770, configData: 0 } })).toBe(0);
    expect(configDataCountOf({})).toBeNull();
  });
});

describe('code age, minimum and mismatches (crew api-types 0.196.0)', () => {
  it('says the code age only when it is known and not zero, singular for one', () => {
    const now = new Date('2026-11-07T00:00:00Z');
    expect(m.codeDriftLine(m.codeDriftOf({ codeDrift: { builtFromCommit: 'abc1234', builtAt: '2026-11-01T13:57:56-05:00', commitsBehind: 69 } }), now))
      .toBe('Built from code 69 commits old (Nov 1)');
    expect(m.codeDriftLine(m.codeDriftOf({ codeDrift: { builtFromCommit: 'abc1234', builtAt: null, commitsBehind: 1 } }), now)).toBe('Built from code 1 commit old');
    expect(m.codeDriftLine(m.codeDriftOf({ codeDrift: { builtFromCommit: 'abc1234', builtAt: null, commitsBehind: 0 } }), now)).toBeNull();
    expect(m.codeDriftLine(m.codeDriftOf({ codeDrift: { builtFromCommit: 'abc1234', builtAt: null, commitsBehind: null } }), now)).toBeNull();
    expect(m.codeDriftOf({ codeDrift: { builtFromCommit: 'HEAD', commitsBehind: 3 } })).toBeNull();
    expect(m.codeDriftLine(m.codeDriftOf({ codeDrift: { builtFromCommit: 'abc1234', builtAt: '2025-12-24T00:00:00Z', commitsBehind: 2 } }), now))
      .toMatch(/^Built from code 2 commits old \(Dec 2[34], 2025\)$/);
  });
  it('reads the minimum and its source, and nothing malformed', () => {
    const repo = m.minimumOf({ minimum: { pct: 66, source: 'repo', repoPct: 66, settingsPct: 80 } });
    expect(repo && m.minimumLine(repo)).toBe("Minimum 66%, this repository's own (Settings: 80%)");
    const settings = m.minimumOf({ minimum: { pct: 80, source: 'settings', repoPct: null, settingsPct: 80 } });
    expect(settings && m.minimumLine(settings)).toBe('Minimum 80%, from Settings');
    expect(m.minimumOf({ minimum: { pct: 0, source: 'repo' } })).toBeNull();
    expect(m.minimumOf({ minimum: { pct: 80, source: 'guess' } })).toBeNull();
    expect(m.minimumOf({})).toBeNull();
  });
  it('reads a code mismatch and the count, and nothing from an older daemon', () => {
    expect(m.codeMismatchOf({ codeMismatch: ' skips the first ' })).toBe('skips the first');
    expect(m.codeMismatchOf({ codeMismatch: '  ' })).toBeNull();
    expect(m.codeMismatchOf({})).toBeNull();
    expect(m.mismatchCountOf({ mismatches: 2 })).toBe(2);
    expect(m.mismatchCountOf({})).toBeNull();
  });
});
