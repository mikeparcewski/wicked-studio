import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DES-CHAT-ARTIFACTS-001 slice A3 (studio): New document in "answer this proposal" mode.
 *  - Change something on a create card opens New document under the card, prefilled with crew's resolution: the
 *    title, what it is about, the sources as chips (a struck one with crew's reason), the repositories, two helpers.
 *  - Make it answers THAT proposal (`POST /chats/:id/proposals/:pid {decision:'go', edits}`) with only what changed;
 *    it never creates a document itself. A refusal stays in the form, which stays editable.
 *  - The project changes only in a chat filed in no project; a run chip from elsewhere is struck as soon as it does.
 *  - The test configuration's "starts nothing" notice follows `stubOps` (create is real since A3).
 */

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useCapabilities, proposalIsStub } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useTeamPlanStore } = await import('../src/store/teamPlan.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useSheets } = await import('../src/store/sheets.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { makeUnit, makeView } = await import('./factories.js');
const { clearCachedRoster, setCachedRoster } = await import('../src/store/rosterCache.js');
const { formSources, isArtifactProposal, proposalFormEdits, proposalFormOf, repoKeysOf, resetSettledProposals, PROPOSAL_STARTING_MS } = await import('../src/board/artifactProposal.js');
type Proposal = import('../src/api/chatArtifacts-wire.js').ArtifactProposal;

const T0 = 1_700_000_000_000;
const RUN = 'r-ask';
const PID = 'chat-ask:t1';

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    pid: PID, chatId: 'chat-ask', turnId: 't1', kind: 'create', seat: 'claude',
    what: { entry: 'document-static', title: 'Release note', label: 'Document · Release note', outcome: null },
    brief: 'what changed in coverage', reason: null,
    sources: [
      { token: 'chat', label: 'this conversation', status: 'ok' },
      { token: 'run:29bbbfb1-0000', label: 'run 29bbbfb1 · stopped', status: 'ok', projectId: null },
      { token: 'run:57443b2b-0000', label: 'run 57443b2b · finished', status: 'ok', projectId: 'mikes' },
      { token: 'run:1a2b3c4d-0000', label: 'run 1a2b3c4d', status: 'struck', reason: 'not named in this chat', projectId: null },
    ],
    repos: ['wicked-crew'], repoRefs: ['repo-crew'],
    helpers: { seats: ['claude', 'codex'], label: 'Claude Code and Codex: one writes, the other checks' },
    time: null, stops: null,
    filedIn: { projectId: null, label: 'Not in a project · this chat' },
    blocked: null,
    ...over,
  };
}

const ASK_RUN = makeView({ id: RUN, status: 'awaiting_human', problem: 'release note', unit_ix: 1, chat_id: 'chat-ask', created_at: T0 / 1000 } as never, [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: 'done', assigned_cli: 'claude', description: 'answer-1' }),
]);
const TURN = [
  { at: T0, turnId: 't1', kind: 'user', seats: ['claude'], text: 'Write a release note from runs 29bbbfb1 and 57443b2b' },
  { at: T0 + 1000, turnId: 't1', kind: 'seat', cliKey: 'claude', ok: true, usage: null, text: 'I can make that into a document.' },
];

let chatBody: Record<string, unknown> = {};
const posts: Array<{ path: string; body: unknown }> = [];
let decideAnswer: () => Response | Promise<Response> = () => new Response('{}', { status: 500 });
const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function setup(p: Proposal = proposal()): void {
  chatBody = { chatId: 'chat-ask', seats: ['claude'], scope: { kind: 'none' }, messages: [...TURN, { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: p }], path: { runId: RUN, pa: 'claude', selection: 'random', reviewer: null, helpers: [], stepId: 'answer-1' } };
}

