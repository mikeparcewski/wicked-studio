/**
 * The working document filled from the run's events (operator 2026-10-30): the Phase report writes, as itself,
 * Decisions (gates answered, checkpoint pauses — who and what), Open questions (what waits on a person now) and Next
 * (what the newest hand-off round left). Closed words only: a pause's reasons reach the plugin as kinds, never text.
 */
import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { pauseKinds, toRow, type TopicRow } from '../src/editors/runEvents.js';
import { emptyReport, foldRows } from '../src/plugins/wicked-phase-report/model.js';
import { docLines } from '../src/plugins/wicked-phase-report/workingDoc.js';
import { at, buildEvents, change, step } from './powerFixtures.js';

const rows = (events: Array<Record<string, unknown>>): TopicRow[] =>
  events.map((e, i) => toRow(e as unknown as CoreEvent, 'r-pm', at(0), `s${i}`, () => null)).filter((r): r is TopicRow => r !== null);
const report = (events: Array<Record<string, unknown>>) => { const r = emptyReport(); foldRows(r, rows(events)); r.loaded = true; return r; };
const hhmm = (min: number) => { const d = new Date(at(min)); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

const pause = { at: at(20), checkpoint: 3, reasons: ['struggling: 80 min against an estimate of 20 min; 3 failed test runs'], recommended: 'split' };
const paused = (extra: Array<Record<string, unknown>> = []) => [
  ...buildEvents(),
  { type: 'powerCheckpointReached', session: 'r-pm', ts: at(20), ord: 1, checkpoint: 3, turn: 3, trigger: 'turn', head: null, picked: 0, rigor: 'high', paused: true, pause },
  ...extra,
];

describe('a pause reaches the plugin as kinds, never its text', () => {
  it('maps the engine’s reasons to closed kinds', () => {
    expect(pauseKinds('struggling: 80 min against an estimate of 20 min; 3 failed test runs')).toEqual(['longer_than_estimated', 'tests_failing']);
    expect(pauseKinds('2 reverts')).toEqual(['changes_undone']);
    expect(pauseKinds('rigor jumped two bands at once (light -> high)')).toEqual(['rigor_jumped']);
    expect(pauseKinds('the sign-in module was touched')).toEqual(['other']);
    expect(pauseKinds('the change spread into another product')).toEqual(['spread']);
    const row = rows(paused()).find((r) => r.topic === 'wicked.run.checkpoint.reached' && r.data['checkpoint'] === 3)!;
    expect(row.data['pauseKinds']).toEqual(['longer_than_estimated', 'tests_failing']);
    expect(JSON.stringify(row)).not.toContain('80 min');
  });
});

describe('the plugin’s lines in the working document', () => {
  it('a pause waiting is an open question, with why', () => {
    const lines = docLines(report(paused()));
    expect(lines.questions).toEqual([`Waiting on you · checkpoint 3 paused (taking much longer than estimated; the tests kept failing): split it, switch to phased steps, continue at high rigor, or stop? · since ${hhmm(20)}`]);
    expect(lines.decisions).toEqual([]);
  });

  it('your answer is a decision (who and what), and the question is gone', () => {
    const answered = paused([
      { type: 'rigorRescored', session: 'r-pm', ts: at(22), change: change(4, 22, 'operator', 'high', 'highest', 34, 70, 3, ['continue at high rigor'], { by: 'local' }) },
      { type: 'powerTurnStarted', session: 'r-pm', ts: at(22.1), ord: 1, attempt: 0, turn: 4, cli: 'claude' },
    ]);
    const lines = docLines(report(answered));
    expect(lines.decisions).toEqual([`Checkpoint 3 pause (taking much longer than estimated; the tests kept failing) · you chose: continue at high rigor · ${hhmm(22)}`]);
    expect(lines.questions).toEqual([]);
  });

  it('the next turn alone is "continue as planned"; a switch to phased steps after it is the answer', () => {
    const cont = paused([{ type: 'powerTurnStarted', session: 'r-pm', ts: at(23), ord: 1, attempt: 0, turn: 4, cli: 'claude' }]);
    expect(docLines(report(cont)).decisions[0]).toMatch(/· answered: continue as planned · /u);
    const sw = paused([{ type: 'powerToggled', session: 'r-pm', ts: at(23), toggle: { at: at(23), on: false, by: 'local', reason: null, stayPhased: [] } }]);
    expect(docLines(report(sw)).decisions[0]).toMatch(/· you chose: switch to phased steps · /u);
  });

  it('decisions read in the order they were made', () => {
    const both = paused([
      { type: 'awaitingHuman', session: 'r-pm', ts: at(30), ord: 4, gateKind: 'deliver' },
      { type: 'powerTurnStarted', session: 'r-pm', ts: at(21), ord: 1, attempt: 0, turn: 4, cli: 'claude' },
      { type: 'resumed', session: 'r-pm', ts: at(31), ord: 4 },
    ]);
    const d = docLines(report(both)).decisions;
    expect(d).toHaveLength(2);
    expect(d[0]).toMatch(/^Checkpoint 3 pause/u);
    expect(d[1]).toMatch(/ · answered \d\d:\d\d$/u);
  });

  it('an open gate is a question; once answered it is a decision', () => {
    const open = [...buildEvents(), { type: 'awaitingHuman', session: 'r-pm', ts: at(30), ord: 4, gateKind: 'deliver' }];
    expect(docLines(report(open)).questions).toEqual([`Waiting on you · ${docLines(report(open)).questions[0]!.split(' · ')[1]} · since ${hhmm(30)}`]);
    const answered = [...open, { type: 'resumed', session: 'r-pm', ts: at(31), ord: 4 }];
    const l = docLines(report(answered));
    expect(l.questions).toEqual([]);
    expect(l.decisions).toEqual([expect.stringMatching(new RegExp(` · answered ${hhmm(31)}$`, 'u'))]);
  });

  it('the newest hand-off round’s failed or skipped steps are Next; a later round that passes them clears them', () => {
    const r1 = [...buildEvents(), { type: 'powerHandoffStepped', session: 'r-pm', ts: at(30), round: 1, step: step('review', 'failed', 'codex', 'one blocking note', 30) },
      { type: 'powerHandoffStepped', session: 'r-pm', ts: at(30), round: 1, step: step('security', 'skipped', null, null, 30) }];
    expect(docLines(report(r1)).next).toEqual([
      'After hand-off round 1 · the review asked for changes: make them and hand off again', 'After hand-off round 1 · the security check was skipped',
    ]);
    const r2 = [...r1, { type: 'powerHandoffStepped', session: 'r-pm', ts: at(40), round: 2, step: step('review', 'passed', 'codex', null, 40) }];
    expect(docLines(report(r2)).next).toEqual([]);
    // No free text: the review's own words never reach the plugin.
    expect(JSON.stringify(rows(r1))).not.toContain('blocking note');
  });
});
