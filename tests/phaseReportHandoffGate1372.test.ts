/**
 * studio#1372: a hand-off step's record said "running" while its gate waited on the person ("Review · Codex · running"
 * beside "Waiting on you at Review"). The record is checked first, so an open gate opened at or after a still-running
 * record must win; a finished record (passed, failed, skipped) still says how the step ended.
 *
 * Real shape: the core events go through the product's own route (`toRow`, src/editors/runEvents.ts:174 for
 * `awaitingHuman`, :217-219 for `powerHandoffStepped`), the same events as tests/powerPhaseReports.test.tsx's
 * "Build and Checks share one unit" run (the t12r3-j4 shape: review handed to Codex, then its gate opens).
 */
import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { toRow, type TopicRow } from '../src/editors/runEvents.js';
import { emptyReport, foldRows, panelLine, phaseDashboard, phaseSummary, type PhaseScope } from '../src/plugins/wicked-phase-report/model.js';

const clockAt = (h: number, m: number, sec = 0): number => new Date(2026, 10, 23, h, m, sec).getTime();
const e = (type: string, ts: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type, session: 'g1', ts, ...extra });
const handoff = (step: string, ord: number, status: string, seat: string | null, ts: number): Record<string, unknown> =>
  e('powerHandoffStepped', ts, { round: 1, step: { step, ord, status, seat, summary: null, at: ts } });

const base = [
  e('unitDispatched', clockAt(13, 27, 56), { ord: 2, attempt: 0 }), e('unitExecuting', clockAt(13, 27, 56), { ord: 2 }),
  e('powerTurnStarted', clockAt(13, 27, 56), { ord: 2, turn: 1, cli: 'claude' }),
  e('powerTurnCompleted', clockAt(13, 37, 25), { ord: 2, turn: 1, cli: 'claude', outcome: 'handoff' }),
  e('unitDone', clockAt(13, 40, 0), { ord: 2 }),
  handoff('checks', 2, 'passed', 'claude', clockAt(13, 40, 5)),
  handoff('review', 3, 'running', 'codex', clockAt(13, 40, 5)),
];

function report(events: Record<string, unknown>[]) {
  const r = emptyReport();
  const names = (cli: string): string | null => ({ claude: 'Claude Code', codex: 'Codex' } as Record<string, string>)[cli] ?? null;
  foldRows(r, (events as unknown as CoreEvent[]).map((x, i) => toRow(x, 'g1', 0, `s${i}`, names)).filter((x): x is TopicRow => x !== null));
  r.loaded = true;
  return r;
}
const review: PhaseScope = { phase: 'review', label: 'Review', ords: [3] };

describe('a hand-off step whose gate waits on the person (studio#1372)', () => {
  it('says "waiting on you" when the gate opened after the running record, never "running"', () => {
    const r = report([...base, e('awaitingHuman', clockAt(13, 52, 0), { ord: 3, gateKind: 'escalation' })]);
    expect(phaseSummary(r, review)).toBe('Review · Codex · waiting on you');
    expect(phaseDashboard(r, review, clockAt(14, 0)).now.value).toBe('Review · waiting on you');
    expect(panelLine(r, review)).toEqual({ text: 'Codex · waiting on you', tone: 'wait' });
  });

  it('a gate opened in the same second as the record waits on you too', () => {
    const r = report([...base, e('awaitingHuman', clockAt(13, 40, 5), { ord: 3, gateKind: 'escalation' })]);
    expect(phaseSummary(r, review)).toBe('Review · Codex · waiting on you');
  });

  it('a finished record still says how the step ended, even with a gate open', () => {
    const passed = report([...base, e('awaitingHuman', clockAt(13, 52, 0), { ord: 3, gateKind: 'escalation' }), handoff('review', 3, 'passed', 'codex', clockAt(13, 53, 0))]);
    expect(phaseSummary(passed, review)).toBe('Review · Codex · approved');
    const failed = report([...base, e('awaitingHuman', clockAt(13, 52, 0), { ord: 3, gateKind: 'escalation' }), handoff('review', 3, 'failed', 'codex', clockAt(13, 53, 0))]);
    expect(phaseSummary(failed, review)).toBe('Review · Codex · changes asked');
  });

  it('an older gate (opened before the step was handed this record) does not hold the new record', () => {
    const r = report([
      ...base.slice(0, -1),
      e('awaitingHuman', clockAt(13, 39, 0), { ord: 3, gateKind: 'escalation' }),
      handoff('review', 3, 'running', 'codex', clockAt(13, 40, 5)),
    ]);
    expect(phaseSummary(r, review)).toBe('Review · Codex · running');
  });

  it('a gate answered (the run resumed) gives the record back', () => {
    const r = report([...base, e('awaitingHuman', clockAt(13, 52, 0), { ord: 3, gateKind: 'escalation' }), e('resumed', clockAt(13, 55, 0), { ord: 3 })]);
    expect(phaseSummary(r, review)).toBe('Review · Codex · running');
  });
});
