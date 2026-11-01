import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatTranscriptRecord } from 'wicked-crew-api-types';
import type { SessionView } from '../src/api/types.js';
import { ApiError } from '../src/api/errors.js';
import {
  ASKED_KEY, answerLine, firstSentence, forgetAsked, GROUNDING_LINE, questionMessage, readAsked, rememberAsked, suggestedQuestions,
} from '../src/board/understandModel.js';
import { typeRows, typeTone, typeWords, type EvalSource } from '../src/board/evalModel.js';
import type { EvalResult } from '../src/api/testing.js';
import { useAskDock } from '../src/store/askDock.js';
import { useCapabilities } from '../src/store/capabilities.js';

const mocks = vi.hoisted(() => ({
  messages: vi.fn(),
  listRepos: vi.fn(),
  members: vi.fn(),
  // Crew's chat history (Recent answers lists Understand's chats from it too): none by default.
  history: vi.fn(() => Promise.resolve({ chats: [], items: [] })),
  // What we know about each repository (the sidebar's graph links show its state).
  kinds: vi.fn(),
  reqs: vi.fn(),
}));
vi.mock('../src/api/client.js', () => ({
  api: { getChatMessages: mocks.messages, listRepos: mocks.listRepos, listProjectMembers: mocks.members, listChatHistory: mocks.history, getGraphKindsForRepo: mocks.kinds, listRequirements: mocks.reqs },
  apiBase: () => '/api/v1',
}));
// The folded views are their own surfaces (with their own tests); here they only need to be reachable.
vi.mock('../src/components/CoverageView.js', () => ({ CoverageView: () => <div data-testid="coverage-view-stub" /> }));
vi.mock('../src/components/RepoGraphModal.js', () => ({ RepoGraphModal: ({ repo, initialView, onClose }: { repo: { name: string }; initialView?: string; onClose: () => void }) => <div data-testid="repo-graph-stub" data-view={initialView ?? 'code'}>{repo.name}<button type="button" data-testid="repo-graph-stub-close" onClick={onClose}>x</button></div> }));
// The page chat (DES-LEARN §6.2) has its own tests (pageChat.test.tsx); here it is a stub that shows what the page
// hands it: its scope chips and its provider (which the page's Recent answers learn the chat id from).
const chat = vi.hoisted(() => ({ props: null as null | { chips?: Array<{ key: string; on: boolean }>; provider?: { knows: string; onSent?: (t: string, id: string) => void } } }));
vi.mock('../src/components/chat/PageChat.js', async (orig) => ({
  ...(await orig<object>()),
  PageChat: (p: typeof chat.props) => { chat.props = p; return <div data-testid="page-chat-stub">{p?.provider?.knows}<input data-testid="page-chat-draft" defaultValue="" /></div>; },
}));

const { UnderstandPage } = await import('../src/components/desk/UnderstandPage.js');
const { usePageChat } = await import('../src/store/pageChat.js');
const { useVoiceStore } = await import('../src/store/voice.js');
const { useLayerStore } = await import('../src/store/layers.js');

