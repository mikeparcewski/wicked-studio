// DES-frontdoor concept P: the project dashboard's model.
import { describe, expect, it } from 'vitest';
import { newestFirst, projectMeta, projectNeeds, projectRuns, qualityTally, reposUsed, stateCounts } from '../src/board/projectModel.js';
import type { NeedRow } from '../src/board/needsYou.js';
import type { ProjectMember, RepoEntry } from '../src/api/types.js';
import { makeView } from './factories.js';

const member = (kind: string, ref: string): ProjectMember => ({ id: `${kind}:${ref}`, project_id: 'p', member_kind: kind, member_ref: ref, meta: null, attached_at: 1, attached_by: 'studio' });
const repo = (id: string, name = id): RepoEntry => ({ id, name, root_path: '', default_branch: 'main', registered_at: 1 });

describe('the project dashboard model', () => {
  const runs = [
    makeView({ id: 'a', repo_ref: 'core', status: 'failed' }),
    makeView({ id: 'b', repo_ref: 'crew', status: 'completed', project_id: 'p' }),
    makeView({ id: 'c', repo_ref: 'core', status: 'awaiting_human' }),
    makeView({ id: 'x', repo_ref: 'core', status: 'completed', project_id: 'other' }),
  ];
  const members = [member('crew.run', 'a'), member('crew.run', 'c'), member('crew.repo', 'garden')];

  it('a project’s runs are its run members plus the runs the daemon files in it', () => {
    expect(projectRuns(runs, members, 'p').map((v) => v.session.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('repositories used by the jobs sit beside the attached ones; unattached work offers Attach', () => {
    const used = reposUsed(projectRuns(runs, members, 'p'), members, [repo('core'), repo('crew'), repo('garden')]);
    expect(used.map((u) => [u.name, u.jobs, u.attached])).toEqual([['garden', 0, true], ['core', 2, false], ['crew', 1, false]]);
    expect(projectMeta('Created 5 weeks ago', 3, used)).toBe('Created 5 weeks ago · 3 jobs · 2 repositories used, 1 attached');
    expect(projectMeta(null, 0, [])).toBe('0 jobs · no repositories yet');
  });

  it('needs here are the rows that name the project’s runs', () => {
    const row = (key: string): NeedRow => ({ key, kind: 'gate', severity: 0, stakes: 0, subject: key, text: '', tone: 'gate', at: null, subjectPath: '/', action: { kind: 'open', path: '/', label: 'Open' } });
    expect(projectNeeds([row('gate:c'), row('fail:x'), row('proposal:1')], new Set(['a', 'c'])).map((r) => r.key)).toEqual(['gate:c']);
  });

  it('jobs by state, in one fixed order', () => {
    expect(stateCounts(projectRuns(runs, members, 'p')).filter((s) => s.count > 0).map((s) => [s.key, s.count])).toEqual([['waiting', 1], ['finished', 1], ['failed', 1]]);
  });

  it('quality checks: passed of recorded; none recorded is said, never 0%', () => {
    expect(qualityTally([{ verdict: 'PASS', satisfied: true }, { verdict: 'FAIL', satisfied: false }, { verdict: null, satisfied: false }, null]))
      .toEqual({ read: 4, recorded: 2, passed: 1 });
    expect(qualityTally([{ verdict: null, satisfied: false }]).recorded).toBe(0);
  });

  it('newest launch first, undated last', () => {
    expect(newestFirst([makeView({ id: 'u' }), makeView({ id: 'o', created_at: 1 }), makeView({ id: 'n', created_at: 9 })]).map((v) => v.session.id)).toEqual(['n', 'o', 'u']);
  });
});
