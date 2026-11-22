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
  // studio#1055 (replaces review r3, which kept it in another project): a listed run's working doc filed under a
  // project studio does not place the run in still showed as `working-<uuid>`. The run-id shape is left out everywhere.
  it('a known UUID run\u2019s working doc is left out in every project (#1055)', () => {
    const id = '4406c5b6-c61b-4b7c-91f1-4622e1cf0c47';
    const runs = [{ session: { id, status: 'completed', problem: 'x', project_id: 'p1' }, units: [] }];
    const doc = { name: `working-${id}`, kind: 'doc', updated_at: '2026-11-01T00:00:00Z' };
    const rows = madeRows({ p1: [doc] as never, p2: [doc] as never }, runs as never, { [id]: 'p1' });
    expect(rows.filter((r) => r.doc !== undefined)).toEqual([]);
  });
  it('a listed run with no project: its working doc in a project is still left out (#1055)', () => {
    const id = 'c7704cc0-2e18-4caa-ac16-0123456789ab';
    const runs = [{ session: { id, status: 'completed', problem: 'x' }, units: [] }];
    const docs = [
      { name: `working-${id}`, kind: 'doc', updated_at: '2026-11-01T00:00:00Z' },
      { name: 'release-plan', kind: 'doc', updated_at: '2026-11-01T00:00:00Z' },
    ];
    const rows = madeRows({ 'proj-a': docs as never }, runs as never, {});
    expect(rows.filter((r) => r.doc !== undefined).map((r) => r.title)).toEqual(['release-plan']);
    expect(rows.some((r) => r.title.startsWith('working-'))).toBe(false);
  });
  it('the run-id shape takes the short tail crew can leave after the uuid, and no more (#1055, codex r1)', () => {
    // crew keeps 40 characters of the slug: the uuid's 36, then at most `-` and three more.
    expect(isRunWorkingDoc('working-4406c5b6-c61b-4b7c-91f1-4622e1cf0c47-r')).toBe(true);
    expect(isRunWorkingDoc('working-4406c5b6-c61b-4b7c-91f1-4622e1cf0c47-abc')).toBe(true);
    expect(isRunWorkingDoc('working-4406c5b6-c61b-4b7c-91f1-4622e1cf0c47-a-b')).toBe(true);
    expect(isRunWorkingDoc('working-4406c5b6-c61b-4b7c-91f1-4622e1cf0c47-notes')).toBe(false);
    // crew collapses every run of non-alphanumerics to one dash (codex r2).
    for (const tail of ['--a', '--ab', '---a', '-a--']) expect(isRunWorkingDoc(`working-4406c5b6-c61b-4b7c-91f1-4622e1cf0c47${tail}`)).toBe(false);
    expect(isRunWorkingDoc('working-4406c5b6')).toBe(false);
    expect(isRunWorkingDoc('my-working-4406c5b6-c61b-4b7c-91f1-4622e1cf0c47')).toBe(false);
  });
  it('a person’s working-<uuid>-notes or working-<uuid>--a document stays in Made', () => {
    const docs = ['working-4406c5b6-c61b-4b7c-91f1-4622e1cf0c47-notes', 'working-4406c5b6-c61b-4b7c-91f1-4622e1cf0c47--a']
      .map((name) => ({ name, kind: 'doc', updated_at: '2026-11-01T00:00:00Z' }));
    expect(madeRows({ p1: docs as never }, [], {}).map((r) => r.title).sort()).toEqual(docs.map((d) => d.name).sort());
  });
  it('a listed caller-chosen-id run whose project studio does not know: its working doc is left out everywhere (codex r1)', () => {
    const runs = [{ session: { id: 'Release_42', status: 'completed', problem: 'x' }, units: [] }];
    const doc = { name: 'working-release-42', kind: 'doc', updated_at: '2026-11-01T00:00:00Z' };
    const notes = { name: 'working-notes', kind: 'doc', updated_at: '2026-11-01T00:00:00Z' };
    const rows = madeRows({ 'proj-a': [doc, notes] as never, 'proj-b': [doc] as never }, runs as never, {});
    expect(rows.filter((r) => r.doc !== undefined).map((r) => `${r.projectId}:${r.title}`)).toEqual(['proj-a:working-notes']);
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
