/**
 * Power mode for run plugins (DES-PLUGIN-EVENTS §3.1, DES-POWER-MODE §8): the power frames become `wicked.run.*` topic
 * rows (api-types 0.149.0's RunBusType names) as CLOSED projections — rigor words, numbers and seat ids, never the
 * reasons, summaries or plan text — and the Phase report folds them into its rigor history, checkpoints and turn.
 */
import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { RUN_TOPICS, toRow, type TopicRow } from '../src/editors/runEvents.js';
import { dashboard, emptyReport, foldRows, summaryLine } from '../src/plugins/wicked-phase-report/model.js';
import manifest from '../src/plugins/wicked-phase-report/manifest.json';
import { topicWords } from '../src/plugins/runPlugins.js';
import { at, buildEvents } from './powerFixtures.js';

const rows = (events: Array<Record<string, unknown>>): TopicRow[] =>
  events.map((e, i) => toRow(e as unknown as CoreEvent, 'r-pm', at(0), `s${i}`, (cli) => ({ claude: 'Claude Code', codex: 'Codex', pi: 'Pi CLI' } as Record<string, string>)[cli] ?? null))
    .filter((r): r is TopicRow => r !== null);

describe('power frames as topic rows', () => {
  const all = rows(buildEvents(true));
  it('each power frame has its topic, named as the bus mirror names it', () => {
    expect([...new Set(all.map((r) => r.topic))]).toEqual(expect.arrayContaining([
      'wicked.run.intake.planned', 'wicked.run.rigor.rescored', 'wicked.run.checkpoint.reached', 'wicked.run.turn.started',
      'wicked.run.turn.completed', 'wicked.run.handoff.stepped',
    ]));
    for (const t of ['wicked.run.intake.planned', 'wicked.run.rigor.rescored', 'wicked.run.checkpoint.reached', 'wicked.run.turn.started', 'wicked.run.turn.completed', 'wicked.run.handoff.stepped', 'wicked.run.power.toggled']) {
      expect(RUN_TOPICS[t]).toBeDefined();
    }
  });
  it('no free text reaches a plugin: no reasons, summaries, plan risks, paths or commit subjects', () => {
    const text = JSON.stringify(all);
    for (const leak of ['sign-in module touched', 'Found it', 'JPY has no minor unit', 'EUR renders', 'reach 12', 'src/lib/money.ts', 'Format invoice amounts']) {
      expect(text).not.toContain(leak);
    }
    // Activity frames have no topic at all.
    expect(all.some((r) => r.data['kind'] === 'edit')).toBe(false);
  });
  it('a rescore row carries the rigor words, the scores, the checkpoint and who kind', () => {
    const up = all.find((r) => r.topic === 'wicked.run.rigor.rescored' && r.data['to'] === 'high')!;
    expect(up.data).toMatchObject({ seq: 3, trigger: 'commit', from: 'standard', to: 'high', direction: 'up', planned: 34, actual: 58, checkpoint: 2, byKind: 'engine' });
    expect(up.at).toBe(at(17));
  });
  it('the Phase report asks for the power topics, each with a reason, and each has plain words on the Plugins page', () => {
    const topics = manifest.observe.map((o) => o.topic);
    expect(topics).toEqual(expect.arrayContaining(['wicked.run.intake.planned', 'wicked.run.rigor.rescored', 'wicked.run.checkpoint.reached', 'wicked.run.turn.*', 'wicked.run.handoff.stepped', 'wicked.run.power.toggled']));
    for (const o of manifest.observe) {
      expect(o.why.length).toBeGreaterThan(10);
      expect(topicWords(o.topic)).not.toBe(o.topic);
    }
  });
});

describe('the Phase report in a power run', () => {
  const report = (): ReturnType<typeof emptyReport> => {
    const r = emptyReport();
    foldRows(r, rows(buildEvents()));
    r.loaded = true;
    return r;
  };
  it('the folded line: the stage, the rigor (↑ when it rose), the checkpoint', () => {
    expect(summaryLine(report())).toBe('Building · rigor high ↑ · checkpoint 2');
  });
  it('the dashboard: the rigor history and "Now" with the checkpoint and the orchestrator\'s turn', () => {
    const d = dashboard(report(), at(20));
    expect(d.rigor!.map((h) => `${h.arrow}${h.to}`)).toEqual(['standard', '↑high']);
    expect(d.rigor![1]!.words).toMatch(/checkpoint 2, score 34 → 58$/);
    expect(d.now.value).toBe('Building · checkpoint 2 · turn 1');
    expect(d.now.sub).toMatch(/^Claude Code · orchestrator · turn 1 ended \d\d:\d\d$/);
    expect(d.handoff).toBeNull();
  });
  it('at hand-off: the stage, and the hand-off steps with their status', () => {
    const r = emptyReport();
    foldRows(r, rows(buildEvents(true)));
    r.loaded = true;
    expect(summaryLine(r)).toBe('Hand-off · rigor high ↑ · checkpoint 2');
    expect(dashboard(r, at(40)).handoff).toEqual([
      { name: 'Checks', status: 'passed' }, { name: 'Review · Codex', status: 'passed' }, { name: 'QE · Pi CLI', status: 'running' }, { name: 'Compliance', status: 'pending' },
    ]);
  });
  it('a phased run with an intake plan keeps its steps\' line, and shows the rigor history', () => {
    const r = emptyReport();
    foldRows(r, rows(buildEvents().slice(0, 6)));
    r.loaded = true;
    expect(summaryLine(r)).not.toMatch(/^Intake · rigor/);
    expect(dashboard(r, at(5)).rigor).toHaveLength(1);
  });
  it('a row heard twice changes nothing', () => {
    const r = report();
    const before = JSON.stringify(dashboard(r, at(20)));
    foldRows(r, rows(buildEvents()));
    expect(JSON.stringify(dashboard(r, at(20)))).toBe(before);
  });
});
