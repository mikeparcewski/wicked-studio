import { describe, expect, it } from 'vitest';
import { isRunWorkingDoc, madeRows } from '../src/board/everythingModel.js';

// artifact-runs-fix (rig): the Made list showed a run's working document as `working-<uuid>`. Those are the notes a
// run keeps in its own thread (crew workingDocName), never something made.
describe('Made never lists a run working document', () => {
  it('matches only crew’s working-<run id> shape', () => {
    expect(isRunWorkingDoc('working-4406c5b6-c61b-4b7c-91f1-4622e1cf0c47')).toBe(true);
    expect(isRunWorkingDoc('working-notes')).toBe(false);
    expect(isRunWorkingDoc('test-release-note')).toBe(false);
    expect(isRunWorkingDoc('working-4406C5B6-C61B-4B7C-91F1-4622E1CF0C47')).toBe(true);
  });
  it('a run with a caller-chosen id is matched by the run itself (review r1)', () => {
    const runs = [{ session: { id: 'Release_42', status: 'completed', problem: 'x' }, units: [] }];
    const doc = { name: 'working-release-42', kind: 'doc', updated_at: '2026-11-01T00:00:00Z' };
    const rows = madeRows({ p1: [doc] as never, p2: [doc] as never }, runs as never, { Release_42: 'p1' });
    // Hidden in the run's own project; another project's document of that name stays (review r2).
    expect(rows.filter((r) => r.doc !== undefined).map((r) => r.projectId)).toEqual(['p2']);
  });
  it('drops them from the rows', () => {
    const docs = [
      { name: 'working-4406c5b6-c61b-4b7c-91f1-4622e1cf0c47', kind: 'doc', updated_at: '2026-11-01T00:00:00Z' },
      { name: 'test-release-note', kind: 'doc', style: 'doc', updated_at: '2026-11-01T00:00:00Z' },
      { name: 'working-notes', kind: 'doc', updated_at: '2026-11-01T00:00:00Z' },
    ];
    const rows = madeRows({ p1: docs as never }, [], {});
    expect(rows.map((r) => r.title).sort()).toEqual(['test-release-note', 'working-notes']);
  });
  it('a known UUID run decides by its project too (review r3)', () => {
    const id = '4406c5b6-c61b-4b7c-91f1-4622e1cf0c47';
    const runs = [{ session: { id, status: 'completed', problem: 'x', project_id: 'p1' }, units: [] }];
    const doc = { name: `working-${id}`, kind: 'doc', updated_at: '2026-11-01T00:00:00Z' };
    const rows = madeRows({ p1: [doc] as never, p2: [doc] as never }, runs as never, { [id]: 'p1' });
    expect(rows.filter((r) => r.doc !== undefined).map((r) => r.projectId)).toEqual(['p2']);
  });
  it('two runs whose ids normalise to one name each keep their own project (review r4)', () => {
    const runs = [
      { session: { id: 'Release_42', status: 'completed', problem: 'x' }, units: [] },
      { session: { id: 'release-42', status: 'completed', problem: 'x' }, units: [] },
    ];
    const doc = { name: 'working-release-42', kind: 'doc', updated_at: '2026-11-01T00:00:00Z' };
    const rows = madeRows({ p1: [doc] as never, p2: [doc] as never, p3: [doc] as never }, runs as never, { Release_42: 'p1', 'release-42': 'p2' });
    expect(rows.filter((r) => r.doc !== undefined).map((r) => r.projectId)).toEqual(['p3']);
  });
});