/** window.matchMedia for Understand's 1023 px drawer query, switchable mid-test. */
function mockNarrow(on: boolean): { set: (v: boolean) => void } {
  let narrow = on;
  const listeners = new Set<() => void>();
  window.matchMedia = ((q: string) => ({
    get matches() { return q.includes('1023') ? narrow : false; }, media: q, onchange: null,
    addEventListener: (_: string, l: () => void) => listeners.add(l), removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return { set: (v) => { narrow = v; listeners.forEach((l) => l()); } };
}
const onRepos = (): string[] => (chat.props?.chips ?? []).filter((c) => c.on && c.key.startsWith('repo:')).map((c) => c.key.slice(5));
const { clearRepoCache } = await import('../src/store/repoCache.js');
const { resetRepoKnowledge } = await import('../src/store/repoKnowledge.js');

const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);

function seat(text: string, ok = true): ChatTranscriptRecord {
  return { at: NOW, turnId: 't1', kind: 'seat', cliKey: 'claude', text, ok, usage: null };
}

beforeEach(() => {
  localStorage.clear();
  clearRepoCache();
  mocks.messages.mockReset();
  mocks.listRepos.mockReset();
  mocks.listRepos.mockResolvedValue({ repos: [{ id: 'r1', name: 'wicked-core' }, { id: 'r2', name: 'wicked-crew' }] });
  mocks.members.mockReset();
  mocks.members.mockResolvedValue({ members: [{ member_kind: 'crew.repo', member_ref: 'r1' }, { member_kind: 'crew.chat', member_ref: 'c1' }] });
  useCapabilities.setState({ chatList: true, loaded: true });
  useAskDock.setState({ request: null });
  usePageChat.setState({ open: {}, focus: {}, seed: {}, gen: {} });
  sessionStorage.clear();
  chat.props = null;
  resetRepoKnowledge();
  mocks.kinds.mockReset();
  mocks.kinds.mockImplementation(async (id: string) => ({ kinds: id === 'r1' ? [{ kind: 'File', count: 4 }, { kind: 'Function', count: 20 }] : [] }));
  mocks.reqs.mockReset();
  mocks.reqs.mockImplementation(async () => ({ total: 1, coverage: { realPct: 90, minPct: 80, behaviorBearing: 10, real: 9, placeholders: 1, unmapped: 0, notProduct: 0 }, graphBuild: { generation: 2, coverage: null, behind: false } }));
});
const realMatchMedia = window.matchMedia;
afterEach(() => { cleanup(); window.matchMedia = realMatchMedia; useVoiceStore.setState({ phase: 'off' }); });

describe('Understand words (pure)', () => {
  it('remembers questions newest first, one per chat, and forgets a gone chat', () => {
    rememberAsked({ chatId: 'a', question: 'first?', at: 1 });
    rememberAsked({ chatId: 'b', question: 'second?', at: 2 });
    rememberAsked({ chatId: 'a', question: 'first again?', at: 3 });
    expect(readAsked().map((q) => [q.chatId, q.question])).toEqual([['a', 'first again?'], ['b', 'second?']]);
    expect(forgetAsked('a').map((q) => q.chatId)).toEqual(['b']);
    localStorage.setItem(ASKED_KEY, '{not json');
    expect(readAsked()).toEqual([]);
  });

  it('sends the question with the grounding line on its own line', () => {
    expect(questionMessage('  Who calls deliver?  ')).toBe(`Who calls deliver?\n\n${GROUNDING_LINE}`);
  });

  it('one plain line of what an answer found, and the files it cites (verified ones only)', () => {
    expect(firstSentence('## Callers\n**14 callers** across `3` crates. The rest follows.')).toBe('Callers 14 callers across 3 crates.');
    expect(firstSentence('a'.repeat(50) + ' ' + 'b'.repeat(100), 60)).toMatch(/…$/);
    const line = answerLine([
      { at: NOW, turnId: 't1', kind: 'user', text: 'q', seats: ['claude'] },
      seat('No answer', false),
      seat('It is benched until the quota resets. More detail.'),
      { at: NOW, turnId: 't1', kind: 'citations', cliKey: 'claude', verified: 2, unverifiable: 1, corrected: 0, unchecked: 0, items: [
        { raw: 'crates/a/src/seat_bench.rs:40', kind: 'line', status: 'verified' },
        { raw: 'cli_runner.rs', kind: 'path', status: 'corrected', resolved: 'crates/a/src/cli_runner.rs' },
        { raw: 'made_up.rs', kind: 'path', status: 'unverified' },
        { raw: 'abc123', kind: 'sha', status: 'verified' },
      ] },
    ]);
    expect(line).toEqual({ answered: true, summary: 'It is benched until the quota resets.', cites: ['seat_bench.rs', 'cli_runner.rs'] });
    expect(answerLine([seat('', true)]).answered).toBe(false);
  });

  it('suggests questions about your own repositories, and general ones without any', () => {
    expect(suggestedQuestions(['wicked-core', 'wicked-crew'])).toEqual(['How is wicked-core put together?', 'Where is wicked-crew riskiest to change?', 'What changed in wicked-core this week?']);
    expect(suggestedQuestions([])).toHaveLength(3);
  });
});

describe('the Understand page', () => {
  it('a chat page: the greeting and the composer, a sidebar with Recent answers, the graph links and More', async () => {
    await act(async () => { render(<UnderstandPage project={null} navigate={vi.fn()} now={NOW} compare={<div data-testid="compare-stub" />} />); });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Understand');
    expect(screen.getByText('Ask how your code fits together. Answers cite the code they come from, right here.')).toBeInTheDocument();
    // Nothing asked yet: the composer, not a chat; New question only once there is something to leave.
    expect(screen.queryByTestId('understand-chat')).toBeNull();
    expect(screen.getByTestId('understand-ask')).toBeVisible();
    expect(screen.queryByTestId('understand-new-question')).toBeNull();
    // No project and no job this week: nothing is chosen, so the questions name no repository.
    expect(screen.getAllByTestId('understand-suggest').map((b) => b.textContent)).toEqual(suggestedQuestions([]));
    const side = screen.getByTestId('understand-side');
    expect(within(side).getByTestId('understand-recent-empty')).toHaveTextContent('Nothing asked yet');
    // None chosen = the question reads every repository, so every repository's graphs are linked.
    expect(within(side).getAllByTestId('understand-graph-repo').map((r) => r.getAttribute('data-repo-id'))).toEqual(['r1', 'r2']);
    // The comparison is mounted (its picks survive) but not shown until asked for.
    expect(screen.getByTestId('understand-compare')).not.toBeVisible();
    expect(screen.queryByTestId('understand-coverage')).toBeNull();
    expect(mocks.messages).not.toHaveBeenCalled();
  });

  it('a suggestion fills the box (nothing sent); Ask sends the question into a new chat ON THE PAGE and lists it', async () => {
    await act(async () => { render(<UnderstandPage project="proj-1" navigate={vi.fn()} now={NOW} compare={null} />); });
    fireEvent.click(screen.getAllByTestId('understand-suggest')[0]!);
    expect(screen.getByTestId('understand-ask-input')).toHaveValue('How is wicked-core put together?');
    expect(usePageChat.getState().seed.understand ?? null).toBeNull();
    mocks.messages.mockRejectedValue(new ApiError(404, 'Not Found'));
    await act(async () => { fireEvent.submit(screen.getByTestId('understand-ask')); });
    // The question is the first message of a NEW page chat (sent: the operator pressed Ask on it); the floating
    // chat is not used.
    expect(usePageChat.getState().seed.understand).toMatchObject({ text: questionMessage('How is wicked-core put together?'), send: true });
    expect(usePageChat.getState().gen.understand).toBe(1);
    expect(useAskDock.getState().request).toBeNull();
    expect(screen.getByTestId('understand-chat')).toBeInTheDocument();
    expect(screen.getByTestId('understand-ask')).not.toBeVisible();
    expect(screen.getByTestId('understand-ask-input')).toHaveValue('');
    // The chat opened (its id) and the question is listed under Recent answers.
    await act(async () => { chat.props!.provider!.onSent!(questionMessage('How is wicked-core put together?'), 'c-new'); });
    const row = screen.getByTestId('understand-answer');
    // The row shows the operator's words, never the grounding line or the chat id.
    expect(row).toHaveTextContent('How is wicked-core put together?');
    expect(row).not.toHaveTextContent(GROUNDING_LINE);
    expect(row).not.toHaveTextContent('c-new');
    expect(readAsked()[0]!.chatId).toBe('c-new');
    // Just asked: it reads as being answered.
    expect(within(row).getByTestId('understand-answer-sub')).toHaveTextContent('Answering now…');
    expect(row).toHaveAttribute('href', '/s/c-new');
    // It is the conversation on screen: marked in the sidebar.
    expect(row).toHaveAttribute('aria-current', 'true');
    // New question: the box again, and the next question starts a new chat.
    fireEvent.click(screen.getByTestId('understand-new-question'));
    expect(screen.queryByTestId('understand-chat')).toBeNull();
    expect(screen.getByTestId('understand-ask')).toBeVisible();
  });

  it('crew#1157: Ask runs analyze on the project’s repositories on its page, the week’s most active one elsewhere; the questions name only those', async () => {
    await act(async () => { render(<UnderstandPage project="proj-1" navigate={vi.fn()} now={NOW} compare={null} />); });
    expect(mocks.members).toHaveBeenCalledWith('proj-1');
    expect(screen.getAllByTestId('understand-scope-repo').map((c) => c.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(screen.getAllByTestId('understand-suggest').map((b) => b.textContent)).toEqual(suggestedQuestions(['wicked-core']));
    fireEvent.change(screen.getByTestId('understand-ask-input'), { target: { value: 'Who calls deliver?' } });
    mocks.messages.mockRejectedValue(new ApiError(404, 'Not Found'));
    await act(async () => { fireEvent.submit(screen.getByTestId('understand-ask')); });
    // The page chat runs analyze (PAGE_CHAT_SPECS.understand.workflow) on exactly the chosen repositories.
    expect(onRepos()).toEqual(['r1']);
    expect(screen.getByTestId('page-chat-stub')).toHaveTextContent('Reads wicked-core · read-only');
    cleanup();
    sessionStorage.clear();
    chat.props = null;
    const day = 86_400;
    const at = (d: number) => NOW / 1000 - d * day;
    const runs = [
      { session: { id: 'a', repo_ref: 'r1', created_at: at(20) } },
      { session: { id: 'b', repo_ref: 'r1', created_at: at(19) } },
      { session: { id: 'c', repo_ref: 'r2', created_at: at(2) } },
    ] as unknown as SessionView[];
    await act(async () => { render(<UnderstandPage project={null} navigate={vi.fn()} now={NOW} compare={null} runs={runs} />); });
    const chips = screen.getAllByTestId('understand-scope-repo');
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    expect(screen.getAllByTestId('understand-suggest').map((b) => b.textContent)).toEqual(suggestedQuestions(['wicked-crew']));
    fireEvent.click(chips[0]!);
    expect(screen.getByTestId('understand-scope-words')).toHaveTextContent('Asks about 2 repositories.');
    expect(screen.getAllByTestId('understand-suggest').map((b) => b.textContent)).toEqual(suggestedQuestions(['wicked-core', 'wicked-crew']));
    fireEvent.change(screen.getByTestId('understand-ask-input'), { target: { value: 'Who calls deliver?' } });
    await act(async () => { fireEvent.submit(screen.getByTestId('understand-ask')); });
    expect(onRepos()).toEqual(['r1', 'r2']);
  });

  // Operator, round 4: Understand gets voice mode like every composer: the mic beside Ask when crew has voice.
  it('the mic sits right before Ask when crew has voice', () => {
    useCapabilities.setState({ chatList: true, loaded: true, voice: true });
    render(<UnderstandPage project={null} navigate={() => undefined} now={Date.now()} compare={null} />);
    const mic = screen.getByTestId('understand-ask-voice');
    expect(mic.getAttribute('aria-keyshortcuts')).toBe('Alt+V');
    expect(mic.nextElementSibling).toBe(screen.getByTestId('understand-ask-send'));
    useCapabilities.setState({ voice: false });
  });

  it('an empty Ask sends nothing', async () => {
    await act(async () => { render(<UnderstandPage project={null} navigate={vi.fn()} now={NOW} compare={null} />); });
    await act(async () => { fireEvent.submit(screen.getByTestId('understand-ask')); });
    expect(usePageChat.getState().seed.understand ?? null).toBeNull();
    expect(screen.queryByTestId('understand-chat')).toBeNull();
  });

  it('Recent answers: what each answer found; an old chat the daemon no longer has is forgotten', async () => {
    rememberAsked({ chatId: 'c-old', question: 'Gone?', at: NOW - 86_400_000 });
    rememberAsked({ chatId: 'c-1', question: 'What breaks if repo_checks.rs changes?', at: NOW - 3_600_000 });
    mocks.messages.mockImplementation(async (id: string) => {
      if (id === 'c-old') throw new ApiError(404, 'Not Found');
      return { chat: { id, status: 'closed' }, messages: [seat('14 callers across 3 crates. Details follow.')], attachments: [] };
    });
    const navigate = vi.fn();
    await act(async () => { render(<UnderstandPage project={null} navigate={navigate} now={NOW} compare={null} />); });
    const rows = screen.getAllByTestId('understand-answer');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('14 callers across 3 crates.');
    expect(rows[0]).toHaveAttribute('data-state', 'answered');
    expect(readAsked().map((q) => q.chatId)).toEqual(['c-1']);
    // An answer reopens in place, in the page's chat (its kept history replays there).
    fireEvent.click(rows[0]!);
    expect(navigate).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem('wicked.pagechat.understand.session')!)).toMatchObject({ chatId: 'c-1', seeded: true });
    expect(screen.getByTestId('understand-chat')).toBeInTheDocument();
  });

  it('a crew without the chat list reads nothing and says where the answer is', async () => {
    useCapabilities.setState({ chatList: false, loaded: true });
    rememberAsked({ chatId: 'c-1', question: 'Q?', at: NOW });
    await act(async () => { render(<UnderstandPage project={null} navigate={vi.fn()} now={NOW} compare={null} />); });
    expect(screen.getByTestId('understand-answer-sub')).toHaveTextContent('Open it to read the answer');
    expect(mocks.messages).not.toHaveBeenCalled();
  });

  it('the graph links: each repository in scope, its code graph and its requirements graph, each with its state', async () => {
    const navigate = vi.fn();
    await act(async () => { render(<UnderstandPage project="proj-1" navigate={navigate} now={NOW} compare={null} />); });
    // On a project's page the project's repository is chosen: only its graphs are linked.
    const rows = screen.getAllByTestId('understand-graph-repo');
    expect(rows.map((r) => r.getAttribute('data-repo-id'))).toEqual(['r1']);
    expect(screen.getByTestId('understand-graph')).toHaveTextContent('Graphs for these repositories');
    // r1 has a code graph (24 nodes in 4 files) and a requirements graph at build 2.
    expect(within(rows[0]!).getByTestId('understand-graph-open')).toHaveAttribute('data-tone', 'ok');
    expect(within(rows[0]!).getByTestId('understand-graph-req')).toHaveAttribute('data-tone', 'ok');
    expect(within(rows[0]!).getByTestId('understand-graph-req').getAttribute('title')).toContain('build 2');
    fireEvent.click(within(rows[0]!).getByTestId('understand-graph-req'));
    expect(screen.getByTestId('repo-graph-stub')).toHaveAttribute('data-view', 'domain');
    expect(screen.getByTestId('repo-graph-stub')).toHaveTextContent('wicked-core');
    // The name is the repository's page.
    fireEvent.click(within(rows[0]!).getByRole('link', { name: 'wicked-core' }));
    expect(navigate).toHaveBeenCalledWith('/repo-detail/r1');
    // Choosing the other one too links both.
    fireEvent.click(screen.getAllByTestId('understand-scope-repo')[1]!);
    expect(screen.getAllByTestId('understand-graph-repo').map((r) => r.getAttribute('data-repo-id'))).toEqual(['r1', 'r2']);
  });

  it('More: Compare side by side and Coverage take the main column; Back returns to the chat', async () => {
    await act(async () => { render(<UnderstandPage project={null} navigate={vi.fn()} now={NOW} compare={<div data-testid="compare-stub" />} />); });
    fireEvent.click(screen.getByTestId('understand-compare-toggle'));
    expect(screen.getByTestId('understand-compare')).toBeVisible();
    expect(screen.getByTestId('compare-stub')).toBeInTheDocument();
    expect(screen.getByTestId('understand-ask')).not.toBeVisible();
    expect(screen.getByTestId('understand-compare-toggle')).toHaveAttribute('aria-pressed', 'true');
    // The way back has the focus (the sidebar control that was pressed is hidden on a wide screen).
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(document.activeElement).toBe(screen.getByTestId('understand-back'));
    fireEvent.click(screen.getByTestId('understand-back'));
    fireEvent.click(screen.getByTestId('understand-coverage-toggle'));
    expect(screen.getByTestId('coverage-view-stub')).toBeInTheDocument();
    expect(screen.getByTestId('understand-compare')).not.toBeVisible();
    fireEvent.click(screen.getByTestId('understand-back'));
    expect(screen.queryByTestId('understand-coverage')).toBeNull();
    expect(screen.getByTestId('understand-ask')).toBeVisible();
    // Back on the empty chat: the question box has the focus.
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(document.activeElement).toBe(screen.getByTestId('understand-ask-input'));
  });

  it('under 1024 px the sidebar is a modal drawer: focus in, the page inert, Escape back to its button; a reopened answer, voice mode or a wider window closes it', async () => {
    const narrow = mockNarrow(true);
    rememberAsked({ chatId: 'c-1', question: 'Q?', at: NOW });
    mocks.messages.mockResolvedValue({ chat: { id: 'c-1', status: 'closed' }, messages: [seat('An answer.')], attachments: [] });
    await act(async () => { render(<UnderstandPage project={null} navigate={vi.fn()} now={NOW} compare={null} />); });
    const page = screen.getByTestId('understand-page');
    const toggle = screen.getByTestId('understand-side-toggle');
    const side = screen.getByTestId('understand-side');
    expect(page).toHaveAttribute('data-side', 'closed');
    expect(toggle).toHaveAttribute('aria-controls', side.id);
    await act(async () => { fireEvent.click(toggle); });
    expect(page).toHaveAttribute('data-side', 'open');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(side).toHaveAttribute('role', 'dialog');
    expect(side).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(screen.getByTestId('understand-side-close'));
    expect(page.querySelector('.wk-uc-main')).toHaveAttribute('inert');
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(page).toHaveAttribute('data-side', 'closed');
    expect(page.querySelector('.wk-uc-main')).not.toHaveAttribute('inert');
    expect(document.activeElement).toBe(toggle);
    // Reopening an answer shows it in the main column, closes the drawer and marks the row as the open one.
    await act(async () => { fireEvent.click(toggle); });
    await act(async () => { fireEvent.click(screen.getByTestId('understand-answer')); });
    expect(page).toHaveAttribute('data-side', 'closed');
    expect(screen.getByTestId('understand-chat')).toBeInTheDocument();
    expect(screen.getByTestId('understand-answer')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('understand-new-question')).toBeInTheDocument();
    // The chat's "explore the graph" next move: the drawer opens on the graph links.
    await act(async () => { (chat.props!.provider as unknown as { onMove: (m: string) => boolean }).onMove('graph'); });
    expect(page).toHaveAttribute('data-side', 'open');
    // Voice mode (⌥V from anywhere) closes it: voice draws under nothing.
    await act(async () => { useVoiceStore.setState({ phase: 'ask' }); });
    expect(page).toHaveAttribute('data-side', 'closed');
    await act(async () => { useVoiceStore.setState({ phase: 'off' }); });
    // Growing past 1024 px closes it too.
    await act(async () => { fireEvent.click(toggle); });
    await act(async () => { narrow.set(false); });
    expect(page).toHaveAttribute('data-side', 'closed');
  });

  it('on a wide screen the chat’s graph move points at the sidebar (no drawer)', async () => {
    mockNarrow(false);
    rememberAsked({ chatId: 'c-1', question: 'Q?', at: NOW });
    mocks.messages.mockResolvedValue({ chat: { id: 'c-1', status: 'closed' }, messages: [seat('An answer.')], attachments: [] });
    await act(async () => { render(<UnderstandPage project={null} navigate={vi.fn()} now={NOW} compare={null} />); });
    await act(async () => { fireEvent.click(screen.getByTestId('understand-answer')); });
    await act(async () => { (chat.props!.provider as unknown as { onMove: (m: string) => boolean }).onMove('graph'); await new Promise((r) => setTimeout(r, 5)); });
    expect(screen.getByTestId('understand-page')).toHaveAttribute('data-side', 'closed');
    expect(document.activeElement).toBe(screen.getByTestId('understand-graph'));
  });

  it('Compare and Coverage keep the conversation mounted: its draft survives the trip', async () => {
    rememberAsked({ chatId: 'c-1', question: 'Q?', at: NOW });
    mocks.messages.mockResolvedValue({ chat: { id: 'c-1', status: 'closed' }, messages: [seat('An answer.')], attachments: [] });
    await act(async () => { render(<UnderstandPage project={null} navigate={vi.fn()} now={NOW} compare={<div data-testid="compare-stub" />} />); });
    await act(async () => { fireEvent.click(screen.getByTestId('understand-answer')); });
    fireEvent.change(screen.getByTestId('page-chat-draft'), { target: { value: 'And who calls that?' } });
    fireEvent.click(screen.getByTestId('understand-compare-toggle'));
    expect(screen.getByTestId('understand-chat')).not.toBeVisible();
    fireEvent.click(screen.getByTestId('understand-back'));
    fireEvent.click(screen.getByTestId('understand-coverage-toggle'));
    fireEvent.click(screen.getByTestId('understand-back'));
    expect(screen.getByTestId('understand-chat')).toBeVisible();
    expect(screen.getByTestId('page-chat-draft')).toHaveValue('And who calls that?');
    // The row is marked only while the chat is what the column shows.
    expect(screen.getByTestId('understand-answer')).toHaveAttribute('aria-current', 'true');
  });

  it('an open conversation’s graph links follow its own scope, not the page’s current choice', async () => {
    // Asked earlier about r2 (recorded with the question); the page's own choice is r1 (the project's repository).
    rememberAsked({ chatId: 'c-9', question: 'About crew?', at: NOW - 1000, repos: ['r2'] });
    mocks.messages.mockResolvedValue({ chat: { id: 'c-9', status: 'closed' }, messages: [seat('An answer.')], attachments: [] });
    await act(async () => { render(<UnderstandPage project="proj-1" navigate={vi.fn()} now={NOW} compare={null} />); });
    expect(screen.getAllByTestId('understand-graph-repo').map((r) => r.getAttribute('data-repo-id'))).toEqual(['r1']);
    await act(async () => { fireEvent.click(screen.getByTestId('understand-answer')); });
    expect(screen.getAllByTestId('understand-graph-repo').map((r) => r.getAttribute('data-repo-id'))).toEqual(['r2']);
    // On a wide screen the reopened conversation has the focus (its box, or the question box while it loads).
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(screen.getByTestId('understand-side')).not.toContainElement(document.activeElement as HTMLElement);
    // A follow-up in that conversation keeps its scope (the resumed chat recorded no chips of its own).
    await act(async () => { chat.props!.provider!.onSent!('And the callers?', 'c-9'); });
    expect(screen.getAllByTestId('understand-graph-repo').map((r) => r.getAttribute('data-repo-id'))).toEqual(['r2']);
    // Nothing is cut off, so there is no "All N repositories".
    expect(screen.queryByTestId('understand-graph-all')).toBeNull();
    // A new question goes back to the page's choice.
    await act(async () => { fireEvent.click(screen.getByTestId('understand-new-question')); });
    expect(screen.getAllByTestId('understand-graph-repo').map((r) => r.getAttribute('data-repo-id'))).toEqual(['r1']);
  });

  it('a question records the repositories it was asked about', async () => {
    await act(async () => { render(<UnderstandPage project="proj-1" navigate={vi.fn()} now={NOW} compare={null} />); });
    fireEvent.change(screen.getByTestId('understand-ask-input'), { target: { value: 'Who calls deliver?' } });
    mocks.messages.mockRejectedValue(new ApiError(404, 'Not Found'));
    await act(async () => { fireEvent.submit(screen.getByTestId('understand-ask')); });
    await act(async () => { chat.props!.provider!.onSent!(questionMessage('Who calls deliver?'), 'c-new'); });
    expect(readAsked()[0]).toMatchObject({ chatId: 'c-new', repos: ['r1'] });
  });

  it('the scope recorded is the one the chat actually opened with (changed in the chat after a failed open)', async () => {
    await act(async () => { render(<UnderstandPage project="proj-1" navigate={vi.fn()} now={NOW} compare={null} />); });
    fireEvent.change(screen.getByTestId('understand-ask-input'), { target: { value: 'Who calls deliver?' } });
    mocks.messages.mockRejectedValue(new ApiError(404, 'Not Found'));
    await act(async () => { fireEvent.submit(screen.getByTestId('understand-ask')); });
    // The chat persisted its own chips (r2) before telling the page it sent.
    sessionStorage.setItem('wicked.pagechat.understand.session', JSON.stringify({ chatId: 'c-r2', title: 'Q', seeded: false,
      chips: [{ key: 'repo:r2', kind: 'repo', label: 'wicked-crew', ref: 'r2', on: true }, { key: 'repo:r1', kind: 'repo', label: 'wicked-core', ref: 'r1', on: false }] }));
    await act(async () => { chat.props!.provider!.onSent!(questionMessage('Who calls deliver?'), 'c-r2'); });
    expect(readAsked()[0]).toMatchObject({ chatId: 'c-r2', repos: ['r2'] });
    expect(screen.getAllByTestId('understand-graph-repo').map((r) => r.getAttribute('data-repo-id'))).toEqual(['r2']);
  });

  it('every repository chip turned off in the chat records "all of them", not the page’s choice', async () => {
    await act(async () => { render(<UnderstandPage project="proj-1" navigate={vi.fn()} now={NOW} compare={null} />); });
    fireEvent.change(screen.getByTestId('understand-ask-input'), { target: { value: 'Q?' } });
    mocks.messages.mockRejectedValue(new ApiError(404, 'Not Found'));
    await act(async () => { fireEvent.submit(screen.getByTestId('understand-ask')); });
    sessionStorage.setItem('wicked.pagechat.understand.session', JSON.stringify({ chatId: 'c-all', title: 'Q', seeded: false,
      chips: [{ key: 'repo:r1', kind: 'repo', label: 'wicked-core', ref: 'r1', on: false }] }));
    await act(async () => { chat.props!.provider!.onSent!(questionMessage('Q?'), 'c-all'); });
    expect(readAsked()[0]).toMatchObject({ chatId: 'c-all', repos: [] });
    expect(screen.getAllByTestId('understand-graph-repo').map((r) => r.getAttribute('data-repo-id'))).toEqual(['r1', 'r2']);
  });

  it('a graph opened from the drawer gives the focus back to the drawer’s button when it closes', async () => {
    mockNarrow(true);
    await act(async () => { render(<UnderstandPage project={null} navigate={vi.fn()} now={NOW} compare={null} />); });
    await act(async () => { fireEvent.click(screen.getByTestId('understand-side-toggle')); });
    await act(async () => { fireEvent.click(screen.getAllByTestId('understand-graph-open')[0]!); });
    expect(screen.getByTestId('understand-page')).toHaveAttribute('data-side', 'closed');
    await act(async () => { fireEvent.click(screen.getByTestId('repo-graph-stub-close')); await new Promise((r) => setTimeout(r, 5)); });
    expect(document.activeElement).toBe(screen.getByTestId('understand-side-toggle'));
  });

  it('the drawer yields to a higher layer: with the shortcut overlay open Escape is not the drawer’s', async () => {
    mockNarrow(true);
    await act(async () => { render(<UnderstandPage project={null} navigate={vi.fn()} now={NOW} compare={null} />); });
    await act(async () => { fireEvent.click(screen.getByTestId('understand-side-toggle')); });
    const page = screen.getByTestId('understand-page');
    act(() => { useLayerStore.setState({ shortcutOverlayOpen: true }); });
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(page).toHaveAttribute('data-side', 'open');
    act(() => { useLayerStore.setState({ shortcutOverlayOpen: false }); });
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(page).toHaveAttribute('data-side', 'closed');
    // (Tab containment needs layout: the journey desk_page_chat tabs through the drawer in a browser.)
  });

  it('a behind requirements graph and an old index say so in words on their links', async () => {
    mocks.reqs.mockImplementation(async () => ({ total: 1, coverage: { realPct: 90, minPct: 80, behaviorBearing: 10, real: 9, placeholders: 1, unmapped: 0, notProduct: 0 }, graphBuild: { generation: 2, coverage: null, behind: true } }));
    const runs = [{ session: { id: 'o1', repo_ref: 'r1', workflow_id: 'onboarding', status: 'completed', created_at: NOW / 1000 - 10 * 86_400 } }] as unknown as SessionView[];
    await act(async () => { render(<UnderstandPage project="proj-1" navigate={vi.fn()} now={NOW} compare={null} runs={runs} />); });
    await vi.waitFor(() => expect(screen.getAllByTestId('understand-graph-flag').map((f) => f.textContent)).toEqual(['old', 'behind']));
  });

  it('a graph link names its repository and its state for a screen reader; the graph opens outside the sidebar', async () => {
    await act(async () => { render(<UnderstandPage project={null} navigate={vi.fn()} now={NOW} compare={null} />); });
    await vi.waitFor(() => expect(screen.getAllByTestId('understand-graph-open')[0]).toHaveAttribute('data-tone', 'ok'));
    const [first] = screen.getAllByTestId('understand-graph-open');
    expect(first!.getAttribute('aria-label')).toMatch(/^wicked-core: Code graph: 24 nodes in 4 files, .*\. Open it$/);
    // Its state in words too, never the dot's colour alone (a behind build says "behind").
    expect(first).toHaveTextContent('Code graph24 symbols');
    const req = screen.getAllByTestId('understand-graph-req')[0]!;
    expect(req).toHaveTextContent('build 2');
    expect(req.querySelector('[data-testid="understand-graph-flag"]')).toBeNull();
    fireEvent.click(first!);
    expect(screen.getByTestId('understand-side')).not.toContainElement(screen.getByTestId('repo-graph-stub'));
  });
});

describe('Evaluate: last results per steering type (pure)', () => {
  const r = (id: string, kind: 'good' | 'bad', type: string, verdict: EvalResult['verdict']): EvalResult =>
    ({ sample: { id, description: id, kind, steering_type: type }, expected: kind === 'bad' ? 'deny' : 'allow', fired: [], verdict }) as EvalResult;
  const src = (at: number, typeFilter: string | null, results: EvalResult[]): EvalSource => ({ at, corpus: null, typeFilter, degraded: null, results, id: `run-${at}`, ruleStore: null });

  it('says each type in plain words and colours it by what needs a look', () => {
    const all = src(100, null, [
      r('a', 'bad', 'security', 'caught'), r('b', 'bad', 'security', 'gap'),
      r('c', 'bad', 'development', 'caught'), r('d', 'good', 'development', 'caught'),
      r('e', 'good', 'testing', 'false_positive'),
      r('f', 'good', 'operations', 'caught'),
    ]);
    const rows = typeRows(all, null);
    expect(rows.map((x) => [x.type, x.tone])).toEqual([['testing', 'fail'], ['security', 'warn'], ['development', 'ok'], ['operations', 'quiet']]);
    expect(rows.map((x) => x.words)).toEqual([
      'No bad behaviours in this set, so nothing could be blocked · 1 false alarm on good work',
      'Blocked 1 of 2 bad behaviours · 1 gap: not covered by any rule',
      'Blocked the 1 bad behaviour',
      'No bad behaviours in this set, so nothing could be blocked',
    ]);
    expect(typeTone(rows[2]!.cov)).toBe('ok');
    expect(typeWords({ ...rows[2]!.cov, bad: 3, blocked: 3 })).toBe('Blocked all 3 bad behaviours');
  });

  it('a run limited to one type: the other types read from the newest all-types run, with its own time', () => {
    const older = src(100, null, [r('a', 'bad', 'security', 'gap'), r('b', 'bad', 'development', 'caught')]);
    const latest = src(200, 'security', [r('c', 'bad', 'security', 'caught')]);
    const rows = typeRows(latest, older);
    expect(rows.map((x) => [x.type, x.source.at, x.tone])).toEqual([['development', 100, 'ok'], ['security', 200, 'ok']]);
    // An all-types latest run never borrows older numbers.
    expect(typeRows(src(300, null, [r('d', 'bad', 'security', 'gap')]), older).map((x) => x.type)).toEqual(['security']);
  });
});
