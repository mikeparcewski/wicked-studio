import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistVerbs } from '../src/components/AssistDock.js';
import { jobProposal } from './jobFixtures.js';

/**
 * e2e 2026-11-07 (plugins-complete G4, studio#1034): a refine asked from the document's side chat ("Ask about this")
 * showed only the seat's prose there — the proposal card (Keep it / Let this change it, Make the change) lived only on
 * the chat's full view. The chat drawn beside something (AssistDock's chat block) now draws the same card from the
 * same transcript records, re-read when crew says the chat changed, and answers it through the same route.
 */

const getChat = vi.fn();
const getChatMessages = vi.fn();
const getRun = vi.fn();
const decide = vi.fn();
vi.mock('../src/api/diagnostics.js', () => ({
  getDiagnostics: () => Promise.resolve({ components: { coreTs: '0.7.27' } }),
  isDiagnosticsUnsupported: () => false,
}));
vi.mock('../src/api/client.js', () => ({
  api: {
    getChat: (...a: unknown[]) => getChat(...a),
    getChatMessages: (...a: unknown[]) => getChatMessages(...a),
    getRun: (...a: unknown[]) => getRun(...a),
    decideChatProposal: (...a: unknown[]) => decide(...a),
    confirmGate: vi.fn(),
    cancelRun: vi.fn(),
  },
  apiFetch: vi.fn(() => Promise.reject(new Error('no wire in this rig'))),
}));
vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { AssistDock } = await import('../src/components/AssistDock.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { resetSettledProposals } = await import('../src/board/artifactProposal.js');
const { useConnectionStore } = await import('../src/store/connection.js');

const TITLE = { id: 'text:h#0a1b2c3d', kind: 'text', label: 'heading “tiny-math exports overview (hand edit)”', wid: 'h', touched: true };
const REFINE = {
  pid: 'chat-1:t1', chatId: 'chat-1', turnId: 't1', kind: 'refine', seat: 'claude',
  what: { entry: null, title: 'tiny math overview', label: 'Change · tiny math overview', outcome: 'A new version of the document. Your own edits are kept.' },
  brief: 'make the intro shorter', reason: null, sources: [], repos: [],
  helpers: { seats: ['codex', 'claude'], label: 'Codex and Claude Code: one writes, the other checks' },
  time: null, stops: null, filedIn: { projectId: null, label: 'Not in a project · this chat' },
  target: { ref: '_unfiled/tiny-math-overview', title: 'tiny math overview', base: 2 },
  protected: [TITLE], blocked: null,
};
const TURN = [
  { at: 1, turnId: 't1', kind: 'user', text: 'make the intro shorter' },
  { at: 2, turnId: 't1', kind: 'seat', cliKey: 'claude', ok: true, text: 'I can tighten the intro of the open document.' },
];

function createProposal() {
  const base: Record<string, unknown> = { ...REFINE };
  delete base['target'];
  delete base['protected'];
  return { ...base, pid: 'chat-1:t1', kind: 'create', what: { ...REFINE.what, label: 'New · tiny math overview' }, sentence: 'I will write a short overview.' };
}

function dock(v: AssistVerbs, onExpandChat?: (chatId: string) => void): void {
  render(<AssistDock context={{ surface: 'page-doc', title: 'Chat', contextLabel: 'tiny math overview', placeholder: 'Ask…' }} verbs={v} open onOpenChange={() => undefined} onExpandChat={onExpandChat} />);
}

beforeEach(() => {
  cleanup();
  resetSettledProposals();
  getChat.mockReset();
  getChatMessages.mockReset();
  getRun.mockReset();
  getRun.mockRejectedValue(new Error('no run in this rig'));
  getChatMessages.mockRejectedValue(new Error('not ended'));
  decide.mockReset();
  useCapabilities.setState({ loaded: true, chatProposals: true, chatArtifactsStub: false, chatList: true, chatJobProposals: false });
  useConnectionStore.setState({ status: 'connected' });
  useAskThreadStore.setState({ replySeq: {} });
  try { localStorage.clear(); } catch { /* stubbed */ }
});

describe('the side chat draws the proposal card', () => {
  it('a refine the seat proposed here gets its card, re-read when crew records it, answered with the person’s choice', async () => {
    let records: unknown[] = [...TURN];
    getChat.mockImplementation(() => Promise.resolve({ chatId: 'chat-1', seats: ['claude'], messages: records }));
    decide.mockResolvedValue({ view: { proposal: REFINE, state: 'decided', decision: 'go', result: { runId: 'r-1', artifactRef: REFINE.target.ref, adopted: false, stub: false } } });
    const user = userEvent.setup();
    dock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) });
    await user.type(screen.getByTestId('assist-input'), 'make the intro shorter');
    await user.click(screen.getByTestId('assist-send'));
    await screen.findByTestId('assist-chat');
    expect(screen.queryByTestId('artifact-proposal')).toBeNull();
    // Crew resolves the card after the reply and says so (`chatProposal` ticks the chat's replySeq): it is read back.
    records = [...TURN, { at: 3, turnId: 't1', kind: 'proposal', proposal: REFINE }];
    act(() => { useAskThreadStore.setState({ replySeq: { 'chat-1': 1 } }); });
    const card = await screen.findByTestId('artifact-proposal');
    expect(screen.getByTestId('assist-chat').contains(card) || screen.getByTestId('chat-proposal-cards').contains(card)).toBe(true);
    expect(card.getAttribute('data-kind')).toBe('refine');
    expect(screen.getByTestId('artifact-proposal-protected-edit').getAttribute('data-edit-id')).toBe(TITLE.id);
    fireEvent.click(screen.getByTestId('artifact-proposal-let-change'));
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(decide.mock.calls[0]).toEqual(['chat-1', 'chat-1:t1', { decision: 'go', edits: { allow: [TITLE.id] } }]);
  });

  it('no card where the daemon does not propose', async () => {
    useCapabilities.setState({ chatProposals: false });
    getChat.mockResolvedValue({ chatId: 'chat-1', seats: ['claude'], messages: [...TURN, { at: 3, turnId: 't1', kind: 'proposal', proposal: REFINE }] });
    const user = userEvent.setup();
    dock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) });
    await user.type(screen.getByTestId('assist-input'), 'make the intro shorter');
    await user.click(screen.getByTestId('assist-send'));
    await screen.findByTestId('assist-chat');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('artifact-proposal')).toBeNull();
  });

  it('review r1: a v2 create (a job passage’s on the full view) is not drawn here as a legacy card', async () => {
    useCapabilities.setState({ chatJobProposals: true });
    const CREATE = createProposal();
    getChat.mockResolvedValue({ chatId: 'chat-1', seats: ['claude'], messages: [...TURN, { at: 3, turnId: 't1', kind: 'proposal', proposal: CREATE }] });
    const user = userEvent.setup();
    dock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) });
    await user.type(screen.getByTestId('assist-input'), 'write an overview');
    await user.click(screen.getByTestId('assist-send'));
    await screen.findByTestId('assist-chat');
    const pointer = await screen.findByTestId('chat-job-pointer');
    expect(pointer.getAttribute('data-pid')).toBe(CREATE.pid);
    expect(within(pointer).getByText(CREATE.what.label)).toBeTruthy();
    expect(screen.queryByTestId('artifact-proposal')).toBeNull();
    // The same record is a valid card where crew has no job proposals: only the passage rule kept it out.
    act(() => { useCapabilities.setState({ chatJobProposals: false }); });
    expect((await screen.findByTestId('artifact-proposal')).getAttribute('data-kind')).toBe('create');
  });

  it('opens the proposed job in the full view of the chat the dock renders', async () => {
    useCapabilities.setState({ chatJobProposals: true });
    const chatId = 'chat-pointer';
    const proposal = jobProposal({ ...createProposal(), chatId, pid: `${chatId}:t1`, lineage: `${chatId}:t1`, kind: 'create', sentence: { text: 'I will write a short overview.', tokens: [], notes: [], ask: null } });
    getChat.mockResolvedValue({ chatId, seats: ['claude'], messages: [...TURN, { at: 3, turnId: 't1', kind: 'proposal', proposal }] });
    const onExpandChat = vi.fn();
    const user = userEvent.setup();
    dock({ send: vi.fn().mockResolvedValue({ chatId }) }, onExpandChat);
    await user.type(screen.getByTestId('assist-input'), 'write an overview');
    await user.click(screen.getByTestId('assist-send'));
    const button = await screen.findByTestId('chat-job-pointer-open');
    expect(button.textContent).toBe('Open in full chat');
    await user.click(button);
    expect(onExpandChat).toHaveBeenCalledExactlyOnceWith(chatId);
  });

  it('keeps the pointer’s guidance without a dead button when expanding is unavailable', async () => {
    useCapabilities.setState({ chatJobProposals: true });
    getChat.mockResolvedValue({ chatId: 'chat-1', seats: ['claude'], messages: [...TURN, { at: 3, turnId: 't1', kind: 'proposal', proposal: createProposal() }] });
    const user = userEvent.setup();
    dock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) });
    await user.type(screen.getByTestId('assist-input'), 'write an overview');
    await user.click(screen.getByTestId('assist-send'));
    const pointer = await screen.findByTestId('chat-job-pointer');
    expect(within(pointer).getByText('Proposal from Claude · nothing starts until you choose · Open the full chat to answer it.')).toBeTruthy();
    expect(screen.queryByTestId('chat-job-pointer-open')).toBeNull();
  });

  it.each(['go', 'not_now'])('a v2 create decided %s draws no pointer, even after a stale read', async (decision) => {
    useCapabilities.setState({ chatJobProposals: true });
    const open = [...TURN, { at: 3, turnId: 't1', kind: 'proposal', proposal: createProposal() }];
    let records: unknown[] = open;
    getChat.mockImplementation(() => Promise.resolve({ chatId: 'chat-1', seats: ['claude'], messages: records }));
    const user = userEvent.setup();
    dock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) }, vi.fn());
    await user.type(screen.getByTestId('assist-input'), 'write an overview');
    await user.click(screen.getByTestId('assist-send'));
    await screen.findByTestId('chat-job-pointer');
    records = [...open, { at: 4, turnId: 't1', kind: 'proposal_decided', pid: 'chat-1:t1', actor: 'local', decision, result: null }];
    act(() => { useAskThreadStore.setState({ replySeq: { 'chat-1': 1 } }); });
    await waitFor(() => expect(screen.queryByTestId('chat-job-pointer')).toBeNull());
    const reads = getChat.mock.calls.length;
    records = open;
    act(() => { useAskThreadStore.setState({ replySeq: { 'chat-1': 2 } }); });
    await waitFor(() => expect(getChat.mock.calls.length).toBeGreaterThan(reads));
    expect(screen.queryByTestId('chat-job-pointer')).toBeNull();
    expect(screen.queryByTestId('chat-job-pointer-open')).toBeNull();
  });

  it('draws one pointer for the open head of a job lineage, and none while it is revising', async () => {
    useCapabilities.setState({ chatJobProposals: true });
    const first = jobProposal({ chatId: 'chat-1', pid: 'chat-1:t1', lineage: 'chat-1:t1' });
    const head = jobProposal({ ...first, pid: 'chat-1:t2', revises: first.pid, what: { ...first.what, label: 'Revised job' } });
    const open = [...TURN, { at: 3, turnId: 't1', kind: 'proposal', proposal: first }, { at: 4, turnId: 't2', kind: 'proposal', proposal: head }];
    let records: unknown[] = open;
    getChat.mockImplementation(() => Promise.resolve({ chatId: 'chat-1', seats: ['claude'], messages: records }));
    const user = userEvent.setup();
    dock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) });
    await user.type(screen.getByTestId('assist-input'), 'revise the job');
    await user.click(screen.getByTestId('assist-send'));
    const pointer = await screen.findByTestId('chat-job-pointer');
    expect(screen.getAllByTestId('chat-job-pointer')).toHaveLength(1);
    expect(pointer.getAttribute('data-pid')).toBe(head.pid);
    expect(within(pointer).getByText(head.what.label)).toBeTruthy();
    records = [...open, { at: 5, turnId: 't3', kind: 'proposal_revising', pid: head.pid }];
    act(() => { useAskThreadStore.setState({ replySeq: { 'chat-1': 1 } }); });
    await waitFor(() => expect(screen.queryByTestId('chat-job-pointer')).toBeNull());
  });

  it('review r1: an ended chat’s history that cannot be read keeps the card it showed', async () => {
    getChat.mockResolvedValue({ chatId: 'chat-1', seats: [], messages: [] });
    getChatMessages.mockResolvedValueOnce({ messages: [...TURN, { at: 3, turnId: 't1', kind: 'proposal', proposal: REFINE }] });
    const user = userEvent.setup();
    dock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) });
    await user.type(screen.getByTestId('assist-input'), 'make the intro shorter');
    await user.click(screen.getByTestId('assist-send'));
    await screen.findByTestId('artifact-proposal');
    getChatMessages.mockRejectedValue(Object.assign(new Error('busy'), { status: 503 }));
    act(() => { useAskThreadStore.setState({ replySeq: { 'chat-1': 1 } }); });
    await waitFor(() => expect(getChatMessages).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('artifact-proposal')).toBeTruthy();
  });

  it('review r1: the socket coming back reads the transcript again (frames are not replayed)', async () => {
    let records: unknown[] = [...TURN];
    getChat.mockImplementation(() => Promise.resolve({ chatId: 'chat-1', seats: ['claude'], messages: records }));
    const user = userEvent.setup();
    dock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) });
    await user.type(screen.getByTestId('assist-input'), 'make the intro shorter');
    await user.click(screen.getByTestId('assist-send'));
    await screen.findByTestId('assist-chat');
    await waitFor(() => expect(getChat).toHaveBeenCalled());
    act(() => { useConnectionStore.setState({ status: 'disconnected' }); });
    records = [...TURN, { at: 3, turnId: 't1', kind: 'proposal', proposal: REFINE }];
    act(() => { useConnectionStore.setState({ status: 'connected' }); });
    expect((await screen.findByTestId('artifact-proposal')).getAttribute('data-kind')).toBe('refine');
  });

  it('review r2: a chat event reads a started refine’s run even after its polling budget ran out', async () => {
    const DECIDED = { at: 4, turnId: 't1', kind: 'proposal_decided', pid: REFINE.pid, actor: 'local', decision: 'go', result: { runId: 'run-1', artifactRef: REFINE.target.ref, adopted: false, stub: false } };
    getChat.mockResolvedValue({ chatId: 'chat-1', seats: ['claude'], messages: [...TURN, { at: 3, turnId: 't1', kind: 'proposal', proposal: REFINE }, DECIDED] });
    getRun.mockResolvedValue({ run: { session: { id: 'run-1', status: 'running' } } });
    const user = userEvent.setup();
    dock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) });
    await user.type(screen.getByTestId('assist-input'), 'make the intro shorter');
    await user.click(screen.getByTestId('assist-send'));
    await screen.findByTestId('artifact-proposal');
    await waitFor(() => expect(getRun).toHaveBeenCalledTimes(1));
    // Sixteen minutes on, the timer reads no more; a chat event still reads the run once.
    const real = Date.now;
    const later = real() + 16 * 60_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => later);
    try {
      act(() => { useAskThreadStore.setState({ replySeq: { 'chat-1': 1 } }); });
      await waitFor(() => expect(getRun).toHaveBeenCalledTimes(2));
    } finally {
      now.mockRestore();
    }
  });
});
