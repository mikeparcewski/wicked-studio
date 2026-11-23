/**
 * domain-graph-3: a job that keeps going (a domain-extraction run mapping a repository page after page) says where it
 * got to — the step's own line from its newest `stepRepeated` frame, or the `repeatLine` of its budget ask — and the
 * ask offers the step's own choices beside Stop. The requirements view reads the share crew's notGenerated answer
 * carries ("3% of behaviours mapped · target 80%").
 */
import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { plainGateQuestion } from '../src/board/deskWords.js';
import type { GateAction } from '../src/board/gateContract.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { headlineProgress, pagesDoneOf, repeatChoicesOf, repeatLineOf, repeatQuestion } from '../src/board/repeatProgress.js';
import type { OpenGate } from '../src/store/gates.js';
import { makeUnit } from './factories.js';

const RUN = 'r-dg3';
const ev = (e: Record<string, unknown>): CoreEvent => ({ session: RUN, ...e }) as unknown as CoreEvent;
const PAGE1 = ev({ type: 'stepRepeated', ord: 11, fromOrd: 7, pass: 1, line: 'Mapping wicked-crew · 3% → 9% · target 80% · page 2' });
const PAGE2 = ev({ type: 'stepRepeated', ord: 11, fromOrd: 7, pass: 2, line: 'Mapping wicked-crew · 3% → 9% → 15% · target 80% · page 3 · about 3 h left' });
const ASK = ev({
  type: 'awaitingHuman', ord: 11, gateKind: 'repeat', prompt: 'Mapping … budget reached … Choose one: …',
  choices: ['consent:continue', 'consent:lower', 'reject'], recommended: 0,
  choiceLabels: { 'consent:continue': 'Map up to 20 more pages', 'consent:lower': 'Lower the target to 15% for wicked-crew and build the graph', reject: 'Stop here' },
  repeatLine: 'Mapping wicked-crew · 3% → … → 15% · target 80% · page 21 · budget reached (20 pages; the budget is 20 pages or 240 minutes)',
});

describe('the progress line', () => {
  it('is the newest page line, then the ask line, and nothing before a page has finished', () => {
    expect(repeatLineOf([])).toBeNull();
    expect(repeatLineOf([ev({ type: 'unitDone', ord: 3 })])).toBeNull();
    expect(repeatLineOf([PAGE1, PAGE2])).toBe('Mapping wicked-crew · 3% → 9% → 15% · target 80% · page 3 · about 3 h left');
    expect(repeatLineOf([PAGE1, PAGE2, ASK])).toMatch(/budget reached/);
    // an ordinary gate's frame carries no line and does not hide the page's
    expect(repeatLineOf([PAGE2, ev({ type: 'awaitingHuman', ord: 4, gateKind: 'def', prompt: 'x' })])).toMatch(/page 3/);
    expect(pagesDoneOf([PAGE1, PAGE2])).toBe(2);
  });

  it('an ask\'s line stands only while the ask is open; then the newest page\'s line does', () => {
    const answered = [PAGE1, PAGE2, ASK, ev({ type: 'resumed', ord: 11 }), ev({ type: 'unitExecuting', ord: 11 })];
    expect(repeatLineOf(answered)).toMatch(/page 3 · about 3 h left$/);
  });

  // studio#1366 (train 12 run 94fa39f3): the page that reached 85% sends no frame (the engine emits stepRepeated only
  // when it loops), so the header kept the last page's "42% · about 41 min left" through the coverage and graph steps.
  it('says nothing once the loop step is over and a later step runs (no stale percent or time left)', () => {
    const PAGE = ev({ type: 'stepRepeated', ord: 11, fromOrd: 7, pass: 5, line: 'Mapping wicked-crew · 3% → … → 42% · target 80% · page 6 · about 41 min left' });
    const thePage = [PAGE, ev({ type: 'unitExecuting', ord: 7 }), ev({ type: 'unitExecuting', ord: 11 })];
    // still on the loop (its range runs again): the line stands
    expect(repeatLineOf(thePage)).toMatch(/42% · target 80% · page 6 · about 41 min left$/);
    // the loop step ended without another pass; coverage (ord 12) runs, then the graph (ord 13)
    expect(repeatLineOf([...thePage, ev({ type: 'unitExecuting', ord: 12 })])).toBeNull();
    // dispatch alone (the step has not started executing yet) is enough
    expect(repeatLineOf([...thePage, ev({ type: 'unitDispatched', ord: 12, attempt: 0 })])).toBeNull();
    // the next step's own gate before it runs ("ask me before every step") is enough too
    expect(repeatLineOf([...thePage, ev({ type: 'awaitingHuman', ord: 12, gateKind: 'def', prompt: 'Run coverage?' })])).toBeNull();
    // re-dispatches and retries inside the loop's range keep the line
    expect(repeatLineOf([...thePage, ev({ type: 'unitDispatched', ord: 8, attempt: 1 }), ev({ type: 'unitDispatched', ord: 11, attempt: 1 })])).toMatch(/about 41 min left$/);
    const runs = [{ session: { id: RUN, status: 'executing', created_at: 1 } }];
    expect(headlineProgress(runs, { [RUN]: [...thePage, ev({ type: 'unitExecuting', ord: 12 })] })).toBeNull();
  });

  it('after an answered ask that finishes with what was found, the old line does not come back', () => {
    const finish = [PAGE1, PAGE2, ASK, ev({ type: 'resumed', ord: 11 }), ev({ type: 'unitExecuting', ord: 11 }), ev({ type: 'unitExecuting', ord: 12 })];
    expect(repeatLineOf(finish)).toBeNull();
    // "Map more": the run goes back into the loop's range, so the newest page's line stands
    const more = [PAGE1, PAGE2, ASK, ev({ type: 'resumed', ord: 11 }), ev({ type: 'unitExecuting', ord: 11 }), ev({ type: 'unitExecuting', ord: 7 })];
    expect(repeatLineOf(more)).toMatch(/page 3 · about 3 h left$/);
  });

  it('the headline speaks for the newest run still going, never a finished one', () => {
    const runs = [
      { session: { id: 'old', status: 'cancelled', created_at: 1 } },
      { session: { id: 'live-a', status: 'executing', created_at: 2 } },
      { session: { id: 'live-b', status: 'awaiting_human', created_at: 3 } },
    ];
    const line = (s: string) => [ev({ type: 'stepRepeated', ord: 11, fromOrd: 7, pass: 1, line: s })];
    expect(headlineProgress(runs, { old: line('old run'), 'live-a': line('a'), 'live-b': line('b') })).toBe('b');
    expect(headlineProgress([runs[0]!], { old: line('old run') })).toBeNull();
    // the newest live run has no line yet: the older live run's line does not stand in for it
    expect(headlineProgress(runs, { old: line('old run'), 'live-a': line('a') })).toBeNull();
  });
});

