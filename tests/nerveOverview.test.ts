import { describe, expect, it } from 'vitest';
import { diskReading, normalizeSnapshot, type SystemAttention } from '../src/api/system.js';
import {
  bytesWords, cliTile, governanceTile, machineTile, overviewSentence, qePassPct, servicesTile, slowingItems, slowingLine, waitingItems, waitingWords,
} from '../src/board/nerveOverview.js';

// NERVE CENTER'S OVERVIEW (the operator-approved mockup `ui-v2-nerve`): the words over the live /system
// shape (crew 0.16.5 on the rig, 2026-10-27), and the disk row reading `freeDisk` where crew provides it.

const att = (id: string, panel: SystemAttention['panel'], level: SystemAttention['level'] = 'yellow', extra: Partial<SystemAttention> = {}): SystemAttention =>
  ({ id, panel, level, text: id, reason: `${id} reason`, remedy: null, action: null, ...extra });

const LIVE = normalizeSnapshot({
  checkedAt: '2026-10-27T13:22:52.211Z',
  attention: [],
  clis: [
    { cli: 'claude', label: 'Claude Code', state: 'signed_in', stateReason: null, canSignIn: true, stats: { days: 7, units: 71, passPct: 79.4, perDay: [] } },
    { cli: 'opencode', label: 'opencode', state: 'signed_out', stateReason: 'signed out', canSignIn: true, stats: null },
    { cli: 'copilot', label: 'Copilot', state: 'benched', stateReason: 'quota exceeded (429)', benchedUntil: '2026-10-28T04:28:00Z', canSignIn: true, stats: null },
  ],
  infra: [
    { key: 'daemon', label: 'Daemon', state: 'ok', reason: 'serving', details: {} },
    { key: 'gateway', label: 'Model gateway', state: 'ok', reason: 'running', details: {} },
    { key: 'interactive', label: 'Interactive bridge', state: 'off', reason: 'not running', details: {} },
    { key: 'disk', label: 'Free disk', state: 'ok', reason: '51.2 GiB free', details: { freeBytes: 55_020_527_616, totalBytes: 494_384_795_648 } },
    { key: 'load', label: 'Host load', state: 'degraded', reason: 'load 25.84 on 14 cores', details: { load1: 25.84, cores: 14 } },
  ],
  governance: [
    { key: 'qe_acceptance', label: 'QE acceptance (7 days)', state: 'ok', value: 14, breakdown: { passed: 2, failed: 12 }, reason: '2 of 14' },
    { key: 'steering_rules', label: 'Steering rules loaded', state: 'ok', value: 21, reason: '21 active' },
  ],
});

describe('the disk reading', () => {
  it("prefers crew's freeDisk block (free bytes, the volume, the floor jobs stop at), then the row's own bytes", () => {
    expect(diskReading({ freeBytes: 10, totalBytes: 20, freeDisk: { freeBytes: 24e9, volumeBytes: 460e9, floorBytes: 5e9 } }))
      .toEqual({ freeBytes: 24e9, totalBytes: 460e9, floorBytes: 5e9, availableBytes: null });
    expect(diskReading({ freeBytes: 55e9, totalBytes: 494e9 })).toEqual({ freeBytes: 55e9, totalBytes: 494e9, floorBytes: null, availableBytes: null });
    expect(diskReading({ freeDisk: 7e9, totalBytes: 9e9 })).toEqual({ freeBytes: 7e9, totalBytes: 9e9, floorBytes: null, availableBytes: null });
    // Nothing measured is absent, never 0.
    expect(diskReading({ freeDisk: { freeBytes: null } })).toBeNull();
    expect(diskReading({})).toBeNull();
    expect(LIVE.infra.find((r) => r.key === 'disk')!.disk).toEqual({ freeBytes: 55_020_527_616, totalBytes: 494_384_795_648, floorBytes: null, availableBytes: null });
    expect(LIVE.infra.find((r) => r.key === 'load')!.load).toEqual({ load1: 25.84, cores: 14 });
  });

  it('a slowing disk item says what is left and, when crew names it, where jobs stop', () => {
    const infra = normalizeSnapshot({ infra: [{ key: 'disk', label: 'Free disk', state: 'degraded', details: { freeDisk: { freeBytes: 24e9, floorBytes: 5e9 } } }] }).infra;
    expect(slowingLine(att('infra:disk', 'infra'), infra)).toBe('24 GB left; jobs stop below 5 GB.');
    expect(slowingLine(att('infra:gateway', 'infra'), infra)).toBe('infra:gateway reason');
    expect(bytesWords(820e6)).toBe('820 MB');
    expect(bytesWords(1.5e9)).toBe('1.5 GB');
  });
});

