// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import type { CoreEvent, SessionView } from '../src/api/types.js';
import type { WatchFinding, WatchFindingCleared } from '../src/api/watch-wire.js';
import {
  EMPTY_WATCH, coverageLine, coverageSummary, foldCleared, foldFeed, foldFinding, foldRuns, foldTeamFrame, foldTrail, foldWatchFrame, foldWatchdog,
  gateLine, jumpPath, orphanedRuns, parseJump, runPath, useWatchStore, watchFeed,
} from '../src/store/watch.js';

/**
 * TR-W8 (DES-TRIGGER-REGISTRY-001 §4.10, §9): the Watchtower's fold over its four inputs — watch
 * findings (frames + GET /watch), the stall watchdog, team findings, and the run list.
 */

function finding(over: Partial<WatchFinding> = {}): WatchFinding {
  return {
    run_id: 'r-88', ord: 5, attempt: 1, by: 'watch:claim-vs-evidence@1', at: 1_000, re: 'repoChecksEvaluated#5:1',
    watch_id: 'w-1', entry_id: 'claim-vs-evidence', entry_version: 1, check: 'deterministic:claim_vs_evidence',
    kind: 'finding', severity: 'medium', watch_kind: 'problem', attach: null, project_id: 'kes',
    sentence: 'The error-states step handed back as finished; its own checks failed (lint).',
    facts: {}, anchor: { run_id: 'r-88', ord: 5, attempt: 1, at: 900 }, evidence: [], model: null, rolled_up: 0,
    ...over,
  };
}
function cleared(watchId: string, extra: Partial<WatchFindingCleared> & { reason: WatchFindingCleared['reason'] }): WatchFindingCleared {
  return {
    run_id: 'r-88', ord: 5, attempt: 2, by: 'watch:claim-vs-evidence@1', at: 2_000, re: 'x', watch_id: watchId,
    entry_id: 'claim-vs-evidence', entry_version: 1, ...extra,
  } as WatchFindingCleared;
}
const frame = (event_type: string, payload: unknown) => ({ type: 'watchEvent', event: { event_id: 1, event_type, payload } });

describe('watch findings', () => {
  it('a raised row is a Problem; its resolved clearing turns it Fixed', () => {
    let f = foldWatchFrame(EMPTY_WATCH, frame('wicked.crew.watch_finding.raised', finding()));
    expect(watchFeed(f).map((r) => [r.id, r.kind, r.state])).toStrictEqual([['w-1', 'problem', 'open']]);
    f = foldWatchFrame(f, frame('wicked.crew.watch_finding.cleared', cleared('w-1', { reason: 'resolved' })));
    expect(f.rows['w-1']!.state).toBe('fixed');
    expect(f.rows['w-1']!.stateLine).toBe('Fixed');
  });

  it('a dismissal says who; a replayed raise keeps the cleared state', () => {
    let f = foldFinding(EMPTY_WATCH, finding());
    f = foldCleared(f, cleared('w-1', { reason: 'dismissed', dismissed_by: 'person:local' } as never));
    f = foldFinding(f, finding());
    expect(f.rows['w-1']!.state).toBe('dismissed');
    expect(f.rows['w-1']!.stateLine).toBe('Dismissed by person:local');
  });

  it('a clearing that arrives before its raise is kept and applied', () => {
    let f = foldCleared(EMPTY_WATCH, cleared('w-1', { reason: 'resolved' }));
    expect(watchFeed(f)).toStrictEqual([]);
    f = foldFinding(f, finding());
    expect(f.rows['w-1']!.state).toBe('fixed');
    expect(f.pendingClears).toStrictEqual({});
  });

  it('roll-up: the replaced rows fold into the roll-up row, which shows its count', () => {
    let f = foldFinding(EMPTY_WATCH, finding({ watch_id: 'w-a', entry_id: 'scope-drift', at: 1 }));
    f = foldFinding(f, finding({ watch_id: 'w-b', entry_id: 'scope-drift', at: 2 }));
    f = foldFinding(f, finding({ watch_id: 'w-roll', entry_id: 'scope-drift', at: 3, rolled_up: 7, sentence: 'Changed 7 more files outside the plan.' }));
    f = foldCleared(f, cleared('w-a', { reason: 'rolled_up', replaced_by: 'w-roll' } as never));
    f = foldCleared(f, cleared('w-b', { reason: 'rolled_up', replaced_by: 'w-roll' } as never));
    expect(watchFeed(f).map((r) => [r.id, r.rolledUp])).toStrictEqual([['w-roll', 7]]);
  });

  it('a late join folds GET /watch as the live frames would have', () => {
    const f = foldFeed(EMPTY_WATCH, { findings: [finding(), finding({ watch_id: 'w-2', at: 5_000 })], cleared: [cleared('w-1', { reason: 'resolved' })] });
    expect(watchFeed(f).map((r) => [r.id, r.state])).toStrictEqual([['w-2', 'open'], ['w-1', 'fixed']]);
  });

  it('a gate-attached finding is one quiet line on the gate, never a feed row', () => {
    const f = foldFinding(EMPTY_WATCH, finding({ watch_id: 'w-g', attach: 'gate', ord: 5, watch_kind: 'decision', sentence: 'This asks you to push to origin; the plan delivers to acme/web.' }));
    expect(watchFeed(f)).toStrictEqual([]);
    expect(gateLine(f, 'r-88')).toBe('This asks you to push to origin; the plan delivers to acme/web.');
    expect(gateLine(f, 'r-other')).toBeNull();
    // Scoped to the gate it was raised on: a later gate on the same run does not carry it (codex).
    expect(gateLine(f, 'r-88', 5)).toBe('This asks you to push to origin; the plan delivers to acme/web.');
    expect(gateLine(f, 'r-88', 9)).toBeNull();
    expect(gateLine(foldCleared(f, cleared('w-g', { reason: 'resolved' })), 'r-88')).toBeNull();
  });

  it('filters by project and kind', () => {
    let f = foldFinding(EMPTY_WATCH, finding({ watch_id: 'w-k', project_id: 'kes' }));
    f = foldFinding(f, finding({ watch_id: 'w-o', project_id: 'other', watch_kind: 'quiet' }));
    expect(watchFeed(f, { project: 'kes' }).map((r) => r.id)).toStrictEqual(['w-k']);
    expect(watchFeed(f, { kind: 'quiet' }).map((r) => r.id)).toStrictEqual(['w-o']);
  });
});