describe('the budget ask', () => {
  const gate = (): OpenGate => ({ runId: RUN, ord: 11, prompt: 'Mapping … budget reached', lifecycle: 'open', receivedAt: 0, gateKind: 'repeat', choices: ['consent:continue', 'consent:lower', 'reject'], recommended: 0 });
  const UNITS = [makeUnit({ id: `${RUN}:extract-next`, session_id: RUN, ord: 11, stage: 'recon', tool_cmd: ['bash', '-c', 'next'] as never })];

  it('offers the step\'s choices with its labels and Stop; the recommendation is marked, nothing preselected', () => {
    const m = sessionGateChoices({ runId: RUN, gate: gate(), units: UNITS, events: [PAGE1, ASK], pool: [], roster: null })!;
    expect(m.question).toBe('The budget for this job is spent — keep going?');
    expect(m.recommended).toBeNull();
    expect(m.choices.map((c) => [c.label, c.decision, c.isDefault === true])).toEqual([
      ['Map up to 20 more pages', { approve: true, action: 'consent:continue' }, true],
      ['Lower the target to 15% for wicked-crew and build the graph', { approve: true, action: 'consent:lower' }, false],
      ['Stop here', { approve: false }, false],
    ]);
    expect(m.detailItems[0]).toMatch(/budget reached/);
    expect(plainGateQuestion('anything', 'repeat')).toBe('The job stopped to ask how to go on');
  });

  it('an ask with no choice of its own offers the step\'s "Run it again" beside Stop, through the row', () => {
    const plain = ev({ type: 'awaitingHuman', ord: 11, gateKind: 'repeat', prompt: 'Paused · Approve: the step runs again.',
      choices: ['approve', 'reject'], choiceLabels: { approve: 'Run it again', reject: 'Stop here' }, repeatLine: 'Paused' });
    const m = sessionGateChoices({ runId: RUN, gate: { ...gate(), choices: ['approve', 'reject'] }, units: UNITS, events: [plain], pool: [], roster: null })!;
    expect(m.question).toBe('The job stopped to ask how to go on');
    expect(m.choices.map((c) => [c.label, c.decision, c.isDefault === true])).toEqual([
      ['Run it again', { approve: true }, false],
      ['Stop here', { approve: false }, false],
    ]);
  });

  // studio#1279: the gate read lists the engine's answers (wicked-core `repeat_actions`: a plain approve that takes the
  // recommended choice, one answer per choice, reject). The row keeps the step's labels and its recommendation.
  const listed = (...tokens: string[]): GateAction[] => tokens.map((action) => ({
    action, intent: action === 'approve' ? 'continue' : action === 'reject' ? 'stop' : 'consent_choice', note: 'none',
  }));

  it('with the gate\'s listed answers, keeps the step\'s labels and its recommendation; no bare ids, no extra Approve (studio#1279)', () => {
    const j6 = ev({
      type: 'awaitingHuman', ord: 6, gateKind: 'repeat', prompt: 'Mapping … budget reached',
      choices: ['consent:continue', 'consent:lower', 'reject'], recommended: 0,
      choiceLabels: { 'consent:continue': 'Map up to 20 more pages', 'consent:lower': 'Lower the minimum to 2% for carddemo-t11 and build the graph', reject: 'Stop here' },
      repeatLine: 'Mapping carddemo-t11 · 0% → 2% · target 80% · page 2 · budget reached',
    });
    const g: OpenGate = { ...gate(), ord: 6, choices: ['consent:continue', 'consent:lower', 'reject'] };
    const m = sessionGateChoices({ runId: RUN, gate: g, units: UNITS, events: [PAGE1, j6], pool: [], roster: null,
      actions: listed('approve', 'consent:continue', 'consent:lower', 'reject') })!;
    expect([...m.choices, ...m.overflow].map((c) => [c.label, c.decision, c.isDefault === true])).toEqual([
      ['Map up to 20 more pages', { approve: true, action: 'consent:continue' }, true],
      ['Lower the minimum to 2% for carddemo-t11 and build the graph', { approve: true, action: 'consent:lower' }, false],
      ['Stop here', { approve: false }, false],
    ]);
    expect(m.choices.map((c) => c.title).join(' ')).not.toMatch(/Answer with/);
    // Only what the engine lists: a choice it no longer takes is not drawn.
    const fewer = sessionGateChoices({ runId: RUN, gate: g, units: UNITS, events: [PAGE1, j6], pool: [], roster: null,
      actions: listed('approve', 'consent:continue', 'reject') })!;
    expect(fewer.choices.map((c) => c.label)).toEqual(['Map up to 20 more pages', 'Stop here']);
  });

  it('with the gate\'s listed answers, an ask with no choice of its own keeps "Run it again" (studio#1279)', () => {
    const plain = ev({ type: 'awaitingHuman', ord: 11, gateKind: 'repeat', prompt: 'Paused · Approve: the step runs again.',
      choices: ['approve', 'reject'], choiceLabels: { approve: 'Run it again', reject: 'Stop here' }, repeatLine: 'Paused' });
    const m = sessionGateChoices({ runId: RUN, gate: { ...gate(), choices: ['approve', 'reject'] }, units: UNITS, events: [plain], pool: [], roster: null,
      actions: listed('approve', 'reject') })!;
    expect(m.choices.map((c) => [c.label, c.decision])).toEqual([
      ['Run it again', { approve: true }],
      ['Stop here', { approve: false }],
    ]);
  });

  it('a frame that names no answer at all keeps the generic row', () => {
    const bare = ev({ type: 'awaitingHuman', ord: 11, gateKind: 'repeat', prompt: 'x' });
    expect(repeatChoicesOf({ ...gate(), choices: null }, [bare])).toBeNull();
  });
});

