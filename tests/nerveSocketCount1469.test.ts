import { describe, expect, it } from 'vitest';
import type { SystemSnapshot } from '../src/api/system.js';
import { nerveState } from '../src/board/nerveCenter.js';
import type { SystemStore } from '../src/store/systemSnapshot.js';
import { needsSource } from '../src/board/attention.js';
const NOW = 1_800_000_000_000;
type Signals = Parameters<typeof nerveState>[0];
const snap = (over: Partial<SystemSnapshot> = {}): SystemSnapshot => ({ checkedAt: NOW, attention: [], clis: [], runs: [], infra: [], governance: [], ...over });
function system(over: Partial<SystemStore> = {}): Signals {
  return {
    mode: 'system', health: { status: 'ok' }, healthAt: NOW, healthError: null,
    snapshot: snap(), snapshotAt: NOW, snapshotError: null, governance: { kind: 'unread' }, governanceAt: null, ...over,
  };
}

/**
 * studio#1469: while studio's live connection to crew is down, studio adds its own "live updates paused" item. It is
 * not a thing that needs you: the chip says it beside crew's count, the badge (`needsSource`, which useSettledNeeds
 * counts) leaves it out, and the Nerve Center's Attention list still shows it.
 */
const job = (id: string) => ({ id, level: 'yellow' as const, panel: 'runs' as const, text: 'review the plan', reason: null, remedy: null, action: null });
const load = { id: 'infra:load', level: 'yellow' as const, panel: 'infra' as const, text: 'Host load: degraded', reason: null, remedy: null, action: null, kind: 'slows' as const };
const ranked = (attention: unknown[]) => system({ snapshot: snap({ ranked: true, attention } as never) });
const badge = (s: Signals): number => {
  const src = needsSource(s, 'disconnected', [], NOW);
  return src.phase === 'ready' && src.from === 'crew' ? src.items.length : -1;
};

describe('studio#1469: the paused socket is said, never counted', () => {
  it('one waiting job: the chip says 1 beside the paused socket, and the badge says 1', () => {
    const s = ranked([job('run:a')]);
    const st = nerveState(s, 'disconnected', 0, NOW);
    expect(st.words).toBe('1 needs you · live updates paused');
    expect(st.tone).toBe('yellow');
    expect(badge(s)).toBe(1);
    // The Attention list still shows the paused socket.
    expect(st.attention.map((a) => a.id)).toEqual(['run:a', 'studio-socket']);
  });

  it('a system item and a job: the total is crew’s two, the socket its own part', () => {
    const s = ranked([load, job('run:a')]);
    expect(nerveState(s, 'disconnected', 0, NOW).words).toBe('2 need a look (machine busy, 1 job) · live updates paused');
    expect(badge(s)).toBe(2);
    expect(nerveState(ranked([load]), 'disconnected', 0, NOW).words).toBe('machine busy · live updates paused');
  });

  it('nothing from crew: the chip still says the paused socket (yellow), and the badge says nothing', () => {
    const s = ranked([]);
    expect(nerveState(s, 'disconnected', 0, NOW)).toMatchObject({ tone: 'yellow', words: 'live updates paused' });
    expect(badge(s)).toBe(0);
  });

  it('work left to tidy up is still said beside the paused socket (the socket used to take its place)', () => {
    const s = system({ snapshot: snap({ ranked: true, attention: [], unresolved: [{ runId: 'r9' }, { runId: 'r8' }] } as never) });
    expect(nerveState(s, 'disconnected', 0, NOW).words).toBe('2 to tidy up · live updates paused');
  });

  it('an item that stops work keeps the tile red, with the paused socket said after it', () => {
    const gw = { id: 'gw', level: 'red' as const, panel: 'infra' as const, text: 'gateway down', reason: null, remedy: null, action: null, kind: 'prevents' as const };
    expect(nerveState(ranked([gw, job('run:a')]), 'disconnected', 0, NOW)).toMatchObject({ tone: 'red', words: '2 need a look (a service is down, 1 job) · live updates paused' });
  });

  it('connected: as before', () => {
    expect(nerveState(ranked([load, job('run:a')]), 'connected', 0, NOW).words).toBe('2 need a look (machine busy, 1 job)');
  });
});
