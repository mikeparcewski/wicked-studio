import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistVerbs } from '../src/components/AssistDock.js';

/**
 * e2e 2026-11-07 (plugins-complete G4, studio#1034): a refine asked from the document's side chat ("Ask about this")
 * showed only the seat's prose there — the proposal card (Keep it / Let this change it, Make the change) lived only on
 * the chat's full view. The chat drawn beside something (AssistDock's chat block) now draws the same card from the
 * same transcript records, re-read when crew says the chat changed, and answers it through the same route.
 */

const getChat = vi.fn();
const decide = vi.fn();
vi.mock('../src/api/diagnostics.js', () => ({
  getDiagnostics: () => Promise.resolve({ components: { coreTs: '0.7.27' } }),
  isDiagnosticsUnsupported: () => false,
}));
vi.mock('../src/api/client.js', () => ({
  api: {
    getChat: (...a: unknown[]) => getChat(...a),
    getChatMessages: () => Promise.reject(new Error('not ended')),
    getRun: () => Promise.reject(new Error('no run in this rig')),
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

function dock(v: AssistVerbs): void {
  render(<AssistDock context={{ surface: 'page-doc', title: 'Chat', contextLabel: 'tiny math overview', placeholder: 'Ask…' }} verbs={v} open onOpenChange={() => undefined} />);
}

beforeEach(() => {
  cleanup();
  resetSettledProposals();
  getChat.mockReset();
  decide.mockReset();
  useCapabilities.setState({ loaded: true, chatProposals: true, chatArtifactsStub: false, chatList: true });
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
});
