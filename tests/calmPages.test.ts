/**
 * The calm Steering, Memory and Agents pages' words (the operator-approved pages mockup,
 * 2026-10-26): pure folds the rows and sentences read.
 */
import { describe, expect, it } from 'vitest';
import { firesWord, ruleFires, ruleReach, ruleTitle, steerSentence } from '../src/board/calmSteer.js';
import { memoryOrigin, memorySentence, shortDate } from '../src/board/calmMemory.js';
import { agentStatus, agentsSentence, agentWeekLine } from '../src/board/calmAgents.js';
import { benchWord, type AgentRow } from '../src/board/agentsModel.js';
import type { SteeringRule } from '../src/api/steering.js';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const DAY = 86_400_000;

describe('ruleTitle', () => {
  it('takes the first clause of a long statement and drops its bracketed aside', () => {
    expect(ruleTitle('Every tool and resource is authenticated per the upstream\'s scheme (bearer, API key, basic or OAuth2 client credentials); the server reads ONE secret'))
      .toBe('Every tool and resource is authenticated per the upstream\'s scheme');
  });
  it('stops at a sentence end and at a lead-in colon', () => {
    expect(ruleTitle('The editor permission approvals ledger. Allowing a permission adds a token.')).toBe('The editor permission approvals ledger');
    expect(ruleTitle('Gate every step (Ask): every write or destructive MCP call asks')).toBe('Gate every step (Ask)');
  });
  it('keeps a short statement whole and trims a very long clause at a word', () => {
    expect(ruleTitle('Tests live next to the change')).toBe('Tests live next to the change');
    const long = ruleTitle(`A governed intent names one surface family and ${'states its boundaries '.repeat(8)}`);
    expect(long.length).toBeLessThanOrEqual(97);
    expect(long.endsWith('…')).toBe(true);
    expect(ruleTitle('   ')).toBe('A rule with no words');
  });
});

describe('ruleFires', () => {
  const claim = (daysAgo: number, policy_ids: string[], obligations: string[]) => ({ evaluated_at: (NOW - daysAgo * DAY) / 1000, policy_ids, obligations });
  it('counts the week’s gate checks citing a rule, as a deciding policy or as an obligation, once per claim', () => {
    const fires = ruleFires([
      claim(1, [], ['conform:Error:POL-2101:The user and steering policies choose', 'conform:Error:POL-2101:again']),
      claim(2, ['POL-2101'], ['conform:Critical:MCPS-1004:Every tool']),
      claim(3, [], ['phase scope']),
      claim(9, ['POL-2101'], []),
    ], NOW);
    expect(fires.get('POL-2101')).toBe(2);
    expect(fires.get('MCPS-1004')).toBe(1);
    expect(fires.has('phase scope')).toBe(false);
  });
  it('words the meta', () => {
    expect(firesWord(undefined)).toBe('Quiet this week');
    expect(firesWord(0)).toBe('Quiet this week');
    expect(firesWord(6)).toBe('Fired 6× this week');
  });
});

describe('ruleReach and steerSentence', () => {
  const rule = (targets: Record<string, unknown>): SteeringRule => ({ id: 'A-1', statement: 's', severity: 'error', targets, applies_to: [], rule_type: 'pattern', provenance: { ref: '', source: 'markdown' } } as unknown as SteeringRule);
  it('says where a rule applies', () => {
    expect(ruleReach(rule({}), () => null)).toBe('applies to every repository');
    expect(ruleReach(rule({ project: 'p1' }), (id) => (id === 'p1' ? 'wicked-core' : null))).toBe('applies to wicked-core');
    expect(ruleReach(rule({ language: 'TypeScript' }), () => null)).toBe('applies to TypeScript');
  });
  it('says the live counts in one sentence', () => {
    expect(steerSentence({ live: 42, type: null, pending: 3 })).toBe('42 rules guide your agents. 3 proposals are waiting for you.');
    expect(steerSentence({ live: 1, type: 'security', pending: 1 })).toBe('1 security rule guides your agents. 1 proposal is waiting for you.');
    expect(steerSentence({ live: 0, type: null, pending: 0 })).toBe('No rules guide your agents yet. Nothing is waiting for you.');
    expect(steerSentence({ live: null, type: null, pending: null })).toBe('Reading your rules…');
    expect(steerSentence({ live: 5, type: null, pending: 'unsupported' })).toBe('5 rules guide your agents.');
  });
});