beforeEach(() => {
  posts.length = 0;
  resetSettledProposals();
  setup();
  useCapabilities.setState({ loaded: true, runChatId: true, askPath: true, chatProposals: true, chatArtifactsStub: false, chatArtifactsStubOps: null, chatList: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, chatClosed: {}, turnGates: {}, replySeq: {}, paByChat: {}, retiredByChat: {}, answerOrds: { [RUN]: [1] } });
  useAskThreadStore.getState().recordTurnGate(RUN, 1);
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  useSheets.setState({ open: null, pointed: null, stopping: {} });
  useProjectsStore.setState({ projects: [{ id: 'mikes', name: 'Mikes' } as never, { id: 'other', name: 'Other' } as never] });
  setCachedRoster([
    { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true } as never,
    { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true } as never,
    { key: 'agy', display_name: 'Antigravity', binary: 'agy', enabled_for_council: true } as never,
  ]);
  decideAnswer = () => ok({ view: { proposal: proposal(), state: 'decided', decision: 'go', result: { runId: 'aaaaaaaa-1111-5222-8333-444444444444', artifactRef: '_unfiled/release-note-1a', adopted: false, stub: false }, decidedAt: T0 + 3000 } });
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body)) });
      return Promise.resolve(path.includes('/proposals/') ? decideAnswer() : ok({}));
    }
    if (path.includes('/considered')) return Promise.resolve(new Response('{}', { status: 404 }));
    if (path.startsWith('/chats/')) return Promise.resolve(ok(chatBody));
    if (path.endsWith('/team')) return Promise.resolve(new Response('{}', { status: 404 }));
    if (path.endsWith('/events')) return Promise.resolve(ok({ events: [] }));
    return Promise.resolve(ok({}));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const text = (id: string): string => screen.getByTestId(id).textContent?.replace(/\s+/g, ' ').trim() ?? '';
