// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import type { RunTeamResponse, TeamRow } from '../src/api/teamPlan.js';
import { blockOf, chainFromTeam, chainFromUnits, chainOf, chainSentence, planStepLabel, stepLabelOf } from '../src/board/chainModel.js';
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

  it('an unknown catalog id is a tool step labelled from the catalog, never hidden (a known step id keeps its word, studio#442)', () => {
    const f = hydrateFold(EMPTY_FOLD, team([row('wicked.team.plan.accepted', {
      plan_rev: 1, steps: [{ catalog: 'pa-scope', id: 'pa-scope' }, { catalog: 'lint_it', id: 'lint_it' }],
    }, 80)]));
    const c = chainFromTeam(f, { catalogLabels: { lint_it: 'Lint the change' } });
    expect(c.steps.map((s) => [s.block, s.label])).toEqual([['tool', 'Scope'], ['tool', 'Lint the change']]);
  });
});

describe('chainFromUnits (a run that is not a team run)', () => {
  function view(units: Array<{ status: string; phase_ref?: string | null; description: string; stage?: string }>, status = 'executing'): SessionView {
    return {
      session: { id: 'r9', status, problem: 'p', unit_ix: 1 },
      units: units.map((u, ord) => ({ ord, phase_ref: null, stage: 'build', ...u })),
    } as unknown as SessionView;
  }
  it('done → done, rejected → failed; only the cursor unit of an executing run is running (labels are the step words, never the description: studio#440)', () => {
    const c = chainFromUnits(view([
      { status: 'done', phase_ref: 'understand', description: 'read the code' },
      { status: 'distributed', phase_ref: 'build', description: 'fix it' },
      // Routed, not running (Copilot): every unit is distributed before any runs.
      { status: 'distributed', phase_ref: 'review', description: 'review it' },
      { status: 'rejected', phase_ref: null, description: 'odd one', stage: 'test' },
    ]));
    expect(c.source).toBe('units');
    expect(c.steps.map((s) => [s.block, s.state, s.label])).toEqual([
      ['research', 'done', 'Research'], ['build', 'running', 'Build'],
      ['review', 'todo', 'Review'], ['test', 'failed', 'Test'],
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

/**
 * Reel take 02/04/05 (studio#440, #442, #445): the shapes a live crew 0.7.46 run carries. A unit's
 * `description` is `<phase id> — <problem> ||| <the phase's instruction>`; only the first unit's
 * `phase_ref` is set, and it is a workflow address, not a catalog id.
 */
describe('one vocabulary for a run’s steps (studio#440, #442, #445)', () => {
  const PROBLEM = 'Add a SAVE20 discount code to applyDiscount in src/cart.js (20% off).';
  const PHASES = ['pa-scope', 'clarify', 'design', 'build', 'adversarial-review', 'test', 'review', 'deliver'];
  const STAGES = ['recon', 'recon', 'recon', 'build', 'review', 'test', 'review', 'build'];
  const INSTR: Record<string, string> = {
    'pa-scope': ' ||| Scope this run before anything changes (READ ONLY: edit nothing). End with exactly one line: SCOPE {"touch":[]}',
    clarify: ' ||| PHASE SCOPE: this is the clarify phase.',
    deliver: ' ||| Pushes branch wicked/7816ee54-a0bc-434a-84a7-adcedf8839ff to origin (/var/repos/origins/checkout-demo.git) — a local path, so no pull request can be opened against it. Push identity: none configured.',
  };
  function liveView(status: string, unitStatus: (ord: number) => string, unitIx = 0, n = 8): SessionView {
    return {
      session: { id: '7816ee54-a0bc-434a-84a7-adcedf8839ff', status, problem: PROBLEM, unit_ix: unitIx },
      units: PHASES.slice(0, n).map((ph, i) => ({
        ord: i + 1, stage: STAGES[i], status: unitStatus(i + 1),
        phase_ref: i === 0 ? 'wf-7816ee54-a0bc-434a-84a7-adcedf8839ff:unit-1' : null,
        description: `${ph} — ${PROBLEM}${INSTR[ph] ?? ''}`,
      })),
    } as unknown as SessionView;
  }
  const TEAM_STEPS = [
    { catalog: 'understand', id: 'pa-scope' }, { catalog: 'understand', id: 'clarify' }, { catalog: 'design', id: 'design' },
    { catalog: 'build', id: 'build' }, { catalog: 'review', id: 'adversarial-review' }, { catalog: 'test', id: 'test' },
    { catalog: 'critique', id: 'review' },
  ];
  const WORDS = ['Scope', 'Clarify', 'Plan', 'Build', 'Challenge', 'Test', 'Review'];

  it('#440: before the team fold, the units read as the same words — never the unit prompt, the phase id or a path', () => {
    const c = chainFromUnits(liveView('executing', (o) => (o < 4 ? 'done' : 'distributed'), 3));
    expect(c.steps.map((s) => s.label)).toEqual([...WORDS, 'Deliver']);
    for (const s of c.steps) expect(s.label).not.toMatch(/\|\|\||—|\/|SAVE20|pa-scope/);
    expect(c.steps.map((s) => s.block)).toEqual(['research', 'research', 'plan', 'build', 'review', 'test', 'review', 'deliver']);
  });

  it('#442: the team fold names each step once, distinct within the run', () => {
    const f = hydrateFold(EMPTY_FOLD, team([row('wicked.team.plan.accepted', { plan_rev: 2, steps: TEAM_STEPS }, 300)]));
    const c = chainFromTeam(f);
    expect(c.steps.map((s) => s.label)).toEqual(WORDS);
    expect(new Set(c.steps.map((s) => s.label)).size).toBe(c.steps.length);
  });

  it('#442: two steps of one block that the table does not name are still told apart', () => {
    const f = hydrateFold(EMPTY_FOLD, team([row('wicked.team.plan.accepted', {
      plan_rev: 1, steps: [{ catalog: 'review', id: 'security-pass' }, { catalog: 'critique', id: 'final-pass' }, { catalog: 'run', id: 'index' }, { catalog: 'run', id: 'annotate' }],
    }, 310)]));
    const labels = chainFromTeam(f, { catalogLabels: { run: 'Run a command' } }).steps.map((s) => s.label);
    expect(new Set(labels).size).toBe(4);
    expect(labels).toEqual(['Security pass', 'Final pass', 'Index', 'Annotate']);
  });

  it('#440: the status sentence before the fold names the running step in words', () => {
    // statusSentence reads the running step's label; the label itself is the guard.
    const c = chainFromUnits(liveView('executing', (o) => (o < 4 ? 'done' : 'distributed'), 3, 7));
    expect(c.steps.find((s) => s.state === 'running')?.label).toBe('Build');
    expect(chainSentence(c)).toBe('3 of 7 done');
  });

  it('#445: a delivered team run counts its deliver step done from the unit, 8 of 8', () => {
    const steps = [...TEAM_STEPS, { catalog: 'deliver', id: 'deliver' }];
    const rows: TeamRow[] = [row('wicked.team.plan.accepted', { plan_rev: 2, steps }, 400)];
    let id = 401;
    for (const s of TEAM_STEPS) { // the deliver Tool unit never reaches the team bus
      rows.push(row('wicked.team.step.claimed', { step_id: s.id }, id++));
      rows.push(row('wicked.team.step.completed', { step_id: s.id, status: 'ok' }, id++));
    }
    const f = hydrateFold(EMPTY_FOLD, team(rows));
    const c = chainOf(liveView('completed', () => 'done', 8), f);
    expect(c.source).toBe('team');
    expect(c.steps.at(-1)).toMatchObject({ id: 'deliver', label: 'Deliver', state: 'done' });
    expect(chainSentence(c)).toBe('8 of 8 done');
  });

  it('#445: a unit not yet done never marks its step done', () => {
    const steps = [...TEAM_STEPS, { catalog: 'deliver', id: 'deliver' }];
    const f = hydrateFold(EMPTY_FOLD, team([row('wicked.team.plan.accepted', { plan_rev: 2, steps }, 500)]));
    const c = chainOf(liveView('awaiting_human', (o) => (o < 8 ? 'done' : 'pending'), 7), f);
    expect(c.steps.at(-1)?.state).toBe('todo');
    expect(c.steps.slice(0, 7).every((s) => s.state === 'done')).toBe(true);
    expect(chainSentence(c)).toBe('7 of 8 done');
  });

  it('#442: a newer proposal than the accepted plan is the chain’s pending plan, in the same words', () => {
    const f = hydrateFold(EMPTY_FOLD, team([
      row('wicked.team.plan.accepted', { plan_rev: 1, steps: [{ catalog: 'understand', id: 'pa-scope' }] }, 600),
      row('wicked.team.plan.proposed', { steps: TEAM_STEPS }, 601),
    ]));
    const c = chainFromTeam(f);
    expect(c.pending?.map((s) => s.label)).toEqual(WORDS);
  });
});

describe('studio#442: the line lists what the plan gate asks about', () => {
  it('the proposal’s new steps follow the accepted ones, not started, with one label each', () => {
    const f = hydrateFold(EMPTY_FOLD, team([
      row('wicked.team.plan.accepted', { plan_rev: 1, steps: [{ catalog: 'understand', id: 'pa-scope' }] }, 700),
      row('wicked.team.step.claimed', { step_id: 'pa-scope' }, 701),
      row('wicked.team.step.completed', { step_id: 'pa-scope', status: 'ok' }, 702),
      row('wicked.team.plan.proposed', { steps: [{ catalog: 'understand', id: 'pa-scope' }, { catalog: 'understand', id: 'clarify' }, { catalog: 'review', id: 'adversarial-review' }, { catalog: 'critique', id: 'review' }] }, 703),
    ]));
    const c = chainFromTeam(f);
    expect(c.steps.map((s) => [s.label, s.state])).toEqual([['Scope', 'done'], ['Clarify', 'todo'], ['Challenge', 'todo'], ['Review', 'todo']]);
    expect(c.pending?.map((s) => s.label)).toEqual(c.steps.map((s) => s.label));
    expect(chainSentence(c)).toBe('1 of 4 done');
  });
});

// ── studio#574: the chain's naming rule, for a caller holding the engine's {id, catalog} pairs ────

describe('studio#574: planStepLabel — the chain’s rule for an {id, catalog} pair', () => {
  it('a known id takes its word whatever its catalog; an unknown id its catalog’s block word; no catalog → the id in words', () => {
    expect(planStepLabel('clarify', 'understand')).toBe('Clarify');
    expect(planStepLabel('adversarial-review', 'review')).toBe('Challenge');
    expect(planStepLabel('understand', 'understand')).toBe(stepLabelOf('understand'));
    expect(planStepLabel('fix-the-importer', 'build')).toBe('Build');
    expect(planStepLabel('fix-the-importer', null)).toBe('Fix the importer');
    expect(planStepLabel(null, 'test')).toBe('Test');
    expect(planStepLabel(null, null)).toBe('Step');
  });
  it('agrees with the chain’s own labels for every step of a team plan', () => {
    const ids = ['pa-scope', 'clarify', 'design', 'build', 'adversarial-review', 'test', 'review', 'deliver'];
    const catalogs = ['understand', 'understand', 'design', 'build', 'review', 'test', 'review', 'deliver'];
    expect(ids.map((id, i) => planStepLabel(id, catalogs[i]!))).toStrictEqual(ids.map((id) => stepLabelOf(id)));
  });
});
