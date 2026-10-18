/**
 * The run's team in the Agents and spend section (DES-TEAMING-002 §0, §8.5, §8.8): who leads, who
 * watches and why that many, a watcher that could not open (with its reason), and the steps another
 * helper did or checked — read from the run's `wicked.team.*` rows. ROWS mirror a real bug run on the
 * container floor (crew 0.14.2): the lead re-picked after a failure, score 20 → 1 monitor, every
 * member refused because members ran over ACP.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TeamRow } from '../src/api/teamPlan.js';
import { monitorsForScore, teamRosterOf, watchWhy } from '../src/board/teamRoster.js';
import { TeamRosterView, watchLine } from '../src/components/session/TeamRosterLines.js';

const ACP = 'team monitors ran over ACP, which is removed from the seats (C5); they are not available until the headless carrier hosts them';
let id = 0;
const row = (type: string, payload: Record<string, unknown>): TeamRow => ({ event_id: ++id, event_type: `wicked.team.${type}`, payload });
const ROWS: TeamRow[] = [
  row('path.started', { cli: 'opencode', selection: 'random', roster: ['opencode', 'claude', 'codex', 'pi'] }),
  row('step.claimed', { ord: 1, by: 'opencode', step_id: 'pa-scope', role: 'neutral', kind: 'agent' }),
  row('path.repicked', { from: 'opencode', to: 'claude', reason: 'failed', selection: 'random' }),
  row('step.claimed', { ord: 1, by: 'claude', step_id: 'pa-scope', role: 'neutral', kind: 'agent' }),
  row('path.scored', { score: 20, basis: 'intent', plan: { monitors: 1 } }),
  row('step.claimed', { ord: 2, by: 'claude', step_id: 'triage', role: 'neutral', kind: 'agent' }),
  row('member.joined', { seat: 'opencode', status: 'failed', error: ACP, member_id: 'm1' }),
  row('member.joined', { seat: 'codex', status: 'failed', error: ACP, member_id: 'm2' }),
  row('step.claimed', { ord: 3, by: 'codex', step_id: 'reproduce', role: 'neutral', kind: 'agent' }),
  row('step.claimed', { ord: 4, by: 'claude', step_id: 'fix', role: 'creator', kind: 'agent' }),
  row('step.claimed', { ord: 6, by: 'codex', step_id: 'verify', role: 'evaluator', kind: 'agent' }),
  row('step.claimed', { ord: 7, by: 'engine', step_id: 'deliver', kind: 'tool' }),
];

afterEach(cleanup);

describe('teamRosterOf', () => {
  it('reads the lead, the watch count and why, each member, and the steps other helpers took', () => {
    const t = teamRosterOf(ROWS);
    expect(t.lead).toEqual({ seat: 'claude', selection: 'random', from: 'opencode', repickReason: 'failed' });
    expect(t.watch).toEqual({ score: 20, monitors: 1, why: 'score 20 → 1 monitor' });
    expect(t.members).toEqual([
      { seat: 'opencode', status: 'failed', error: ACP },
      { seat: 'codex', status: 'failed', error: ACP },
    ]);
    expect(t.steps).toEqual([
      { ord: 3, step: 'reproduce', seat: 'codex', kind: 'work' },
      { ord: 6, step: 'verify', seat: 'codex', kind: 'check' },
    ]);
  });

  it('a member that opened later reads as watching; the absent member is kept', () => {
    const t = teamRosterOf([
      row('member.joined', { seat: 'codex', status: 'failed', error: 'x' }),
      row('member.joined', { seat: 'codex', status: 'attached' }),
      row('member.joined', { seat: null, status: 'failed', error: 'the roster has no seat distinct from the PA (claude)' }),
    ]);
    expect(t.members).toEqual([
      { seat: 'codex', status: 'watching', error: null },
      { seat: null, status: 'failed', error: 'the roster has no seat distinct from the PA (claude)' },
    ]);
  });

  it('a seat that watched one step and was refused on another (its own) still reads as watching', () => {
    const t = teamRosterOf([
      row('member.joined', { seat: 'pi', status: 'attached' }),
      row('member.joined', { seat: 'pi', status: 'failed', error: "'pi' is the creator's own seat instance" }),
    ]);
    expect(t.members).toEqual([{ seat: 'pi', status: 'watching', error: null }]);
  });

  // wicked-studio#850, from bug run 5cc8e33a on :7721 (lead codex): pi claimed and did the triage
  // team step (attempt 0), then the lead re-claimed it (attempt 1) to review it and accepted it.
  it('a team step done by a member and reviewed by the lead is the member\'s work', () => {
    const t = teamRosterOf([
      row('path.started', { cli: 'codex', selection: 'chosen' }),
      row('step.claimed', { ord: 1, by: 'codex', step_id: 'pa-scope', role: 'neutral', kind: 'agent', attempt: 0 }),
      row('step.claimed', { ord: 2, by: 'pi', step_id: 'triage', role: 'neutral', kind: 'agent', attempt: 0 }),
      row('step.completed', { ord: 2, by: 'pi', step_id: 'triage', attempt: 0 }),
      row('step.claimed', { ord: 2, by: 'codex', step_id: 'triage', role: 'neutral', kind: 'agent', attempt: 1 }),
      row('step.reviewed', { ord: 2, by: 'codex', step_id: 'triage', verdict: 'accepted', to: null, reason: 'ok', reviewed_attempt: 0 }),
      row('step.claimed', { ord: 3, by: 'pi', step_id: 'reproduce', role: 'neutral', kind: 'agent', attempt: 0 }),
      row('step.claimed', { ord: 4, by: 'codex', step_id: 'fix', role: 'creator', kind: 'agent', attempt: 0 }),
    ]);
    expect(t.steps).toEqual([
      { ord: 2, step: 'triage', seat: 'pi', kind: 'work' },
      { ord: 3, step: 'reproduce', seat: 'pi', kind: 'work' },
    ]);
  });

  it('a review row without the attempt still credits the member; a step the lead took back is the lead\'s', () => {
    const base = [
      row('path.started', { cli: 'codex', selection: 'chosen' }),
      row('step.claimed', { ord: 2, by: 'pi', step_id: 'triage', role: 'neutral', kind: 'agent', attempt: 0 }),
      row('step.claimed', { ord: 2, by: 'codex', step_id: 'triage', role: 'neutral', kind: 'agent', attempt: 1 }),
    ];
    expect(teamRosterOf([...base, row('step.reviewed', { step_id: 'triage', verdict: 'accepted', to: null, reason: '' })]).steps)
      .toEqual([{ ord: 2, step: 'triage', seat: 'pi', kind: 'work' }]);
    expect(teamRosterOf([...base, row('step.reviewed', { step_id: 'triage', verdict: 'rejected', to: 'pa', reason: 'redo', reviewed_attempt: 0 })]).steps)
      .toEqual([]);
    // No review: the latest claim stands (a re-pick to the lead is the lead's step).
    expect(teamRosterOf(base).steps).toEqual([]);
  });

  it('the band only ratchets up, and a row without the plan count reads it from the band', () => {
    const t = teamRosterOf([row('path.scored', { score: 45 }), row('path.scored', { score: 10, plan: { monitors: 0 } })]);
    expect(t.watch).toEqual({ score: 45, monitors: 2, why: 'score 45 → 2 monitors' });
    expect([0, 19, 20, 39, 40, 69, 70, 100].map(monitorsForScore)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(watchWhy(0, 0)).toBe('score 0 → 0 monitors');
  });

  it('a chosen lead says so; no rows reads as nothing', () => {
    expect(teamRosterOf([row('path.started', { cli: 'codex', selection: 'chosen' })]).lead?.selection).toBe('chosen');
    expect(teamRosterOf([])).toEqual({ lead: null, watch: null, members: [], steps: [] });
  });
});

describe('TeamRosterView', () => {
  it('draws who leads, who watches and why, and discloses a member that could not open with its reason', () => {
    render(<TeamRosterView team={teamRosterOf(ROWS)} roster={null} />);
    expect(screen.getByTestId('run-tab-team-lead').textContent).toBe('Leading: claude (picked at random) · took over from opencode (failed)');
    expect(screen.getByTestId('run-tab-team-watch').textContent).toBe('Watching: 1 monitor per step · no seat watched yet (score 20 → 1 monitor)');
    const members = screen.getAllByTestId('run-tab-team-member');
    expect(members.map((m) => m.dataset.status)).toEqual(['failed', 'failed']);
    expect(members[0]!.textContent).toContain('could not watch');
    expect(screen.getAllByTestId('run-tab-team-member-error')[0]!.textContent).toBe(ACP);
    expect(screen.getByTestId('run-tab-team-work').textContent).toBe('Done by other helpers: reproduce (codex)');
    expect(screen.getByTestId('run-tab-team-checks').textContent).toBe('Checked by: verify (codex)');
  });

  // wicked-studio#850: a claude monitor on steps 2–4 and a codex monitor on step 5 is two seats
  // watching at one monitor per step — never "2 of 1 monitor".
  it('counts the watchers like with like: monitors per step, seats across the run', () => {
    const team = teamRosterOf([
      row('path.started', { cli: 'claude', selection: 'random' }),
      row('path.scored', { score: 20, plan: { monitors: 1 } }),
      row('member.joined', { seat: 'claude', status: 'attached' }),
      row('member.joined', { seat: 'codex', status: 'attached' }),
    ]);
    render(<TeamRosterView team={team} roster={null} />);
    expect(screen.getByTestId('run-tab-team-watch').textContent).toBe('Watching: 1 monitor per step · 2 seats watched (score 20 → 1 monitor)');
    expect(watchLine(0, 0)).toBe('no monitor');
    expect(watchLine(2, 1)).toBe('2 monitors per step · 1 seat watched');
  });

  it('draws nothing for a run with no team rows', () => {
    const { container } = render(<TeamRosterView team={teamRosterOf([])} roster={null} />);
    expect(container.innerHTML).toBe('');
  });
});
