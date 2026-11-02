import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const { setCachedRoster } = await import('../src/store/rosterCache.js');
const { formSources, proposalFormEdits, proposalFormOf, resetSettledProposals } = await import('../src/board/artifactProposal.js');
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
let decideAnswer: () => Response = () => new Response('{}', { status: 500 });
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
    expect(f).toStrictEqual({ title: 'Release note', brief: 'what changed in coverage', project: null, sources: ['chat', 'run:29bbbfb1-0000', 'run:57443b2b-0000'], repos: ['wicked-crew'], helpers: ['claude', 'codex'] });
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
    // Only the project moves: crew re-checks and strikes the rest itself (no sources edit, so no refusal for them).
    expect(proposalFormEdits(p, moved)).toStrictEqual({ project: 'mikes' });
    // Leaving one more out sends the kept ones, never the struck one.
    expect(proposalFormEdits(p, { ...moved, sources: ['chat', 'run:29bbbfb1-0000'] })).toStrictEqual({ project: 'mikes', sources: ['chat'] });
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
    // Nothing in the form takes focus away from the composer.
    expect(form.contains(document.activeElement)).toBe(false);
  });

  it('Make it answers THIS proposal with the edits, never a create; the card then shows what was started', async () => {
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
    expect(posts[0]!.body).toStrictEqual({ decision: 'go', edits: { project: 'mikes' } });
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
