import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAskThreadStore } from '../src/store/askThread.js';
import { Composer } from '../src/components/session/Composer.js';
import type { RosterSeat } from '../src/api/types.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { resetCatalogV2 } from '../src/store/catalogV2.js';
import { resetChatFlow } from '../src/store/chatFlow.js';
import { useComposerChips } from '../src/store/composerChips.js';
import { resetComposerSeats } from '../src/store/composerSeats.js';
import { startInChat, useJobAsks, useStartNotes } from '../src/store/inlineStart.js';
import { useChatFlow } from '../src/store/chatFlow.js';
import { openLaunchWizard } from '../src/store/launchWizard.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import rig from './fixtures/workflowCatalogV2-rig.json';

/**
 * studio#1472 (J6): the Requirements panel's "Generate it" asks for the person's words BEFORE it posts the domain-map
 * job. Posted with none, the card opened with its intent missing, and the scope typed next was answered as a question
 * about the code; it never reached the card. Now the job waits on a new chat's composer (its chip, its repository) under
 * the question, and the person's first Enter posts it with their words. Other named openers still post at once. The
 * catalog is crew's own (tests/fixtures/workflowCatalogV2-rig.json); the seed body is postJob's (`POST /chats {seed}`).
 */
const roster = ['claude', 'codex', 'pi'].map((key) => ({
  key, display_name: key, binary: key, enabled_for_council: true, signed_in: true,
})) as RosterSeat[];
vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

let proposalSeats: string[];
let revisionStatus: number;
let messages: unknown[];
let seats: string[];
let reseatStatus: number;
let reseatAnswer: Record<string, unknown> | null;
let calls: Array<{ path: string; method: string; body: Record<string, unknown> }>;


beforeEach(() => {
  resetComposerSeats();
  resetChatFlow();
  resetCatalogV2();
  clearCachedRoster();
  setCachedRoster(roster);
  useComposerChips.setState({ byComposer: {} });
  useCapabilities.setState({ loaded: true, chatJobProposals: true, workflowCatalogV2: true, askPath: false, chatProposals: false, runChatId: false });
  messages = [];
  proposalSeats = ['claude'];
  revisionStatus = 200;
  useStartNotes.setState({ notes: {} });
  useJobAsks.setState({ asks: {} });
  seats = ['codex', 'claude'];
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), replySeq: {} });
  reseatStatus = 200;
  reseatAnswer = null;
  calls = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ path, method, body });
    let answer: unknown = {};
    let status = 200;
    if (path === '/chats/seeded') answer = { chatId: 'seeded', seats, scope: { kind: 'none' }, messages };
    if (path === '/chats/seeded/seats') {
      status = reseatStatus;
      if (reseatAnswer === null) seats = body['clis'] as string[];
      answer = reseatAnswer ?? { chatId: 'seeded', seats: seats.map((cliKey) => ({ cliKey, ok: true })), refused: [] };
    }
    if (path === '/roster') answer = { roster };
    if (path === '/repos') answer = { repos: [] };
    if (path === '/projects') answer = { projects: [] };
    if (path === '/workflows/catalog') answer = rig;
    if (path === '/chats/seeded/proposals') { status = revisionStatus; answer = { error: 'choices refused' }; }
    if (path === '/chats') answer = { chatId: 'seeded', seats: [], scope: null, proposal: { state: 'open', proposal: { pid: 'p1', kind: 'job', seats: { lead: proposalSeats[0] ?? null, keys: proposalSeats, label: proposalSeats.join(', ') } } } };
    return Promise.resolve(new Response(JSON.stringify(answer), { status, headers: { 'content-type': 'application/json' } }));
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); resetComposerSeats(); });


const SCOPE = 'In carddemo-t16, extract the business rules of CBTRN02C, CBACT04C and CBTRN03C';
const ASK = 'What should the model cover?';
const freshId = (): string => useChatFlow.getState().request!.chatId;

