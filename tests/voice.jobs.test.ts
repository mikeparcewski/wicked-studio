// "Show me this job", then "tell it …" (lane voice-jobs): which job the words name, and what they ask for. Pure, so
// these read like the conversation.

import { describe, expect, it } from 'vitest';
import { actionOf, actionWords, isDeictic, jobScore, nextRigor, otherJob, parseJobWords, readClass, resolveJob, type JobRef } from '../src/voice/jobs.js';
import { checksLine, previewFacts } from '../src/voice/jobPreview.js';
import type { CoreEvent, SessionView } from '../src/api/types.js';

const HOOK: JobRef = { runId: 'r-hook', title: 'Retry failed webhook sends', running: true };
const DARK: JobRef = { runId: 'r-dark', title: 'Dark mode for settings', running: true };
const HOOK_DOCS: JobRef = { runId: 'r-hookdocs', title: 'Document the webhook payloads', running: false };
const INVOICE: JobRef = { runId: 'r-inv', title: 'Fix the invoice currency', running: false };

describe('which job: reference resolution', () => {
  it('"this job" is the job in focus', () => {
    expect(resolveJob('', [HOOK, DARK], 'r-dark')).toEqual({ kind: 'one', job: DARK, how: 'focused' });
    expect(isDeictic('this job')).toBe(true);
    expect(isDeictic('that one')).toBe(true);
    expect(isDeictic('the webhook job')).toBe(false);
  });

  it('with nothing in focus, "it" is the only running job', () => {
    expect(resolveJob('', [HOOK, INVOICE], null)).toEqual({ kind: 'one', job: HOOK, how: 'only-running' });
    // A focus that is not a known job is ignored.
    expect(resolveJob('', [HOOK], 'r-gone')).toMatchObject({ kind: 'one', how: 'only-running' });
  });

  it('with several running and none in focus, "it" asks which; with none running it says so', () => {
    expect(resolveJob('', [HOOK, DARK], null)).toMatchObject({ kind: 'choose', jobs: [HOOK, DARK] });
    expect(resolveJob('', [INVOICE], null)).toMatchObject({ kind: 'none' });
  });

  it('a name is fuzzy-matched: words, plurals, a prefix, one letter off', () => {
    expect(resolveJob('webhook retries', [HOOK, DARK, INVOICE], null)).toMatchObject({ kind: 'one', job: HOOK, how: 'named' });
    expect(resolveJob('the dark mode', [HOOK, DARK], null)).toMatchObject({ kind: 'one', job: DARK });
    expect(resolveJob('invoice', [HOOK, DARK, INVOICE], null)).toMatchObject({ kind: 'one', job: INVOICE });
    expect(resolveJob('invoise currency', [HOOK, INVOICE], null)).toMatchObject({ kind: 'one', job: INVOICE });
    expect(jobScore('webhooks', HOOK)).toBeGreaterThan(0.9);
    expect(jobScore('settings dark', DARK)).toBe(1);
  });

  it('several close matches → a choose-one; nothing close → none, naming what runs', () => {
    expect(resolveJob('webhook', [HOOK, HOOK_DOCS, DARK], null)).toMatchObject({ kind: 'choose', jobs: [HOOK, HOOK_DOCS] });
    const none = resolveJob('database migration', [HOOK, DARK], null);
    expect(none.kind).toBe('none');
    expect(none.kind === 'none' && none.why).toMatch(/Running now: Retry failed webhook sends; Dark mode for settings/);
  });

  it('"the other one" cycles the last choice, then the running jobs', () => {
    expect(otherJob('r-hook', ['r-hook', 'r-hookdocs'], [HOOK, HOOK_DOCS, DARK])?.runId).toBe('r-hookdocs');
    expect(otherJob('r-hookdocs', ['r-hook', 'r-hookdocs'], [HOOK, HOOK_DOCS, DARK])?.runId).toBe('r-dark');
    expect(otherJob('r-hook', [], [HOOK])).toBeNull();
    expect(otherJob(null, [], [HOOK, DARK])?.runId).toBe('r-hook');
  });
});

