import { describe, expect, it } from 'vitest';
import type { CoreEvent, SessionView } from '../src/api/types.js';
import {
  approvingReviewers, conciseOutput, CONCISE_LINES, decisionMessages, finalWords, planSteps, stepMessages, stepWord, testCountOf,
} from '../src/board/runConversation.js';
import type { ChainModel } from '../src/board/chainModel.js';
import { isReviewUnit } from '../src/board/responder.js';

const RUN = 'r-1';

function unit(key: string, ord: number, status: string, cli: string | null, stage = 'build', role = 'neutral'): SessionView['units'][number] {
  return {
    id: `${RUN}:${key}`, session_id: RUN, ord, description: key, stage, role, assigned_cli: cli, assigned_invocation: null,
    council_task_ref: null, routing: null, denial_reason: null, phase_ref: key, conformance_ref: null, phase_status: null,
    collection_scope: null, status,
  } as unknown as SessionView['units'][number];
}

function run(status: string, units: SessionView['units'], extra: Record<string, unknown> = {}): SessionView {
  return { session: { id: RUN, status, problem: 'fix it', clis: ['claude'], unit_ix: 0, ...extra }, units } as unknown as SessionView;
}

const EMPTY_CHAIN: ChainModel = { source: 'units', steps: [], proposed: false, transportLine: null, done: 0, total: 0, checked: null };

