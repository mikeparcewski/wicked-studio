import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * crew-0182 (crew 0.18.2): a chat adds a git repository to a project on one consent. Crew resolves the `onboard` card;
 * studio draws its facts (address, name, where it is cloned, the project) and Go / Not now answer it, nothing else.
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
const { foldChatProposals, proposalAsk, changeRoute, proposalRecordLine, proposalResultWords, resetSettledProposals, isArtifactProposal } = await import('../src/board/artifactProposal.js');
type Proposal = import('../src/api/chatArtifacts-wire.js').ArtifactProposal;

const T0 = 1_700_000_000_000;
const RUN = 'r-ask';
const PID = 'chat-ask:t1';

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    pid: PID, chatId: 'chat-ask', turnId: 't1', kind: 'theme', seat: 'claude',
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

/** An onboard proposal as crew resolves it (no helpers, time, stops or sources). */
function onboardProposal(over: Partial<Proposal> = {}): Proposal {
  return proposal({
    kind: 'onboard', what: { entry: null, title: 'wicked-studio', label: 'Add a repository · wicked-studio', outcome: 'Cloned to this computer, registered, added to Wicked Labs, and onboarded: its code map is built so jobs and chats can read it.' },
    brief: null, sources: [], repos: [], helpers: null, time: null, stops: null, filedIn: { projectId: 'proj_labs', label: 'Wicked Labs' },
    onboard: { url: 'https://github.com/mikeparcewski/wicked-studio.git', name: 'wicked-studio', checkout: '~/.wicked/repos/wicked-studio', projectId: 'proj_labs', projectName: 'Wicked Labs', existing: null },
    ...over,
  });
}

const ASK_RUN = makeView({ id: RUN, status: 'awaiting_human', problem: 'release note', unit_ix: 1, chat_id: 'chat-ask', created_at: T0 / 1000 } as never, [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: 'done', assigned_cli: 'claude', description: 'answer-1' }),
]);
const TURN = [
  { at: T0, turnId: 't1', kind: 'user', seats: ['claude'], text: 'Want to onboard https://github.com/mikeparcewski/wicked-studio.git into the wicked labs project' },
  { at: T0 + 1000, turnId: 't1', kind: 'seat', cliKey: 'claude', ok: true, usage: null, text: 'I can add wicked-studio to Wicked Labs and onboard it.' },
];

let chatBody: Record<string, unknown> = {};
const posts: Array<{ path: string; body: unknown }> = [];
let decideAnswer: () => Response | Promise<Response> = () => new Response('{}', { status: 500 });
/** `GET /chats/:id/messages` (an ended chat's kept history): its body, or an error status. */
let keptBody: Record<string, unknown> | number = 404;
/** `GET /chats/:id` fails with this status (the chat's own status read). */
let chatFail: number | null = null;
/** `PUT /settings`: the appearance save. */
let putAnswer: () => Response = () => ok({ settings: {} });

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  posts.length = 0;
  putAnswer = () => ok({ settings: {} });
  localStorage.clear();
  keptBody = 404;
  chatFail = null;
  resetSettledProposals();
  chatBody = { chatId: 'chat-ask', seats: ['claude'], scope: { kind: 'none' }, messages: [...TURN, { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: onboardProposal() }], path: { runId: RUN, pa: 'claude', selection: 'random', reviewer: null, helpers: [], stepId: 'answer-1' } };
  useCapabilities.setState({ loaded: true, runChatId: true, askPath: true, chatProposals: true, chatArtifactsStub: false, chatList: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, chatClosed: {}, turnGates: {}, replySeq: {}, paByChat: {}, retiredByChat: {}, answerOrds: { [RUN]: [1] } });
  useAskThreadStore.getState().recordTurnGate(RUN, 1);
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  useSheets.setState({ open: null, pointed: null, stopping: {} });
  setCachedRoster([{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true } as never, { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true } as never]);
  decideAnswer = () => ok({ view: { proposal: onboardProposal(), state: 'decided', decision: 'go', result: { runId: 'aaaaaaaa-1111-5222-8333-444444444444', artifactRef: null, adopted: false, stub: false }, decidedAt: T0 + 3000 } });
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'PUT') {
      posts.push({ path, body: JSON.parse(String(init.body)) });
      return Promise.resolve(putAnswer());
    }
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body)) });
      return path.includes('/proposals/') ? Promise.resolve(decideAnswer()) : Promise.resolve(ok({}));
    }
    if (path.includes('/considered')) return Promise.resolve(new Response('{}', { status: 404 }));
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



