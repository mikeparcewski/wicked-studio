import { describe, expect, it } from 'vitest';
import { normalizeSnapshot, type SystemSnapshot } from '../src/api/system.js';
import { ALL_CLEAR, CANT_REACH, nerveState, runsWorstFirst, STALE_MS } from '../src/board/nerveCenter.js';
import type { SystemStore } from '../src/store/systemSnapshot.js';
import { pageNameFor } from '../src/board/pageNames.js';
import { parseRoute } from '../src/hooks/useRoute.js';

/**
 * NERVE CENTER'S VERDICT (DES-SYSTEM-VIEW): green only over a fresh, successful read with nothing in
 * attention; a failed, pending or stale read is yellow "can't reach crew" / "checking"; red when an
 * item blocks work. Pure — the rail tile and the dashboard both read it.
 */

const NOW = 1_800_000_000_000;
type Signals = Parameters<typeof nerveState>[0];

const snap = (over: Partial<SystemSnapshot> = {}): SystemSnapshot => ({ checkedAt: NOW, attention: [], clis: [], runs: [], infra: [], governance: [], ...over });

function system(over: Partial<SystemStore> = {}): Signals {
  return {
    mode: 'system', health: { status: 'ok' }, healthAt: NOW, healthError: null,
    snapshot: snap(), snapshotAt: NOW, snapshotError: null, governance: { kind: 'unread' }, governanceAt: null, ...over,
  };
}

function fallback(over: Partial<SystemStore> = {}): Signals {
  return {
    mode: 'fallback', health: { status: 'ok' }, healthAt: NOW, healthError: null,
    snapshot: null, snapshotAt: null, snapshotError: null, governanceAt: NOW,
    governance: { kind: 'ok', governance: { store: { path: '/x', source: 'flag' }, records: { total: 1, sinceBoot: 1 }, deadletters: { path: null, count: 0, byType: {}, byReason: {}, timestamped: 0, untimestamped: 0, oldestTs: null, newestTs: null, truncated: false, legacyOutbox: null }, findings: [] } } as never,
    ...over,
  };
}

const red = { id: 'gw', level: 'red' as const, panel: 'infra' as const, text: 'gateway down', reason: 'no answer on :7721', remedy: 'Start the gateway', action: { kind: 'recheck' as const, target: 'gateway' } };
const yellow = { id: 'cp', level: 'yellow' as const, panel: 'clis' as const, text: 'copilot benched (429)', reason: null, remedy: null, action: null };

describe('green only over a fresh, successful read', () => {
  it('a fresh snapshot with nothing in attention is green "all clear"', () => {
    const s = nerveState(system(), 'connected', 0, NOW);
    expect(s).toMatchObject({ tone: 'green', read: 'fresh', words: ALL_CLEAR, attention: [] });
  });

  it('before any answer it is yellow "checking", never green', () => {
    const s = nerveState(system({ mode: 'unknown', health: null, healthAt: null, snapshot: null, snapshotAt: null }), 'connected', 0, NOW);
    expect(s.tone).toBe('yellow');
    expect(s.read).toBe('checking');
  });

  it('a failed /health read is yellow "can\'t reach crew", even over an older green snapshot', () => {
    const s = nerveState(system({ healthError: 'Failed to fetch' }), 'connected', 0, NOW);
    expect(s).toMatchObject({ tone: 'yellow', read: 'failed', words: CANT_REACH });
    expect(s.attention[0]).toMatchObject({ id: 'crew-unreachable', action: { kind: 'recheck' } });
  });

  it('a failed /system read is yellow "can\'t reach crew", never green', () => {
    const s = nerveState(system({ snapshotError: 'no answer after 10 s' }), 'connected', 0, NOW);
    expect(s).toMatchObject({ tone: 'yellow', read: 'failed', words: CANT_REACH });
  });

  it('a stale answer (no fresh read inside STALE_MS) is yellow, never the old green', () => {
    expect(nerveState(system({ healthAt: NOW - STALE_MS - 1 }), 'connected', 0, NOW)).toMatchObject({ tone: 'yellow', read: 'stale', words: CANT_REACH });
    expect(nerveState(system({ snapshotAt: NOW - STALE_MS - 1 }), 'connected', 0, NOW)).toMatchObject({ tone: 'yellow', read: 'stale', words: CANT_REACH });
    expect(nerveState(system({ healthAt: NOW - STALE_MS + 1, snapshotAt: NOW - STALE_MS + 1 }), 'connected', 0, NOW).tone).toBe('green');
  });

  it('a capability claimed but no snapshot yet is "checking", not green', () => {
    expect(nerveState(system({ snapshot: null, snapshotAt: null }), 'connected', 0, NOW)).toMatchObject({ tone: 'yellow', read: 'checking' });
  });
});

