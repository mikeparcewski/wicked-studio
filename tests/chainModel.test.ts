// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import type { RunTeamResponse, TeamRow } from '../src/api/teamPlan.js';
import { blockOf, chainFromTeam, chainFromUnits, chainOf, chainSentence } from '../src/board/chainModel.js';
import { EMPTY_FOLD, foldFrame, foldRows, hydrateFold, teamFrameOf } from '../src/store/teamPlan.js';

/**
 * The session chain (DES-STUDIO-REBUILD-001 §5.2, slice S6a): the team-plan fold (hydrate from
 * `GET /runs/:id/team`, then live `teamEvent` frames by `event_id`, no double-apply, late join) and
 * the chain line it renders. "checked" is never derived here: it needs `check_state` (WT).
 */

let seq = 0;
function row(event_type: string, payload: Record<string, unknown>, event_id = ++seq): TeamRow {
  return { event_id, event_type, payload: { run_id: 'r1', ord: null, attempt: null, by: 'engine', at: 1, re: null, ...payload } };
}

const STEPS = [
  { catalog: 'understand', id: 'understand' },
  { catalog: 'build', id: 'build' },
  { catalog: 'review', id: 'review', added_by: 'floor', floor_reason: 'band 20+ always reviews' },
  { catalog: 'deliver', id: 'deliver' },
];

function team(rows: TeamRow[], over: Partial<RunTeamResponse> = {}): RunTeamResponse {
  return { runId: 'r1', teamed: true, transport: 'bus', reason: null, planRev: 1, ended: false, rows, units: [], ...over };
}

describe('blockOf (the §5.2 block table, catalog ids at wicked-core src/catalog.rs)', () => {
  it.each([
    ['understand', 'research'], ['test_plan', 'plan'], ['design', 'plan'], ['architecture', 'plan'],
    ['build', 'build'], ['produce', 'write'], ['test', 'test'], ['domain_coverage', 'test'],
    ['review', 'review'], ['critique', 'review'], ['security_review', 'review'],
    ['walkthrough_review', 'walkthrough'], ['deliver', 'deliver'], ['run', 'tool'],
    ['something_new', 'tool'],
  ])('%s → %s', (cat, block) => {
    expect(blockOf(cat)).toBe(block);
  });
  it('a run step the operator owns is "yours"', () => {
    expect(blockOf('run', 'operator')).toBe('yours');
  });
});

describe('the team fold', () => {
  it('hydrates, then follows live frames in event order with no double-apply', () => {
    const accepted = row('wicked.team.plan.accepted', { plan_rev: 1, steps: STEPS }, 10);
    let f = hydrateFold(EMPTY_FOLD, team([accepted]));
    const claim = row('wicked.team.step.claimed', { step_id: 'understand' }, 11);
    f = foldFrame(f, claim);
    f = foldFrame(f, claim); // the same frame twice (reconnect replay)
    expect(f.rows.map((r) => r.event_id)).toEqual([10, 11]);
    // A late hydrate that carries a row we already have, plus one we missed.
    const done = row('wicked.team.step.completed', { step_id: 'understand', status: 'ok' }, 12);
    f = hydrateFold(f, team([accepted, claim, done]));
    expect(f.rows.map((r) => r.event_id)).toEqual([10, 11, 12]);
  });

  it('late join: frames that arrive before the hydrate are kept, and order is by event_id', () => {
    const accepted = row('wicked.team.plan.accepted', { plan_rev: 1, steps: STEPS }, 20);
    const done = row('wicked.team.step.completed', { step_id: 'understand', status: 'ok' }, 22);
    const claim = row('wicked.team.step.claimed', { step_id: 'understand' }, 21);
    let f = foldFrame(EMPTY_FOLD, done); // arrived first over /ws
    f = hydrateFold(f, team([accepted, claim]));
    expect(f.rows.map((r) => r.event_id)).toEqual([20, 21, 22]);
    expect(chainFromTeam(f).steps[0]!.state).toBe('done');
  });

  it('reads a teamEvent frame (and nothing else)', () => {
    const r = row('wicked.team.step.claimed', { step_id: 'build' }, 5);
    expect(teamFrameOf({ type: 'teamEvent', event: r } as never)).toEqual({ runId: 'r1', row: r });
    expect(teamFrameOf({ type: 'unitOutputDelta', session: 'r1' } as never)).toBeNull();
    expect(teamFrameOf({ type: 'teamEvent', event: { event_type: 'x' } } as never)).toBeNull();
  });

  it('foldRows ignores a row without an event id', () => {
    expect(foldRows(EMPTY_FOLD, [{ event_type: 'x', payload: {} } as unknown as TeamRow]).rows).toEqual([]);
  });
});