const decidePath = `/chats/chat-ask/proposals/${encodeURIComponent(PID)}`;

describe('the onboard card model', () => {
  it('folds an onboard proposal; its words; what Go did', () => {
    expect(isArtifactProposal(onboardProposal())).toBe(true);
    // Every onboard fact must be there: a half card is never drawn.
    expect(isArtifactProposal({ ...onboardProposal(), onboard: undefined })).toBe(false);
    expect(isArtifactProposal({ ...onboardProposal(), onboard: { url: 'x', name: 'y' } })).toBe(false);
    // On any kind: a malformed onboard payload on a create card is refused, never drawn half (codex/pi review).
    const create = { ...onboardProposal(), kind: 'create' as const };
    expect(isArtifactProposal({ ...create, onboard: { url: 'x' } })).toBe(false);
    expect(isArtifactProposal({ ...create, onboard: null })).toBe(false);
    // An answerable card says what Go does: a new one where it is cloned, an existing one the project it joins.
    const base = onboardProposal().onboard!;
    expect(isArtifactProposal(onboardProposal({ onboard: { ...base, checkout: null } }))).toBe(false);
    expect(isArtifactProposal(onboardProposal({ onboard: { ...base, url: ' ' } }))).toBe(false);
    expect(isArtifactProposal(onboardProposal({ onboard: { ...base, checkout: null, projectId: null, existing: { id: 'r', name: 'r' } } }))).toBe(false);
    // One destination: id and name together, and the card's Project row is that project (codex r2).
    expect(isArtifactProposal(onboardProposal({ onboard: { ...base, projectName: null } }))).toBe(false);
    expect(isArtifactProposal(onboardProposal({ filedIn: { projectId: null, label: 'Not in a project' } }))).toBe(false);
    // …unless Go is blocked: then it only informs.
    expect(isArtifactProposal(onboardProposal({ blocked: 'no project is named “labs”', onboard: { ...base, checkout: null } }))).toBe(true);
    const [e] = foldChatProposals([{ at: 1, turnId: 't1', kind: 'proposal', proposal: onboardProposal() }]);
    const ask = proposalAsk(e!, { stub: false });
    expect(ask.options?.map((o) => [o.label, o.sub])).toStrictEqual([
      ['Add it', 'Clones it and starts onboarding'],
      ['Change something', 'Say it in the chat'],
      ['Not now', 'Nothing is cloned or registered'],
    ]);
    expect(changeRoute('onboard')).toMatchObject({ kind: 'stub', note: expect.stringMatching(/say so in the chat/) });
    const [done] = foldChatProposals([
      { at: 1, turnId: 't1', kind: 'proposal', proposal: onboardProposal() },
      { at: 2, turnId: 't1', kind: 'proposal_decided', pid: PID, actor: 'local', decision: 'go', result: { runId: 'aaaaaaaa-1111', artifactRef: null, adopted: false, stub: false } },
    ]);
    expect(proposalRecordLine(done!)).toBe('You chose: Add it');
    expect(proposalResultWords(done!)).toBe('Added to Wicked Labs · onboarding run aaaaaaaa');
    const existing = onboardProposal({ onboard: { ...onboardProposal().onboard!, checkout: null, existing: { id: 'wicked-studio', name: 'wicked-studio' } } });
    const [ex] = foldChatProposals([{ at: 1, turnId: 't1', kind: 'proposal', proposal: existing }, { at: 2, turnId: 't1', kind: 'proposal_decided', pid: PID, actor: 'local', decision: 'go', result: { runId: 'bbbbbbbb', artifactRef: null, adopted: false, stub: false } }]);
    expect(proposalResultWords(ex!)).toBe('Added to Wicked Labs · nothing was started');
    // No project: the consequence never claims one.
    const unfiled = foldChatProposals([{ at: 1, turnId: 't1', kind: 'proposal', proposal: onboardProposal({ filedIn: { projectId: null, label: 'Not in a project' }, onboard: { ...onboardProposal().onboard!, projectId: null, projectName: null } }) }])[0]!;
    expect(proposalAsk(unfiled, { stub: false }).options?.[0]?.consequence).toBe('Studio clones the repository to this computer, registers it (in no project) and starts onboarding (it builds the code map). Nothing happens until you choose.');
    expect(proposalAsk(foldChatProposals([{ at: 1, turnId: 't1', kind: 'proposal', proposal: existing }])[0]!, { stub: false }).options?.[0]?.sub).toBe('Adds it to the project; nothing is cloned');
  });
});

