// F-4R2-006 — the doc↔run binding read back off the runs wire. Crew's frames carry no run id
// and the announce history no state, so a reload mid-run showed `terminal` until the next
// heartbeat. Every seam declares the run's own inbox as its write root, named by the doc;
// that is the binding these tests pin — and what `restoreDocRun` adopts on doc open.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import { makeView } from './factories.js';

const listRuns = vi.fn<() => Promise<{ runs: SessionView[] }>>();
vi.mock('../src/api/client.js', () => ({ api: { listRuns: () => listRuns() } }));

const { clearRunRestores, docRunOf, isDocRun, restoreDocRun } = await import('../src/interactive/runBinding.js');
const { RESTORED_RUN_GATED_NARRATION, RESTORED_RUN_NARRATION, threadKey, useDocThreadStore } = await import('../src/store/docThread.js');

const PROJECT = 'proj_178902523421000000';
const DOC = 'wicked-studio-brochure-r2';
const KEY = threadKey(PROJECT, DOC);
const STATE = '/w5/state';

function run(id: string, root: string, status: SessionView['session']['status'] = 'executing', projectId: string | null | undefined = PROJECT): SessionView {
  return makeView({
    id, status, workflow_id: 'interactive-draft', extra_write_roots: [root],
    ...(projectId === undefined ? {} : { project_id: projectId }),
  });
}

beforeEach(() => {
  listRuns.mockReset();
  clearRunRestores();
  useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, boundRun: {} });
});
afterEach(() => vi.useRealTimers());

describe('isDocRun — the seams\' write-root grammars', () => {
  it('matches the draft, ask, edit and demo directories named by this doc, and nothing else', () => {
    expect(isDocRun(run('d', `${STATE}/interactive-drafts/${DOC}`), DOC)).toBe(true);
    expect(isDocRun(run('c', `${STATE}/interactive-chats/${DOC}-m-dmsg-7`), DOC)).toBe(true);
    expect(isDocRun(run('c2', `${STATE}/interactive-chats/${DOC}-e-4412`), DOC)).toBe(true);
    expect(isDocRun(run('e', `${STATE}/interactive-edits/${DOC}-v3`), DOC)).toBe(true);
    expect(isDocRun(run('v', `${STATE}/interactive-demos/${DOC}`), DOC)).toBe(true);
    // A sibling doc whose slug EXTENDS this one is not this doc.
    expect(isDocRun(run('x', `${STATE}/interactive-drafts/${DOC}-2`), DOC)).toBe(false);
    expect(isDocRun(run('x', `${STATE}/interactive-chats/${DOC}-2-m-dmsg-1`), DOC)).toBe(false);
    // A run whose write root is not a seam inbox (a repo worktree) never binds.
    expect(isDocRun(run('w', `/w5/repos/${DOC}`), DOC)).toBe(false);
    expect(isDocRun(makeView({ extra_write_roots: [] }), DOC)).toBe(false);
    // Windows separators read the same.
    expect(isDocRun(run('win', `C:\\state\\interactive-drafts\\${DOC}`), DOC)).toBe(true);
  });
});

describe('docRunOf — which record is the thread\'s', () => {
  it('prefers the LIVE run, falls back to the newest terminal record, narrows to the project', () => {
    const done = run('r-done', `${STATE}/interactive-drafts/${DOC}`, 'completed');
    const live = run('r-live', `${STATE}/interactive-chats/${DOC}-m-dmsg-7`, 'executing');
    const other = run('r-other', `${STATE}/interactive-drafts/${DOC}`, 'executing', 'proj_other');
    const unjoined = run('r-old-daemon', `${STATE}/interactive-drafts/${DOC}`, 'executing', undefined);
    expect(docRunOf([done, live, other], PROJECT, DOC)?.session.id).toBe('r-live');
    expect(docRunOf([done, other], PROJECT, DOC)?.session.id).toBe('r-done');
    expect(docRunOf([other], PROJECT, DOC)).toBeNull();
    // A daemon that does not join project_id cannot disagree with the thread's project.
    expect(docRunOf([unjoined], PROJECT, DOC)?.session.id).toBe('r-old-daemon');
    // Archived records are written off.
    expect(docRunOf([{ ...done, session: { ...done.session, archived_at: 1 } }], PROJECT, DOC)).toBeNull();
    // The Unfiled mount owns unfiled runs.
    expect(docRunOf([run('u', `${STATE}/interactive-drafts/${DOC}`, 'executing', null)], 'default', DOC)?.session.id).toBe('u');
  });
});

