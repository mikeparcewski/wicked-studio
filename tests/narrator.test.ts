// DES-RUN-NARRATOR §4-§6: the deterministic narrator — a pure template layer
// (no LLM call) over the run's CoreEvent trail — and the feed composition:
// stable ordering fixed at the source, unit anchors, artifact derivation.

import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import {
  buildFeed,
  deriveArtifacts,
  lastNarration,
  narrate,
  sortFeedEvents,
  type NarratorContext,
} from '../src/components/narrator.js';
import { makeUnit, makeView } from './factories.js';

const ctx: NarratorContext = {
  phaseOf: (ord) => (typeof ord === 'number' ? `phase-${ord}` : 'this phase'),
};

const ev = (bag: Record<string, unknown>): CoreEvent => bag as unknown as CoreEvent;

describe('narrate — the event → status-line templates (§4)', () => {
  const CASES: Array<[Record<string, unknown>, string | RegExp, string]> = [
    [{ type: 'sessionStarted', session: 'r' }, 'Run started', 'work'],
    [{ type: 'workflowSelected', session: 'r', workflowId: 'feature', unitCount: 6 }, 'Workflow "feature" — 6 phases planned', 'info'],
    [{ type: 'unitPlanned', session: 'r', ord: 1, description: 'survey the repo' }, 'Planned phase-1 — survey the repo', 'info'],
    [{ type: 'councilConvened', session: 'r', ord: 1, clis: ['a', 'b', 'c'] }, 'Council convened — polling 3 agents', 'info'],
    [{ type: 'councilDeliberated', session: 'r', ord: 1, round: 2, agreementPct: 50, neededPct: 75 }, 'Ballot 2: 50% — below the 75% bar, runoff', 'info'],
    [{ type: 'councilVoted', session: 'r', ord: 1, agreementPct: 100, votes: 4 }, 'Council voted — 100% agreement (4 votes)', 'info'],
    [{ type: 'councilSeatFailed', session: 'r', ord: 1, cli: 'codex', kind: 'timed_out' }, 'Seat codex did not vote (timed_out)', 'fail'],
    [{ type: 'unitDistributed', session: 'r', ord: 2, cli: 'claude', agreement_pct: 83 }, 'phase-2 routed to claude — council 83%', 'info'],
    [{ type: 'unitDispatched', session: 'r', ord: 2, attempt: 0 }, 'Worker started phase-2', 'work'],
    [{ type: 'unitDispatched', session: 'r', ord: 2, attempt: 1 }, 'phase-2 re-dispatched (attempt 2)', 'work'],
    [{ type: 'unitExecuting', session: 'r', ord: 2 }, 'phase-2 is running', 'work'],
    [{ type: 'unitOutputCaptured', session: 'r', ord: 2, outputBytes: 4096, stepStatus: 'ok' }, 'phase-2 finished — output captured (4 KB)', 'work'],
    [{ type: 'unitOutputCaptured', session: 'r', ord: 2, outputBytes: 10, stepStatus: 'failed' }, 'phase-2 finished with errors', 'fail'],
    [{ type: 'dataUsed', session: 'r', ord: 2, files: ['/a/b.ts', '/a/c.ts'] }, 'phase-2 touched 2 files', 'info'],
    [{ type: 'gateEscalated', session: 'r', ord: 3, condition: 'coverage >= 80%' }, 'Gate approaching — coverage >= 80%', 'gate'],
    [{ type: 'awaitingHuman', session: 'r', ord: 3, prompt: 'Approve the design phase? [internals]' }, 'Gate: waiting on you — Approve the design phase?', 'gate'],
    [{ type: 'gateEvaluated', session: 'r', ord: 2, combined: true }, 'Checks ran on phase-2 — pass', 'work'],
    [{ type: 'gateEvaluated', session: 'r', ord: 2, combined: false, denialReason: 'no tests' }, 'Checks ran on phase-2 — deny: no tests', 'fail'],
    [{ type: 'gateDecided', session: 'r', ord: 2, allow: true }, 'Gate: approved', 'work'],
    [{ type: 'gateDecided', session: 'r', ord: 2, allow: false }, 'Gate: denied', 'fail'],
    [{ type: 'unitReworkAmended', session: 'r', ord: 2, amendment: 'focus on x' }, 'You amended phase-2 — re-dispatching with your note', 'human'],
    [{ type: 'unitDone', session: 'r', ord: 2 }, 'phase-2 approved and done', 'work'],
    [{ type: 'unitDenied', session: 'r', ord: 2 }, 'phase-2 denied', 'fail'],
    [{ type: 'unitReassigned', session: 'r', ord: 2, previousCli: 'codex', newCli: 'claude' }, 'phase-2 reassigned codex → claude', 'info'],
    [{ type: 'resumed', session: 'r' }, 'Run resumed', 'work'],
    [{ type: 'stepFailed', session: 'r', ord: 2, detail: 'worker exited 1\nstack…' }, 'Step failed on phase-2 — worker exited 1', 'fail'],
    [{ type: 'crashRecoveryRedrive', session: 'r', ord: 2, attempt: 2 }, 'Engine restarted — re-dispatching phase-2 (attempt 2)', 'fail'],
    [{ type: 'workerStalled', session: 'r', ord: 2, stalledSecs: 120 }, /Worker quiet for 120s/, 'gate'],
    [{ type: 'failureTriaged', session: 'r', decision: 'retry', analysis: 'transient' }, 'Failure triaged: retry — transient', 'info'],
    [{ type: 'workerMessageQueued', session: 'r', target: 'claude', message: 'hi' }, "Your message is queued for claude's next turn", 'human'],
    [{ type: 'workerMessageInjected', session: 'r', target: 'all', message: 'hi' }, 'Your message was delivered to all', 'human'],
    [{ type: 'elicitationCreated', session: 'r', elicitationId: 'e1', message: 'Which db?' }, 'The agent asks: Which db?', 'gate'],
    [{ type: 'elicitationResolved', session: 'r' }, 'Answer sent — the agent continues', 'human'],
    [{ type: 'governanceHookFired', session: 'r', ord: 2, decision: 'deny', denyingPolicy: 'POL-1' }, 'Blocked a tool call — POL-1', 'fail'],
    [{ type: 'governanceUnenforced', session: 'r', ord: 2, cli: 'codex' }, 'Governance was requested but is not enforced for codex', 'gate'],
    [{ type: 'sessionCompleted', session: 'r' }, 'Run completed', 'work'],
    [{ type: 'sessionFailed', session: 'r' }, 'Run failed', 'fail'],
    [{ type: 'runCancelled', session: 'r' }, 'Run cancelled', 'info'],
    [{ type: 'error', session: 'r', message: 'boom' }, 'Error: boom', 'fail'],
  ];

  it.each(CASES)('narrates %j', (bag, expected, tone) => {
    const line = narrate(ev(bag), ctx);
    expect(line).not.toBeNull();
    if (typeof expected === 'string') expect(line!.text).toBe(expected);
    else expect(line!.text).toMatch(expected);
    expect(line!.tone).toBe(tone);
  });

  it('unitPlanned strips the daemon\'s duplicated "<phase> — " description prefix', () => {
    const line = narrate(
      ev({ type: 'unitPlanned', session: 'r', ord: 1, description: 'phase-1 — survey the repo' }),
      ctx,
    );
    expect(line!.text).toBe('Planned phase-1 — survey the repo');
  });

  it('unitPlanned drops a description that merely restates the run intent (ctx.intent)', () => {
    const intent = 'Implement GitHub issue #167 in this repo: the doc-creation wizard project picker lists stale projects';
    const withIntent: NarratorContext = { ...ctx, intent };
    // The daemon truncates the restated intent per-unit; head-match still catches it.
    const line = narrate(
      ev({ type: 'unitPlanned', session: 'r', ord: 2, description: `phase-2 — ${intent.slice(0, 80)}` }),
      withIntent,
    );
    expect(line!.text).toBe('Planned phase-2');
    // A REAL description (not the intent) survives untouched.
    const real = narrate(
      ev({ type: 'unitPlanned', session: 'r', ord: 3, description: 'write the acceptance test plan for the picker' }),
      withIntent,
    );
    expect(real!.text).toBe('Planned phase-3 — write the acceptance test plan for the picker');
  });

  it('stays silent on noise frames (deltas, heartbeat, terminal bytes, burn, allow-hooks, unknown)', () => {
    for (const bag of [
      { type: 'unitOutputDelta', session: 'r', ord: 0, text: 'x' },
      { type: 'cliOutputDelta', session: 'r', ord: 0, chunk: 'x' },
      { type: 'heartbeat' },
      { type: 'terminalOutput', id: 't1', bytesB64: 'eA==' },
      { type: 'cliUsage', session: 'r', ord: 0, attempt: 0, inputTokens: 1, outputTokens: 1, costUsd: null },
      { type: 'governanceHookFired', session: 'r', ord: 0, decision: 'allow', denyingPolicy: null },
      { type: 'someFutureFrame', session: 'r' },
    ]) {
      expect(narrate(ev(bag), ctx)).toBeNull();
    }
  });
});