describe('the run as a conversation (DES-CHAT-NATIVE-RUN)', () => {
  it('each finished step speaks once, in run order; the planning and deliver steps do not', () => {
    const view = run('completed', [
      unit('deliver', 4, 'done', null), unit('review', 3, 'done', 'codex', 'review', 'evaluator'),
      unit('pa-scope', 0, 'done', 'claude', 'recon'), unit('understand', 1, 'done', 'claude', 'recon'),
      unit('build', 2, 'rejected', 'claude'), unit('test', 5, 'pending', null),
    ]);
    expect(stepMessages(view)[1]!.version).toBe('rejected:0'); // a step that runs again is read again
    expect(stepMessages(view).map((s) => [s.key, s.label, s.cli, s.state])).toEqual([
      ['understand', 'Research', 'claude', 'done'], ['build', 'Build', 'claude', 'rejected'], ['review', 'Review', 'codex', 'done'],
    ]);
  });

  it('a step’s words are versioned by ITS OWN dispatches, not the run’s cursor attempt (codex r2 #1)', () => {
    const view = run('executing', [unit('review', 1, 'done', 'codex', 'review'), unit('build', 2, 'pending', null)], { attempt: 0 });
    const ev = (ord: number, attempt: number) => ({ type: 'unitDispatched', ord, attempt }) as unknown as CoreEvent;
    expect(stepMessages(view, [ev(1, 0)])[0]!.version).toBe('done:1');
    // The review ran again; the cursor then moved on and its attempt reset to 0: the review is still its 2nd try.
    expect(stepMessages(view, [ev(1, 0), ev(1, 1), ev(2, 0)])[0]!.version).toBe('done:2');
  });

  it('the plan is the chain’s steps, else the units’ (without the planning step)', () => {
    const view = run('executing', [unit('pa-scope', 0, 'done', 'claude'), unit('understand', 1, 'pending', null), unit('security_review', 2, 'pending', null)]);
    expect(planSteps(view, EMPTY_CHAIN)).toEqual(['Research', 'Security check']);
    const chain = { ...EMPTY_CHAIN, steps: [{ id: 'build', catalog: 'build', block: 'build', label: 'Build', state: 'todo', addedBy: 'pa' }, { id: 'x', catalog: 'x', block: 'tool', label: 'Gone', state: 'struck', addedBy: 'pa' }] } as ChainModel;
    expect(planSteps(view, chain)).toEqual(['Build']);
    expect(stepWord('walkthrough_review#2')).toBe('Walkthrough');
  });

  it('your gate answers come from the event log, worded by what was asked', () => {
    const events = [
      { type: 'awaitingHuman', ord: 1, prompt: 'Approve plan rev 1 before unit 1 runs', ts: 1 },
      { type: 'gateDecided', ord: 1, allow: true, ts: 2 },
      { type: 'awaitingHuman', ord: 3, prompt: 'Unit 3 verdict is NOT PASS', ts: 3 },
      { type: 'gateDecided', ord: 3, allow: false, ts: 4 },
      // The engine passed step 5 itself: nobody approved it, so nothing is said for it.
      { type: 'gateDecided', ord: 5, allow: true, ts: 5 },
    ] as unknown as CoreEvent[];
    expect(decisionMessages(events)).toEqual([
      { ord: 1, at: 2, text: 'Approved the plan', by: 'you' }, { ord: 3, at: 4, text: 'Sent it back', by: 'you' },
    ]);
    expect(decisionMessages(null)).toEqual([]);
  });

  it('(J4 0.16.6) the job\'s own rounds are the job\'s: "The job retried automatically", never your "Sent it back"', () => {
    // Run 115fabdb ord 6: the floor failed, the engine sent it back itself (the automatic floor round), the no-change
    // answer failed again and the engine asked you; you answered with your own judgment.
    const events = [
      { type: 'gateDecided', ord: 6, allow: false, ts: 10 },
      { type: 'unitReworkAmended', ord: 6, ts: 11 }, { type: 'resumed', ord: 6, ts: 11 },
      { type: 'gateDecided', ord: 6, allow: false, ts: 20 },
      { type: 'gateEscalated', ord: 6, ts: 20 }, { type: 'awaitingHuman', ord: 6, prompt: 'Unit 6 failed its deterministic floor', ts: 20 },
      { type: 'resumed', ord: 6, ts: 30 }, { type: 'gateDecided', ord: 6, allow: true, ts: 30 },
    ] as unknown as CoreEvent[];
    expect(decisionMessages(events)).toEqual([
      { ord: 6, at: 10, text: 'The job retried automatically', by: 'job' },
      { ord: 6, at: 30, text: 'Approved', by: 'you' },
    ]);
  });

  it('a step’s output is concise: the verdict header is lifted, long output is cut at a paragraph, never in a fence', () => {
    const short = conciseOutput('\u001b[32mVERDICT: PASS\u001b[0m\n\nLooks right.');
    expect(short).toEqual({ text: 'Looks right.', more: false, verdict: 'pass' });
    const long = conciseOutput(['Para one.', '', ...Array.from({ length: 30 }, (_, i) => `line ${i}`)].join('\n'));
    expect(long.more).toBe(true);
    expect(long.text).toBe('Para one.');
    const fenced = conciseOutput(['Intro.', '', '```ts', ...Array.from({ length: CONCISE_LINES + 4 }, (_, i) => `x${i}`), '```'].join('\n'));
    expect(fenced.more).toBe(true);
    expect(fenced.text).toBe('Intro.');
    expect(fenced.text).not.toContain('```');
  });

  it('a cut never leaves a heading over nothing: the report\u2019s Commands run table is not shown as an empty section (run b445c17e)', () => {
    // The governed-worker report shape every step writes: What I did, then Commands run + a table.
    const report = [
      '## What I did', '', '**Role:** Neutral (scope).', '', '**Files read (no writes):**', '- `README.md`', '- `src/math.js`',
      '- `test/math.test.js`', '- `tmp/` (empty)', '', '## Commands run', '', '| Command | Exit |', '|---|---|',
      '| `ls -la` | 0 |', '| `git log --oneline -5` | 0 |', '', '## Counts', '', 'derived 0 / submitted 0 / failed 0',
    ].join('\n');
    const c = conciseOutput(report);
    expect(c.more).toBe(true);
    expect(c.text).not.toMatch(/Commands run\s*$/);
    expect(c.text).not.toContain('## Commands run');
    expect(c.text.endsWith('- `tmp/` (empty)')).toBe(true);
    // A bold-only label is a heading too.
    const bold = conciseOutput(['Para one.', '', '**Commands run:**', '', ...Array.from({ length: 30 }, (_, i) => `| c${i} | 0 |`)].join('\n'));
    expect(bold.text).toBe('Para one.');
    // Output that is nothing but a heading before the cut still shows something: the limit cut.
    const onlyHead = conciseOutput(['## Commands run', '', '| Command | Exit |', '|---|---|', ...Array.from({ length: 30 }, (_, i) => `| c${i} | 0 |`)].join('\n'));
    expect(onlyHead.text.startsWith('## Commands run')).toBe(true);
    expect(onlyHead.text).toContain('| c0 | 0 |');
  });

  it('the final message is plain words: tests, the approving reviewer, the pull request', () => {
    const view = run('completed', [unit('review', 1, 'done', 'codex', 'review', 'evaluator'), unit('build', 0, 'done', 'claude')],
      { delivery: 'delivered', deliverUrl: 'https://github.com/acme/shop/pull/12' });
    const reviewers = approvingReviewers(view, isReviewUnit, (ord) => (ord === 1 ? 'pass' : null));
    expect(reviewers).toEqual(['codex']);
    // A review that finished saying FAIL, or with no verdict read, approved nothing (codex r1 #3).
    expect(approvingReviewers(view, isReviewUnit, () => 'fail')).toEqual([]);
    expect(approvingReviewers(view, isReviewUnit, () => null)).toEqual([]);
    const w = finalWords(view, { done: 2, total: 2 }, { passed: true, tests: testCountOf('QE acceptance passed: 38 tests pass'), nothing: false, reviewers });
    expect(w.lead).toBe('Done');
    expect(w.line).toBe('Tests pass (38), and codex reviewed and approved it. Pull request #12 is open.');
    expect(w.line).not.toMatch(/QE|acceptance/i);
    expect(w.pr).toEqual({ url: 'https://github.com/acme/shop/pull/12', number: '12' });
  });

  it('says what did not happen, honestly: nothing checked, checks failed, a stop, nothing pushed', () => {
    const stranded = run('completed', [unit('build', 0, 'done', 'claude'), unit('deliver', 1, 'done', null)], { delivery: 'stranded' });
    const plain = finalWords(stranded, { done: 2, total: 2 }, { passed: null, tests: null, nothing: true, reviewers: [] });
    expect(plain.line).toMatch(/^Nothing checked this work\./);
    const failed = finalWords(run('failed', [unit('build', 0, 'done', 'claude')]), { done: 1, total: 3 }, { passed: false, tests: null, nothing: false, reviewers: [] });
    expect(failed).toMatchObject({ lead: 'Stopped', line: 'It stopped after 1 of 3 steps. The checks did not pass.', pr: null });
    const reviewedOnly = finalWords(run('completed', []), { done: 0, total: 0 }, { passed: null, tests: null, nothing: false, reviewers: ['codex', 'pi'] });
    expect(reviewedOnly.line).toBe('Reviewed and approved by codex and pi.');
  });
});