describe('the onboard card', () => {
  it('draws crew\'s facts: the address, the name, where it is cloned and the project', async () => {
    page();
    const card = await screen.findByTestId('artifact-proposal');
    expect(card.getAttribute('data-kind')).toBe('onboard');
    expect(text('artifact-proposal-what')).toBe('Add a repository · wicked-studio');
    expect(text('artifact-proposal-onboard-url')).toBe('Repositoryhttps://github.com/mikeparcewski/wicked-studio.git');
    expect(text('artifact-proposal-onboard-name')).toBe('Namewicked-studio');
    expect(text('artifact-proposal-onboard-checkout')).toBe('Clones to~/.wicked/repos/wicked-studio');
    expect(text('artifact-proposal-filed')).toBe('ProjectWicked Labs');
    // The Project row is the onboard facts' own (never a label that could say another project; review r3).
    cleanup();
    chatBody = { ...chatBody, messages: [...TURN, { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: onboardProposal({ filedIn: { projectId: 'proj_labs', label: 'Some other project' } }) }] };
    page();
    await screen.findByTestId('artifact-proposal');
    expect(text('artifact-proposal-filed')).toBe('ProjectWicked Labs');
    expect(screen.queryByTestId('artifact-proposal-helpers')).toBeNull();
    expect(card.querySelector('[data-ask-option="go"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('Add it posts go once and the card says what was started', async () => {
    page();
    await screen.findByTestId('artifact-proposal');
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('decided'));
    expect(posts).toStrictEqual([{ path: decidePath, body: { decision: 'go' } }]);
    expect(text('artifact-proposal-record')).toBe('You chose: Add it');
    expect(screen.getByTestId('ask-record-row').textContent).toContain('Added to Wicked Labs · onboarding run aaaaaaaa');
  });

  it('Not now posts not_now; Change something posts nothing and says to ask in the chat', async () => {
    decideAnswer = () => ok({ view: { proposal: onboardProposal(), state: 'decided', decision: 'not_now', result: null, decidedAt: T0 + 3000 } });
    page();
    const card = await screen.findByTestId('artifact-proposal');
    fireEvent.click(card.querySelector('[data-ask-option="change"]')!);
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    expect(text('artifact-proposal-note')).toMatch(/say so in the chat/);
    expect(posts).toStrictEqual([]);
    fireEvent.click(card.querySelector('[data-ask-option="not_now"]')!);
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await waitFor(() => expect(posts).toStrictEqual([{ path: decidePath, body: { decision: 'not_now' } }]));
  });

  it('a blocked card says crew\'s reason and Add it is disabled', async () => {
    const blocked = onboardProposal({ blocked: "this computer's git can't read it: the repository is private or doesn't exist" });
    chatBody = { ...chatBody, messages: [...TURN, { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: blocked }] };
    page();
    await screen.findByTestId('artifact-proposal');
    expect(text('artifact-proposal-blocked')).toMatch(/private or doesn't exist/);
    expect(screen.getByTestId('artifact-proposal').querySelector('[data-ask-option="go"]')?.getAttribute('aria-disabled')).toBe('true');
  });
});
