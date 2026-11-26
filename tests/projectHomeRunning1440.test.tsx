/**
 * studio#1440 (train-14 cert, sitrep row 52): the project page said "Two things need you. Nothing is running." while
 * its own In progress list showed a Working job, and that row said "step 5 of 10" for a run its session put at
 * "Step 9 of 10". The sentence now counts the list's own jobs, and every In progress row reads the session's step rule.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project, SessionView } from '../src/api/types.js';
import { normalizeSnapshot } from '../src/api/system.js';
import type { RunTeamResponse, TeamRow } from '../src/api/teamPlan.js';
import { chainFromUnits, chainOf, stepNow } from '../src/board/chainModel.js';
import { EMPTY_FOLD, hydrateFold } from '../src/store/teamPlan.js';
import { progressRows } from '../src/board/deskHome.js';
import { homeProgress } from '../src/board/projectHome.js';
import { ProjectHome } from '../src/components/desk/ProjectHome.js';
import { resetSystemStore, useSystemStore } from '../src/store/systemSnapshot.js';
import { makeUnit, makeView } from './factories.js';

const RID = 'run-1440';
const PROJECT = { id: 'p1', name: 'CardDemo T14', description: null, status: 'active', scope: 'project:p1', created_at: 0, updated_at: 0 } as unknown as Project;
/** A ten-step run on step 9: four steps finished, four still open before it, the cursor on the ninth. */
const working = (): SessionView => makeView({ id: RID, status: 'executing', unit_ix: 8, problem: 'In carddemo, extract the business rules' } as never,
  Array.from({ length: 10 }, (_, i) => makeUnit({
    id: `${RID}:u${i}`, session_id: RID, ord: i, stage: i === 8 ? 'test' : 'build',
    status: i < 4 ? 'done' : 'pending',
  })));

describe('In progress says the step the session says', () => {
  it('the session\'s rule puts the run at step 9 of 10', () => {
    const v = working();
    const chain = chainFromUnits(v);
    expect(chain.steps.indexOf(stepNow(chain)!) + 1).toBe(9);
  });

  it('the project home\'s row says step 9 of 10', () => {
    expect(homeProgress([working()], 5).rows[0]!.line).toMatch(/step 9 of 10$/);
  });

  it('the Desk\'s row says Step 9 of 10', () => {
    expect(progressRows([working()], { max: 5, agentName: () => '' }).rows[0]!.line).toMatch(/^Step 9 of 10/);
  });
});

describe('a team run: its steps are its plan\'s phases, as its session draws them (codex r1 + delta)', () => {
  const TID = 'run-team';
  /** research → build (two units) → test; the cursor on the second build unit. */
  const teamRun = (): SessionView => makeView({ id: TID, status: 'executing', unit_ix: 2, problem: 'add a limiter' } as never,
    [['research', 'done'], ['build', 'done'], ['build', 'pending'], ['test', 'pending']].map(([phase, status], i) => makeUnit({
      id: `${TID}:u${i}`, session_id: TID, ord: i, stage: phase === 'research' ? 'recon' : phase!, status: status!,
      description: `${phase} — add a limiter`, team_run: true,
    } as never)));
  const row = (event_id: number, event_type: string, payload: Record<string, unknown>): TeamRow =>
    ({ event_id, event_type, payload: { run_id: TID, ord: null, attempt: null, by: 'engine', at: 1, re: null, ...payload } }) as TeamRow;
  const fold = hydrateFold(EMPTY_FOLD, { runId: TID, teamed: true, transport: 'bus', reason: null, planRev: 1, ended: false, units: [],
    rows: [row(1, 'wicked.team.plan.accepted', { plan_rev: 1, steps: [{ catalog: 'understand', id: 'research' }, { catalog: 'build', id: 'build' }, { catalog: 'test', id: 'test' }] })] } as RunTeamResponse);

  it('the session draws step 2 of 3', () => {
    const chain = chainOf(teamRun(), fold);
    expect(chain.source).toBe('team');
    expect([chain.steps.indexOf(stepNow(chain)!) + 1, chain.steps.length]).toEqual([2, 3]);
  });

  it('the Desk and project rows say step 2 of 3, not one step per unit', () => {
    expect(progressRows([teamRun()], { max: 5, agentName: () => '' }).rows[0]!.line).toMatch(/^Step 2 of 3/);
    expect(homeProgress([teamRun()], 5).rows[0]!.line).toMatch(/step 2 of 3$/);
  });
});

/** A ranked crew with one item holding this job: `slows` (a helper signed out; it still works) or `prevents`. */
function crewHolds(kind: 'slows' | 'prevents'): void {
  useSystemStore.setState({
    mode: 'system',
    healthError: null,
    snapshot: normalizeSnapshot({
      runs: [], infra: [], clis: [], governance: [], unresolved: [],
      attention: [{ id: 'cli:out:pi', severity: kind === 'slows' ? 'yellow' : 'red', source: 'cli', kind, title: 'Pi is signed out', reason: '1 job you picked it for needs it', remedy: 'Sign Pi in again.', blocks: 1, blockedRunIds: [RID], target: { kind: 'cli', cli: 'pi' }, action: { kind: 'sign_in', label: 'Sign in' } }],
    }),
  } as never);
}

describe('the project sentence counts the jobs its In progress list shows', () => {
  beforeEach(() => { resetSystemStore(); crewHolds('slows'); });
  afterEach(() => { cleanup(); resetSystemStore(); });

  it('a Working job that a need only slows is running, not "Nothing is running"', () => {
    render(<ProjectHome project={PROJECT} projectId="p1" runs={[working()]} allRuns={[working()]} needRows={[]} repos={[]} now={Date.now()} known loading={false} navigate={() => {}} isDefault={false} />);
    expect(screen.getAllByTestId('project-progress-row')).toHaveLength(1);
    expect(screen.getByTestId('project-sentence').textContent).not.toMatch(/Nothing is running/);
    expect(screen.getByTestId('project-sentence')).toHaveTextContent('One job is running.');
  });

  it('a job a need prevents from working is under Needs you: neither listed Working nor counted running (codex r1)', () => {
    crewHolds('prevents');
    render(<ProjectHome project={PROJECT} projectId="p1" runs={[working()]} allRuns={[working()]} needRows={[]} repos={[]} now={Date.now()} known loading={false} navigate={() => {}} isDefault={false} />);
    expect(screen.queryAllByTestId('project-progress-row')).toHaveLength(0);
    expect(screen.getByTestId('project-sentence')).toHaveTextContent('One thing needs you. Nothing is running.');
  });
});