describe('the stall watchdog', () => {
  it('a stall is one Gone quiet row per quiet period, Fixed when the run speaks again', () => {
    let f = foldWatchdog(EMPTY_WATCH, { type: 'workerStalled', session: 'r-1', ord: 2, quietForMs: 18 * 60_000 }, 100);
    f = foldWatchdog(f, { type: 'workerStalled', session: 'r-1', ord: 2, quietForMs: 19 * 60_000 }, 200);
    expect(watchFeed(f).map((r) => [r.kind, r.sentence, r.state])).toStrictEqual([['quiet', 'Nothing new from this run in 18 minutes', 'open']]);
    f = foldWatchdog(f, { type: 'unitOutputDelta', session: 'r-1', ord: 2, text: 'x' }, 300);
    expect(f.rows['quiet:r-1:1']!.state).toBe('fixed');
    expect(f.rows['quiet:r-1:1']!.stateLine).toBe('Moving again');
    f = foldWatchdog(f, { type: 'workerStalled', session: 'r-1', quietForMs: 60_000 }, 400);
    expect(Object.keys(f.rows).sort()).toStrictEqual(['quiet:r-1:1', 'quiet:r-1:2']);
  });

  it('a recovered reassign says where it went; a failed one stays open and says so', () => {
    let f = foldWatchdog(EMPTY_WATCH, { type: 'workerStalled', session: 'r-1', quietForMs: 60_000 }, 1);
    f = foldWatchdog(f, { type: 'workerStallEscalated', session: 'r-1', quietForMs: 1, action: 'reassign', outcome: 'ok', needsYou: false, cli: 'codex' }, 2);
    expect(f.rows['quiet:r-1:1']!.stateLine).toBe('Restarted on codex');
    let g = foldWatchdog(EMPTY_WATCH, { type: 'workerStalled', session: 'r-2', quietForMs: 60_000 }, 1);
    g = foldWatchdog(g, { type: 'workerStallEscalated', session: 'r-2', quietForMs: 1, action: 'notify', outcome: 'ok', needsYou: true }, 2);
    expect(g.rows['quiet:r-2:1']!.state).toBe('open');
    expect(g.rows['quiet:r-2:1']!.stateLine).toBe('Studio could not get it moving again');
  });

  it('frames for runs with no stall change nothing', () => {
    expect(foldWatchdog(EMPTY_WATCH, { type: 'unitOutputDelta', session: 'r-9' }, 1)).toBe(EMPTY_WATCH);
  });
});