describe('sortFeedEvents — ordering fixed at the source (§3)', () => {
  it('sorts recorded frames (ts+seq) by seq even when they arrive out of order', () => {
    const events = [
      ev({ type: 'unitDone', session: 'r', ord: 1, ts: 3, seq: 30 }),
      ev({ type: 'sessionStarted', session: 'r', ts: 1, seq: 10 }),
      ev({ type: 'unitDispatched', session: 'r', ord: 1, attempt: 0, ts: 2, seq: 20 }),
    ];
    expect(sortFeedEvents(events).map((e) => e.type)).toEqual([
      'sessionStarted',
      'unitDispatched',
      'unitDone',
    ]);
  });

  it('never scrambles live frames (no comparable clock — arrival IS the order)', () => {
    const events = [
      ev({ type: 'unitDispatched', session: 'r', ord: 1, attempt: 0 }),
      ev({ type: 'gateDecided', session: 'r', ord: 1, allow: true }),
      ev({ type: 'unitDone', session: 'r', ord: 1 }),
    ];
    expect(sortFeedEvents(events).map((e) => e.type)).toEqual([
      'unitDispatched',
      'gateDecided',
      'unitDone',
    ]);
  });

  it('keeps the recorded prefix + live tail interleave stable', () => {
    const events = [
      ev({ type: 'sessionStarted', session: 'r', ts: 1, seq: 2 }),
      ev({ type: 'unitPlanned', session: 'r', ord: 1, description: 'd', ts: 1, seq: 1 }),
      ev({ type: 'unitDone', session: 'r', ord: 1 }), // live — stays last
    ];
    expect(sortFeedEvents(events).map((e) => e.type)).toEqual([
      'unitPlanned',
      'sessionStarted',
      'unitDone',
    ]);
  });
});