describe('restoreDocRun — adopting the record on doc open', () => {
  it('an executing run flips a silent thread to generating, says why once, and binds the run', async () => {
    listRuns.mockResolvedValue({ runs: [run('r-live', `${STATE}/interactive-chats/${DOC}-m-dmsg-7`)] });
    await restoreDocRun(PROJECT, DOC);
    const s = useDocThreadStore.getState();
    expect(s.genState[KEY]).toBe('generating');
    expect(s.boundRun[KEY]).toEqual({ runId: 'r-live', status: 'executing' });
    expect(s.messages[KEY]?.map((m) => ('text' in m ? m.text : m.kind))).toEqual([RESTORED_RUN_NARRATION]);
    // Once per doc per session — a second open does not re-read the runs wire.
    await restoreDocRun(PROJECT, DOC);
    expect(listRuns).toHaveBeenCalledTimes(1);
  });

  it('a run parked at a human gate restores as "waiting at a gate", never "executing now" (review F4)', async () => {
    listRuns.mockResolvedValue({ runs: [run('r-gated', `${STATE}/interactive-drafts/${DOC}`, 'awaiting_human')] });
    await restoreDocRun(PROJECT, DOC);
    const s = useDocThreadStore.getState();
    expect(s.genState[KEY]).toBe('generating');
    expect(s.messages[KEY]?.map((m) => ('text' in m ? m.text : m.kind))).toEqual([RESTORED_RUN_GATED_NARRATION]);
    expect(RESTORED_RUN_GATED_NARRATION).toContain('waiting at a gate');
    expect(RESTORED_RUN_GATED_NARRATION).not.toContain('executing');
    // A second adoption never doubles either spelling.
    s.adoptRun(KEY, run('r-gated', `${STATE}/interactive-drafts/${DOC}`, 'executing'));
    expect(useDocThreadStore.getState().messages[KEY]?.filter((m) => m.kind === 'narration')).toHaveLength(1);
  });

  it('a terminal record only binds — the composer stays terminal and no line is added', async () => {
    listRuns.mockResolvedValue({ runs: [run('r-done', `${STATE}/interactive-drafts/${DOC}`, 'failed')] });
    await restoreDocRun(PROJECT, DOC);
    const s = useDocThreadStore.getState();
    expect(s.genState[KEY]).toBeUndefined();
    expect(s.boundRun[KEY]).toEqual({ runId: 'r-done', status: 'failed' });
    expect(s.messages[KEY]).toBeUndefined();
  });

  it('a thread that already knows it is generating (a restored pending send) is not narrated twice', async () => {
    useDocThreadStore.getState().addUserMsg(KEY, 'm-1', 'the ask');
    useDocThreadStore.getState().setGenState(KEY, 'generating');
    listRuns.mockResolvedValue({ runs: [run('r-live', `${STATE}/interactive-chats/${DOC}-m-m-1`)] });
    await restoreDocRun(PROJECT, DOC);
    expect(useDocThreadStore.getState().messages[KEY]?.some((m) => m.kind === 'narration')).toBe(false);
    expect(useDocThreadStore.getState().boundRun[KEY]?.runId).toBe('r-live');
  });

  it('a daemon that cannot list runs leaves the thread as it was — and the next open may retry', async () => {
    listRuns.mockRejectedValue(new Error('offline'));
    await restoreDocRun(PROJECT, DOC);
    expect(useDocThreadStore.getState().genState[KEY]).toBeUndefined();
    listRuns.mockResolvedValue({ runs: [run('r-live', `${STATE}/interactive-drafts/${DOC}`)] });
    await restoreDocRun(PROJECT, DOC);
    expect(useDocThreadStore.getState().genState[KEY]).toBe('generating');
  });

  it('markRunEnded retires a generating composer with nothing queued; a queued send keeps it live', () => {
    const store = useDocThreadStore.getState();
    store.adoptRun(KEY, run('r-live', `${STATE}/interactive-drafts/${DOC}`));
    expect(useDocThreadStore.getState().genState[KEY]).toBe('generating');
    store.markRunEnded(KEY, 'completed');
    expect(useDocThreadStore.getState().genState[KEY]).toBe('terminal');
    expect(useDocThreadStore.getState().boundRun[KEY]).toEqual({ runId: 'r-live', status: 'completed' });

    useDocThreadStore.getState().addUserMsg(KEY, 'm-2', 'another ask');
    useDocThreadStore.getState().setGenState(KEY, 'generating');
    useDocThreadStore.getState().adoptRun(KEY, run('r-2', `${STATE}/interactive-chats/${DOC}-m-m-2`));
    useDocThreadStore.getState().markRunEnded(KEY, 'failed');
    expect(useDocThreadStore.getState().genState[KEY]).toBe('generating');
  });
});