describe('chainFromTeam', () => {
  it('steps from the accepted plan; claimed → running, completed ok → done, failed → failed', () => {
    let f = hydrateFold(EMPTY_FOLD, team([
      row('wicked.team.plan.accepted', { plan_rev: 1, steps: STEPS }, 30),
      row('wicked.team.step.claimed', { step_id: 'understand' }, 31),
      row('wicked.team.step.completed', { step_id: 'understand', status: 'ok' }, 32),
      row('wicked.team.step.claimed', { step_id: 'build' }, 33),
    ]));
    let c = chainFromTeam(f);
    expect(c.steps.map((s) => [s.id, s.block, s.state])).toEqual([
      ['understand', 'research', 'done'], ['build', 'build', 'running'],
      ['review', 'review', 'todo'], ['deliver', 'deliver', 'todo'],
    ]);
    expect(c.steps[2]).toMatchObject({ addedBy: 'floor', reason: 'band 20+ always reviews' });
    f = foldFrame(f, row('wicked.team.step.completed', { step_id: 'build', status: 'failed' }, 34));
    c = chainFromTeam(f);
    expect(c.steps[1]!.state).toBe('failed');
    expect(chainSentence(c)).toBe('1 of 4 done');
  });

  it('a later plan revision adds its steps once, marked late', () => {
    const f = hydrateFold(EMPTY_FOLD, team([
      row('wicked.team.plan.accepted', { plan_rev: 1, steps: STEPS }, 40),
      row('wicked.team.plan.revised', { plan_rev: 2, reason: 'pa_added', added: [{ catalog: 'test', id: 'test' }] }, 41),
      row('wicked.team.plan.accepted', { plan_rev: 2, steps: [...STEPS.slice(0, 3), { catalog: 'test', id: 'test' }, STEPS[3]] }, 42),
    ]));
    const c = chainFromTeam(f);
    expect(c.steps.map((s) => s.id)).toEqual(['understand', 'build', 'review', 'test', 'deliver']);
    expect(c.steps[3]).toMatchObject({ late: true, addedBy: 'pa', block: 'test' });
  });

  it('before any plan is accepted, the proposed plan is shown as proposed', () => {
    const f = hydrateFold(EMPTY_FOLD, team([row('wicked.team.plan.proposed', { proposal_id: 'p1', steps: STEPS }, 50)]));
    const c = chainFromTeam(f);
    expect(c.proposed).toBe(true);
    expect(c.steps.every((s) => s.state === 'todo')).toBe(true);
  });

  it('never says "checked": no check_state comes from the team stream', () => {
    const f = hydrateFold(EMPTY_FOLD, team([
      row('wicked.team.plan.accepted', { plan_rev: 1, steps: STEPS }, 60),
      ...STEPS.map((s, i) => row('wicked.team.step.completed', { step_id: s.id, status: 'ok' }, 61 + i)),
    ]));
    const c = chainFromTeam(f);
    expect(c.checked).toBeNull();
    expect(c.steps.some((s) => s.state === 'checked')).toBe(false);
    expect(chainSentence(c)).toBe('4 of 4 done');
    expect(chainSentence(c)).not.toMatch(/checked/);
  });

  it('an un-teamed run (transport none) says so, with the reason', () => {
    const f = hydrateFold(EMPTY_FOLD, team([], { transport: 'none', reason: 'bus unreachable at launch' }));
    expect(chainFromTeam(f).transportLine).toBe('Team transport unavailable: bus unreachable at launch');
  });

  it('a user plan marks its steps as the operator\'s', () => {
    const f = hydrateFold(EMPTY_FOLD, team([row('wicked.team.plan.accepted', { plan_rev: 1, steps: STEPS }, 70)]));
    expect(chainFromTeam(f, { userPlan: true }).steps.map((s) => s.addedBy)).toEqual(['human', 'human', 'floor', 'human']);
  });

  it('an unknown catalog id is a tool step labelled from the catalog, never hidden', () => {
    const f = hydrateFold(EMPTY_FOLD, team([row('wicked.team.plan.accepted', {
      plan_rev: 1, steps: [{ catalog: 'pa-scope', id: 'pa-scope' }, { catalog: 'lint_it', id: 'lint_it' }],
    }, 80)]));
    const c = chainFromTeam(f, { catalogLabels: { lint_it: 'Lint the change' } });
    expect(c.steps.map((s) => [s.block, s.label])).toEqual([['tool', 'Pa scope'], ['tool', 'Lint the change']]);
  });
});

