import { describe, expect, it } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import { filterRunRows, pageRunRows, runRows, sortRunRows, type RunRow } from '../src/board/runsTableModel.js';

/**
 * The "Every run" row model (S17b): the pure folds behind the Sessions tab's table. One row per RUN,
 * sorted / filtered / paged without a store. The project-name resolver is injected, so these tests
 * never touch React or zustand.
 */

function makeView(id: string, opts: {
  status?: string; problem?: string; project_id?: string | null;
  created_at?: number; ended_at?: number | null; finished_at?: number | null;
  repo_ref?: string | null; workflow_id?: string; chat_id?: string; archived_at?: number | null;
} = {}): SessionView {
  return {
    session: {
      id, workflow_id: opts.workflow_id ?? 'wf-default',
      problem: opts.problem ?? `Problem ${id}`,
      status: opts.status ?? 'executing',
      project_id: opts.project_id !== undefined ? opts.project_id : null,
      created_at: opts.created_at ?? 1_700_000_000,
      ended_at: opts.ended_at !== undefined ? opts.ended_at : null,
      finished_at: opts.finished_at !== undefined ? opts.finished_at : null,
      repo_ref: opts.repo_ref !== undefined ? opts.repo_ref : null,
      archived_at: opts.archived_at !== undefined ? opts.archived_at : null,
      archive_note: null,
      entity_mode: 'shared', collection_scope: null, clis: ['claude'],
      human_confirm: 'none', unit_ix: 0, attempt: 0, workdir: null,
      extra_write_roots: [],
      ...(opts.chat_id !== undefined ? { chat_id: opts.chat_id } : {}),
    },
    units: [],
  } as unknown as SessionView;
}

const NAMES: Record<string, string> = { alpha: 'Alpha', beta: 'Beta', gamma: 'Gamma', default: 'Default' };
const nameOf = (id: string | null): string => (id === null ? 'Not in a project' : NAMES[id] ?? id);
const opts = { runChatId: false, nameOf };

const row = (views: SessionView[]): RunRow => runRows(views, opts)[0]!;

describe('runRows — row mapping', () => {
  it('A1 project_id null → "Not in a project"', () => {
    expect(row([makeView('r1', { project_id: null })]).project).toBe('Not in a project');
  });
  it('A2 project_id resolves through nameOf', () => {
    const r = row([makeView('r1', { project_id: 'alpha' })]);
    expect(r.project).toBe('Alpha');
    expect(r.projectId).toBe('alpha');
  });
  it('A2b project_id "default" normalizes to unfiled', () => {
    const r = row([makeView('r1', { project_id: 'default' })]);
    expect(r.projectId).toBeNull();
    expect(r.project).toBe('Not in a project');
  });
  it('A3 updated = endedAtMs (seconds×1000) when ended_at set', () => {
    expect(row([makeView('r1', { ended_at: 1_700_000_100 })]).updated).toBe(1_700_000_100_000);
  });
  it('A4 updated = finishedAtMs (already ms) when no ended_at', () => {
    expect(row([makeView('r1', { ended_at: null, finished_at: 1_700_000_200_000 })]).updated).toBe(1_700_000_200_000);
  });
  it('A5 updated = created when neither terminal clock is set', () => {
    expect(row([makeView('r1', { ended_at: null, finished_at: null, created_at: 1_700_000_300 })]).updated).toBe(1_700_000_300_000);
  });
  it('A6 title from plainRunTitle (onboarding → "Set up …")', () => {
    expect(row([makeView('r1', { problem: 'Onboard repository: offsite-plan' })]).title).toBe('Set up offsite-plan');
  });
  it('A7 title falls back to the id when problem is empty', () => {
    expect(row([makeView('r-abc', { problem: '' })]).title).toBe('r-abc');
  });
  it('A8-A12 status maps to the 5 session states', () => {
    expect(row([makeView('r1', { status: 'completed' })]).status).toBe('done');
    expect(row([makeView('r1', { status: 'awaiting_human' })]).status).toBe('waiting');
    expect(row([makeView('r1', { status: 'failed' })]).status).toBe('blocked');
    expect(row([makeView('r1', { status: 'cancelled' })]).status).toBe('quiet');
    expect(row([makeView('r1', { status: 'executing' })]).status).toBe('working');
  });
  it('A13 runId = session.id', () => {
    expect(row([makeView('r-abc')]).runId).toBe('r-abc');
  });
  it('A14 sessionId uses chat_id when runChatId=true', () => {
    expect(runRows([makeView('r1', { chat_id: 'chat-42' })], { runChatId: true, nameOf })[0]!.sessionId).toBe('chat-42');
  });
  it('A15 sessionId = run:<id> when no chat_id', () => {
    expect(row([makeView('r1')]).sessionId).toBe('run:r1');
  });
  it('A16 repo from repo_ref', () => {
    expect(row([makeView('r1', { repo_ref: 'studio-api' })]).repo).toBe('studio-api');
  });
  it('A17 repo null when no repo_ref', () => {
    expect(row([makeView('r1', { repo_ref: null })]).repo).toBeNull();
  });
  it('A18 workflow = workflow_id', () => {
    expect(row([makeView('r1', { workflow_id: 'wf-build' })]).workflow).toBe('wf-build');
  });
  it('A19 archived views are excluded by default, included on request', () => {
    const v = makeView('r1', { archived_at: 1_700_000_000 });
    expect(runRows([v], opts)).toHaveLength(0);
    expect(runRows([v], { ...opts, includeArchived: true })).toHaveLength(1);
  });
});