const page = () => render(<SessionPage sessionId="chat-ask" runs={[ASK_RUN]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);

async function openForm(): Promise<HTMLElement> {
  page();
  const card = await screen.findByTestId('artifact-proposal');
  fireEvent.click(card.querySelector('[data-ask-option="change"]')!);
  fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
  return screen.getByTestId('proposal-answer-form');
}

describe('the answer form, pure', () => {
  it('opens on crew’s resolution, and a Go carries only what changed', () => {
    const p = proposal();
    const f = proposalFormOf(p);
    expect(f).toStrictEqual({ title: 'Release note', brief: 'what changed in coverage', project: null, sources: ['chat', 'run:29bbbfb1-0000', 'run:57443b2b-0000'], repos: ['repo-crew'], helpers: ['claude', 'codex'] });
    // Repositories go by registry id (two checkouts may share a name).
    expect(proposalFormEdits(proposal({ repos: ['shared', 'shared'], repoRefs: ['r-a', 'r-b'] }), { ...proposalFormOf(proposal({ repos: ['shared', 'shared'], repoRefs: ['r-a', 'r-b'] })), repos: ['r-b'] })).toStrictEqual({ repos: ['r-b'] });
    expect(proposalFormEdits(p, f)).toStrictEqual({});
    expect(proposalFormEdits(p, { ...f, title: ' Coverage note ', helpers: ['codex', 'agy'], sources: ['chat', 'run:57443b2b-0000'] }))
      .toStrictEqual({ title: 'Coverage note', sources: ['chat', 'run:57443b2b-0000'], helpers: ['codex', 'agy'] });
    // The same helpers in another order is no change.
    expect(proposalFormEdits(p, { ...f, helpers: ['codex', 'claude'] })).toStrictEqual({});
  });

  it('moving the document strikes a run from elsewhere at once, and never sends that chip as a source', () => {
    const p = proposal();
    const moved = { ...proposalFormOf(p), project: 'mikes' };
    const chips = formSources(p, moved, (id) => (id === 'mikes' ? 'Mikes' : 'Unfiled'));
    expect(chips.map((c) => [c.token, c.status, c.reason ?? null])).toStrictEqual([
      ['chat', 'ok', null],
      ['run:29bbbfb1-0000', 'struck', 'not in Mikes'],
      ['run:57443b2b-0000', 'ok', null],
      ['run:1a2b3c4d-0000', 'struck', 'not named in this chat'],
    ]);
    // The project moves with the kept repositories (crew checks them as the person's choice); crew re-checks and strikes
    // the sources itself (no sources edit, so no refusal for them).
    expect(proposalFormEdits(p, moved)).toStrictEqual({ project: 'mikes', repos: ['repo-crew'] });
    // Leaving one more out sends the kept ones, never the struck one.
    expect(proposalFormEdits(p, { ...moved, sources: ['chat', 'run:29bbbfb1-0000'] })).toStrictEqual({ project: 'mikes', repos: ['repo-crew'], sources: ['chat'] });
  });

  it('the starts-nothing notice follows stubOps (create is real since A3)', () => {
    expect(proposalIsStub(true, ['refine', 'theme', 'demo'], 'create')).toBe(false);
    expect(proposalIsStub(true, ['refine', 'theme', 'demo'], 'refine')).toBe(true);
    expect(proposalIsStub(true, null, 'create')).toBe(true); // a daemon before the field: every kind
    expect(proposalIsStub(false, null, 'create')).toBe(false);
  });
});

describe('Change something on a create card (A3)', () => {
  it('opens New document under the card, prefilled with crew’s facts; nothing is posted until Make it', async () => {
    const form = await openForm();
    expect((within(form).getByTestId('proposal-answer-title') as HTMLInputElement).value).toBe('Release note');
    expect((within(form).getByTestId('proposal-answer-brief') as HTMLTextAreaElement).value).toBe('what changed in coverage');
    const chips = within(form).getAllByTestId('proposal-answer-source');
    expect(chips.map((c) => [c.getAttribute('data-token'), c.getAttribute('data-status'), c.getAttribute('aria-pressed')])).toStrictEqual([
      ['chat', 'ok', 'true'], ['run:29bbbfb1-0000', 'ok', 'true'], ['run:57443b2b-0000', 'ok', 'true'], ['run:1a2b3c4d-0000', 'struck', null],
    ]);
    expect(chips[3]!.textContent).toContain('not named in this chat');
    expect(within(form).getAllByTestId('proposal-answer-repo').map((r) => r.getAttribute('aria-pressed'))).toStrictEqual(['true']);
    expect(within(form).getAllByTestId('proposal-answer-seat').filter((s) => s.getAttribute('aria-pressed') === 'true').map((s) => s.getAttribute('data-seat'))).toStrictEqual(['claude', 'codex']);
    expect(within(form).getByTestId('proposal-answer-project')).not.toBeNull(); // a chat filed in no project may move it
    expect(posts).toStrictEqual([]);
    // The control the person used is gone: focus goes to the form itself, never to its Make it (Enter there sends nothing).
    expect(document.activeElement).toBe(form);
  });

  it('Make it answers THIS proposal with the edits, never a create; the card then shows what was started', async () => {
    const accepted = proposal({
      what: { entry: 'document-static', title: 'Coverage note', label: 'Document · Coverage note', outcome: null },
      helpers: { seats: ['codex', 'agy'], label: 'Codex and Antigravity: one writes, the other checks' },
      sources: proposal().sources.filter((s) => s.token !== 'run:29bbbfb1-0000'),
    });
    decideAnswer = () => ok({ view: { proposal: accepted, state: 'decided', decision: 'go', result: { runId: 'aaaaaaaa-1111-5222-8333-444444444444', artifactRef: '_unfiled/coverage-note-1a', adopted: false, stub: false }, decidedAt: T0 + 3000 } });
    const form = await openForm();
    fireEvent.change(within(form).getByTestId('proposal-answer-title'), { target: { value: 'Coverage note' } });
    fireEvent.click(within(form).getAllByTestId('proposal-answer-source')[1]!); // leave run 29bbbfb1 out
    fireEvent.click(within(form).getAllByTestId('proposal-answer-seat').find((s) => s.getAttribute('data-seat') === 'claude')!);
    expect(within(form).getByTestId('proposal-answer-go').hasAttribute('disabled')).toBe(true); // one helper is not two
    fireEvent.click(within(form).getAllByTestId('proposal-answer-seat').find((s) => s.getAttribute('data-seat') === 'agy')!);
    fireEvent.click(within(form).getByTestId('proposal-answer-go'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toStrictEqual({
      path: `/chats/chat-ask/proposals/${encodeURIComponent(PID)}`,
      body: { decision: 'go', edits: { title: 'Coverage note', sources: ['chat', 'run:57443b2b-0000'], helpers: ['codex', 'agy'] } },
    });
    expect(posts.some((p) => p.path.includes('/interactive/'))).toBe(false);
    await waitFor(() => expect(screen.queryByTestId('proposal-answer-form')).toBeNull());
    expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('decided');
    // What was accepted, as crew answered it: the edited title and helpers, behind Details.
    expect(text('artifact-proposal-what')).toBe('Document · Coverage note');
    fireEvent.click(screen.getByTestId('artifact-proposal-details'));
    expect(text('artifact-proposal-helpers')).toContain('Codex and Antigravity');
    expect(text('artifact-proposal-from')).toContain('run 57443b2b');
    expect(text('artifact-proposal-from')).not.toContain('run 29bbbfb1');
  });

  it('a refusal stays in the form, in crew’s words, and the form stays editable', async () => {
    decideAnswer = () => new Response(JSON.stringify({ code: 'edits_invalid', error: 'wicked-core isn’t in this chat’s scope' }), { status: 400, headers: { 'content-type': 'application/json' } });
    const form = await openForm();
    fireEvent.click(within(form).getByTestId('proposal-answer-go'));
    await waitFor(() => expect(within(form).getByTestId('proposal-answer-error').textContent).toBe('wicked-core isn’t in this chat’s scope'));
    expect(screen.getByTestId('proposal-answer-form')).not.toBeNull();
    expect((within(form).getByTestId('proposal-answer-title') as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByTestId('artifact-proposal-error')).toBeNull(); // said once, where it was asked
  });

  it('moving the document to a project strikes the run from elsewhere at once and says what crew re-checks', async () => {
    const form = await openForm();
    fireEvent.change(within(form).getByTestId('proposal-answer-project'), { target: { value: 'mikes' } });
    const chips = within(form).getAllByTestId('proposal-answer-source');
    expect(chips[1]!.getAttribute('data-status')).toBe('struck');
    expect(chips[1]!.textContent).toContain('not in Mikes');
    expect(within(form).getByTestId('proposal-answer-recheck').textContent).toContain('Mikes');
    fireEvent.click(within(form).getByTestId('proposal-answer-go'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toStrictEqual({ decision: 'go', edits: { project: 'mikes', repos: ['repo-crew'] } });
  });

  it('a project chat’s document stays in its project; Cancel closes the form and posts nothing', async () => {
    setup(proposal({ filedIn: { projectId: 'mikes', label: 'Mikes' } }));
    const form = await openForm();
    expect(within(form).queryByTestId('proposal-answer-project')).toBeNull();
    expect(within(form).getByTestId('proposal-answer-project-fixed').textContent).toContain('Mikes');
    fireEvent.click(within(form).getByTestId('proposal-answer-cancel'));
    expect(screen.queryByTestId('proposal-answer-form')).toBeNull();
    expect(posts).toStrictEqual([]);
  });

  it('a Go that is still starting (a real launch takes seconds) reads "Starting it…", never "Interrupted · Go again"', async () => {
    // Another tab's Go recorded a moment ago: the accepting record is fresh.
    const now = Date.now();
    chatBody = { ...chatBody, messages: [
      ...TURN,
      { at: now - 2000, turnId: 't1', kind: 'proposal', proposal: proposal() },
      { at: now - 1000, turnId: 't1', kind: 'proposal_accepting', pid: PID, actor: 'local', edits: null, resolution: proposal(), identity: { artifactRef: '_unfiled/x', runId: 'r' } },
    ] };
    page();
    await waitFor(() => expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('accepting'));
    expect(text('artifact-proposal-record')).toBe('Starting it…');
    expect(screen.queryByTestId('artifact-proposal-go-again')).toBeNull();
    // An old one (a crash before the record) is interrupted, with Go again.
    cleanup();
    resetSettledProposals();
    chatBody = { ...chatBody, messages: [
      ...TURN,
      { at: now - 600_000, turnId: 't1', kind: 'proposal', proposal: proposal() },
      { at: now - 500_000, turnId: 't1', kind: 'proposal_accepting', pid: PID, actor: 'local', edits: null, resolution: proposal(), identity: { artifactRef: '_unfiled/x', runId: 'r' } },
    ] };
    page();
    await screen.findByTestId('artifact-proposal-go-again');
    expect(text('artifact-proposal-record')).toBe('Interrupted before it was recorded as started.');
  });

  it('while the form is open it is the only way to answer; Enter in its fields submits nothing', async () => {
    const form = await openForm();
    // The card's own choices are gone until Cancel: no competing answer without the form's edits.
    expect(screen.queryByTestId('artifact-proposal-confirm')).toBeNull();
    for (const id of ['proposal-answer-title', 'proposal-answer-brief']) {
      const el = within(form).getByTestId(id);
      el.focus();
      fireEvent.keyDown(el, { key: 'Enter', code: 'Enter' });
      fireEvent.keyUp(el, { key: 'Enter', code: 'Enter' });
    }
    await new Promise((r) => setTimeout(r, 30));
    expect(posts).toStrictEqual([]);
    fireEvent.click(within(form).getByTestId('proposal-answer-cancel'));
    expect(screen.getByTestId('artifact-proposal-confirm')).not.toBeNull();
  });

  it('a retry card keeps its document and its repositories: only the allowed edits are sent', async () => {
    setup(proposal({ pid: 'chat-ask:retry:r1', turnId: null, sourceRunId: 'r1', artifactRef: 'mikes/release-note-1a2b3c4d', filedIn: { projectId: 'mikes', label: 'Mikes' } }));
    decideAnswer = () => ok({ view: { proposal: proposal(), state: 'decided', decision: 'go', result: { runId: 'bbbbbbbb-1', artifactRef: 'mikes/release-note-1a2b3c4d', adopted: false, stub: false }, decidedAt: T0 + 3000 } });
    page();
    const card = await screen.findByTestId('artifact-proposal');
    fireEvent.click(card.querySelector('[data-ask-option="change"]')!);
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    const form = screen.getByTestId('proposal-answer-form');
    expect(within(form).queryByTestId('proposal-answer-project')).toBeNull();
    expect(within(form).getByTestId('proposal-answer-project-fixed').textContent).toContain('a retry keeps its document where it is');
    expect(within(form).getAllByTestId('proposal-answer-repo').every((r) => (r as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.change(within(form).getByTestId('proposal-answer-title'), { target: { value: 'Release note, again' } });
    fireEvent.click(within(form).getByTestId('proposal-answer-go'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toStrictEqual({ decision: 'go', edits: { title: 'Release note, again' } });
  });

  it('a helper the roster no longer has is said and can be swapped for another', async () => {
    setCachedRoster([
      { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true } as never,
      { key: 'agy', display_name: 'Antigravity', binary: 'agy', enabled_for_council: true } as never,
    ]);
    const form = await openForm();
    const gone = within(form).getAllByTestId('proposal-answer-seat').find((s) => s.getAttribute('data-seat') === 'claude')!;
    expect(gone.textContent).toBe('claude (not available)');
    expect(within(form).getByTestId('proposal-answer-go').hasAttribute('disabled')).toBe(true);
    fireEvent.click(gone);
    fireEvent.click(within(form).getAllByTestId('proposal-answer-seat').find((s) => s.getAttribute('data-seat') === 'agy')!);
    expect(within(form).getByTestId('proposal-answer-go').hasAttribute('disabled')).toBe(false);
    fireEvent.click(within(form).getByTestId('proposal-answer-go'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toStrictEqual({ decision: 'go', edits: { helpers: ['codex', 'agy'] } });
  });

  it('a refusal that closes the form (launch_failed, now interrupted) is said once, under the card', async () => {
    decideAnswer = () => new Response(JSON.stringify({ code: 'launch_failed', error: 'could not start it: the engine is restarting. Go again resumes the same job.', view: { proposal: proposal(), state: 'accepting' } }), { status: 502, headers: { 'content-type': 'application/json' } });
    const form = await openForm();
    fireEvent.click(within(form).getByTestId('proposal-answer-go'));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal-error').textContent).toBe('could not start it: the engine is restarting. Go again resumes the same job.'));
    expect(screen.queryByTestId('proposal-answer-form')).toBeNull();
    expect(screen.getAllByText('could not start it: the engine is restarting. Go again resumes the same job.')).toHaveLength(1);
  });

  it('"Starting it…" ends on the same card when its window closes: Go again appears without a remount', async () => {
    const now = Date.now();
    chatBody = { ...chatBody, messages: [
      ...TURN,
      { at: now - 2000, turnId: 't1', kind: 'proposal', proposal: proposal() },
      { at: now - (PROPOSAL_STARTING_MS - 300), turnId: 't1', kind: 'proposal_accepting', pid: PID, actor: 'local', edits: null, resolution: proposal(), identity: { artifactRef: '_unfiled/x', runId: 'r' } },
    ] };
    page();
    await waitFor(() => expect(text('artifact-proposal-record')).toBe('Starting it…'));
    expect(screen.queryByTestId('artifact-proposal-go-again')).toBeNull();
    // The window closes ~300 ms later on this same mounted card.
    await screen.findByTestId('artifact-proposal-go-again', undefined, { timeout: 2000 });
    expect(text('artifact-proposal-record')).toBe('Interrupted before it was recorded as started.');
  });

  it('a live accepting record closes the form before the answer fails with no view: the refusal shows once, under the card', async () => {
    let release!: (r: Response) => void;
    decideAnswer = () => new Promise<Response>((r) => { release = r; }) as unknown as Response;
    const form = await openForm();
    fireEvent.click(within(form).getByTestId('proposal-answer-go'));
    await waitFor(() => expect(posts).toHaveLength(1));
    // The transcript's accepting record arrives first (another read), closing the form.
    chatBody = { ...chatBody, messages: [...(chatBody['messages'] as unknown[]), { at: Date.now(), turnId: 't1', kind: 'proposal_accepting', pid: PID, actor: 'local', edits: null, resolution: proposal(), identity: { artifactRef: '_unfiled/x', runId: 'r' } }] };
    act(() => useAskThreadStore.getState().ingest({ type: 'chatProposal', chat: 'chat-ask', turn_id: 't1', record: {} } as never));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('accepting'));
    expect(screen.queryByTestId('proposal-answer-form')).toBeNull();
    release(new Response(JSON.stringify({ error: 'the gateway dropped the answer' }), { status: 502, headers: { 'content-type': 'application/json' } }));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal-error').textContent).toBe('the gateway dropped the answer'));
    expect(screen.getAllByText('the gateway dropped the answer')).toHaveLength(1);
  });

  it('a helper that is on the roster but cannot work (signed out) is said, and Make it waits for two that can', async () => {
    setCachedRoster([
      { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true, auth: 'signed_out' } as never,
      { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true } as never,
      { key: 'agy', display_name: 'Antigravity', binary: 'agy', enabled_for_council: true } as never,
    ]);
    const form = await openForm();
    const out = within(form).getAllByTestId('proposal-answer-seat').find((s) => s.getAttribute('data-seat') === 'claude')!;
    expect(out.textContent).toBe('Claude Code (not available)');
    expect(within(form).getByTestId('proposal-answer-go').hasAttribute('disabled')).toBe(true);
    fireEvent.click(out);
    fireEvent.click(within(form).getAllByTestId('proposal-answer-seat').find((s) => s.getAttribute('data-seat') === 'agy')!);
    expect(within(form).getByTestId('proposal-answer-go').hasAttribute('disabled')).toBe(false);
  });

  it('an interrupted Go whose helper can no longer work: Change helpers sends only the helpers; focus follows', async () => {
    chatBody = { ...chatBody, messages: [
      ...TURN,
      { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: proposal() },
      { at: T0 + 1600, turnId: 't1', kind: 'proposal_accepting', pid: PID, actor: 'local', edits: null, resolution: proposal(), identity: { artifactRef: '_unfiled/x', runId: 'r' } },
    ] };
    page();
    fireEvent.click(await screen.findByTestId('artifact-proposal-change-helpers'));
    const form = screen.getByTestId('proposal-answer-form');
    expect(document.activeElement).toBe(form);
    expect((within(form).getByTestId('proposal-answer-title') as HTMLInputElement).disabled).toBe(true);
    expect(within(form).getAllByTestId('proposal-answer-repo').every((r) => (r as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(within(form).getAllByTestId('proposal-answer-seat').find((s) => s.getAttribute('data-seat') === 'claude')!);
    fireEvent.click(within(form).getAllByTestId('proposal-answer-seat').find((s) => s.getAttribute('data-seat') === 'agy')!);
    fireEvent.click(within(form).getByTestId('proposal-answer-go'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toStrictEqual({ decision: 'go', edits: { helpers: ['codex', 'agy'] } });
  });

  it('a Go crew refused (launch_failed) offers Go again at once, even when its accepting record is moments old', async () => {
    decideAnswer = () => new Response(JSON.stringify({ code: 'launch_failed', error: 'could not start it: the engine is restarting. Go again resumes the same job.', view: { proposal: proposal(), state: 'accepting' } }), { status: 502, headers: { 'content-type': 'application/json' } });
    page();
    await screen.findByTestId('artifact-proposal');
    // The reread after the refusal carries the fresh accepting record.
    chatBody = { ...chatBody, messages: [...(chatBody['messages'] as unknown[]), { at: Date.now(), turnId: 't1', kind: 'proposal_accepting', pid: PID, actor: 'local', edits: null, resolution: proposal(), identity: { artifactRef: '_unfiled/x', runId: 'r' } }] };
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await screen.findByTestId('artifact-proposal-go-again');
    expect(text('artifact-proposal-record')).toBe('Interrupted before it was recorded as started.');
  });

  it('the helpers-only form stays mounted while its answer is on the way, and keeps the replacement when refused', async () => {
    decideAnswer = () => new Response(JSON.stringify({ code: 'chat_busy', error: 'This chat already has a job running (run 0bad0bad). Wait, or stop that run.' }), { status: 409, headers: { 'content-type': 'application/json' } });
    chatBody = { ...chatBody, messages: [
      ...TURN,
      { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: proposal() },
      { at: T0 + 1600, turnId: 't1', kind: 'proposal_accepting', pid: PID, actor: 'local', edits: null, resolution: proposal(), identity: { artifactRef: '_unfiled/x', runId: 'r' } },
    ] };
    page();
    fireEvent.click(await screen.findByTestId('artifact-proposal-change-helpers'));
    const form = screen.getByTestId('proposal-answer-form');
    fireEvent.click(within(form).getAllByTestId('proposal-answer-seat').find((s) => s.getAttribute('data-seat') === 'claude')!);
    fireEvent.click(within(form).getAllByTestId('proposal-answer-seat').find((s) => s.getAttribute('data-seat') === 'agy')!);
    fireEvent.click(within(form).getByTestId('proposal-answer-go'));
    await waitFor(() => expect(within(form).getByTestId('proposal-answer-error').textContent).toContain('already has a job running'));
    expect(screen.getByTestId('proposal-answer-form')).toBe(form);
    expect(within(form).getAllByTestId('proposal-answer-seat').filter((s) => s.getAttribute('aria-pressed') === 'true').map((s) => s.getAttribute('data-seat')).sort()).toEqual(['agy', 'codex']);
  });

  it('a helper the tab thinks is signed out is checked again with crew’s keyed sign-in check, not the cached read', async () => {
    const stale = [
      { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true, auth: 'signed_out' },
      { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true },
    ];
    setCachedRoster(stale as never);
    const reads: string[] = [];
    const base = (globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>);
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(url, 'http://x');
      if (!u.pathname.endsWith('/roster')) return base(url, init);
      reads.push(u.search);
      // The plain read is the daemon's cached reading (still signed out); only the keyed check reads it fresh.
      return Promise.resolve(ok(u.searchParams.get('refresh') === 'claude'
        ? { roster: [{ ...stale[0], auth: undefined }, stale[1]], refresh: { key: 'claude', outcome: 'signed_in' } }
        : { roster: stale }));
    }));
    const form = await openForm();
    expect(within(form).getByTestId('proposal-answer-go').hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(form).getByTestId('proposal-answer-council-refresh'));
    await waitFor(() => expect(within(form).getByTestId('proposal-answer-go').hasAttribute('disabled')).toBe(false));
    expect(reads).toEqual(['?refresh=claude']);
    // The control that asked is gone; focus stays in the helpers, and the line is a live status.
    await waitFor(() => expect(document.activeElement).toBe(within(form).getByTestId('proposal-answer-seats')));
    expect(within(form).getByTestId('proposal-answer-council').getAttribute('role')).toBe('status');
  });

  it('one check at a time, and a check that fails is said beside the helpers, with the control kept', async () => {
    setCachedRoster([
      { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true, auth: 'signed_out' } as never,
      { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true } as never,
    ]);
    let release: (r: Response) => void = () => {};
    let reads = 0;
    const base = (globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>);
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (!new URL(url, 'http://x').pathname.endsWith('/roster')) return base(url, init);
      reads += 1;
      return new Promise<Response>((r) => { release = r; });
    }));
    const form = await openForm();
    const button = within(form).getByTestId('proposal-answer-council-refresh');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(reads).toBe(1);
    expect(button.hasAttribute('disabled')).toBe(true);
    release(new Response('{}', { status: 503 }));
    await waitFor(() => expect(within(form).getByTestId('proposal-answer-council-check-failed')).toBeTruthy());
    expect(within(form).getByTestId('proposal-answer-council-refresh').hasAttribute('disabled')).toBe(false);
  });

  it('a refusal before accepting never marks another tab’s fresh Go as interrupted', async () => {
    let release: (r: Response) => void = () => {};
    decideAnswer = () => new Promise<Response>((r) => { release = r; });
    page();
    await screen.findByTestId('artifact-proposal');
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await waitFor(() => expect(posts).toHaveLength(1));
    // Another tab's Go is recorded while this tab's answer is on its way; then this one is refused (the chat is busy).
    chatBody = { ...chatBody, messages: [...(chatBody['messages'] as unknown[]), { at: Date.now(), turnId: 't1', kind: 'proposal_accepting', pid: PID, actor: 'local', edits: null, resolution: proposal(), identity: { artifactRef: '_unfiled/x', runId: 'r' } }] };
    release(new Response(JSON.stringify({ code: 'chat_busy', error: 'This chat already has a job running (run 0bad0bad). Wait, or stop that run.' }), { status: 409, headers: { 'content-type': 'application/json' } }));
    await waitFor(() => expect(text('artifact-proposal-record')).toBe('Starting it…'));
    expect(screen.queryByTestId('artifact-proposal-go-again')).toBeNull();
  });

  it('Go again after a launch_failed says Starting while its answer is on the way', async () => {
    decideAnswer = () => new Response(JSON.stringify({ code: 'launch_failed', error: 'could not start it: the engine is restarting. Go again resumes the same job.', view: { proposal: proposal(), state: 'accepting' } }), { status: 502, headers: { 'content-type': 'application/json' } });
    page();
    await screen.findByTestId('artifact-proposal');
    chatBody = { ...chatBody, messages: [...(chatBody['messages'] as unknown[]), { at: Date.now(), turnId: 't1', kind: 'proposal_accepting', pid: PID, actor: 'local', edits: null, resolution: proposal(), identity: { artifactRef: '_unfiled/x', runId: 'r' } }] };
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    const again = await screen.findByTestId('artifact-proposal-go-again');
    decideAnswer = () => new Promise<Response>(() => {});
    fireEvent.click(again);
    await waitFor(() => expect(text('artifact-proposal-record')).toBe('Starting it…'));
  });

  it('Cancel puts focus back on Change something', async () => {
    const form = await openForm();
    fireEvent.click(within(form).getByTestId('proposal-answer-cancel'));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-ask-option')).toBe('change'));
  });

  it('a roster that cannot be read is said with a Retry; Make it waits for a roster', async () => {
    clearCachedRoster();
    let fail = true;
    const base = (globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>);
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (new URL(url, 'http://x').pathname.endsWith('/roster')) {
        return Promise.resolve(fail ? new Response('{}', { status: 503 }) : ok({ roster: [
          { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true },
          { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true },
        ] }));
      }
      return base(url, init);
    }));
    const form = await openForm();
    await within(form).findByTestId('proposal-answer-council-error');
    expect(within(form).getByTestId('proposal-answer-go').hasAttribute('disabled')).toBe(true);
    fail = false;
    fireEvent.click(within(form).getByTestId('proposal-answer-council-retry'));
    await waitFor(() => expect(within(form).getByTestId('proposal-answer-go').hasAttribute('disabled')).toBe(false));
  });

  it('a record whose fields the form reads are malformed is skipped, never a card that breaks when opened', () => {
    for (const bad of [
      { helpers: { label: 'two', seats: 42 } },
      { repoRefs: [1] },
      { artifactRef: 7 },
      { filedIn: { projectId: 3, label: 'x' } },
    ]) {
      expect(isArtifactProposal({ ...proposal(), ...bad }), JSON.stringify(bad)).toBe(false);
    }
    expect(isArtifactProposal(proposal())).toBe(true);
  });

  it('two repositories that share a name are told apart by their id', () => {
    expect(repoKeysOf(proposal({ repos: ['shared', 'shared', 'crew'], repoRefs: ['r-a', 'r-b', 'r-c'] }))).toStrictEqual([
      { key: 'r-a', label: 'shared (r-a)' }, { key: 'r-b', label: 'shared (r-b)' }, { key: 'r-c', label: 'crew' },
    ]);
  });

  it('under the test configuration a create card no longer says it starts nothing; a refine card still does', async () => {
    useCapabilities.setState({ chatArtifactsStub: true, chatArtifactsStubOps: ['refine', 'theme', 'demo'] });
    page();
    await screen.findByTestId('artifact-proposal');
    expect(screen.queryByTestId('artifact-proposal-stub')).toBeNull();
    cleanup();
    resetSettledProposals();
    setup(proposal({ kind: 'refine', target: { ref: 'mikes/deck', title: 'Deck', base: 2 } }));
    page();
    await screen.findByTestId('artifact-proposal');
    expect(screen.getByTestId('artifact-proposal-stub')).not.toBeNull();
  });
});
