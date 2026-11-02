/**
 * domain-graph-3: a job that keeps going (a domain-extraction run mapping a repository page after page) says where it
 * got to — the step's own line from its newest `stepRepeated` frame, or the `repeatLine` of its budget ask — and the
 * ask offers the step's own choices beside Stop. The requirements view reads the share crew's notGenerated answer
 * carries ("3% of behaviours mapped · target 80%").
 */
import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { plainGateQuestion } from '../src/board/deskWords.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { headlineProgress, pagesDoneOf, repeatChoicesOf, repeatLineOf, REPEAT_QUESTION } from '../src/board/repeatProgress.js';
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
    expect(m.question).toBe(REPEAT_QUESTION);
    expect(m.recommended).toBeNull();
    expect(m.choices.map((c) => [c.label, c.decision, c.isDefault === true])).toEqual([
      ['Map up to 20 more pages', { approve: true, action: 'consent:continue' }, true],
      ['Lower the target to 15% for wicked-crew and build the graph', { approve: true, action: 'consent:lower' }, false],
      ['Stop here', { approve: false }, false],
    ]);
    expect(m.detailItems[0]).toMatch(/budget reached/);
    expect(plainGateQuestion('anything', 'repeat')).toBe(REPEAT_QUESTION);
  });

  it('an ask with no choice of its own offers the step\'s "Run it again" beside Stop, through the row', () => {
    const plain = ev({ type: 'awaitingHuman', ord: 11, gateKind: 'repeat', prompt: 'Paused · Approve: the step runs again.',
      choices: ['approve', 'reject'], choiceLabels: { approve: 'Run it again', reject: 'Stop here' }, repeatLine: 'Paused' });
    const m = sessionGateChoices({ runId: RUN, gate: { ...gate(), choices: ['approve', 'reject'] }, units: UNITS, events: [plain], pool: [], roster: null })!;
    expect(m.question).toBe(REPEAT_QUESTION);
    expect(m.choices.map((c) => [c.label, c.decision, c.isDefault === true])).toEqual([
      ['Run it again', { approve: true }, false],
      ['Stop here', { approve: false }, false],
    ]);
  });

  it('a frame that names no answer at all keeps the generic row', () => {
    const bare = ev({ type: 'awaitingHuman', ord: 11, gateKind: 'repeat', prompt: 'x' });
    expect(repeatChoicesOf({ ...gate(), choices: null }, [bare])).toBeNull();
  });
});