describe('sortRunRows', () => {
  const rows = runRows([
    makeView('r-a', { problem: 'Alpha task', status: 'completed', project_id: 'gamma', repo_ref: 'z-repo', workflow_id: 'wf-3', created_at: 100, ended_at: 300 }),
    makeView('r-b', { problem: 'Beta task', status: 'executing', project_id: 'beta', repo_ref: 'a-repo', workflow_id: 'wf-1', created_at: 200, ended_at: 200 }),
    makeView('r-c', { problem: 'Gamma task', status: 'awaiting_human', project_id: 'alpha', repo_ref: null, workflow_id: 'wf-2', created_at: 300, ended_at: 100 }),
  ], opts);

  it('B2/B3 title asc then desc', () => {
    expect(sortRunRows(rows, 'title', 'asc').map((r) => r.title)).toEqual(['Alpha task', 'Beta task', 'Gamma task']);
    expect(sortRunRows(rows, 'title', 'desc').map((r) => r.title)).toEqual(['Gamma task', 'Beta task', 'Alpha task']);
  });
  it('B5 project asc (by resolved name)', () => {
    expect(sortRunRows(rows, 'project', 'asc').map((r) => r.project)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
  it('B6 repo asc sorts null last', () => {
    expect(sortRunRows(rows, 'repo', 'asc').map((r) => r.repo)).toEqual(['a-repo', 'z-repo', null]);
  });
  it('B7 workflow asc', () => {
    expect(sortRunRows(rows, 'workflow', 'asc').map((r) => r.workflow)).toEqual(['wf-1', 'wf-2', 'wf-3']);
  });
  it('B8 created desc (newest first)', () => {
    expect(sortRunRows(rows, 'created', 'desc').map((r) => r.runId)).toEqual(['r-c', 'r-b', 'r-a']);
  });
  it('B9 updated desc (newest terminal clock first)', () => {
    expect(sortRunRows(rows, 'updated', 'desc').map((r) => r.runId)).toEqual(['r-a', 'r-b', 'r-c']);
  });
  it('B10 stable tiebreak: equal key falls back to updated desc', () => {
    const tied = runRows([
      makeView('r-x', { problem: 'Same', workflow_id: 'wf', ended_at: 100 }),
      makeView('r-y', { problem: 'Same', workflow_id: 'wf', ended_at: 300 }),
      makeView('r-z', { problem: 'Same', workflow_id: 'wf', ended_at: 200 }),
    ], opts);
    expect(sortRunRows(tied, 'title', 'asc').map((r) => r.runId)).toEqual(['r-y', 'r-z', 'r-x']);
  });
});

describe('filterRunRows', () => {
  const rows = runRows([
    makeView('r-done', { problem: 'Onboard repository: alpha-ui', status: 'completed', project_id: 'alpha', repo_ref: 'alpha-ui', workflow_id: 'wf-build' }),
    makeView('r-work', { problem: 'Build the tool', status: 'executing', project_id: 'beta', repo_ref: 'beta-svc', workflow_id: 'wf-build' }),
    makeView('r-wait', { problem: 'Review output', status: 'awaiting_human', project_id: 'alpha', repo_ref: null, workflow_id: 'wf-ask' }),
    makeView('r-block', { problem: 'Deploy pipeline', status: 'failed', project_id: null, repo_ref: null, workflow_id: 'wf-ship' }),
    makeView('r-quiet', { problem: 'Abandoned run', status: 'cancelled', project_id: 'beta', repo_ref: null, workflow_id: 'wf-ask' }),
  ], opts);
  const ids = (rs: RunRow[]): string[] => rs.map((r) => r.runId).sort();

  it('C1 all', () => expect(filterRunRows(rows, { filter: 'all', text: '' })).toHaveLength(5));
  it('C2 active = working + waiting', () => expect(ids(filterRunRows(rows, { filter: 'active', text: '' }))).toEqual(['r-wait', 'r-work']));
  it('C3 waiting', () => expect(ids(filterRunRows(rows, { filter: 'waiting', text: '' }))).toEqual(['r-wait']));
  it('C4 completed', () => expect(ids(filterRunRows(rows, { filter: 'completed', text: '' }))).toEqual(['r-done']));
  it('C5 failed', () => expect(ids(filterRunRows(rows, { filter: 'failed', text: '' }))).toEqual(['r-block']));
  it('C6 cancelled', () => expect(ids(filterRunRows(rows, { filter: 'cancelled', text: '' }))).toEqual(['r-quiet']));
  it('C7 archived filter matches nothing in the live list', () => expect(filterRunRows(rows, { filter: 'archived', text: '' })).toHaveLength(0));
  it('C8 text over title (case-insensitive)', () => expect(ids(filterRunRows(rows, { filter: 'all', text: 'set up' }))).toEqual(['r-done']));
  it('C9 text over runId', () => expect(ids(filterRunRows(rows, { filter: 'all', text: 'r-block' }))).toEqual(['r-block']));
  it('C10 text over project name', () => expect(ids(filterRunRows(rows, { filter: 'all', text: 'alpha' })).length).toBeGreaterThanOrEqual(2));
  it('C11 text over repo; null-repo row does not match', () => expect(ids(filterRunRows(rows, { filter: 'all', text: 'beta-svc' }))).toEqual(['r-work']));
  it('C12 text over workflow', () => expect(ids(filterRunRows(rows, { filter: 'all', text: 'wf-ship' }))).toEqual(['r-block']));
  it('C13 text AND state chip', () => expect(ids(filterRunRows(rows, { filter: 'active', text: 'beta' }))).toEqual(['r-work']));
  it('C14 empty text returns all', () => expect(filterRunRows(rows, { filter: 'all', text: '' })).toHaveLength(5));
  it('C15 no match', () => expect(filterRunRows(rows, { filter: 'completed', text: 'zzz-nomatch' })).toHaveLength(0));
});

describe('pageRunRows', () => {
  const many = (n: number): RunRow[] => runRows(Array.from({ length: n }, (_, i) => makeView(`r-${i}`, { created_at: 1_700_000_000 + i })), opts);

  it('D1 under limit', () => {
    const p = pageRunRows(many(50), 1, 100);
    expect([p.slice.length, p.pages, p.total]).toEqual([50, 1, 50]);
  });
  it('D2 exactly limit', () => {
    const p = pageRunRows(many(100), 1, 100);
    expect([p.slice.length, p.pages]).toEqual([100, 1]);
  });
  it('D3/D4 first and second page of 150', () => {
    expect(pageRunRows(many(150), 1, 100).slice).toHaveLength(100);
    const p2 = pageRunRows(many(150), 2, 100);
    expect([p2.slice.length, p2.pages]).toEqual([50, 2]);
  });
  it('D5/D6 1200 runs page math', () => {
    const p1 = pageRunRows(many(1200), 1, 100);
    expect([p1.slice.length, p1.pages, p1.total]).toEqual([100, 12, 1200]);
    expect(pageRunRows(many(1200), 12, 100).slice).toHaveLength(100);
  });
  it('D7/D8 clamp page below 1 and above max', () => {
    expect(pageRunRows(many(50), 0, 100).page).toBe(1);
    expect(pageRunRows(many(50), 99, 100).page).toBe(1);
  });
  it('D9 empty input', () => {
    const p = pageRunRows([], 1, 100);
    expect([p.slice.length, p.pages, p.total]).toEqual([0, 1, 0]);
  });
});