describe('team findings and corroboration', () => {
  const team = (event_type: string, payload: Record<string, unknown>) => ({ type: 'teamEvent', event: { event_id: 7, event_type, payload } });
  const raised = team('wicked.team.finding.raised', {
    run_id: 'r-88', ord: 5, attempt: 1, at: 1_500, finding_id: 'f-1', severity: 'high', path: 'src/pay.ts', line: 42,
    claim: 'model prose that is never shown', corroborated_by: [],
  });

  it('a raised team finding is a Problem in template words, never the reviewer’s prose', () => {
    const f = foldTeamFrame(EMPTY_WATCH, raised);
    const row = f.rows['team:f-1']!;
    expect(row.sentence).toBe('A reviewer raised a serious problem in src/pay.ts:42');
    expect(row.sentence).not.toContain('prose');
  });

  it('settled: withdrawn is dismissed, superseded is fixed', () => {
    const f = foldTeamFrame(EMPTY_WATCH, raised);
    expect(foldTeamFrame(f, team('wicked.team.finding.settled', { finding_id: 'f-1', status: 'withdrawn' })).rows['team:f-1']!.state).toBe('dismissed');
    expect(foldTeamFrame(f, team('wicked.team.finding.settled', { finding_id: 'f-1', status: 'superseded' })).rows['team:f-1']!.state).toBe('fixed');
  });

  it('a watch flag on the same (run, ord, attempt, path) attaches as corroborated_by, either order', () => {
    const flag = finding({ watch_id: 'w-drift', entry_id: 'scope-drift', kind: 'flag', facts: { path: 'src/pay.ts' } });
    for (const f of [foldFinding(foldTeamFrame(EMPTY_WATCH, raised), flag), foldTeamFrame(foldFinding(EMPTY_WATCH, flag), raised)]) {
      expect(f.rows['team:f-1']!.corroboratedBy).toStrictEqual(['w-drift']);
      expect(watchFeed(f).map((r) => r.id)).toStrictEqual(['team:f-1']);
    }
    // Only a FLAG corroborates; a watch finding on the same place stays its own row (codex).
    const own = finding({ watch_id: 'w-own', kind: 'finding', facts: { path: 'src/pay.ts' } });
    const g = foldFinding(foldTeamFrame(EMPTY_WATCH, raised), own);
    expect(g.rows['team:f-1']!.corroboratedBy).toStrictEqual([]);
    expect(watchFeed(g).map((r) => r.id).sort()).toStrictEqual(['team:f-1', 'w-own']);
    const elsewhere = finding({ watch_id: 'w-x', kind: 'flag', facts: { path: 'src/other.ts' } });
    expect(foldFinding(foldTeamFrame(EMPTY_WATCH, raised), elsewhere).rows['team:f-1']!.corroboratedBy).toStrictEqual([]);
  });
});

describe('the run list: Finished and Delivered', () => {
  const run = (id: string, status: string, delivery?: string, ended = 3_000): SessionView =>
    ({ session: { id, status, problem: id, ended_at: ended, ...(delivery ? { delivery } : {}) }, units: [] }) as unknown as SessionView;

  it('rows that arrived without a project take their run’s project from the run list (Copilot)', () => {
    let f = foldWatchdog(EMPTY_WATCH, { type: 'workerStalled', session: 'r-q', quietForMs: 60_000 }, 1);
    expect(watchFeed(f, { project: 'kes' })).toStrictEqual([]);
    f = foldRuns(f, [run('r-q', 'executing')], () => 'kes');
    expect(watchFeed(f, { project: 'kes' }).map((r) => r.id)).toStrictEqual(['quiet:r-q:1']);
  });

  it('a finished run is Finished; a delivered one adds Delivered; folding again changes nothing', () => {
    const f = foldRuns(EMPTY_WATCH, [run('a', 'completed', 'delivered'), run('b', 'executing'), run('c', 'completed')], () => 'kes');
    expect(watchFeed(f).map((r) => r.id).sort()).toStrictEqual(['delivered:a', 'finished:a', 'finished:c']);
    expect(f.rows['finished:a']!.projectId).toBe('kes');
    expect(foldRuns(f, [run('a', 'completed', 'delivered')])).toBe(f);
  });
});