describe('chainFromUnits (a run that is not a team run)', () => {
  function view(units: Array<{ status: string; phase_ref?: string | null; description: string; stage?: string }>, status = 'executing'): SessionView {
    return {
      session: { id: 'r9', status, problem: 'p', unit_ix: 1 },
      units: units.map((u, ord) => ({ ord, phase_ref: null, stage: 'build', ...u })),
    } as unknown as SessionView;
  }
  it('done → done, rejected → failed; only the cursor unit of an executing run is running', () => {
    const c = chainFromUnits(view([
      { status: 'done', phase_ref: 'understand', description: 'read the code' },
      { status: 'distributed', phase_ref: 'build', description: 'fix it' },
      // Routed, not running (Copilot): every unit is distributed before any runs.
      { status: 'distributed', phase_ref: 'review', description: 'review it' },
      { status: 'rejected', phase_ref: null, description: 'odd one', stage: 'test' },
    ]));
    expect(c.source).toBe('units');
    expect(c.steps.map((s) => [s.block, s.state, s.label])).toEqual([
      ['research', 'done', 'read the code'], ['build', 'running', 'fix it'],
      ['review', 'todo', 'review it'], ['test', 'failed', 'odd one'],
    ]);
  });
  it('a run paused at a gate has no running unit', () => {
    const c = chainFromUnits(view([
      { status: 'done', phase_ref: 'understand', description: 'a' },
      { status: 'distributed', phase_ref: 'build', description: 'b' },
    ], 'awaiting_human'));
    expect(c.steps.map((s) => s.state)).toEqual(['done', 'todo']);
  });
  it('chainOf picks the units when the run is not teamed', () => {
    const v = view([{ status: 'done', phase_ref: 'build', description: 'b' }], 'completed');
    const notTeamed = hydrateFold(EMPTY_FOLD, team([], { teamed: false, transport: null }));
    expect(chainOf(v, notTeamed).source).toBe('units');
    expect(chainOf(v, null).source).toBe('units');
  });
});

describe('the team-plan store', () => {
  it('folds frames only for runs a session tracks, once each', async () => {
    const { useTeamPlanStore } = await import('../src/store/teamPlan.js');
    const r = row('wicked.team.step.claimed', { step_id: 'build', run_id: 'tracked' }, 500);
    const other = row('wicked.team.step.claimed', { step_id: 'build', run_id: 'untracked' }, 501);
    useTeamPlanStore.getState().track('tracked');
    useTeamPlanStore.getState().ingest({ type: 'teamEvent', event: r });
    useTeamPlanStore.getState().ingest({ type: 'teamEvent', event: r });
    useTeamPlanStore.getState().ingest({ type: 'teamEvent', event: other });
    expect(useTeamPlanStore.getState().byRun['tracked']!.rows.map((x) => x.event_id)).toEqual([500]);
    expect(useTeamPlanStore.getState().byRun['untracked']).toBeUndefined();
  });
});

describe('the team-plan store releases a run nobody shows (codex)', () => {
  it('track is counted; the last untrack drops the fold and stops folding its frames', async () => {
    const { useTeamPlanStore } = await import('../src/store/teamPlan.js');
    const st = useTeamPlanStore.getState();
    st.track('twice');
    st.track('twice');
    st.untrack('twice');
    expect(useTeamPlanStore.getState().byRun['twice']).toBeDefined();
    useTeamPlanStore.getState().untrack('twice');
    expect(useTeamPlanStore.getState().byRun['twice']).toBeUndefined();
    useTeamPlanStore.getState().ingest({ type: 'teamEvent', event: row('wicked.team.step.claimed', { step_id: 'b', run_id: 'twice' }, 600) });
    expect(useTeamPlanStore.getState().byRun['twice']).toBeUndefined();
  });
});
