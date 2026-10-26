import { describe, expect, it } from 'vitest';
import type { SystemAttention, SystemSnapshot } from '../src/api/system.js';
import type { NerveState } from '../src/board/nerveCenter.js';
import { activeNerveTab, landingTab, nerveSummary, nerveTabPath, readNerveTab, type AreaSummary, type FallbackSignals } from '../src/board/nerveTabs.js';

/**
 * NERVE CENTER'S TABS (board/nerveTabs): the default tab, the tab on the address, and the summary
 * chips' words and colours — never green over a read that is not fresh.
 */

const att = (id: string, level: SystemAttention['level'], panel: SystemAttention['panel'], text = id): SystemAttention =>
  ({ id, level, panel, text, reason: null, remedy: null, action: null });
const state = (read: NerveState['read'], attention: SystemAttention[] = []): Pick<NerveState, 'read' | 'attention'> => ({ read, attention });

const snap = (over: Partial<Record<'clis' | 'runs' | 'infra' | 'governance', { state?: string; liveness?: string }[]>> = {}): SystemSnapshot =>
  ({ checkedAt: 0, attention: [], clis: [], runs: [], infra: [], governance: [], ...over } as unknown as SystemSnapshot);

const GREEN = snap({
  clis: [{ state: 'signed_in' }, { state: 'signed_in' }],
  runs: [{ liveness: 'working' }],
  infra: [{ state: 'ok' }, { state: 'off' }],
  governance: [{ state: 'ok' }],
});
const FB: FallbackSignals = { roster: null, needCount: 0, governance: 'unread' };
const byId = (areas: AreaSummary[]): Record<string, AreaSummary> => Object.fromEntries(areas.map((a) => [a.id, a]));

describe('the tab on the address', () => {
  it('reads ?tab= when it names a tab, and nothing else', () => {
    expect(readNerveTab('?tab=infra')).toBe('infra');
    expect(readNerveTab('?tab=governance&filter=decision')).toBe('governance');
    expect(readNerveTab('?tab=bogus')).toBeNull();
    expect(readNerveTab('')).toBeNull();
  });

  it("a tab's address keeps the rest of the query (the feed's filter)", () => {
    expect(nerveTabPath('', 'clis')).toBe('/watch?tab=clis');
    expect(nerveTabPath('?filter=decision', 'runs')).toBe('/watch?filter=decision&tab=runs');
    expect(nerveTabPath('?tab=infra&filter=problem', 'attention')).toBe('/watch?tab=attention&filter=problem');
  });
});

describe('the default tab', () => {
  it('lands on Attention when anything needs attention, else on CLIs; undecided while checking', () => {
    expect(landingTab(state('fresh', [att('a', 'yellow', 'infra')]))).toBe('attention');
    expect(landingTab(state('fresh'))).toBe('clis');
    // A failed or stale read carries "can't reach crew": Attention.
    expect(landingTab(state('failed', [att('crew-unreachable', 'yellow', 'infra')]))).toBe('attention');
    expect(landingTab(state('checking'))).toBeNull();
  });

  it('the address wins; a feed filter opens Runs; while checking the page holds Attention', () => {
    expect(activeNerveTab('?tab=governance', 'attention')).toBe('governance');
    expect(activeNerveTab('?tab=attention', 'clis')).toBe('attention');
    expect(activeNerveTab('?filter=decision', 'attention')).toBe('runs');
    expect(activeNerveTab('?tab=infra&filter=decision', 'clis')).toBe('infra');
    expect(activeNerveTab('', 'clis')).toBe('clis');
    expect(activeNerveTab('', null)).toBe('attention');
    expect(activeNerveTab('?tab=nope', 'clis')).toBe('clis');
  });
});

