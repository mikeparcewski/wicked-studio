import { describe, expect, it } from 'vitest';
import { dashboard, emptyReport, foldRows, openGates, panelLine, phaseDashboard, phaseSummary, summaryLine, type Row } from '../src/plugins/wicked-phase-report/model.js';

function report(steps: string[]) {
  const r = { ...emptyReport(), loaded: true };
  const rows: Row[] = steps.flatMap((step, i) => [
    { id: `${i}-plan`, topic: 'wicked.run.unit.planned', at: i * 3 + 1, seq: null, ord: i + 1, data: { step } },
    { id: `${i}-start`, topic: 'wicked.run.unit.started', at: i * 3 + 2, seq: null, ord: i + 1, data: {} },
    { id: `${i}-done`, topic: 'wicked.run.unit.finished', at: i * 3 + 3, seq: null, ord: i + 1, data: { outcome: 'done' } },
  ]);
  foldRows(r, [...rows, { id: 'gate', topic: 'wicked.run.human.awaited', at: steps.length * 3 + 1, seq: null, ord: steps.length, data: { kind: 'terminal' } }]);
  return r;
}

describe('an answered chat in the Phase report', () => {
  it('the parked answer turn is Answered, with no decision open in the folded line or dashboards; a feature terminal gate still counts', () => {
    const r = report(['answer-1']);
    expect(openGates(r)).toEqual([]);
    expect(summaryLine(r)).toBe('Answered · 1 of 1 step done');
    expect(summaryLine(r)).not.toContain('decision open');
    expect(dashboard(r, 10).now).toEqual({ value: 'Answered', sub: 'Waiting for your next message' });
    expect(dashboard(r, 10).decisions.open).toBe(0);
    // The open turn is not listed as a decision at all ("0 open" beside a listed open gate would contradict itself).
    expect(dashboard(r, 10).decisions.items).toEqual([]);
    // The Details panel's line under "Phase report": done, never "working" or "waiting on you".
    expect(panelLine(r, null)).toEqual({ text: 'Answered · 1 of 1 step done', tone: 'ok' });
    const scope = { phase: 'review' as const, label: 'Answer 1', ords: [1] };
    expect(phaseSummary(r, scope)).not.toContain('waiting on you');
    const phase = phaseDashboard(r, scope, 10);
    expect(phase.now.value).toBe('Answer 1 · done');
    expect(phase.decisions.open).toBe(0);
    expect(phase.decisions.items).toEqual([]);
    const feature = report(['build', 'review']);
    expect(openGates(feature)).toHaveLength(1);
    expect(summaryLine(feature)).toContain('1 decision open');
    expect(panelLine(feature, null).tone).toBe('wait');
  });

  it('recognizes all completed answer steps and keeps checks words and plural steps', () => {
    const r = report(['answer-1', 'answer-2']);
    foldRows(r, [{ id: 'checks', topic: 'wicked.run.checks.evaluated', at: 8, seq: null, ord: 2, data: { passed: true, checks: [{ name: 'test', exitCode: 0 }] } }]);
    expect(summaryLine(r)).toBe('Answered · 2 of 2 steps done · checks: 1 passed');
    expect(openGates(r)).toEqual([]);
    // Each condition matters: an unfinished answer, a mixed plan, and a finished run are not parked turns.
    r.units.get(2)!.state = 'running';
    expect(openGates(r)).toHaveLength(1);
    r.units.get(2)!.state = 'done';
    r.units.get(2)!.step = 'answer-review';
    expect(openGates(r)).toHaveLength(1);
    r.units.get(2)!.step = 'answer-2';
    r.finished = { outcome: 'completed', at: 9 };
    expect(summaryLine(r)).toBe('Finished · 2 of 2 steps done · checks: 1 passed');
    expect(summaryLine({ ...emptyReport(), loaded: true })).toBe('No events yet');
  });
});
