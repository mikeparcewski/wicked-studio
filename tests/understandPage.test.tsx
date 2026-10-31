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
}));
vi.mock('../src/api/client.js', () => ({
  api: { getChatMessages: mocks.messages, listRepos: mocks.listRepos, listProjectMembers: mocks.members },
  apiBase: () => '/api/v1',
}));
// The folded views are their own surfaces (with their own tests); here they only need to be reachable.
vi.mock('../src/components/CoverageView.js', () => ({ CoverageView: () => <div data-testid="coverage-view-stub" /> }));
vi.mock('../src/components/RepoGraphModal.js', () => ({ RepoGraphModal: ({ repo }: { repo: { name: string } }) => <div data-testid="repo-graph-stub">{repo.name}</div> }));
// The page chat (DES-LEARN §6.2) has its own tests (pageChat.test.tsx); here it is a stub that shows what the page
// hands it: its scope chips and its provider (which the page's Recent answers learn the chat id from).
const chat = vi.hoisted(() => ({ props: null as null | { chips?: Array<{ key: string; on: boolean }>; provider?: { knows: string; onSent?: (t: string, id: string) => void } } }));
vi.mock('../src/components/chat/PageChat.js', async (orig) => ({
  ...(await orig<object>()),
  PageChat: (p: typeof chat.props) => { chat.props = p; return <div data-testid="page-chat-stub">{p?.provider?.knows}</div>; },
}));

const { UnderstandPage } = await import('../src/components/desk/UnderstandPage.js');
const { usePageChat } = await import('../src/store/pageChat.js');
const onRepos = (): string[] => (chat.props?.chips ?? []).filter((c) => c.on && c.key.startsWith('repo:')).map((c) => c.key.slice(5));
const { clearRepoCache } = await import('../src/store/repoCache.js');

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
});
afterEach(() => cleanup());

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
  it('leads with one question box and three suggestions; the graph and the comparison are folded away', async () => {
    await act(async () => { render(<UnderstandPage project={null} navigate={vi.fn()} now={NOW} compare={<div data-testid="compare-stub" />} />); });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Understand');
    expect(screen.getByText('Ask how your code fits together. Answers cite the code they come from, right here.')).toBeInTheDocument();
    // Nothing asked yet: the box, not a chat.
    expect(screen.queryByTestId('understand-chat')).toBeNull();
    // No project and no job this week: nothing is chosen, so the questions name no repository.
    expect(screen.getAllByTestId('understand-suggest').map((b) => b.textContent)).toEqual(suggestedQuestions([]));
    expect(screen.getByTestId('understand-recent-empty')).toHaveTextContent('Nothing asked yet');
    expect(screen.getByTestId('understand-graph')).not.toHaveAttribute('open');
    expect(screen.getByTestId('understand-compare')).not.toHaveAttribute('open');
    // Nothing is read for the closed graph fold until it opens.
    expect(screen.queryByTestId('understand-graph-repo')).toBeNull();
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

  it('Explore the graph lists each repository with its graph when opened', async () => {
    await act(async () => { render(<UnderstandPage project={null} navigate={vi.fn()} now={NOW} compare={null} />); });
    const fold = screen.getByTestId('understand-graph');
    await act(async () => { (fold as HTMLDetailsElement).open = true; fireEvent(fold, new Event('toggle')); });
    expect(screen.getAllByTestId('understand-graph-repo').map((r) => r.textContent)).toEqual([expect.stringContaining('wicked-core'), expect.stringContaining('wicked-crew')]);
    fireEvent.click(screen.getAllByTestId('understand-graph-open')[1]!);
    expect(screen.getByTestId('repo-graph-stub')).toHaveTextContent('wicked-crew');
    fireEvent.click(screen.getByTestId('understand-coverage-toggle'));
    expect(screen.getByTestId('coverage-view-stub')).toBeInTheDocument();
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
