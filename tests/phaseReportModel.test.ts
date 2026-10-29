import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { toRow, type TopicRow } from '../src/editors/runEvents.js';
import { dashboard, emptyReport, foldRows, summaryLine } from '../src/plugins/wicked-phase-report/model.js';
import manifest from '../src/plugins/wicked-phase-report/manifest.json';
import fixture from './fixtures/runEvents-crew-fix.json';

/** The phase report v0 over a real run's events (a crew fix run on the rig: 10 steps, 2 failed floors, reused checks). */

const names = (cli: string) => ({ claude: 'Claude Code', codex: 'Codex' } as Record<string, string>)[cli] ?? null;
const rows: TopicRow[] = (fixture as unknown as CoreEvent[])
  .map((e) => toRow(e, 'run-2410', 0, `s${String(e.seq)}`, names))
  .filter((r): r is TopicRow => r !== null);
const upTo = (seq: number) => rows.filter((r) => (r.seq ?? 0) <= seq);
/** A report the replay has reached (the plugin marks it on its first batch). */
const loaded = () => ({ ...emptyReport(), loaded: true });

describe('the phase report', () => {
  it('folds to the brief’s one line while the job runs', () => {
    // At the fix step's failed floor, waiting on the operator.
    const r = loaded();
    foldRows(r, upTo(139));
    expect(summaryLine(r)).toBe('Fix · step 6 of 10 · checks: 3 of 4 passed · 1 decision open');
    // At the check step's reused floor.
    const v = loaded();
    foldRows(v, upTo(184));
    expect(summaryLine(v)).toBe('Check · step 9 of 10 · checks: 3 of 4 passed (reused from Fix) · 1 decision open');
  });

  it('says the end, and its dashboard has now, checks, decisions, helpers and time', () => {
    const r = loaded();
    foldRows(r, rows);
    expect(summaryLine(r)).toBe('Finished · 10 of 10 steps done · checks: 3 of 4 passed (reused from Fix)');
    const d = dashboard(r, Date.now());
    expect(d.now.value).toBe('Finished');
    expect(d.checks[0]?.reused).toBe('Reused from Fix: typecheck, lint, test_targeted · ran again: install');
    expect(d.checks[0]?.chips.map((c) => `${c.name}${c.ok ? '+' : '-'}${c.reused ? 'R' : ''}`)).toEqual(['install+', 'typecheck+R', 'lint+R', 'test targeted-R']);
    expect(d.decisions).toMatchObject({ open: 0, answered: 4 });
    expect(d.helpers).toEqual([
      { name: 'Claude Code', steps: 'Scope, Plan, Fix' },
      { name: 'Codex', steps: 'Triage, Reproduce, Review, Security check, Check' },
    ]);
    expect(d.time.value).toBe('1 h 19 min');
    expect(d.time.sub).toMatch(/^≈ \$\d+\.\d\d · /u);
  });

  it('says it is reading until the replay arrives, never "no events"', () => {
    expect(summaryLine(emptyReport())).toBe('Reading the job’s events…');
    expect(summaryLine(loaded())).toBe('No events yet');
  });

  it('a failed run that is resumed is running again, and its new decision is open', () => {
    const r = loaded();
    const row = (id: string, topic: string, at: number, ord: number | null, data: Record<string, unknown> = {}) => ({ id, topic, seq: null, at, ord, data });
    foldRows(r, [
      row('a', 'wicked.run.unit.planned', 1, 1, { step: 'fix' }), row('b', 'wicked.run.unit.started', 2, 1),
      row('c', 'wicked.run.unit.finished', 3, 1, { outcome: 'failed' }), row('d', 'wicked.run.session.finished', 4, null, { outcome: 'failed' }),
    ]);
    expect(summaryLine(r)).toMatch(/^Failed/u);
    foldRows(r, [row('e', 'wicked.run.session.resumed', 5, 1), row('f', 'wicked.run.unit.started', 6, 1), row('g', 'wicked.run.human.awaited', 7, 1, { kind: 'escalation' })]);
    expect(r.finished).toBeNull();
    expect(summaryLine(r)).toBe('Fix · step 1 of 1 · 1 decision open');
  });

  it('a row heard twice changes nothing', () => {
    const r = loaded();
    expect(foldRows(r, rows)).toBe(true);
    const line = summaryLine(r);
    const cost = r.costUsd;
    expect(foldRows(r, rows)).toBe(false);
    expect(summaryLine(r)).toBe(line);
    expect(r.costUsd).toBe(cost);
  });

  it('asks to observe only run topics, each with a reason', () => {
    expect(manifest.inline).toBe('run-thread');
    expect(manifest.protocol).toEqual([3]);
    for (const o of manifest.observe) {
      expect(o.topic).toMatch(/^wicked\.run\./u);
      expect(o.why.length).toBeGreaterThan(10);
    }
  });
});
