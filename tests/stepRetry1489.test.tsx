/**
 * studio#1489: a step that failed and is being tried again says so in the header and the Now panel, in closed words.
 *
 * The record is train-17 cert J6 v3 run B: the run's whole log as GET /runs/:id/events served it
 * (tests/fixtures/j6-t17-step-retry-1489.json). Step 1 failed at attempt 0 (seq 1590, workerError), the triage judge
 * said retry (1592), and attempt 1 ran (1593) until it finished (1679). The page said only "No output for N min".
 */
import { describe, expect, it } from 'vitest';
import { retryBadge, retryLine, stepRetry } from '../src/board/stepRetry.js';
import { makeUnit, makeView } from './factories.js';
import certLog from './fixtures/j6-t17-step-retry-1489.json';

const CERT = certLog as unknown as { runId: string; events: Array<Record<string, unknown>> };
const RUN = CERT.runId;
const upTo = (seq: number) => CERT.events.filter((e) => (e['seq'] as number) <= seq && e['type'] !== 'workerStalled');
const run = (status = 'executing', u1: 'distributed' | 'done' = 'distributed') => makeView({ id: RUN, status: status as never, unit_ix: 0, problem: 'Extract the business rules', created_at: 1_700_000_000 } as never, [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: u1, phase_ref: 'domain-run', stage: 'recon', assigned_cli: 'bash' }),
  makeUnit({ id: `${RUN}:u2`, session_id: RUN, ord: 2, status: 'distributed', phase_ref: 'domain-graph', stage: 'build', assigned_cli: 'wicked-core' }),
]);

describe('studio#1489: stepRetry (the reader)', () => {
  it('reads the cert log at the shot as step 1 on attempt 2 after a helper failure', () => {
    expect(stepRetry(run(), upTo(1595))).toEqual({ ord: 1, attempt: 1, kind: 'workerError' });
    expect(retryLine({ ord: 1, attempt: 1, kind: 'workerError' }, 'Research', null)).toBe('Research failed (a helper could not finish it); trying it again · attempt 2');
    expect(retryBadge({ ord: 1, attempt: 1, kind: 'workerError' }, 10)).toBe('Trying again · attempt 2 · no output for 10 min');
    expect(retryBadge({ ord: 1, attempt: 1, kind: 'workerError' }, null)).toBe('Trying again · attempt 2');
  });

  it('STALE READS: not yet re-dispatched, finished on the log, or done on the run view: no retry words', () => {
    expect(stepRetry(run(), upTo(1592))).toBeNull();
    expect(stepRetry(run(), upTo(1679))).toBeNull();
    // The run view says the step is done, over a log that has not caught up.
    expect(stepRetry(run('executing', 'done'), upTo(1595))).toBeNull();
    expect(stepRetry(run('completed'), CERT.events)).toBeNull();
  });

  it('IDENTITY REUSE: the attempt is the key; an old dispatch copied late never rolls it back, and a second retry supersedes', () => {
    const late = [...upTo(1595), { type: 'unitDispatched', session: RUN, ord: 1, attempt: 0, baseSkill: null }];
    expect(stepRetry(run(), late)).toMatchObject({ ord: 1, attempt: 1 });
    const again = [...upTo(1595), { type: 'stepFailed', session: RUN, ord: 1, attempt: 1, failureKind: 'timeout', detail: 'x' },
      { type: 'failureTriaged', session: RUN, ord: 1, decision: 'retry', analysis: 'y' }, { type: 'unitDispatched', session: RUN, ord: 1, attempt: 2 }];
    expect(stepRetry(run(), again)).toEqual({ ord: 1, attempt: 2, kind: 'timeout' });
    // Attempt 1 failed and nothing has been dispatched since: that is not a retry running.
    expect(stepRetry(run(), again.slice(0, -1))).toBeNull();
  });

  it('PARTIAL FAILURE: no log, a triage that is not retry, or no triage at all makes no retry claim', () => {
    expect(stepRetry(run(), null)).toBeNull();
    const swap = (decision: string) => upTo(1595).map((e) => (e['type'] === 'failureTriaged' ? { ...e, decision } : e));
    expect(stepRetry(run(), swap('fail'))).toBeNull();
    expect(stepRetry(run(), swap('escalate'))).toBeNull();
    expect(stepRetry(run(), upTo(1595).filter((e) => e['type'] !== 'failureTriaged'))).toBeNull();
    expect(stepRetry(run('awaiting_human'), upTo(1595))).toBeNull();
  });

  it('UNTRUSTED TEXT OUT: the judge’s analysis and the worker’s detail never reach the words; an unknown kind names no cause', () => {
    const marked = upTo(1595).map((e) => (e['type'] === 'failureTriaged' ? { ...e, analysis: 'MARKER-ANALYSIS <b>x</b>' }
      : e['type'] === 'stepFailed' ? { ...e, detail: 'MARKER-DETAIL', failureKind: 'somethingNew' } : e));
    const r = stepRetry(run(), marked)!;
    expect(r).toEqual({ ord: 1, attempt: 1, kind: null });
    const words = `${retryLine(r, 'Research', 10)} ${retryBadge(r, 10)}`;
    expect(words).not.toMatch(/MARKER|somethingNew|<b>/u);
    expect(retryLine(r, 'Research', 10)).toBe('Research failed; trying it again · attempt 2 · no output for 10 min');
    expect(retryLine(r, null, null)).toBe('A step failed; trying it again · attempt 2');
    // A kind that names an Object prototype key is not a known cause.
    expect(stepRetry(run(), upTo(1595).map((e) => (e['type'] === 'stepFailed' ? { ...e, failureKind: 'toString' } : e)))!.kind).toBeNull();
  });

  it('SHARED/CACHED READS: a late copy of the old failure (attempt 0) does not end attempt 1', () => {
    const late = [...upTo(1595), { type: 'stepFailed', session: RUN, ord: 1, attempt: 0, failureKind: 'workerError', detail: 'd' }];
    expect(stepRetry(run(), late)).toMatchObject({ ord: 1, attempt: 1 });
    expect(stepRetry(run(), [...late, { type: 'stepFailed', session: RUN, ord: 1, attempt: 1, failureKind: 'workerError' }])).toBeNull();
  });
});