describe('buildFeed — the one chronological stream (§5)', () => {
  const units = [
    makeUnit({ id: 'run-1:survey', ord: 1, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
    makeUnit({ id: 'run-1:build', ord: 2, stage: 'build', status: 'distributed', assigned_cli: 'claude' }),
    makeUnit({ id: 'run-1:review', ord: 3, stage: 'review', status: 'pending' }),
  ];

  it('anchors a spoken unit group after its LAST narration line', () => {
    const events = [
      ev({ type: 'unitDispatched', session: 'run-1', ord: 1, attempt: 0, ts: 1, seq: 1 }),
      ev({ type: 'unitOutputCaptured', session: 'run-1', ord: 1, outputBytes: 10, stepStatus: 'ok', ts: 2, seq: 2 }),
      ev({ type: 'unitDispatched', session: 'run-1', ord: 2, attempt: 0, ts: 3, seq: 3 }),
    ];
    const feed = buildFeed(events, units, 2, ctx);
    const kinds = feed.map((i) => (i.kind === 'unit' ? `unit${i.ord}` : i.kind === 'line' ? i.line.text : 'artifact'));
    expect(kinds).toEqual([
      'Worker started phase-1',
      'phase-1 finished — output captured (1 KB)',
      'unit1', // after its last line
      'Worker started phase-2',
      'unit2', // the cursor unit, after its dispatch line
    ]);
  });

  it('renders sorted even when the trail arrives out of order', () => {
    const events = [
      ev({ type: 'unitDispatched', session: 'run-1', ord: 2, attempt: 0, ts: 3, seq: 3 }),
      ev({ type: 'unitDispatched', session: 'run-1', ord: 1, attempt: 0, ts: 1, seq: 1 }),
      ev({ type: 'unitOutputCaptured', session: 'run-1', ord: 1, outputBytes: 10, stepStatus: 'ok', ts: 2, seq: 2 }),
    ];
    const feed = buildFeed(events, units, 2, ctx);
    const lines = feed.filter((i) => i.kind === 'line').map((i) => (i.kind === 'line' ? i.line.text : ''));
    expect(lines).toEqual([
      'Worker started phase-1',
      'phase-1 finished — output captured (1 KB)',
      'Worker started phase-2',
    ]);
  });

  it('appends unspoken units (empty trail) in ord order — queued units get nothing', () => {
    const feed = buildFeed([], units, 2, ctx);
    expect(feed.map((i) => (i.kind === 'unit' ? i.ord : null))).toEqual([1, 2]); // never ord 3 (pending)
  });

  it('rides artifact cards behind the dataUsed line that produced them, deduped', () => {
    const events = [
      ev({ type: 'dataUsed', session: 'run-1', ord: 1, files: ['/w/src/a.ts', '/w/src/b.ts'], ts: 1, seq: 1 }),
      ev({ type: 'dataUsed', session: 'run-1', ord: 2, files: ['/w/src/a.ts'], ts: 2, seq: 2 }), // duplicate path
    ];
    const feed = buildFeed(events, units, null, ctx);
    const artifacts = feed.filter((i) => i.kind === 'artifact');
    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((a) => (a.kind === 'artifact' ? a.artifact.name : ''))).toEqual(['a.ts', 'b.ts']);
  });
});

describe('deriveArtifacts (§6)', () => {
  it('collects dataUsed files (deduped, first-seen order) and the delivered PR', () => {
    const events = [
      ev({ type: 'dataUsed', session: 'run-1', ord: 1, files: ['/w/a.ts', '/w/b.ts'] }),
      ev({ type: 'dataUsed', session: 'run-1', ord: 2, files: ['/w/a.ts', '/w/c.ts'] }),
    ];
    const view = makeView({ status: 'completed' });
    (view.session as unknown as Record<string, unknown>)['delivery'] = { kind: 'pull_request', url: 'https://github.com/x/y/pull/7' };
    const artifacts = deriveArtifacts(events, view, ctx);
    expect(artifacts.map((a) => a.ref)).toEqual(['/w/a.ts', '/w/b.ts', '/w/c.ts', 'https://github.com/x/y/pull/7']);
    expect(artifacts[3]!.kind).toBe('pr');
    expect(artifacts[0]!.name).toBe('a.ts');
  });
});

describe('lastNarration — the now-bar line (§2)', () => {
  it('returns the newest SPOKEN line, skipping silent frames', () => {
    const events = [
      ev({ type: 'sessionStarted', session: 'r', ts: 1, seq: 1 }),
      ev({ type: 'unitDispatched', session: 'r', ord: 1, attempt: 0, ts: 2, seq: 2 }),
      ev({ type: 'cliUsage', session: 'r', ord: 1, attempt: 0, inputTokens: 1, outputTokens: 1, costUsd: null, ts: 3, seq: 3 }),
    ];
    expect(lastNarration(events, ctx)?.text).toBe('Worker started phase-1');
  });

  it('is null on a silent trail', () => {
    expect(lastNarration([], ctx)).toBeNull();
  });
});
