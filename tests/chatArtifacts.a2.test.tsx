import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DES-CHAT-ARTIFACTS-001 slice A2 (studio): a chat proposes; nothing launches without a person's click.
 *  - The transcript's proposal records fold into one card per proposal, with crew's rules (a newer one supersedes the
 *    open one; the same pid again re-opens it with the fresh facts; an answer stays answered).
 *  - The card draws crew's facts (What, From with struck chips and their reasons, About, Helpers, Time and cost, Stops,
 *    Filed in) on an AskCard whose primary is preselected but NEVER focused.
 *  - Make it / Not now post `POST /chats/:id/proposals/:pid`; Change something is routed per kind (a stub note, no post).
 *  - A reload draws the answered card as its record line; a daemon without the capability draws no card.
 */

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useTeamPlanStore } = await import('../src/store/teamPlan.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useSheets } = await import('../src/store/sheets.js');
const { makeUnit, makeView } = await import('./factories.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');
const { foldChatProposals, proposalAsk, changeRoute, proposalRecordLine, resetSettledProposals, isProposalRecord, isProposalView, shownProposal } = await import('../src/board/artifactProposal.js');
type Proposal = import('../src/api/chatArtifacts-wire.js').ArtifactProposal;

const T0 = 1_700_000_000_000;
const RUN = 'r-ask';
const PID = 'chat-ask:t1';

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    pid: PID, chatId: 'chat-ask', turnId: 't1', kind: 'create', seat: 'claude',
    what: { entry: 'document-static', title: 'Release note', label: 'Document · Release note', outcome: 'A document in studio you can edit in place and export as PDF.' },
    brief: 'what changed', reason: null,
    sources: [
      { token: 'chat', label: 'this conversation', status: 'ok' },
      { token: 'run:29bbbfb1-0000', label: 'run 29bbbfb1 · stopped', status: 'ok', projectId: null },
      { token: 'run:1a2b3c4d-0000', label: 'run 1a2b3c4d', status: 'struck', reason: 'not named in this chat', projectId: null },
    ],
    repos: ['wicked-crew'],
    helpers: { seats: ['codex', 'claude'], label: 'Codex and Claude Code: one writes, the other checks' },
    time: { minutes: [10, 20], cost: 'medium', steps: 3, median: { runs: 4, minutes: 9, costUsd: 0.62, costRuns: 4 }, label: 'About 10–20 min · 3 agent steps · median of 4 past documents here: 9 min, $0.62' },
    stops: 'Stops for you if the check fails. The plan or an escalation may also ask.',
    filedIn: { projectId: null, label: 'Not in a project · this chat' },
    blocked: null,
    ...over,
  };
}

const ASK_RUN = makeView({ id: RUN, status: 'awaiting_human', problem: 'release note', unit_ix: 1, chat_id: 'chat-ask', created_at: T0 / 1000 } as never, [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: 'done', assigned_cli: 'claude', description: 'answer-1' }),
]);
const TURN = [
  { at: T0, turnId: 't1', kind: 'user', seats: ['claude'], text: 'Write a release note from runs 29bbbfb1 and 1a2b3c4d' },
  { at: T0 + 1000, turnId: 't1', kind: 'seat', cliKey: 'claude', ok: true, usage: null, text: 'I can make that into a document.' },
];

