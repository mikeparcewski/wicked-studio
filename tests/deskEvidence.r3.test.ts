import { describe, expect, it } from 'vitest';
import type { SeatRecordResponse } from '../src/api/types.js';
import { agentRows, callouts, workflowRows } from '../src/board/deskInsights.js';
import { compareProjects, compareWorkflows } from '../src/board/deskCompare.js';
import { median, pulse } from '../src/board/deskPulse.js';
import { DAY, NOW, deskRun, names } from './fixtures/deskV2.js';

const record: SeatRecordResponse = {
  days: 30, since: NOW - 30 * DAY, until: NOW, runsRead: 2, truncated: false,
  seats: [{ cli: 'claude', units: 10, gated: 10, firstPass: 2, rework: 8, stalls: 0,
    benched: 3, benchReasons: { quota: 3 }, costUsd: 20, costedUsage: 10, byPhase: {} }],
};

describe('Desk evidence review r3', () => {
  it('excludes agent totals and findings under a workflow filter while retaining run findings', () => {
    const kept = [deskRun('failed', { status: 'failed' })];
    const agents = agentRows(record, kept, names, []);
    expect(agents[0]).toMatchObject({ steps: 10, benched: 3, rework: 8, costUsd: 20 });
    expect(agentRows(record, kept, names, ['claude'], 'fix-bug')).toEqual([]);
    const input = { agents, workflows: workflowRows(kept), acp: { claude: { fallbacks: 4, kinds: { session_died: 4 } } }, openFailures: 1, days: 30 as const };
    expect(callouts(input).map((c) => c.id)).toEqual(['bench:claude', 'acp:claude', 'failures', 'rework:claude']);
    expect(callouts({ ...input, workflow: 'fix-bug' }).map((c) => c.id)).toEqual(['failures']);
  });

  it.each([
    { sample: [2, 100], expected: 51 },
    { sample: [2, 10, 100], expected: 10 },
    { sample: [2], expected: 2 },
    { sample: [], expected: null },
  ])('uses the same median for workflows, projects and pulse: $sample', ({ sample, expected }) => {
    const runs = sample.map((minutes, i) => deskRun(`timed-${i}`, { ended_at: (NOW - DAY) / 1000 + minutes * 60 }));
    if (sample.length > 0) expect(median(sample)).toBe(expected);
    expect(workflowRows(runs)[0]?.medianMin ?? null).toBe(expected);
    expect(pulse(runs, 30, NOW).typicalMin).toBe(expected);
    const view = compareProjects(['studio'], runs, names.project);
    expect(view.cards[0]?.cells[view.rows.indexOf('Typical time')]?.text).toBe(expected === null ? '—' : `${expected} min`);
  });

  it('awards best typical time to the faster median rather than the lower middle duration', () => {
    const runs = [
      deskRun('short', { ended_at: (NOW - DAY) / 1000 + 2 * 60 }),
      deskRun('long', { ended_at: (NOW - DAY) / 1000 + 100 * 60 }),
      deskRun('steady', { project_id: 'crew', ended_at: (NOW - DAY) / 1000 + 30 * 60,
        run_identity: { kind: 'workflow', name: 'steady', user_plan: false, system: false } }),
    ];
    const flows = compareWorkflows(workflowRows(runs));
    const projects = compareProjects(['studio', 'crew'], runs, names.project);
    for (const [view, winner, loser] of [[flows, 'steady', 'fix-bug'], [projects, 'crew', 'studio']] as const) {
      const index = view.rows.indexOf('Typical time');
      expect(view.cards.find((c) => c.id === winner)?.cells[index]).toMatchObject({ text: '30 min', best: true });
      expect(view.cards.find((c) => c.id === loser)?.cells[index]).toMatchObject({ text: '51 min', best: false });
    }
  });
});
