import { describe, expect, it } from 'vitest';
import type { RepoEntry } from '../src/api/types.js';
import {
  matchesRepoChip, ONBOARDING_WORKFLOW_ID, repoFleetModels, repoOnboard,
} from '../src/board/repoStats.js';
import { makeView } from './factories.js';

/**
 * The Repositories section's fold layer (lane B): the per-repo graph story
 * derived from the run history (the repos wire carries NO index-freshness
 * field — repoStats never pretends it does), and the attention-ordered fleet
 * models the /repos grid, chips and tiles all read.
 */

const repo = (id: string): RepoEntry =>
  ({ id, name: id, root_path: `/tmp/${id}`, default_branch: 'main', registered_at: 1_700_000_000 });

const onboard = (id: string, repoRef: string, status: string) =>
  makeView({ id, repo_ref: repoRef, workflow_id: ONBOARDING_WORKFLOW_ID, status: status as never });

describe('repoOnboard — the honest graph state off the run history', () => {
  it('newest decisive onboard completed ⇒ ready', () => {
    const runs = [onboard('o-new', 'a', 'completed'), onboard('o-old', 'a', 'failed')];
    expect(repoOnboard(runs, 'a')).toEqual({ state: 'ready', run: runs[0] });
  });

  it('newest decisive onboard failed ⇒ failed — even with an older success behind it', () => {
    const runs = [onboard('o-new', 'a', 'failed'), onboard('o-old', 'a', 'completed')];
    expect(repoOnboard(runs, 'a').state).toBe('failed');
    expect(repoOnboard(runs, 'a').run!.session.id).toBe('o-new');
  });

  it('an in-flight onboard wins ⇒ onboarding (gated onboards count as in flight)', () => {
    expect(repoOnboard([onboard('o-run', 'a', 'executing')], 'a').state).toBe('onboarding');
    expect(repoOnboard([onboard('o-gate', 'a', 'awaiting_human')], 'a').state).toBe('onboarding');
  });

  it('a cancelled onboard is withdrawn, not a verdict — the fold looks further back', () => {
    const runs = [onboard('o-cancelled', 'a', 'cancelled'), onboard('o-done', 'a', 'completed')];
    expect(repoOnboard(runs, 'a')).toEqual({ state: 'ready', run: runs[1] });
  });

  it('no onboard run on record ⇒ never (a build run is not an onboard)', () => {
    const runs = [
      makeView({ id: 'r-build', repo_ref: 'a', workflow_id: 'feature', status: 'completed' }),
      onboard('o-other', 'b', 'completed'), // another repo's onboard never counts
    ];
    expect(repoOnboard(runs, 'a')).toEqual({ state: 'never', run: null });
  });

  it('archived onboards never count', () => {
    const runs = [makeView({
      id: 'o-archived', repo_ref: 'a', workflow_id: ONBOARDING_WORKFLOW_ID,
      status: 'completed', archived_at: 123,
    })];
    expect(repoOnboard(runs, 'a').state).toBe('never');
  });
});

describe('repoFleetModels — one fold per card, attention-ordered', () => {
  const NOW = 1_756_000_000_000;
  const REPOS = [repo('quiet'), repo('gated'), repo('broken'), repo('busy')];
  const RUNS = [
    makeView({ id: 'r-gate', repo_ref: 'gated', workflow_id: 'feature', status: 'awaiting_human' }),
    makeView({ id: 'r-run', repo_ref: 'busy', workflow_id: 'feature', status: 'executing' }),
    makeView({ id: 'r-fail', repo_ref: 'broken', workflow_id: 'feature', status: 'failed' }),
    makeView({ id: 'r-done', repo_ref: 'busy', workflow_id: 'feature', status: 'completed' }),
    makeView({ id: 'r-out', repo_ref: 'busy', workflow_id: 'feature', status: 'failed' }), // outside window
    onboard('o-busy', 'busy', 'completed'),
    onboard('o-broken', 'broken', 'failed'),
  ];
  const ATTACHED = { 'r-run': NOW - 3_600_000, 'r-done': NOW - 2 * 3_600_000 };
  // The recency window holds everything but r-out (the positional idiom —
  // membership is the caller's windowBuckets output).
  const WINDOW = new Set(RUNS.map((v) => v.session.id).filter((id) => id !== 'r-out'));

  const fleet = repoFleetModels(REPOS, RUNS, ATTACHED, WINDOW);
  const byId = Object.fromEntries(fleet.map((m) => [m.repo.id, m]));

  it('orders needs-you FIRST, then failing, then active, then quiet', () => {
    expect(fleet.map((m) => m.repo.id)).toEqual(['gated', 'broken', 'busy', 'quiet']);
  });

  it('counts only the windowed runs; waiting stays unwindowed (a gate is a gate)', () => {
    expect(byId['busy']!.counts.total).toBe(3);       // r-run + r-done + o-busy; r-out held back
    expect(byId['busy']!.counts.done).toBe(2);
    expect(byId['busy']!.counts.failed).toBe(0);      // r-out is outside the window
    expect(byId['gated']!.waiting.map((v) => v.session.id)).toEqual(['r-gate']);
  });

  it('derives the graph story per repo and folds an onboard failure into failing', () => {
    expect(byId['busy']!.onboard.state).toBe('ready');
    expect(byId['broken']!.onboard.state).toBe('failed');
    expect(byId['broken']!.failing).toBe(true);
    expect(byId['quiet']!.onboard.state).toBe('never');
    expect(byId['quiet']!.failing).toBe(false);
  });

  it('lastAt is the newest attach clock — null when no clock is known, never invented', () => {
    expect(byId['busy']!.lastAt).toBe(NOW - 3_600_000);
    expect(byId['gated']!.lastAt).toBeNull();
  });

  it('matchesRepoChip partitions the fleet the chips and tiles agree on', () => {
    expect(fleet.filter((m) => matchesRepoChip(m, 'needs-you')).map((m) => m.repo.id)).toEqual(['gated']);
    expect(fleet.filter((m) => matchesRepoChip(m, 'active')).map((m) => m.repo.id)).toEqual(['busy']);
    expect(fleet.filter((m) => matchesRepoChip(m, 'failing')).map((m) => m.repo.id)).toEqual(['broken']);
    expect(fleet.filter((m) => matchesRepoChip(m, 'ready')).map((m) => m.repo.id)).toEqual(['busy']);
    expect(fleet.filter((m) => matchesRepoChip(m, 'never')).map((m) => m.repo.id)).toEqual(['gated', 'quiet']);
    expect(fleet.filter((m) => matchesRepoChip(m, 'all'))).toHaveLength(4);
  });
});