it('Generate it posts nothing: the job waits on a new chat\'s composer under the question', async () => {
  await startInChat({ workflowId: 'domain-extraction', repoRef: 'r1', words: '', askWords: ASK });
  expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  const chatId = freshId();
  expect(useComposerChips.getState().byComposer[chatId]?.map((c) => c.label)).toEqual(['Analyze a codebase · Domain']);
  expect(Object.values(useJobAsks.getState().asks)).toEqual([ASK]);
  // The composer asks it, as a question, not as a refusal: no alert note.
  render(<Composer composerKey={chatId} text="" setText={() => {}} onSend={() => {}} placeholder="p" ariaLabel="a" variant="session" />);
  expect(screen.getByTestId('composer-job-line')).toHaveTextContent(`${ASK} Say it here: Enter puts this job in the chat with your words.`);
  expect(screen.getByPlaceholderText(ASK)).toHaveAccessibleDescription(expect.stringContaining(ASK));
  expect(screen.queryByTestId('composer-start-note')).toBeNull();
  expect(useStartNotes.getState().notes[chatId]).toBeUndefined();
});

it('the person\'s first Enter there posts the job with their words as its intent, for the repository', async () => {
  await startInChat({ workflowId: 'domain-extraction', repoRef: 'r1', words: '', askWords: ASK });
  const chatId = freshId();
  render(<Composer composerKey={chatId} text={SCOPE} setText={() => {}} onSend={() => {}} placeholder="p" ariaLabel="a" variant="session" />);
  await waitFor(() => expect(screen.getByTestId('session-composer-send')).toBeEnabled());
  fireEvent.click(screen.getByTestId('session-composer-send'));
  await waitFor(() => expect(calls.some((c) => c.path === '/chats' && c.method === 'POST')).toBe(true));
  const seed = calls.find((c) => c.path === '/chats' && c.method === 'POST')!.body;
  // The same card and option the direct post sends (startInChat posts `hit.wireCard`, the catalog alias's own name).
  expect(seed['seed']).toMatchObject({ card: '/workflow-domain-extraction', option: 'domain', words: SCOPE });
  expect(seed['repoRefs']).toEqual(['r1']);
});

it('the Requirements opener asks first (openLaunchWizard carries the question through)', async () => {
  openLaunchWizard({ workflowId: 'domain-extraction', intent: '', contextRepo: 'r1', composerKey: 'repo:r1', askWords: ASK });
  await waitFor(() => expect(Object.values(useJobAsks.getState().asks)).toContain(ASK));
  expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
});

it('words already given, or an opener that does not ask, post at once as before', async () => {
  await startInChat({ workflowId: 'domain-extraction', repoRef: 'r1', words: SCOPE, askWords: ASK });
  await waitFor(() => expect(calls.filter((c) => c.path === '/chats' && c.method === 'POST')).toHaveLength(1));
  expect(calls.find((c) => c.path === '/chats' && c.method === 'POST')!.body['seed']).toMatchObject({ card: '/workflow-domain-extraction', option: 'domain', words: SCOPE });
  await startInChat({ workflowId: 'draft-epics', projectId: 'p1' });
  await waitFor(() => expect(calls.filter((c) => c.path === '/chats' && c.method === 'POST')).toHaveLength(2));
});

it('the question goes with its job: a later job picked on the same composer does not ask it (pi r1)', async () => {
  await startInChat({ workflowId: 'domain-extraction', repoRef: 'r1', words: '', askWords: ASK });
  const chatId = freshId();
  const first = useComposerChips.getState().byComposer[chatId]![0]!;
  // The job chip leaves (sent, or taken off); another job is picked on the same composer.
  useComposerChips.setState({ byComposer: { [chatId]: [{ ...first, key: 'job:later:1', label: 'Draft epics' }] } });
  render(<Composer composerKey={chatId} text="" setText={() => {}} onSend={() => {}} placeholder="p" ariaLabel="a" variant="session" />);
  expect(screen.getByTestId('composer-job-line')).toHaveTextContent('Enter puts this job in the chat for you to look over.');
  expect(screen.getByTestId('composer-job-line')).not.toHaveTextContent(ASK);
});