describe('jump in, coverage, the store', () => {
  it('Copilot r2: no jump without a unit to land on; a legacy delivery object still reads Delivered', () => {
    expect(jumpPath({ runId: 'r-1', anchor: { run_id: 'r-1', ord: null, attempt: null, at: 5 } })).toBeNull();
    expect(jumpPath({ runId: 'r-1', anchor: null })).toBeNull();
    expect(runPath({ runId: 'r-1', anchor: null })).toBe('/runs/r-1');
    const legacy = { session: { id: 'old', status: 'completed', problem: 'x', ended_at: 9, delivery: { kind: 'pull_request', url: 'https://github.com/a/b/pull/1' } }, units: [] } as unknown as SessionView;
    expect(foldRuns(EMPTY_WATCH, [legacy]).rows['delivered:old']?.sentence).toBe('Delivered');
  });

  it('jump paths round-trip', () => {
    const p = jumpPath({ runId: 'r-88', anchor: { run_id: 'r-88', ord: 5, attempt: 1, at: 900 } })!;
    expect(p).toBe('/runs/r-88?jump=5:1:900');
    expect(parseJump(p.slice(p.indexOf('?')))).toStrictEqual({ ord: 5, attempt: 1, at: 900 });
    expect(parseJump('?x=1')).toBeNull();
  });

  it('coverage: never "all clear" when an entry was not checked', () => {
    expect(coverageLine([{ entry_id: 'scope-drift', state: 'not_checked', reason: 'no declared scope' }, { entry_id: 'claim-vs-evidence', state: 'checked' }], () => 'scope'))
      .toBe('Not checked on this run: scope (no declared scope)');
    expect(coverageLine([{ entry_id: 'claim-vs-evidence', state: 'checked' }])).toBeNull();
    expect(coverageLine(undefined)).toBeNull();
  });

  it('the store routes each frame to its input', () => {
    useWatchStore.getState().reset();
    useWatchStore.getState().ingest(frame('wicked.crew.watch_finding.raised', finding()) as never);
    useWatchStore.getState().ingest({ type: 'workerStalled', session: 'r-2', quietForMs: 60_000 });
    expect(watchFeed(useWatchStore.getState().fold).map((r) => r.kind).sort()).toStrictEqual(['problem', 'quiet']);
  });
});

describe('coverageSummary (S17c)', () => {
  const NOW = 1_700_000_000_000;
  const NOT_CHECKED = (id: string, reason: string) => ({ entry_id: id, state: 'not_checked' as const, reason });
  const CHECKED = (id: string) => ({ entry_id: id, state: 'checked' as const });

  it('A1: terminal + all not_checked → one no-evidence line with reasons', () => {
    const result = coverageSummary(
      [NOT_CHECKED('scope-drift', 'no declared scope'), NOT_CHECKED('claim-vs-evidence', 'no evidence file')],
      true, NOW - 120_000, undefined, NOW,
    );
    expect(result?.line).toBe('No governance evidence was recorded for this run — it ended 2 min ago');
    expect(result?.reasons).toStrictEqual(['scope-drift (no declared scope)', 'claim-vs-evidence (no evidence file)']);
  });

  it('A2: terminal + empty list → no-evidence line, empty reasons', () => {
    const result = coverageSummary([], true, NOW - 120_000, undefined, NOW);
    expect(result?.line).toMatch(/^No governance evidence was recorded for this run/);
    expect(result?.reasons).toStrictEqual([]);
  });

  it('A3: live run → delegates to coverageLine', () => {
    const result = coverageSummary(
      [NOT_CHECKED('scope-drift', 'no declared scope')],
      false, null, undefined, NOW,
    );
    expect(result?.line).toMatch(/^Not checked on this run:/);
    expect(result?.reasons).toStrictEqual([]);
  });

  it('A4: undefined (absent registry) → null', () => {
    expect(coverageSummary(undefined, true, NOW - 120_000, undefined, NOW)).toBeNull();
  });

  it('terminal + has a checked entry → null (evidence exists)', () => {
    const result = coverageSummary(
      [NOT_CHECKED('scope-drift', 'no declared scope'), CHECKED('claim-vs-evidence')],
      true, NOW - 120_000, undefined, NOW,
    );
    expect(result).toBeNull();
  });
});