describe('red when work is blocked, yellow when it needs a look', () => {
  it('red tops yellow, and the words are a summary of the worst (never its title)', () => {
    const s = nerveState(system({ snapshot: snap({ attention: [yellow, red] }) }), 'connected', 0, NOW);
    expect(s.tone).toBe('red');
    expect(s.words).toBe('a service is down and 1 more');
    expect(s.attention.map((a) => a.id)).toEqual(['gw', 'cp']);
  });

  it('yellow only is yellow, said as a summary', () => {
    expect(nerveState(system({ snapshot: snap({ attention: [yellow] }) }), 'connected', 0, NOW)).toMatchObject({ tone: 'yellow', read: 'fresh', words: 'a helper is resting' });
  });

  it('a job waiting on you is amber, never red, and counted ("1 needs you"); a disk item is "disk low"', () => {
    const job = { id: 'run:a', level: 'red' as const, panel: 'runs' as const, text: 'Where is wicked-core riskiest to change', reason: null, remedy: null, action: null, kind: 'prevents' as const };
    expect(nerveState(system({ snapshot: snap({ attention: [job] }) }), 'connected', 0, NOW)).toMatchObject({ tone: 'yellow', words: '1 needs you' });
    const disk = { ...red, id: 'infra:disk', text: 'Free disk: degraded', level: 'yellow' as const };
    expect(nerveState(system({ snapshot: snap({ attention: [disk, job] }) }), 'connected', 0, NOW)).toMatchObject({ tone: 'yellow', words: 'disk low · 1 needs you' });
  });

  it('a dropped socket is said (yellow) in both modes', () => {
    expect(nerveState(system(), 'disconnected', 0, NOW)).toMatchObject({ tone: 'yellow', words: 'live updates paused' });
    expect(nerveState(fallback(), 'disconnected', 0, NOW)).toMatchObject({ tone: 'yellow', words: 'live updates paused' });
  });
});

describe('an older crew (no system capability): attention folded from what it can say', () => {
  it('a healthy crew with nothing waiting is green', () => {
    expect(nerveState(fallback(), 'connected', 0, NOW)).toMatchObject({ tone: 'green', words: ALL_CLEAR });
  });

  it('a run waiting on you is yellow, said in words', () => {
    expect(nerveState(fallback(), 'connected', 2, NOW)).toMatchObject({ tone: 'yellow', words: '2 things wait on you' });
    expect(nerveState(fallback(), 'connected', 1, NOW).words).toBe('1 thing waits on you');
  });

  it('no evidence store is red; a warning finding or an unreadable block is yellow', () => {
    const g = fallback().governance as unknown as { kind: 'ok'; governance: Record<string, unknown> };
    expect(nerveState(fallback({ governance: { kind: 'ok', governance: { ...g.governance, store: null } } as never }), 'connected', 0, NOW)).toMatchObject({ tone: 'red', words: 'no evidence store' });
    expect(nerveState(fallback({ governance: { kind: 'ok', governance: { ...g.governance, findings: [{ kind: 'k', severity: 'warning', message: 'm' }] } } as never }), 'connected', 0, NOW)).toMatchObject({ tone: 'yellow', words: 'governance warning' });
    expect(nerveState(fallback({ governance: { kind: 'error', message: 'boom' } }), 'connected', 0, NOW)).toMatchObject({ tone: 'yellow', words: "governance can't be read" });
  });

  it('a crew reporting a status other than ok is yellow', () => {
    expect(nerveState(fallback({ health: { status: 'degraded' } }), 'connected', 0, NOW)).toMatchObject({ tone: 'yellow', words: 'crew reports degraded' });
  });

  it('before the governance read answers it is "checking", not green', () => {
    expect(nerveState(fallback({ governance: { kind: 'unread' } }), 'connected', 0, NOW)).toMatchObject({ tone: 'yellow', read: 'checking' });
  });

  it('a stale governance answer beside a fresh /health is yellow, never the old green (review: codex/agy on #901)', () => {
    expect(nerveState(fallback({ governanceAt: NOW - STALE_MS - 1 }), 'connected', 0, NOW)).toMatchObject({ tone: 'yellow', read: 'stale', words: CANT_REACH });
    expect(nerveState(fallback({ governanceAt: null }), 'connected', 0, NOW)).toMatchObject({ tone: 'yellow', read: 'stale' });
  });

  it('a crew whose diagnostics has no governance block is still green when nothing else is wrong', () => {
    expect(nerveState(fallback({ governance: { kind: 'absent' } }), 'connected', 0, NOW).tone).toBe('green');
  });
});