let chatBody: Record<string, unknown> = {};
const posts: Array<{ path: string; body: unknown }> = [];
let decideAnswer: () => Response | Promise<Response> = () => new Response('{}', { status: 500 });
/** `GET /chats/:id/messages` (an ended chat's kept history): its body, or an error status. */
let keptBody: Record<string, unknown> | number = 404;
/** How many times the page read the chat (`GET /chats/:id` and `/messages`). */
let chatReads = 0;
/** `GET /chats/:id` fails with this status (the chat's own status read). */
let chatFail: number | null = null;

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  posts.length = 0;
  keptBody = 404;
  chatReads = 0;
  chatFail = null;
  resetSettledProposals();
  chatBody = { chatId: 'chat-ask', seats: ['claude'], scope: { kind: 'none' }, messages: [...TURN, { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: proposal() }], path: { runId: RUN, pa: 'claude', selection: 'random', reviewer: null, helpers: [], stepId: 'answer-1' } };
  useCapabilities.setState({ loaded: true, runChatId: true, askPath: true, chatProposals: true, chatArtifactsStub: false, chatList: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, chatClosed: {}, turnGates: {}, replySeq: {}, paByChat: {}, retiredByChat: {}, answerOrds: { [RUN]: [1] } });
  useAskThreadStore.getState().recordTurnGate(RUN, 1);
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  useSheets.setState({ open: null, pointed: null, stopping: {} });
  setCachedRoster([{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true } as never, { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true } as never]);
  decideAnswer = () => ok({ view: { proposal: proposal(), state: 'decided', decision: 'go', result: { runId: 'aaaaaaaa-1111-5222-8333-444444444444', artifactRef: '_unfiled/release-note-1a', adopted: false, stub: false }, decidedAt: T0 + 3000 } });
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body)) });
      return path.includes('/proposals/') ? Promise.resolve(decideAnswer()) : Promise.resolve(ok({}));
    }
    if (path.includes('/considered')) return Promise.resolve(new Response('{}', { status: 404 }));
    if (path.startsWith('/chats/')) chatReads += 1;
    if (path.startsWith('/chats/') && path.endsWith('/messages')) {
      if (keptBody === -1) return new Promise<Response>(() => undefined); // a read still in flight
      return Promise.resolve(typeof keptBody === 'number' ? new Response(JSON.stringify({ error: 'read failed' }), { status: keptBody }) : ok(keptBody));
    }
    if (path.startsWith('/chats/') && chatFail !== null) return Promise.resolve(new Response(JSON.stringify({ error: 'unavailable' }), { status: chatFail }));
    if (path.startsWith('/chats/')) return Promise.resolve(ok(chatBody));
    if (path.endsWith('/team')) return Promise.resolve(new Response('{}', { status: 404 }));
    if (path.endsWith('/events')) return Promise.resolve(ok({ events: [] }));
    return Promise.resolve(ok({}));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function page(onAsk: (text: string, opts: unknown) => void = () => {}, runs = [ASK_RUN], sessionId = 'chat-ask') {
  return render(<SessionPage sessionId={sessionId} runs={runs} runsLoaded needRows={[]} navigate={() => {}} onAsk={onAsk} />);
}
const text = (id: string): string => screen.getByTestId(id).textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('the proposal fold', () => {
  it('a newer proposal supersedes the open one; the same pid re-opens with fresh facts; an answer stays answered', () => {
    const p1 = proposal();
    const p2 = proposal({ pid: 'chat-ask:t2', turnId: 't2' });
    const folded = foldChatProposals([
      { at: 1, turnId: 't1', kind: 'proposal', proposal: p1 },
      { at: 2, turnId: 't1', kind: 'user', text: 'x' },
      { at: 3, turnId: 't2', kind: 'proposal', proposal: p2 },
      { at: 4, turnId: 't2', kind: 'proposal_accepting', pid: p2.pid, actor: 'local', edits: null, resolution: p2, identity: { artifactRef: null, runId: 'r' } },
      { at: 5, turnId: 't2', kind: 'proposal', proposal: { ...p2, target: { ref: 'm/d', title: 'D', base: 5 } } },
    ]);
    expect(folded.map((f) => [f.pid, f.state, f.at])).toStrictEqual([[PID, 'superseded', 1], ['chat-ask:t2', 'open', 3]]);
    expect(folded[1]!.proposal.target?.base).toBe(5);
    // An older proposal re-resolved after a newer one exists is superseded, never re-opened over it (crew's rule).
    const older = foldChatProposals([
      { at: 1, turnId: 't1', kind: 'proposal', proposal: p1 },
      { at: 2, turnId: 't1', kind: 'proposal_accepting', pid: PID, actor: 'local', edits: null, resolution: p1, identity: { artifactRef: null, runId: 'r' } },
      { at: 3, turnId: 't2', kind: 'proposal', proposal: p2 },
      { at: 4, turnId: 't1', kind: 'proposal', proposal: p1 },
    ]);
    expect(older.map((f) => [f.pid, f.state])).toStrictEqual([[PID, 'superseded'], ['chat-ask:t2', 'open']]);
    const decided = foldChatProposals([
      { at: 1, turnId: 't1', kind: 'proposal', proposal: p1 },
      { at: 2, turnId: 't1', kind: 'proposal_decided', pid: PID, actor: 'local', decision: 'not_now', result: null },
      { at: 3, turnId: 't1', kind: 'proposal_decided', pid: PID, actor: 'local', decision: 'go', result: null },
    ]);
    expect(decided[0]).toMatchObject({ state: 'decided', decision: 'not_now', decidedAt: 2 });
    expect(proposalRecordLine(decided[0]!)).toBe('You chose: Not now');
  });

  it('the ask: the primary per kind is preselected and recommended; a blocked one is disabled with crew’s reason', () => {
    const [e] = foldChatProposals([{ at: 1, turnId: 't1', kind: 'proposal', proposal: proposal() }]);
    const ask = proposalAsk(e!, { stub: false });
    expect(ask).toMatchObject({ host: 'chat', kind: 'choose', default: 'go', answeredBy: 'person' });
    expect(ask.options?.map((o) => o.label)).toStrictEqual(['Make it', 'Change something', 'Not now']);
    expect(ask.options?.[0]?.recommended).toBe(true);
    for (const [kind, word] of [['refine', 'Make the change'], ['theme', 'Preview'], ['demo', 'Make it']] as const) {
      const [k] = foldChatProposals([{ at: 1, turnId: 't1', kind: 'proposal', proposal: proposal({ kind }) }]);
      expect(proposalAsk(k!, { stub: false }).options?.[0]?.label).toBe(word);
    }
    const [b] = foldChatProposals([{ at: 1, turnId: 't1', kind: 'proposal', proposal: proposal({ blocked: 'Needs a second helper to check it' }) }]);
    const blocked = proposalAsk(b!, { stub: true });
    expect(blocked.default).toBe('change');
    expect(blocked.options?.[0]).toMatchObject({ disabled: 'Blocked: Needs a second helper to check it' });
    expect(blocked.options?.[0]?.consequence).toMatch(/^Test configuration/);
    expect(changeRoute('create').note).toMatch(/New document form/);
  });
});