describe('what to do: intent mapping', () => {
  it('show / other / close / pin', () => {
    expect(parseJobWords('Show me this job.')).toEqual({ kind: 'show', job: '' });
    expect(parseJobWords('show me the webhook retries job')).toEqual({ kind: 'show', job: 'webhook retries' });
    expect(parseJobWords('Open the dark mode job please')).toEqual({ kind: 'show', job: 'dark mode' });
    expect(parseJobWords('show me the other one')).toEqual({ kind: 'other' });
    expect(parseJobWords('the other one')).toEqual({ kind: 'other' });
    expect(parseJobWords('close it')).toEqual({ kind: 'close' });
    expect(parseJobWords('pin it')).toEqual({ kind: 'pin', on: true });
    expect(parseJobWords('unpin it')).toEqual({ kind: 'pin', on: false });
    // "show me what is running" is a question, not a job.
    expect(parseJobWords('show me what is running')).toBeNull();
  });

  it('"tell it to …" is a steer note, as said', () => {
    expect(parseJobWords('Tell it to keep the old URL working.')).toEqual({ kind: 'act', job: '', explicit: true, action: { kind: 'steer', note: 'Keep the old URL working' } });
    expect(parseJobWords('tell the dark mode job to use CSS variables')).toEqual({ kind: 'act', job: 'dark mode', explicit: true, action: { kind: 'steer', note: 'Use CSS variables' } });
    expect(parseJobWords('ask it to add a test for the retry limit')).toMatchObject({ action: { kind: 'steer', note: 'Add a test for the retry limit' } });
  });

  it('stop, with or without a reason; "stop using X" is an instruction', () => {
    expect(actionOf('stop it')).toEqual({ kind: 'stop', reason: null });
    expect(actionOf('stop it because the tests are pointed at the wrong repo')).toEqual({ kind: 'stop', reason: 'The tests are pointed at the wrong repo' });
    expect(parseJobWords('tell it to stop, because we are changing the plan')).toMatchObject({ action: { kind: 'stop', reason: 'We are changing the plan' } });
    expect(parseJobWords('stop the webhook job because it is the wrong branch')).toMatchObject({ job: 'webhook', action: { kind: 'stop', reason: 'It is the wrong branch' } });
    expect(actionOf('stop using lodash')).toBeNull();
    expect(parseJobWords('tell it to stop using lodash')).toMatchObject({ action: { kind: 'steer', note: 'Stop using lodash' } });
    expect(parseJobWords('stop listening')).toBeNull();
  });

  it('raise rigor, to a level or one up', () => {
    expect(actionOf('raise the rigor')).toEqual({ kind: 'rigor', to: null });
    expect(actionOf('raise rigor to highest')).toEqual({ kind: 'rigor', to: 'highest' });
    expect(actionOf('be more careful')).toEqual({ kind: 'rigor', to: null });
    expect(parseJobWords('raise the rigor on the webhook job')).toMatchObject({ job: 'webhook', action: { kind: 'rigor' } });
    expect(nextRigor('standard')).toBe('high');
    expect(nextRigor('highest')).toBeNull();
  });

  it('check on it, the working document, and its decision', () => {
    expect(parseJobWords('check on it')).toEqual({ kind: 'act', job: '', explicit: false, action: { kind: 'check' } });
    expect(parseJobWords('Is it stuck?')).toMatchObject({ action: { kind: 'check' } });
    expect(parseJobWords('check on the dark mode job')).toMatchObject({ job: 'dark mode', action: { kind: 'check' } });
    expect(actionOf('add a constraint: keep /v1 working')).toEqual({ kind: 'doc', section: 'constraints', text: 'Keep /v1 working' });
    expect(parseJobWords('tell it to add a constraint that the old URL keeps working')).toMatchObject({ action: { kind: 'doc', section: 'constraints', text: 'The old URL keeps working' } });
    expect(actionOf('next: add GBP and JPY tests')).toEqual({ kind: 'doc', section: 'next', text: 'Add GBP and JPY tests' });
    expect(actionOf('approve it')).toEqual({ kind: 'gate', words: { action: 'approve' } });
    expect(actionOf('send it back with a note keep the old URL')).toMatchObject({ kind: 'gate', words: { action: 'request_changes', note: 'Keep the old URL' } });
  });

  it('words that match nothing are left for the one classification', () => {
    expect(parseJobWords('make the button blue')).toBeNull();
    expect(parseJobWords('what is running right now?')).toBeNull();
    expect(readClass('Steer.')).toBe('steer');
    expect(readClass('I think: question')).toBe('question');
    expect(readClass('no idea')).toBeNull();
  });

  it('every action says on its confirm exactly what goes where', () => {
    expect(actionWords({ kind: 'steer', note: 'Keep the old URL working' }, 'Retry failed webhook sends').prompt).toBe('Send to “Retry failed webhook sends”: “Keep the old URL working”?');
    expect(actionWords({ kind: 'stop', reason: 'Wrong repo' }, 'X').prompt).toBe('Stop “X” because “Wrong repo”?');
    expect(actionWords({ kind: 'stop', reason: null }, 'X').prompt).toBe('Stop “X”?');
    expect(actionWords({ kind: 'rigor', to: 'high' }, 'X', { rigor: 'standard' }).prompt).toBe('Raise “X”’s rigor from standard to high?');
    expect(actionWords({ kind: 'check' }, 'X').detail).toMatch(/read-only/);
  });
});

