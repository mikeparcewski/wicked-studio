import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { SessionPage } from '../src/components/session/SessionView.js';
import { useAskThreadStore } from '../src/store/askThread.js';
import { jobProposal } from './jobFixtures.js';
import { Composer } from '../src/components/session/Composer.js';
import type { RosterSeat } from '../src/api/types.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { resetCatalogV2 } from '../src/store/catalogV2.js';
import { resetChatFlow } from '../src/store/chatFlow.js';
import { addAboutChip, useComposerChips } from '../src/store/composerChips.js';
import { NO_SEAT_PICKED, resetComposerSeats, useComposerSeats } from '../src/store/composerSeats.js';
import { postJob, startInChat, useStartNotes } from '../src/store/inlineStart.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import rig from './fixtures/workflowCatalogV2-rig.json';

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
const seatButton = (key: string): HTMLElement => screen.getAllByTestId('composer-seat').find((b) => b.dataset.key === key)!;

function composer(hasPersonMessage = false): React.ReactElement {
  // A seed's proposal already makes the thread "started" before the person sends a message.
  return <Composer composerKey="seeded" jobChatId="seeded" started chatHasPersonMessage={hasPersonMessage}
    text="" setText={() => {}} onSend={() => {}} placeholder="p" ariaLabel="a" variant="session" />;
}

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

it('B1: a seeded chat shows its read-back seats and unticking replaces the full set in roster order', async () => {
  useComposerSeats.getState().toggle('claude');
  render(composer());
  await waitFor(() => expect(seatButton('claude')).toHaveAttribute('aria-pressed', 'true'));
  expect(seatButton('pi')).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(seatButton('codex'));
  await waitFor(() => expect(calls.find((c) => c.path.endsWith('/seats'))?.body).toEqual({ clis: ['claude'] }));
  await waitFor(() => expect(seatButton('codex')).toHaveAttribute('aria-pressed', 'false'));
  expect(useComposerSeats.getState().dropped).toEqual(['claude']);
});

it('B1: the reseat answer supplies the admitted seats and crew refusal words', async () => {
  reseatAnswer = { chatId: 'seeded', seats: [{ cliKey: 'claude', ok: true }, { cliKey: 'pi', ok: false, error: 'pi is signed out' }], refused: [{ cliKey: 'pi', reason: 'pi is signed out' }] };
  render(composer());
  await waitFor(() => expect(seatButton('claude')).toHaveAttribute('aria-pressed', 'true'));
  fireEvent.click(seatButton('pi'));
  await waitFor(() => expect(screen.getByText('pi is signed out')).toBeInTheDocument());
  expect(seatButton('codex')).toHaveAttribute('aria-pressed', 'false');
  expect(seatButton('pi')).toHaveAttribute('aria-pressed', 'false');
});

it.each([409, 200])('B1: a refused seat replacement (%s) says crew words and re-reads the chat', async (status) => {
  reseatStatus = status;
  const words = status === 409 ? 'open a new chat' : 'No named helper could be seated.';
  reseatAnswer = status === 409 ? { error: words } : { chatId: 'seeded', seats: [], refused: [], reseated: false, note: words };
  render(composer());
  await waitFor(() => expect(seatButton('claude')).toHaveAttribute('aria-pressed', 'true'));
  seats = ['pi'];
  fireEvent.click(seatButton('codex'));
  await waitFor(() => expect(screen.getByText(words)).toBeInTheDocument());
  await waitFor(() => expect(seatButton('pi')).toHaveAttribute('aria-pressed', 'true'));
  expect(seatButton('claude')).toHaveAttribute('aria-pressed', 'false');
  expect(calls.filter((c) => c.path === '/chats/seeded')).toHaveLength(2);
});

it('B1: the helper row disappears after the seeded chat first person message', async () => {
  const view = render(composer());
  await waitFor(() => expect(screen.getByTestId('composer-seats')).toBeInTheDocument());
  view.rerender(composer(true));
  expect(screen.queryByTestId('composer-seats')).toBeNull();
});

