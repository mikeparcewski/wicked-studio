import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatTranscriptRecord } from 'wicked-crew-api-types';
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
}));
vi.mock('../src/api/client.js', () => ({
  api: { getChatMessages: mocks.messages, listRepos: mocks.listRepos },
  apiBase: () => '/api/v1',
}));
// The folded views are their own surfaces (with their own tests); here they only need to be reachable.
vi.mock('../src/components/CoverageView.js', () => ({ CoverageView: () => <div data-testid="coverage-view-stub" /> }));
vi.mock('../src/components/RepoGraphModal.js', () => ({ RepoGraphModal: ({ repo }: { repo: { name: string } }) => <div data-testid="repo-graph-stub">{repo.name}</div> }));

const { UnderstandPage } = await import('../src/components/desk/UnderstandPage.js');
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
  useCapabilities.setState({ chatList: true, loaded: true });
  useAskDock.setState({ request: null });
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
    expect(screen.getByText('Ask how your code fits together. Answers cite the code they come from.')).toBeInTheDocument();
    expect(screen.getAllByTestId('understand-suggest').map((b) => b.textContent)).toEqual(suggestedQuestions(['wicked-core', 'wicked-crew']));
    expect(screen.getByTestId('understand-recent-empty')).toHaveTextContent('Nothing asked yet');
    expect(screen.getByTestId('understand-graph')).not.toHaveAttribute('open');
    expect(screen.getByTestId('understand-compare')).not.toHaveAttribute('open');
    // Nothing is read for the closed graph fold until it opens.
    expect(screen.queryByTestId('understand-graph-repo')).toBeNull();
    expect(mocks.messages).not.toHaveBeenCalled();
  });

  it('a suggestion fills the box (nothing sent); Ask sends the operator’s question into a new chat and lists it', async () => {
    await act(async () => { render(<UnderstandPage project="proj-1" navigate={vi.fn()} now={NOW} compare={null} />); });
    fireEvent.click(screen.getAllByTestId('understand-suggest')[0]!);
    expect(screen.getByTestId('understand-ask-input')).toHaveValue('How is wicked-core put together?');
    expect(useAskDock.getState().request).toBeNull();
    mocks.messages.mockRejectedValue(new ApiError(404, 'Not Found'));
    await act(async () => { fireEvent.submit(screen.getByTestId('understand-ask')); });
    const req = useAskDock.getState().request!;
    expect(req.seedText).toBe(questionMessage('How is wicked-core put together?'));
    expect(req.projectId).toBe('proj-1');
    expect(req.send?.chatId).toBe(readAsked()[0]!.chatId);
    expect(screen.getByTestId('understand-ask-input')).toHaveValue('');
    const row = screen.getByTestId('understand-answer');
    // The row shows the operator's words, never the grounding line or the chat id.
    expect(row).toHaveTextContent('How is wicked-core put together?');
    expect(row).not.toHaveTextContent(GROUNDING_LINE);
    expect(row).not.toHaveTextContent(req.send!.chatId);
    // Just asked, not opened yet: it reads as being answered.
    expect(within(row).getByTestId('understand-answer-sub')).toHaveTextContent('Answering now…');
    expect(row).toHaveAttribute('href', `/s/${req.send!.chatId}`);
  });

  it('an empty Ask sends nothing', async () => {
    await act(async () => { render(<UnderstandPage project={null} navigate={vi.fn()} now={NOW} compare={null} />); });
    await act(async () => { fireEvent.submit(screen.getByTestId('understand-ask')); });
    expect(useAskDock.getState().request).toBeNull();
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
    fireEvent.click(rows[0]!);
    expect(navigate).toHaveBeenCalledWith('/s/c-1');
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