describe('a run the daemon restart orphaned (studio#545 / crew#830)', () => {
  const LINE = 'The daemon restarted while this step was running; nothing is working on it.';
  const trail: CoreEvent[] = [
    { type: 'sessionStarted', session: 'r-o', ts: 1_000, seq: 1 },
    { type: 'unitDispatched', session: 'r-o', ord: 1, ts: 2_000, seq: 2 },
    { type: 'runOrphaned', session: 'r-o', ord: 1, ts: 9_000, seq: 3 },
  ];
  afterEach(() => { vi.restoreAllMocks(); useWatchStore.getState().reset(); });

  it('the live report opens one row at its clock; a second report changes nothing; the next dispatch turns it Resumed', () => {
    let f = foldWatchdog(EMPTY_WATCH, { type: 'runOrphaned', session: 'r-o', ord: 1 }, 100);
    expect(watchFeed(f).map((r) => [r.id, r.kind, r.sentence, r.state, r.at, r.ord])).toStrictEqual([['orphan:r-o', 'quiet', LINE, 'open', 100, 1]]);
    expect(foldWatchdog(f, { type: 'runOrphaned', session: 'r-o', ord: 1 }, 200)).toBe(f);
    expect(orphanedRuns(f)).toStrictEqual({ 'r-o': 100 });
    f = foldWatchdog(f, { type: 'unitDispatched', session: 'r-o', ord: 1, cli: 'claude' }, 300);
    expect(f.rows['orphan:r-o']!.state).toBe('fixed');
    expect(f.rows['orphan:r-o']!.stateLine).toBe('Resumed');
    expect(orphanedRuns(f)).toStrictEqual({});
  });

  it('the report does not touch an open Gone quiet row; a dispatch closes both', () => {
    let f = foldWatchdog(EMPTY_WATCH, { type: 'workerStalled', session: 'r-o', ord: 1, quietForMs: 60_000 }, 1);
    f = foldWatchdog(f, { type: 'runOrphaned', session: 'r-o', ord: 1 }, 2);
    expect(f.rows['quiet:r-o:1']!.state).toBe('open');
    expect(f.rows['orphan:r-o']!.state).toBe('open');
    f = foldWatchdog(f, { type: 'unitDispatched', session: 'r-o', ord: 1 }, 3);
    expect([f.rows['quiet:r-o:1']!.state, f.rows['orphan:r-o']!.state]).toStrictEqual(['fixed', 'fixed']);
  });

  it('the durable trail (a late join): ending on the report opens the row at the report\'s clock; a dispatch after it closes an open row', () => {
    let f = foldTrail(EMPTY_WATCH, 'r-o', trail, 50_000);
    expect(orphanedRuns(f)).toStrictEqual({ 'r-o': 9_000 });
    expect(foldTrail(f, 'r-o', trail, 60_000)).toBe(f);
    f = foldTrail(f, 'r-o', [...trail, { type: 'unitDispatched', session: 'r-o', ord: 1, ts: 10_000, seq: 4 }], 60_000);
    expect(f.rows['orphan:r-o']!.state).toBe('fixed');
    // A trail without the report says nothing: no row opens, and a row a LIVE frame opened stays (codex r1 #2).
    expect(foldTrail(EMPTY_WATCH, 'r-x', trail.slice(0, 2), 1)).toBe(EMPTY_WATCH);
    const live = foldWatchdog(EMPTY_WATCH, { type: 'runOrphaned', session: 'r-o', ord: 1 }, 100);
    expect(foldTrail(live, 'r-o', trail.slice(0, 2), 200)).toBe(live);
    expect(foldTrail(live, 'r-o', [], 200)).toBe(live);
  });

  it('the run list closes the row when the run is no longer executing', () => {
    const f = foldWatchdog(EMPTY_WATCH, { type: 'runOrphaned', session: 'r-o', ord: 1 }, 100);
    const cancelled = { session: { id: 'r-o', status: 'cancelled' }, units: [] } as unknown as SessionView;
    const g = foldRuns(f, [cancelled]);
    expect(g.rows['orphan:r-o']!.state).toBe('fixed');
    expect(g.rows['orphan:r-o']!.stateLine).toBe('Ended (cancelled)');
    const executing = { session: { id: 'r-o', status: 'executing' }, units: [] } as unknown as SessionView;
    expect(foldRuns(f, [executing])).toBe(f);
  });

  it('the store reads each executing run\'s trail once and folds the verdict; a terminal run is never asked', async () => {
    const read = vi.spyOn(api, 'getRunEvents').mockImplementation((id) => Promise.resolve({ events: id === 'r-o' ? trail : [] }));
    const runs = [
      { session: { id: 'r-o', status: 'executing' }, units: [] },
      { session: { id: 'r-live', status: 'executing' }, units: [] },
      { session: { id: 'r-done', status: 'completed' }, units: [] },
    ] as unknown as SessionView[];
    useWatchStore.getState().runs(runs);
    useWatchStore.getState().runs(runs);
    await vi.waitFor(() => expect(orphanedRuns(useWatchStore.getState().fold)).toStrictEqual({ 'r-o': 9_000 }));
    expect(read.mock.calls.map((c) => c[0]).sort()).toStrictEqual(['r-live', 'r-o']);
  });
});
