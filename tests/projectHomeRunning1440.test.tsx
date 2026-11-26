/**
 * studio#1440 (train-14 cert, sitrep row 52): the project page said "Two things need you. Nothing is running." while
 * its own In progress list showed a Working job, and that row said "step 5 of 10" for a run its session put at
 * "Step 9 of 10". The sentence now counts the list's own jobs, and every In progress row reads the session's step rule.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project, SessionView } from '../src/api/types.js';
import { normalizeSnapshot } from '../src/api/system.js';
import { chainFromUnits, stepNow } from '../src/board/chainModel.js';
import { progressRows } from '../src/board/deskHome.js';
import { homeProgress } from '../src/board/projectHome.js';
import { ProjectHome } from '../src/components/desk/ProjectHome.js';
import { resetSystemStore, useSystemStore } from '../src/store/systemSnapshot.js';
import { makeUnit, makeView } from './factories.js';

const RID = 'run-1440';
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

describe('the project sentence counts the jobs its In progress list shows', () => {
  beforeEach(() => {
    resetSystemStore();
    // A ranked crew: one item that only slows this job (a helper signed out), so the job is in the item's
    // blockedRunIds while it still works.
    useSystemStore.setState({
      mode: 'system',
      healthError: null,
      snapshot: normalizeSnapshot({
        runs: [], infra: [], clis: [], governance: [], unresolved: [],
        attention: [{ id: 'cli:out:pi', severity: 'yellow', source: 'cli', kind: 'slows', title: 'Pi is signed out', reason: '1 job you picked it for needs it', remedy: 'Sign Pi in again.', blocks: 1, blockedRunIds: [RID], target: { kind: 'cli', cli: 'pi' }, action: { kind: 'sign_in', label: 'Sign in' } }],
      }),
    } as never);
  });
  afterEach(() => { cleanup(); resetSystemStore(); });

  it('a Working job that a need only slows is running, not "Nothing is running"', () => {
    const project = { id: 'p1', name: 'CardDemo T14', description: null, status: 'active', scope: 'project:p1', created_at: 0, updated_at: 0 } as unknown as Project;
    render(<ProjectHome project={project} projectId="p1" runs={[working()]} allRuns={[working()]} needRows={[]} repos={[]} now={Date.now()} known loading={false} navigate={() => {}} isDefault={false} />);
    expect(screen.getAllByTestId('project-progress-row')).toHaveLength(1);
    expect(screen.getByTestId('project-sentence').textContent).not.toMatch(/Nothing is running/);
    expect(screen.getByTestId('project-sentence')).toHaveTextContent('One job is running.');
  });
});