describe('the card in the chat thread', () => {
  it('draws crew’s facts after the reply, with the struck source and its reason, and takes no focus', async () => {
    page();
    const card = await screen.findByTestId('artifact-proposal');
    expect(card.getAttribute('data-state')).toBe('open');
    expect(text('artifact-proposal-what')).toBe('Document · Release note');
    const sources = screen.getAllByTestId('artifact-proposal-source');
    // A struck chip says so in words, read the same aloud as on screen (crew's reason verbatim; no invented one).
    expect(sources.map((s) => [s.getAttribute('data-status'), s.textContent])).toStrictEqual([
      ['ok', 'this conversation'],
      ['ok', 'run 29bbbfb1 · stopped'],
      ['struck', 'Left out: run 1a2b3c4d · not named in this chat'],
    ]);
    expect(sources[2]!.hasAttribute('aria-label')).toBe(false);
    expect(text('artifact-proposal-brief')).toBe('Briefwhat changed');
    expect(text('artifact-proposal-about')).toBe('Aboutwicked-crew');
    expect(text('artifact-proposal-helpers')).toContain('Codex and Claude Code: one writes, the other checks');
    expect(text('artifact-proposal-time')).toContain('median of 4 past documents here: 9 min, $0.62');
    expect(text('artifact-proposal-filed')).toContain('Not in a project · this chat');
    // After the reply that carried the block.
    const order = [...document.querySelectorAll('[data-testid="session-turn"], [data-testid="artifact-proposal"]')].map((el) => el.getAttribute('data-testid'));
    expect(order).toStrictEqual(['session-turn', 'session-turn', 'artifact-proposal']);
    // Preselected, never focused: the composer keeps Enter.
    expect(card.querySelector('[data-ask-option="go"]')?.getAttribute('aria-checked')).toBe('true');
    expect(card.contains(document.activeElement)).toBe(false);
    expect(screen.queryByTestId('artifact-proposal-stub')).toBeNull();
  });

  it('Make it posts go once and the card becomes its record line', async () => {
    page();
    await screen.findByTestId('artifact-proposal');
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('decided'));
    expect(posts).toStrictEqual([{ path: `/chats/chat-ask/proposals/${encodeURIComponent(PID)}`, body: { decision: 'go' } }]);
    expect(text('artifact-proposal-record')).toBe('You chose: Make it');
    expect(screen.getByTestId('ask-record-row').textContent).toContain('Started · run aaaaaaaa');
  });

  it('Not now posts not_now; Change something posts nothing and says what is coming', async () => {
    decideAnswer = () => ok({ view: { proposal: proposal(), state: 'decided', decision: 'not_now', result: null, decidedAt: T0 + 3000 } });
    page();
    const card = await screen.findByTestId('artifact-proposal');
    fireEvent.click(card.querySelector('[data-ask-option="change"]')!);
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    expect(text('artifact-proposal-note')).toMatch(/New document form/);
    expect(posts).toStrictEqual([]);
    fireEvent.click(card.querySelector('[data-ask-option="not_now"]')!);
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('decided'));
    expect(posts.map((p) => p.body)).toStrictEqual([{ decision: 'not_now' }]);
    expect(text('artifact-proposal-record')).toBe('You chose: Not now');
  });

  it('a refusal says crew’s words and keeps the card answerable', async () => {
    decideAnswer = () => new Response(JSON.stringify({ code: 'chat_busy', error: 'This chat already has a job running (run 0bad0bad). Wait, or stop that run.', view: { proposal: proposal(), state: 'open' } }), { status: 409, headers: { 'content-type': 'application/json' } });
    page();
    await screen.findByTestId('artifact-proposal');
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal-error').textContent).toBe('This chat already has a job running (run 0bad0bad). Wait, or stop that run.'));
    expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('open');
    expect(screen.getByTestId('artifact-proposal-confirm')).not.toBeNull();
  });

  it('a reload draws an answered card collapsed to its line (facts behind Details); a replaced one says so', async () => {
    const p2 = proposal({ pid: 'chat-ask:t2', turnId: 't2', what: { entry: 'presentation', title: 'Deck', label: 'Slides · Deck', outcome: null } });
    chatBody = { ...chatBody, messages: [
      ...TURN,
      { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: proposal() },
      { at: T0 + 2000, turnId: 't2', kind: 'proposal', proposal: p2 },
      { at: T0 + 2500, turnId: 't2', kind: 'proposal_accepting', pid: p2.pid, actor: 'local', edits: null, resolution: p2, identity: { artifactRef: null, runId: 'r2' } },
      { at: T0 + 2600, turnId: 't2', kind: 'proposal_decided', pid: p2.pid, actor: 'local', decision: 'go', result: { runId: 'bbbbbbbb-1', artifactRef: null, adopted: false, stub: true } },
    ] };
    page();
    await waitFor(() => expect(screen.getAllByTestId('artifact-proposal')).toHaveLength(2));
    const [first, second] = screen.getAllByTestId('artifact-proposal');
    expect(first!.getAttribute('data-state')).toBe('superseded');
    expect(first!.textContent).toContain('A newer proposal replaced this one. Nothing was started.');
    expect(second!.getAttribute('data-state')).toBe('decided');
    expect(second!.textContent).toContain('You chose: Make it');
    expect(second!.textContent).toContain('Test configuration: recorded, nothing was made');
    expect(screen.queryByTestId('artifact-proposal-confirm')).toBeNull();
    // Collapsed: no fact sheet until Details is pressed.
    expect(second!.querySelector('[data-testid="artifact-proposal-lines"]')).toBeNull();
    fireEvent.click(second!.querySelector('[data-testid="artifact-proposal-details"]')!);
    expect(second!.querySelector('[data-testid="artifact-proposal-lines"]')).not.toBeNull();
  });

  it('a settled card never reopens on an older read; an interrupted Go offers Go again', async () => {
    chatBody = { ...chatBody, messages: [
      ...TURN,
      { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: proposal() },
      { at: T0 + 1600, turnId: 't1', kind: 'proposal_decided', pid: PID, actor: 'local', decision: 'not_now', result: null },
    ] };
    const view = page();
    await waitFor(() => expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('decided'));
    // An older snapshot (another tab's stale read) arrives: the card stays answered, no controls come back.
    chatBody = { ...chatBody, messages: [...TURN, { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: proposal() }] };
    act(() => useAskThreadStore.getState().ingest({ type: 'chatProposal', chat: 'chat-ask', turn_id: 't1', record: {} } as never));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('decided');
    expect(screen.queryByTestId('artifact-proposal-confirm')).toBeNull();
    view.unmount();
    // Interrupted: accepting with no decision.
    resetSettledProposals();
    chatBody = { ...chatBody, messages: [
      ...TURN,
      { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: proposal() },
      { at: T0 + 1600, turnId: 't1', kind: 'proposal_accepting', pid: PID, actor: 'local', edits: null, resolution: proposal(), identity: { artifactRef: null, runId: 'r' } },
    ] };
    page();
    await screen.findByTestId('artifact-proposal-go-again');
    expect(text('artifact-proposal-record')).toBe('Interrupted before it was recorded as started.');
    fireEvent.click(screen.getByTestId('artifact-proposal-go-again'));
    await waitFor(() => expect(posts.map((p) => p.body)).toStrictEqual([{ decision: 'go' }]));
  });

  it('Enter in the composer with a card on screen sends a message, never an answer; the card never takes focus', async () => {
    const asked: Array<[string, unknown]> = [];
    page((text, opts) => asked.push([text, opts]));
    await screen.findByTestId('artifact-proposal');
    const box = screen.getByTestId('session-composer-input') as HTMLTextAreaElement;
    box.focus();
    fireEvent.change(box, { target: { value: 'actually, one more question' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    // A proposal record arriving re-renders the card: focus stays in the composer.
    act(() => useAskThreadStore.getState().ingest({ type: 'chatProposal', chat: 'chat-ask', turn_id: 't1', record: {} } as never));
    await new Promise((r) => setTimeout(r, 30));
    expect(document.activeElement).toBe(box);
    expect(asked.map(([t, o]) => [t, (o as { chatId?: string }).chatId])).toStrictEqual([['actually, one more question', 'chat-ask']]);
    expect(posts.filter((p) => p.path.includes('/proposals/'))).toStrictEqual([]);
    expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('open');
  });

  it('a demo card shows what it records and shows; the stub says the click starts nothing; a malformed record is skipped', async () => {
    useCapabilities.setState({ chatArtifactsStub: true });
    chatBody = { ...chatBody, messages: [
      ...TURN,
      { at: T0 + 1400, turnId: 't0', kind: 'proposal', proposal: { pid: 'broken' } },
      { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: proposal({ kind: 'demo', sources: [], demo: { url: 'http://localhost:5173/req', audience: 'engineers', show: 'the requirements view' }, what: { entry: 'demo-video', title: 'Req', label: 'Demo video · Req', outcome: null } }) },
    ] };
    expect(isProposalRecord({ at: 1, turnId: 't0', kind: 'proposal', proposal: { pid: 'broken' } })).toBe(false);
    page();
    await screen.findByTestId('artifact-proposal');
    expect(screen.getAllByTestId('artifact-proposal')).toHaveLength(1);
    expect(text('artifact-proposal-demo')).toBe('Recordshttp://localhost:5173/req');
    expect(text('artifact-proposal-show')).toBe('Showsthe requirements view');
    expect(screen.getByTestId('artifact-proposal').querySelector('[data-ask-option="go"]')?.textContent).toContain('Records your click; nothing starts');
  });

  it('the test configuration says Go starts nothing; a chatProposal frame re-reads the chat and the card follows', async () => {
    useCapabilities.setState({ chatArtifactsStub: true });
    page();
    await screen.findByTestId('artifact-proposal');
    expect(text('artifact-proposal-stub')).toBe('Test configuration: Make it records your click and starts nothing.');
    // Another tab answered: the transcript now holds the decision, and its frame arrives here.
    chatBody = { ...chatBody, messages: [...(chatBody['messages'] as unknown[]), { at: T0 + 2000, turnId: 't1', kind: 'proposal_decided', pid: PID, actor: 'local', decision: 'not_now', result: null }] };
    const reads = chatReads;
    act(() => useAskThreadStore.getState().ingest({ type: 'chatProposal', chat: 'chat-ask', turn_id: 't1', record: {} } as never));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('decided'));
    expect(chatReads).toBeGreaterThan(reads);
    expect(text('artifact-proposal-record')).toBe('You chose: Not now');
  });

  it('an interrupted Go later declined shows the proposal as recorded; a started one shows what was accepted', () => {
    const edited = proposal({ brief: 'EDITED' });
    const base = [
      { at: 1, turnId: 't1', kind: 'proposal', proposal: proposal() },
      { at: 2, turnId: 't1', kind: 'proposal_accepting', pid: PID, actor: 'l', edits: { brief: 'EDITED' }, resolution: edited, identity: { artifactRef: null, runId: 'r' } },
    ];
    const declined = foldChatProposals([...base, { at: 3, turnId: 't1', kind: 'proposal_decided', pid: PID, actor: 'l', decision: 'not_now', result: null }])[0]!;
    expect(shownProposal(declined).brief).toBe('what changed');
    const started = foldChatProposals([...base, { at: 3, turnId: 't1', kind: 'proposal_decided', pid: PID, actor: 'l', decision: 'go', result: { runId: 'r', artifactRef: null, adopted: false, stub: true } }])[0]!;
    expect(shownProposal(started).brief).toBe('EDITED');
    // A malformed decided view (a non-string run id) is not drawn.
    expect(isProposalView({ proposal: proposal(), state: 'decided', decision: 'go', result: { runId: 42, stub: false } })).toBe(false);
  });

  it('a refusal’s fresh facts show at once (the document moved): the card is never left on what crew replaced', async () => {
    chatBody = { ...chatBody, messages: [...TURN, { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: proposal({ kind: 'refine', target: { ref: 'mikes/deck', title: 'Deck', base: 4 } }) }] };
    decideAnswer = () => new Response(JSON.stringify({ code: 'proposal_reresolved', error: 'Deck changed since this was proposed (now v5); check the card again', view: { proposal: proposal({ kind: 'refine', target: { ref: 'mikes/deck', title: 'Deck', base: 5 } }), state: 'open' } }), { status: 409, headers: { 'content-type': 'application/json' } });
    page();
    await screen.findByTestId('artifact-proposal-target');
    expect(text('artifact-proposal-target')).toBe('ChangesDeck · v4');
    const reads = chatReads;
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal-error').textContent).toMatch(/now v5/));
    // The re-read the answer triggers lands (still the OLDER record here): the refusal's newer facts stay.
    await waitFor(() => expect(chatReads).toBeGreaterThan(reads));
    await new Promise((r) => setTimeout(r, 30));
    expect(text('artifact-proposal-target')).toBe('ChangesDeck · v5');
  });

  it('an ended chat’s cards come from its kept history; a failed read says so with Retry; nothing leaks between chats', async () => {
    const CLOSED = 'chat-closed';
    chatBody = { chatId: CLOSED, seats: [], scope: null, messages: [] };
    keptBody = 503;
    // No runs: the page would say "nothing here" — it does not while the read failed (it says the read failed).
    page(() => {}, [], CLOSED);
    await screen.findByTestId('artifact-proposals-read-error');
    expect(screen.queryByTestId('artifact-proposal')).toBeNull();
    expect(screen.queryByTestId('session-missing')).toBeNull();
    keptBody = { chat: { id: CLOSED }, messages: [...TURN, { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: proposal({ pid: `${CLOSED}:t1`, chatId: CLOSED }) }], attachments: [] };
    fireEvent.click(screen.getByTestId('artifact-proposals-read-error').querySelector('button')!);
    const card = await screen.findByTestId('artifact-proposal');
    expect(card.getAttribute('data-pid')).toBe(`${CLOSED}:t1`);
    expect(screen.queryByTestId('artifact-proposals-read-error')).toBeNull();
    expect(screen.queryByTestId('session-missing')).toBeNull();
    // A later read that fails keeps the cards shown beside the error.
    keptBody = 503;
    act(() => useAskThreadStore.getState().ingest({ type: 'chatProposal', chat: CLOSED, turn_id: 't1', record: {} } as never));
    await screen.findByTestId('artifact-proposals-read-error');
    expect(screen.getByTestId('artifact-proposal').getAttribute('data-pid')).toBe(`${CLOSED}:t1`);
    // Another chat's cards never stand in for this one's while its kept history loads.
    cleanup();
    chatBody = { chatId: 'chat-ask', seats: ['claude'], scope: { kind: 'none' }, messages: [...TURN, { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: proposal() }], path: { runId: RUN, pa: 'claude', selection: 'random', reviewer: null, helpers: [], stepId: 'answer-1' } };
    const view = page();
    await screen.findByTestId('artifact-proposal');
    chatBody = { chatId: 'chat-other', seats: [], scope: null, messages: [] };
    keptBody = -1;
    view.rerender(<SessionPage sessionId="chat-other" runs={[makeView({ id: 'r-o', status: 'completed', problem: 'x', chat_id: 'chat-other', created_at: T0 / 1000 } as never, [])]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('artifact-proposal')).toBeNull();
    // Malformed records (no `time`, a null source) are skipped, never crash the thread.
    expect(isProposalRecord({ at: 1, turnId: 't9', kind: 'proposal', proposal: { ...proposal(), time: undefined } })).toBe(false);
    expect(isProposalRecord({ at: 1, turnId: 't9', kind: 'proposal', proposal: { ...proposal(), sources: [null] } })).toBe(false);
  });

  it('a refusal that arrives after another tab settled the card leaves no stale error under the answer', async () => {
    let release!: () => void;
    decideAnswer = () => new Promise<Response>((res) => {
      release = () => res(new Response(JSON.stringify({ code: 'chat_busy', error: 'This chat already has a job running.', view: { proposal: proposal(), state: 'open' } }), { status: 409, headers: { 'content-type': 'application/json' } }));
    });
    page();
    await screen.findByTestId('artifact-proposal');
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    // Meanwhile another tab answered Not now: the frame re-reads the chat first.
    chatBody = { ...chatBody, messages: [...(chatBody['messages'] as unknown[]), { at: T0 + 2000, turnId: 't1', kind: 'proposal_decided', pid: PID, actor: 'local', decision: 'not_now', result: null }] };
    act(() => useAskThreadStore.getState().ingest({ type: 'chatProposal', chat: 'chat-ask', turn_id: 't1', record: {} } as never));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('decided'));
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('decided');
    expect(screen.queryByTestId('artifact-proposal-error')).toBeNull();
  });

  it('a failed status read of an ended chat keeps its cards; a reconnect reads back what the socket missed', async () => {
    const { useConnectionStore } = await import('../src/store/connection.js');
    useConnectionStore.setState({ status: 'connected' });
    const CLOSED = 'chat-ended';
    chatBody = { chatId: CLOSED, seats: [], scope: null, messages: [] };
    keptBody = { chat: { id: CLOSED }, messages: [...TURN, { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: proposal({ pid: `${CLOSED}:t1`, chatId: CLOSED }) }], attachments: [] };
    page(() => {}, [], CLOSED);
    await screen.findByTestId('artifact-proposal');
    // The chat's own status read fails on the next refresh: the cards stay.
    chatFail = 503;
    act(() => useAskThreadStore.getState().ingest({ type: 'chatProposal', chat: CLOSED, turn_id: 't1', record: {} } as never));
    await waitFor(() => expect(chatReads).toBeGreaterThan(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId('artifact-proposal').getAttribute('data-pid')).toBe(`${CLOSED}:t1`);
    // Retry while the status read still fails: the cards stay through the pending read and the second failure.
    const reads = chatReads;
    fireEvent.click(screen.getByTestId('session-chat-error').querySelector('button')!);
    await waitFor(() => expect(chatReads).toBeGreaterThan(reads));
    await waitFor(() => expect(screen.queryByTestId('session-chat-error')).not.toBeNull());
    expect(screen.getByTestId('artifact-proposal').getAttribute('data-pid')).toBe(`${CLOSED}:t1`);
    // The socket drops; meanwhile another tab answered; on reconnect the page reads it back (no frame replayed).
    chatFail = null;
    act(() => useConnectionStore.setState({ status: 'disconnected' }));
    keptBody = { chat: { id: CLOSED }, messages: [...TURN, { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: proposal({ pid: `${CLOSED}:t1`, chatId: CLOSED }) }, { at: T0 + 2000, turnId: 't1', kind: 'proposal_decided', pid: `${CLOSED}:t1`, actor: 'local', decision: 'not_now', result: null }], attachments: [] };
    act(() => useConnectionStore.setState({ status: 'connected' }));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('decided'));
  });

  it('a daemon without the capability draws no card', async () => {
    useCapabilities.setState({ chatProposals: false });
    page();
    await screen.findByText('I can make that into a document.');
    expect(screen.queryByTestId('artifact-proposal')).toBeNull();
  });
});