describe('the snapshot wire, read defensively', () => {
  it('missing fields are absent (null / []), never a fabricated 0 or ok', () => {
    const s = normalizeSnapshot({ attention: [{ title: 'x' }], clis: [{ cli: 'claude', stats: null }], infra: [{ key: 'gateway', state: 'sideways' }], runs: [{ runId: 'r1', liveness: 'Working' }], governance: [{ key: 'judges', value: null }] });
    expect(s.attention[0]).toMatchObject({ level: 'yellow', text: 'x', action: null });
    expect(s.clis[0]).toMatchObject({ key: 'claude', name: 'claude', state: 'unknown', units: null, passPct: null, tokens: null, perDay: [], canSignIn: false });
    expect(s.infra[0]).toMatchObject({ state: 'unknown' });
    // An unknown liveness word is never read as "working".
    expect(s.runs[0]).toMatchObject({ runId: 'r1', liveness: 'quiet', atGate: false });
    expect(s.governance[0]).toMatchObject({ value: 'not counted', state: 'unknown' });
  });

  it('reads the settled wire: severity, source, target and action map to the page', () => {
    const s = normalizeSnapshot({
      checkedAt: '2026-10-25T12:00:00.000Z',
      attention: [{ id: 'run:r9', severity: 'red', source: 'run', title: 'run r9 stalled', reason: 'r', remedy: 'm', blocks: 1, target: { kind: 'run', runId: 'r9', gateOrd: 4 }, action: { kind: 'open_gate', label: 'Open the gate' } },
        { id: 'cli:pi', severity: 'yellow', source: 'cli', title: 'pi signed out', reason: 'r', remedy: 'm', blocks: 0, target: { kind: 'cli', cli: 'pi' }, action: { kind: 'sign_in', label: 'Sign in' } }],
      clis: [{ cli: 'codex', label: 'Codex', state: 'benched', stateReason: 'quota', canSignIn: false, governanceMode: { unscoped: { mode: 'admitted' } }, stats: { units: 3, passPct: 67, medianUnitMs: 1000, rateLimited: 2, fallbacks: 0, perDay: [1, 2], tokens: { input: 10, output: 5 } } }],
      runs: [{ runId: 'r9', liveness: 'held', gate: { interactionId: null, ord: 4, kind: 'escalation', prompt: null }, lastEventAt: '2026-10-25T11:00:00.000Z' }],
      governance: [{ key: 'gates_answered', label: 'Gates answered', state: 'ok', value: 40, breakdown: { you: 9, judges: 31 }, reason: 'r', remedy: null }],
    });
    expect(s.checkedAt).toBe(Date.parse('2026-10-25T12:00:00.000Z'));
    expect(s.attention[0]).toMatchObject({ level: 'red', panel: 'runs', text: 'run r9 stalled', action: { kind: 'open-gate', target: 'r9', ord: 4, label: 'Open the gate' } });
    expect(s.attention[1]).toMatchObject({ panel: 'clis', action: { kind: 'sign-in', target: 'pi' } });
    expect(s.clis[0]).toMatchObject({ name: 'Codex', state: 'benched', reason: 'quota', units: 3, passPct: 67, rateLimited: 2, tokens: 15, governanceMode: 'admitted' });
    expect(s.runs[0]).toMatchObject({ liveness: 'held', gateOrd: 4, atGate: true, lastEventAt: Date.parse('2026-10-25T11:00:00.000Z') });
    expect(s.governance[0]).toMatchObject({ value: '40', breakdown: 'you 9 · judges 31' });
  });

  it('runs sort worst first in crew\'s order: waiting on you, held, stalled, quiet, working', () => {
    const r = (runId: string, liveness: SystemSnapshot['runs'][number]['liveness']) => ({ runId, title: runId, liveness, phase: null, seat: null, lastEventAt: null, reason: null, gateOrd: null, atGate: false });
    expect(runsWorstFirst([r('w', 'working'), r('q', 'quiet'), r('y', 'waiting_on_you'), r('h', 'held'), r('s', 'stalled')]).map((x) => x.runId)).toEqual(['y', 'h', 's', 'q', 'w']);
  });
});

describe('/health lands on Nerve Center', () => {
  it('both addresses name the one page', () => {
    expect(parseRoute('/watch').panel).toBe('watch');
    // `/health` still parses (so App can redirect it, replace) — and its name is Nerve Center's.
    expect(parseRoute('/health').panel).toBe('health');
    expect(pageNameFor('/health')).toBe('Nerve Center');
    expect(pageNameFor('/watch')).toBe('Nerve Center');
  });
});
