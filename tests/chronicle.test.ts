import { describe, expect, it } from 'vitest';
import type { AuditEntry, SessionView } from '../src/api/types.js';
import {
  assembleChains, chainInProgress, chainStatus, completedPhases,
  guidanceAmendments, lastCompletedRun, lastWorkflowSelected, passedCriterion,
} from '../src/components/chronicle.js';

/**
 * The work chronicle's pure derivations (DES-UX-002 §3.2/§3.3, slice BC):
 * chain assembly by `retry_of` (EC50), chain-status semantics, the
 * current-state pick (EC53), and the guidance summary's scope+amend filter.
 */

function run(id: string, status: string, over: Partial<SessionView['session']> = {}): SessionView {
  return {
    session: {
      id, workflow_id: 'wf-w2', problem: `problem of ${id}`, entity_mode: 'shared',
      collection_scope: null, clis: ['claude'], status, human_confirm: 'none',
      unit_ix: 0, attempt: 0, workdir: null, repo_ref: null, extra_write_roots: [],
      archived_at: null, archive_note: null, ...over,
    } as SessionView['session'],
    units: [],
  } as unknown as SessionView;
}

describe('assembleChains (§3.2 CLIENT chain assembly, EC50)', () => {
  it('groups a lineage chain under ONE root and keeps standalone runs as their own chains', () => {
    const a = run('r-a', 'failed');
    const b = run('r-b', 'failed', { retry_of: 'r-a', attempt: 1 });
    const c = run('r-c', 'completed', { retry_of: 'r-b', attempt: 2 });
    const solo = run('r-solo', 'executing');
    const chains = assembleChains([a, b, c, solo]);
    expect(chains.map((ch) => ch.map((v) => v.session.id))).toEqual([
      ['r-a', 'r-b', 'r-c'],
      ['r-solo'],
    ]);
  });

  it('a retry_of naming a run OUTSIDE the scope makes an honest root, never a dropped run', () => {
    const orphan = run('r-x', 'completed', { retry_of: 'r-gone' });
    expect(assembleChains([orphan])).toEqual([[orphan]]);
  });

  it('fan-out siblings order by the DTO attempt', () => {
    const a = run('r-a', 'failed');
    const late = run('r-late', 'completed', { retry_of: 'r-a', attempt: 2 });
    const early = run('r-early', 'failed', { retry_of: 'r-a', attempt: 1 });
    const [chain] = assembleChains([a, late, early]);
    expect(chain?.map((v) => v.session.id)).toEqual(['r-a', 'r-early', 'r-late']);
  });
});

describe('chainStatus (§3.3 semantics)', () => {
  it('a moving latest attempt makes the chain live in its own word', () => {
    expect(chainStatus([run('r-a', 'failed'), run('r-b', 'executing')])).toBe('executing');
    expect(chainStatus([run('r-a', 'failed'), run('r-b', 'awaiting_human')])).toBe('awaiting_human');
  });
  it('completed if ANY attempt completed; failed only when ALL failed', () => {
    expect(chainStatus([run('r-a', 'failed'), run('r-b', 'completed')])).toBe('completed');
    expect(chainStatus([run('r-a', 'failed'), run('r-b', 'failed')])).toBe('failed');
    expect(chainStatus([run('r-a', 'failed'), run('r-b', 'cancelled')])).toBe('cancelled');
  });
  it('chainInProgress drives the default-expanded rule', () => {
    expect(chainInProgress([run('r-a', 'failed'), run('r-b', 'executing')])).toBe(true);
    expect(chainInProgress([run('r-a', 'failed'), run('r-b', 'completed')])).toBe(false);
  });
});

describe('the current-state pick (EC53)', () => {
  it('picks the newest completed run by the attach clock; null with none (the honest empty state)', () => {
    const old = run('r-old', 'completed');
    const fresh = run('r-new', 'completed');
    const live = run('r-live', 'executing');
    expect(lastCompletedRun([old, fresh, live], { 'r-old': 100, 'r-new': 900 })).toBe(fresh);
    expect(lastCompletedRun([live], {})).toBeNull();
  });

  it('completedPhases counts done units; criterion/workflow read the durable trail', () => {
    const v = run('r-a', 'completed');
    (v as { units: unknown[] }).units = [
      { status: 'done' }, { status: 'done' }, { status: 'pending' },
    ];
    expect(completedPhases(v)).toBe(2);
    const events = [
      { type: 'workflowSelected', session: 'r-a', workflowId: 'wf-w2', unitCount: 3 },
      { type: 'gateEvaluated', session: 'r-a', ord: 0, criterion: 'tests pass', combined: false },
      { type: 'gateEvaluated', session: 'r-a', ord: 1, criterion: 'review clean', combined: true },
    ];
    expect(passedCriterion(events)).toBe('review clean');
    expect(lastWorkflowSelected(events)).toBe('wf-w2');
    expect(passedCriterion([])).toBeNull();
  });
});

describe('guidanceAmendments (§3.3 scope + amend filter)', () => {
  const entry = (runId: string, detail: Record<string, unknown>): AuditEntry =>
    ({ ts: 1, action: 'gate.decided', actor: { id: 'mika', kind: 'human', trust: 'operator' }, runId, detail });

  it('keeps only in-scope entries that CARRY a non-empty amend, capped at 5', () => {
    const scope = new Set(['r-a', 'r-b']);
    const rows = guidanceAmendments([
      entry('r-a', { approve: true, amend: 'focus the tests' }),
      entry('r-a', { approve: false }), // no amend — a plain decision, not guidance
      entry('r-foreign', { approve: true, amend: 'not this project' }),
      entry('r-b', { approve: true, amend: '   ' }), // blank amend
      ...Array.from({ length: 7 }, (_, i) => entry('r-b', { approve: true, amend: `g${i}` })),
    ], scope);
    expect(rows).toHaveLength(5);
    expect(rows[0]?.detail?.['amend']).toBe('focus the tests');
    expect(rows.every((r) => r.runId !== 'r-foreign')).toBe(true);
  });
});