describe('the summary chips', () => {
  it('a red snapshot: counts in words, each coloured by its worst state', () => {
    const s = snap({
      clis: [{ state: 'signed_in' }, { state: 'signed_in' }, { state: 'signed_in' }, { state: 'signed_out' }, { state: 'benched' }],
      runs: [{ liveness: 'working' }, { liveness: 'waiting_on_you' }, { liveness: 'stalled' }],
      infra: [{ state: 'ok' }, { state: 'down' }, { state: 'unknown' }, { state: 'off' }],
      governance: [{ state: 'ok' }, { state: 'degraded' }, { state: 'degraded' }],
    });
    const a = byId(nerveSummary(state('fresh', [att('infra:gateway', 'red', 'infra'), att('cli:copilot', 'yellow', 'clis'), att('run:x', 'yellow', 'runs'), att('x', 'yellow', 'governance')]), s, FB));
    expect(a['attention']).toMatchObject({ words: '4', count: 4, tone: 'fail', stale: false });
    expect(a['clis']).toMatchObject({ words: '3/5 signed in', tone: 'warn' });
    expect(a['runs']).toMatchObject({ words: '1 waiting', tone: 'warn' });
    expect(a['infra']).toMatchObject({ words: '1 down', tone: 'fail' });
    expect(a['governance']).toMatchObject({ words: '2 degraded', tone: 'warn' });
  });

  it('a run crew calls red makes Runs red; held is counted before stalled', () => {
    const s = snap({ runs: [{ liveness: 'stalled' }, { liveness: 'held' }, { liveness: 'held' }] });
    const a = byId(nerveSummary(state('fresh', [att('run:1', 'red', 'runs')]), s, FB));
    expect(a['runs']).toMatchObject({ words: '2 held', tone: 'fail' });
  });

  it('all clear over a fresh read: every chip green', () => {
    const a = nerveSummary(state('fresh'), GREEN, FB);
    expect(a.map((x) => [x.id, x.words, x.tone])).toEqual([
      ['attention', '0', 'ok'], ['clis', '2/2 signed in', 'ok'], ['runs', '1 working', 'ok'], ['infra', 'ok', 'ok'], ['governance', 'ok', 'ok'],
    ]);
  });

  it('an attention item the data does not show still colours its area, in its own words', () => {
    const a = byId(nerveSummary(state('fresh', [att('studio-socket', 'yellow', 'infra', 'live updates paused')]), GREEN, FB));
    expect(a['infra']).toMatchObject({ words: 'live updates paused', tone: 'warn' });
  });

  it.each(['stale', 'failed', 'checking'] as const)('a %s read is never green, in any chip', (read) => {
    const items = read === 'checking' ? [] : [att('crew-unreachable', 'yellow', 'infra', "can't reach crew")];
    const a = nerveSummary(state(read, items), GREEN, { roster: [{ signed_in: true }], needCount: 0, governance: 'ok' });
    expect(a.every((x) => x.tone !== 'ok')).toBe(true);
    expect(a.every((x) => x.stale)).toBe(true);
    // The words stay (the last answer), the colour says it is not current.
    if (read !== 'checking') expect(byId(a)['clis']).toMatchObject({ words: '2/2 signed in', tone: 'unknown' });
  });

  it('a stale read keeps a known problem red (never downgraded, never green)', () => {
    const s = snap({ infra: [{ state: 'down' }] });
    expect(byId(nerveSummary(state('stale', [att('crew-unreachable', 'yellow', 'infra')]), s, FB))['infra']).toMatchObject({ tone: 'fail', stale: true });
  });

  it('an older crew: CLIs from the roster, Runs from the needs-you count, governance from its read', () => {
    const fb: FallbackSignals = { roster: [{ signed_in: true }, { signed_in: false }], needCount: 2, governance: 'ok' };
    const a = byId(nerveSummary(state('fresh', [att('waiting-on-you', 'yellow', 'runs'), att('governance-x', 'yellow', 'governance', 'governance warning')]), null, fb));
    expect(a['clis']).toMatchObject({ words: '1/2 signed in', tone: 'warn' });
    expect(a['runs']).toMatchObject({ words: '2 waiting', tone: 'warn' });
    expect(a['infra']).toMatchObject({ words: 'ok', tone: 'ok' });
    expect(a['governance']).toMatchObject({ words: 'governance warning', tone: 'warn' });
    // A roster whose sign-in is not known, and a crew without governance, are grey — not green.
    const b = byId(nerveSummary(state('fresh'), null, { roster: [{ signed_in: null }], needCount: 0, governance: 'absent' }));
    expect(b['clis']!.tone).toBe('unknown');
    expect(b['governance']).toMatchObject({ words: 'not reported', tone: 'unknown' });
    expect(b['runs']).toMatchObject({ words: 'none waiting', tone: 'ok' });
  });
});