describe('the preview tile’s facts', () => {
  const view = (power: unknown): SessionView => ({
    session: { id: 'r', status: 'executing', unit_ix: 1, power } as unknown as SessionView['session'],
    units: [
      { ord: 0, status: 'done', phase_ref: 'plan', stage: 'plan' },
      { ord: 1, status: 'distributed', phase_ref: 'build', stage: 'build' },
    ] as unknown as SessionView['units'],
  } as SessionView);

  it('phase, rigor and the step it is on, from the run and the system read', () => {
    expect(previewFacts(view(null), null, [])).toMatchObject({ phase: 'build', rigor: 'phased', ord: 1, checks: 'none run yet' });
    const power = { on: true, available: true, rigor: 'high', history: [], orchestrator: { cli: 'claude', ord: 7, turns: 2, inTurn: true, sessionRestarts: 0 } };
    expect(previewFacts(view(power), { phase: 'build', unitOrd: 1 }, [])).toMatchObject({ rigor: 'high', ord: 7 });
  });

  it('checks: the newest repository-checks record, in words', () => {
    const ev = (checks: Array<{ name: string; exitCode: number }>, passed: boolean): CoreEvent => ({ type: 'repoChecksEvaluated', session: 'r', passed, criterion: 'x', checks: checks.map((c) => ({ ...c, argv: [], source: 'x', timedOut: false, spawnError: null, durationMs: 1 })) } as unknown as CoreEvent);
    expect(checksLine([ev([{ name: 'lint', exitCode: 0 }, { name: 'test', exitCode: 1 }], false)])).toEqual({ line: '1 of 2 passed · test failed', tone: 'fail' });
    expect(checksLine([ev([{ name: 'test', exitCode: 1 }], false), ev([{ name: 'test', exitCode: 0 }], true)])).toEqual({ line: 'all 1 passed', tone: 'ok' });
  });
});

describe('the thread says "You (by voice)"', () => {
  it('a note crew stamped as said by voice, queued and delivered', async () => {
    const { narrate } = await import('../src/components/narrator.js');
    const n = (e: Record<string, unknown>) => narrate(e as unknown as CoreEvent, { phaseOf: () => 'this phase' })?.text;
    expect(n({ type: 'workerMessageInjected', session: 'r', target: 'all', message: 'Keep the old URL', input: 'voice' })).toBe('You (by voice): your message was delivered to all');
    expect(n({ type: 'workerMessageQueued', session: 'r', target: 'claude', message: 'x', input: 'voice' })).toBe("You (by voice): your message is queued for claude's next turn");
    expect(n({ type: 'workerMessageInjected', session: 'r', target: 'all', message: 'typed' })).toBe('Your message was delivered to all');
  });

  it('a working-document edit said by voice', async () => {
    const { steerRowWords } = await import('../src/components/session/RunThreadPlugin.js');
    expect(steerRowWords('local', ['constraints'], { pickedUp: null, error: null, input: 'voice' })).toBe('You (by voice) edited the working document · Constraints · waiting for the next step');
    expect(steerRowWords('local', ['constraints'], { pickedUp: null, error: null })).toBe('You edited the working document · Constraints · waiting for the next step');
  });
});