it('B2: Generate it opens its seed with the chosen helpers, without the dropped seat', async () => {
  useComposerSeats.getState().toggle('codex');
  await startInChat({ workflowId: 'demo-video', words: 'Show the app', projectId: 'p1' });
  expect(calls.find((c) => c.path === '/chats')?.body['clis']).toEqual(['claude', 'pi']);
});

it('B2: a composer seeded job puts its named lead first among the chosen helpers', async () => {
  useComposerSeats.getState().toggle('codex');
  addAboutChip('fresh', { kind: 'about', key: 'h:pi', label: 'pi' });
  render(<Composer composerKey="fresh" text="/bug login crashes" setText={() => {}} onSend={() => {}}
    placeholder="p" ariaLabel="a" variant="session" />);
  await waitFor(() => expect(screen.getByTestId('session-composer-send')).toBeEnabled());
  fireEvent.click(screen.getByTestId('session-composer-send'));
  await waitFor(() => expect(calls.find((c) => c.path === '/chats')?.body['clis']).toEqual(['pi', 'claude']));
});


it('B1: a seeded session offers helpers until its live first person turn, before the transcript catches up', async () => {
  useCapabilities.setState({ askPath: true, chatProposals: true, runChatId: true });
  messages = [{ at: 1, kind: 'proposal', proposal: jobProposal({ chatId: 'seeded' }) }];
  render(<SessionPage sessionId="seeded" runs={[]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
  await screen.findByTestId('job-passage');
  await waitFor(() => expect(seatButton('claude')).toHaveAttribute('aria-pressed', 'true'));
  act(() => { useAskThreadStore.getState().sent('seeded', { turnId: 'first', text: 'Go ahead' }); });
  expect(screen.queryByTestId('composer-seats')).toBeNull();
});

it('B1: a chat seat edit waits for roster order before it can be sent', async () => {
  clearCachedRoster();
  let release!: (value: { roster: RosterSeat[] }) => void;
  vi.spyOn(api, 'getRoster').mockReturnValue(new Promise((resolve) => { release = resolve; }));
  render(composer());
  await waitFor(() => expect(seatButton('claude')).toHaveAttribute('aria-pressed', 'true'));
  expect(seatButton('claude')).toBeDisabled();
  await act(async () => { release({ roster }); });
  expect(seatButton('claude')).toBeEnabled();
  fireEvent.click(seatButton('pi'));
  await waitFor(() => expect(calls.find((c) => c.path.endsWith('/seats'))?.body).toEqual({ clis: ['claude', 'codex', 'pi'] }));
});


it('F1: the last chat helper is disabled and clicking it sends no POST', async () => {
  seats = ['claude'];
  render(composer());
  await waitFor(() => expect(seatButton('claude')).toHaveAttribute('aria-pressed', 'true'));
  expect(seatButton('claude')).toBeDisabled();
  expect(seatButton('claude')).toHaveAttribute('title', 'A chat needs at least one helper');
  fireEvent.click(seatButton('claude'));
  expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
});

it('F5: the chat helper row names its group and explains when choices stay', async () => {
  render(composer());
  const group = await screen.findByRole('group', { name: 'Helpers in this chat' });
  expect(group).toHaveTextContent('Helpers');
  expect(group).toHaveTextContent('Set before the first message; after it, they stay.');
});

it.each([
  { projectId: null, repoRef: null, clis: ['claude'] },
  { projectId: 'default', repoRef: null, clis: ['claude'] },
  { projectId: 'p1', repoRef: null, clis: ['codex'] },
  { projectId: null, repoRef: 'repo1', clis: ['codex'] },
])('F2: the seed uses its actual scope for admission ($projectId, $repoRef)', async ({ projectId, repoRef, clis }) => {
  setCachedRoster(roster.slice(0, 2).map((seat) => ({ ...seat, chat_admission: {
    unscoped: { ok: seat.key === 'claude' }, scoped: { ok: seat.key === 'codex' },
  } })));
  await postJob({ card: 'demo-video', option: null, depth: null, words: 'Show it', source: 'pick',
    chatId: null, projectId, repoRef, pickKey: 'scope-test' });
  expect(calls.find((c) => c.path === '/chats')?.body['clis']).toEqual(clis);
});

it('F2: an empty helper choice rejects before opening the seed', async () => {
  for (const seat of roster) useComposerSeats.getState().toggle(seat.key);
  await expect(postJob({ card: 'demo-video', option: null, depth: null, words: 'Show it', source: 'pick',
    chatId: null, projectId: 'p1', pickKey: 'empty-test' })).rejects.toThrow(NO_SEAT_PICKED);
  expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
});

it.each([false, true])('F3: Generate it removes a dropped proposal seat in one revision (requirements: %s)', async (requirements) => {
  useComposerSeats.getState().toggle('codex');
  proposalSeats = ['claude', 'codex'];
  await startInChat({ workflowId: 'draft-epics', projectId: 'p1',
    ...(requirements ? { requirements: [{ repoId: 'r1', key: 'REQ-1', title: 'Do it' }] } : {}),
  });
  expect(calls.find((c) => c.path === '/chats')?.body['clis']).toEqual(['claude', 'pi']);
  const revisions = calls.filter((c) => c.path === '/chats/seeded/proposals');
  expect(revisions).toHaveLength(1);
  expect(revisions[0]?.body).toEqual({ revises: 'p1', edits: {
    ...(requirements ? { inputs: { requirements: { kind: 'requirements', refs: [{ repoId: 'r1', key: 'REQ-1' }] } } } : {}),
    removeSeats: ['codex'],
  }, source: 'question', requestId: expect.stringMatching(/:choices$/) });
});

it('F3: admitted proposal seats without requirements need no revision', async () => {
  proposalSeats = ['claude', 'pi'];
  await startInChat({ workflowId: 'draft-epics', projectId: 'p1' });
  expect(calls.some((c) => c.path === '/chats')).toBe(true);
  expect(calls.filter((c) => c.path === '/chats/seeded/proposals')).toEqual([]);
});

it.each([
  { requirements: true, dropped: false, note: 'The requirements you chose were not added (the daemon refused this — choices refused): pick them in the job.' },
  { requirements: false, dropped: true, note: 'The helpers you turned off were not taken off this job (the daemon refused this — choices refused): change them in the job.' },
  { requirements: true, dropped: true, note: 'Your requirements and helper choices were not applied (the daemon refused this — choices refused): set them in the job.' },
])('F3: a failed choices revision says what was lost ($requirements, $dropped)', async ({ requirements, dropped, note }) => {
  revisionStatus = 400;
  if (dropped) useComposerSeats.getState().toggle('codex');
  proposalSeats = ['claude', 'codex'];
  await startInChat({ workflowId: 'draft-epics', projectId: 'p1',
    ...(requirements ? { requirements: [{ repoId: 'r1', key: 'REQ-1', title: 'Do it' }] } : {}),
  });
  expect(useStartNotes.getState().notes['seeded']).toBe(note);
  const revisions = calls.filter((c) => c.path === '/chats/seeded/proposals');
  expect(revisions).toHaveLength(1);
  expect(revisions[0]?.body['edits']).toEqual({
    ...(requirements ? { inputs: { requirements: { kind: 'requirements', refs: [{ repoId: 'r1', key: 'REQ-1' }] } } } : {}),
    ...(dropped ? { removeSeats: ['codex'] } : {}),
  });
});

it('B1: a chat read that carries no seats draws no helper row and does not throw', async () => {
  // CI on #1249: a run's session reads GET /chats/:id without `seats`; the row must step aside, not crash the page.
  seats = undefined as unknown as string[];
  render(composer());
  await waitFor(() => expect(calls.some((c) => c.path === '/chats/seeded' && c.method === 'GET')).toBe(true));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(screen.queryByTestId('composer-seats')).toBeNull();
});