// studio#1082: the step's reason decides the repeat question.
describe('repeat questions', () => {
  const nothing = 'Mapping wicked-crew · target 80% · nothing left to map; minimum not met';
  // The issue's own line (run d13ea2f6, garden `decide()`): nothing left to map, no budget involved.
  const d13 = 'Mapping autogpt-exec · real requirements 0% → 30% → 57% → 66% · minimum 80% · 393 placeholders · last page resolved 94 of 158 units · nothing left to map in the files the repository tracks';
  const cases: Array<[string | null | undefined, string]> = [
    [d13, 'Nothing is left to map and the minimum isn’t met — finish with what was found, or stop?'],
    [nothing, 'Nothing is left to map and the minimum isn’t met — finish with what was found, or stop?'],
    ['nothing is left to map; budget reached', 'Nothing is left to map and the minimum isn’t met — finish with what was found, or stop?'],
    ['resolved under 1 in 12 of its units; out of reach', 'The last page resolved almost none of its units — read its review before you choose'],
    ['answered under 1 in 4 of its units', 'The last page resolved almost none of its units — read its review before you choose'],
    ['minimum out of reach in this run; budget reached', 'The minimum is out of reach in this run — keep going anyway?'],
    ['the last two pages added no real requirement; budget reached', 'The last two pages added no real requirement — keep going?'],
    ['budget reached', 'The budget for this job is spent — keep going?'],
    ['Paused', 'The job stopped to ask how to go on'],
    [null, 'The job stopped to ask how to go on'],
    [undefined, 'The job stopped to ask how to go on'],
  ];
  it.each(cases)('reads %j with the first matching reason', (line, question) => {
    expect(repeatQuestion(line)).toBe(question);
    expect(plainGateQuestion(line ?? '', 'repeat')).toBe(question);
  });

  it('the d13ea2f6 nothing-left ask uses its line, then the prompt when no line is recorded', () => {
    const gate: OpenGate = { runId: RUN, ord: 11, prompt: 'budget reached', lifecycle: 'open', receivedAt: 0, gateKind: 'repeat', choices: ['approve', 'reject'] };
    const events = [ev({ type: 'awaitingHuman', ord: 11, gateKind: 'repeat', repeatLine: nothing, choices: ['approve', 'reject'] })];
    const input = { runId: RUN, gate, units: [], events, pool: [], roster: null };
    const question = 'Nothing is left to map and the minimum isn’t met — finish with what was found, or stop?';
    expect(sessionGateChoices(input)?.question).toBe(question);
    expect(sessionGateChoices({ ...input, gate: { ...gate, prompt: nothing }, events: [] })?.question).toBe(question);
  });
});