describe('the sections', () => {
  it('slowing work is the system; a job waiting on a person is Needs you, counted in one line', () => {
    const items = [att('run:a', 'runs', 'red'), att('infra:gateway', 'infra', 'red'), att('governance:judges', 'governance')];
    expect(slowingItems(items).map((a) => a.id)).toEqual(['infra:gateway', 'governance:judges']);
    expect(waitingItems(items).map((a) => a.id)).toEqual(['run:a']);
    expect(waitingWords(1)).toBe('One job needs you.');
    expect(waitingWords(3)).toBe('Three jobs need you.');
    expect(waitingWords(0)).toBeNull();
  });

  it('a helper tile: Ready with the week, Back at a time when out of quota, Sign in when signed out', () => {
    const [claude, opencode, copilot] = LIVE.clis.map(cliTile);
    expect(claude).toMatchObject({ name: 'Claude Code', state: 'Ready', tone: 'ok', line: '71 steps · 79% pass', tab: 'clis' });
    expect(opencode).toMatchObject({ state: 'Not signed in', tone: 'quiet', signIn: 'opencode' });
    expect(copilot!.state).toMatch(/^Back at /);
    expect(copilot).toMatchObject({ tone: 'warn', line: 'Out of quota' });
    expect(copilot!.signIn).toBeUndefined();
  });

  it('System: services leave out the machine rows; the machine says free disk and a busy load; governance derives QE pass', () => {
    expect(servicesTile(LIVE.infra)).toMatchObject({ state: '2 running', tone: 'ok', line: 'Interactive bridge starts when needed', tab: 'infra' });
    expect(machineTile(LIVE.infra)).toMatchObject({ state: 'Running slowly', tone: 'warn', line: '55 GB free · Load is high' });
    // 2 of 14 passed: 14%, from the card's own counts (never the gate count read as a percent).
    expect(qePassPct(LIVE.governance)).toBe(14);
    // Crew calls every card ok, but QE passes 2 times in 14: never "Healthy" beside that figure.
    expect(governanceTile(LIVE.governance)).toMatchObject({ state: 'QE passes rarely', tone: 'warn', line: 'QE pass 14% · 21 rules' });
    const good = normalizeSnapshot({ governance: [{ key: 'qe_acceptance', state: 'ok', value: 10, breakdown: { passed: 8, failed: 2 } }, { key: 'steering_rules', state: 'ok', value: 21 }] }).governance;
    expect(governanceTile(good)).toMatchObject({ state: 'Healthy', tone: 'ok', line: '21 rules · QE pass 80%' });
    const down = normalizeSnapshot({ infra: [{ key: 'gateway', label: 'Model gateway', state: 'down' }, { key: 'bus', label: 'Event bus', state: 'ok' }] }).infra;
    expect(servicesTile(down)).toMatchObject({ state: '1 down', tone: 'fail', line: 'Model gateway' });
    expect(machineTile([])).toMatchObject({ state: 'Not reported', tone: 'quiet' });
  });

  it('the sentence: what slows work first, then the rest; never a verdict over a read that is not fresh', () => {
    expect(overviewSentence({ read: 'fresh' }, [att('a', 'infra'), att('b', 'governance')], 0))
      .toEqual({ lead: 'Work is slowed by two things.', rest: 'Everything else is healthy.', tone: 'warn' });
    expect(overviewSentence({ read: 'fresh' }, [att('a', 'infra', 'red')], 2))
      .toEqual({ lead: 'Work is stopped by one thing.', rest: 'Two things need a look.', tone: 'fail' });
    expect(overviewSentence({ read: 'fresh' }, [], 0)).toEqual({ lead: 'Nothing is slowing work.', rest: 'Everything is healthy.', tone: 'ok' });
    expect(overviewSentence({ read: 'stale' }, [], 0).lead).toBe('Can’t reach crew.');
    expect(overviewSentence({ read: 'checking' }, [], 0).lead).toBe('Checking crew…');
  });
});

describe('the tidy-up line', () => {
  it('says how many jobs nobody resolved and what they cost, or nothing', async () => {
    const { tidyWords } = await import('../src/board/nerveOverview.js');
    expect(tidyWords(16, 4.2)).toBe('16 jobs to tidy up ($4.20 spent)');
    expect(tidyWords(1, null)).toBe('1 job to tidy up');
    expect(tidyWords(0, 3)).toBeNull();
  });
});

describe('free disk, free now and available (operator 2026-10-29: Finder said 70 GB, crew said 13 GB)', () => {
  it('says both when macOS can make much more available, else free alone', async () => {
    const { diskWords } = await import('../src/board/nerveOverview.js');
    expect(diskWords({ freeBytes: 6e9, availableBytes: 70e9 })).toBe('6 GB free now · 70 GB available once macOS clears purgeable space');
    expect(diskWords({ freeBytes: 15e9, availableBytes: 15.4e9 })).toBe('15 GB free');
    expect(diskWords({ freeBytes: 15e9, availableBytes: null })).toBe('15 GB free');
  });
  it('the disk reading carries crew\'s availableBytes, null when crew does not report it', async () => {
    const { diskReading } = await import('../src/api/system.js');
    expect(diskReading({ freeBytes: 6e9, totalBytes: 460e9, availableBytes: 70e9 })).toEqual({ freeBytes: 6e9, totalBytes: 460e9, floorBytes: null, availableBytes: 70e9 });
    expect(diskReading({ freeBytes: 6e9, totalBytes: 460e9 })!.availableBytes).toBeNull();
  });
  it('Check again stamps when crew was read: just now, then minutes', async () => {
    const { checkedWords } = await import('../src/components/nerve/NerveOverview.js');
    expect(checkedWords(1_000_000, 1_000_000 + 20_000)).toBe('Checked just now');
    expect(checkedWords(1_000_000, 1_000_000 + 3 * 60_000)).toBe('Checked 3 min ago');
    expect(checkedWords(null, 1)).toBeNull();
  });
});