describe('memory words', () => {
  it('reads where a memory came from only when the store says', () => {
    expect(memoryOrigin({ scope: 'operator:local', facets: {} })).toBe('told');
    expect(memoryOrigin({ scope: 'project:wicked', facets: { source: 'operator' } })).toBe('told');
    expect(memoryOrigin({ scope: 'project:wicked', facets: { run: '86bf54a4' } })).toBe('session');
    expect(memoryOrigin({ scope: 'project:wicked/session:abc', facets: {} })).toBe('session');
    expect(memoryOrigin({ scope: 'project:wicked', facets: { area: 'floor' } })).toBeNull();
  });
  it('says the totals and what is waiting', () => {
    expect(memorySentence({ total: 333, pending: 2, coverage: 'ok' })).toBe('Your agents remember 333 things, and where each came from. 2 proposals are waiting for you.');
    expect(memorySentence({ total: 0, pending: 0, coverage: 'ok' })).toBe('Your agents haven’t learned anything yet.');
    expect(memorySentence({ total: null, pending: null, coverage: 'loading' })).toBe('Reading what your agents have learned…');
    expect(memorySentence({ total: null, pending: 'unsupported', coverage: 'unsupported' })).toBe('What your agents have learned, and where it came from.');
  });
  it('dates a row briefly', () => {
    expect(shortDate(Date.parse('2026-10-23T15:00:00Z'), NOW)).toBe('Oct 23');
    expect(shortDate(Date.parse('2025-10-23T15:00:00Z'), NOW)).toBe('Oct 23, 2025');
  });
});

describe('agent words', () => {
  const row = (over: Partial<AgentRow>): AgentRow => ({
    key: 'claude', name: 'Claude Code', ready: { word: 'Ready', tone: 'ok', sub: null }, sign: { word: 'Signed in', tone: 'ok', sub: null },
    governed: { word: 'Every action checked', tone: 'ok', sub: null },
    bench: null, week: { units: 61, gated: 53, firstPass: 45 }, usable: true, issues: [], ...over,
  } as AgentRow);
  it('gives each agent one status word', () => {
    expect(agentStatus(row({}))).toEqual({ word: 'Ready', tone: 'ok', move: null });
    expect(agentStatus(row({ sign: { word: 'Signed out', tone: 'fail', sub: null } }))).toEqual({ word: 'Not signed in', tone: 'quiet', move: 'signin' });
    const benched = agentStatus(row({ bench: { kind: 'recent quota_exhausted', runs: 6, last_at: '2026-10-26T12:53:36Z', lifts_at: '2026-10-26T13:53:36Z' } as AgentRow['bench'] }));
    expect(benched.word).toMatch(/^Out of quota, back at /);
    expect(benched.tone).toBe('gate');
  });
  it('reads a re-probe bench’s cause token (crew 0.16.3 sends "recent quota_exhausted")', () => {
    const b = (kind: string) => ({ kind, runs: 1, last_at: '', lifts_at: '' }) as unknown as Parameters<typeof benchWord>[0];
    expect(benchWord(b('recent quota_exhausted'))).toBe('Out of quota');
    expect(benchWord(b('quota_exhausted'))).toBe('Out of quota');
    expect(benchWord(b('usage_limit'))).toBe('Out of usage');
    expect(benchWord(b('not_logged_in'))).toBe('Held back for now');
  });
  it('words the week', () => {
    expect(agentWeekLine(row({}))).toBe('61 steps this week · 85% passed first time');
    expect(agentWeekLine(row({ week: { units: 0, gated: 0, firstPass: 0 } }))).toBe('No work this week');
    expect(agentWeekLine(row({ week: { units: 1, gated: 0, firstPass: 0 } }))).toBe('1 step this week');
    expect(agentWeekLine(row({ week: null }))).toBeNull();
  });
  it('says how many are ready', () => {
    const ready = row({});
    const out = row({ key: 'pi', ready: { word: 'Not ready', tone: 'fail', sub: null }, usable: false });
    expect(agentsSentence([ready, ready, out])).toBe('2 of 3 are ready to work.');
    expect(agentsSentence([ready, ready])).toBe('All 2 are ready to work.');
    expect(agentsSentence([])).toBe('No AI agents found on this computer yet.');
  });
});
