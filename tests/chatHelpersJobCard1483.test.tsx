// studio#1483: the helper chips under a job card change THAT job's helpers.
//
// Train-17 cert, J4b (crew 0.20.0): with four helpers signed in, the person turned three chips off under the job card.
// Each press re-seated the CHAT (POST /chats/:id/seats, 200), but crew draws a job's seats from the seats new work may
// use, never from the chat's (crew chat-jobs.ts drawOrder), so card v2 still named all four and Start ran all four.
// The card here is that chat's own first transcript record (tests/fixtures/j4b-t17-job-card-1483.json).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fixture from './fixtures/j4b-t17-job-card-1483.json';
import { ChatHelpers, openJobCard } from '../src/components/session/ChatHelpers.js';
import type { RosterSeat } from '../src/api/types.js';

const RECORD = fixture.record as unknown as { proposal: { pid: string; seats: { keys: string[] } } };
const NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', pi: 'Pi CLI', copilot: 'GitHub Copilot CLI' };
const roster = Object.entries(NAMES).map(([key, display_name]) => ({ key, display_name, binary: key, enabled_for_council: true, signed_in: true })) as unknown as RosterSeat[];

let messages: unknown[];
let chatSeats: string[];
let revisionStatus: number;
let calls: Array<{ path: string; method: string; body: Record<string, unknown> }>;
// A chat read made while `holdReads` is on answers later, with what crew held when it was made (a slow read).
let holdReads: boolean;
// The revision POST takes effect on crew, then the answer is lost (the network drops).
let revisionLost: boolean;
let heldReads: Array<() => void>;
const chip = (key: string): HTMLElement => screen.getAllByTestId('composer-seat').find((b) => b.dataset.key === key)!;

beforeEach(() => {
  messages = [fixture.record];
  chatSeats = ['claude', 'codex', 'pi', 'copilot'];
  revisionStatus = 201;
  calls = [];
  holdReads = false;
  heldReads = [];
  revisionLost = false;
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ path, method, body });
    let answer: unknown = {};
    let status = 200;
    if (path === '/chats/seeded' && method === 'GET') answer = { chatId: 'seeded', seats: chatSeats, scope: { kind: 'none' }, messages };
    if (path === '/chats/seeded/seats') {
      chatSeats = body['clis'] as string[];
      answer = { chatId: 'seeded', seats: chatSeats.map((cliKey) => ({ cliKey, ok: true })), refused: [] };
    }
    if (path === '/chats/seeded/proposals') {
      status = revisionStatus;
      if (status === 201) {
        // Crew answers with the card's next version, built on the head it revises; the transcript gains it.
        const head = (messages as Array<typeof RECORD>).filter((m) => m.proposal?.pid !== undefined).at(-1)!.proposal;
        const edits = body['edits'] as { removeSeats?: string[]; addSeats?: string[] };
        const keys = [...head.seats.keys.filter((k) => !(edits.removeSeats ?? []).includes(k)), ...(edits.addSeats ?? []).filter((k) => !head.seats.keys.includes(k))];
        const n = messages.length + 1;
        const next = { ...RECORD, turnId: `person:v${n}`, proposal: { ...RECORD.proposal, pid: `${RECORD.proposal.pid}:v${n}`, revises: head.pid, seats: { lead: keys[0], keys, label: keys.join(', ') } } };
        messages = [...messages, next];
        answer = { view: { state: 'open', proposal: next.proposal } };
      } else answer = { code: 'proposal_stale', error: 'this card was changed in another tab' };
    }
    // Crew took the revision (above); its answer never arrives.
    if (revisionLost && path === '/chats/seeded/proposals') return Promise.reject(new TypeError('Failed to fetch'));
    const respond = (): Response => new Response(JSON.stringify(answer), { status, headers: { 'content-type': 'application/json' } });
    if (holdReads && method === 'GET') return new Promise<Response>((resolve) => heldReads.push(() => resolve(respond())));
    return Promise.resolve(respond());
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('reads the open job card from the transcript', () => {
  expect(openJobCard([fixture.record])).toEqual({ pid: RECORD.proposal.pid, seats: ['claude', 'codex', 'pi', 'copilot'] });
  expect(openJobCard([])).toBeNull();
});

it('under an open job card, a chip press re-versions the card without the seat, and never re-seats the chat', async () => {
  const onJobChanged = vi.fn();
  render(<ChatHelpers chatId="seeded" roster={roster} onJobChanged={onJobChanged} />);
  await waitFor(() => expect(chip('codex').getAttribute('aria-pressed')).toBe('true'));
  expect(screen.getByTestId('composer-seats').dataset.target).toBe('job');
  fireEvent.click(chip('codex'));
  await waitFor(() => expect(chip('codex').getAttribute('aria-pressed')).toBe('false'));
  const posts = calls.filter((c) => c.method === 'POST');
  expect(posts.map((c) => c.path)).toEqual(['/chats/seeded/proposals']);
  expect(posts[0]!.body).toMatchObject({ revises: RECORD.proposal.pid, edits: { removeSeats: ['codex'] }, source: 'question' });
  // The chips now read card v2's helpers.
  expect(['claude', 'pi', 'copilot'].map((k) => chip(k).getAttribute('aria-pressed'))).toEqual(['true', 'true', 'true']);
  expect(screen.getByTestId('composer-seats').textContent).toContain('A change here draws the job card again with these helpers.');
  // The transcript is told to read the card's new version.
  expect(onJobChanged).toHaveBeenCalledTimes(1);
});

it('a seat the card does not name is added to the job through the same revision', async () => {
  messages = [{ ...fixture.record, proposal: { ...RECORD.proposal, seats: { lead: 'claude', keys: ['claude'], label: 'Claude Code' } } }];
  render(<ChatHelpers chatId="seeded" roster={roster} />);
  await waitFor(() => expect(chip('codex').getAttribute('aria-pressed')).toBe('false'));
  fireEvent.click(chip('codex'));
  await waitFor(() => expect(calls.some((c) => c.path === '/chats/seeded/proposals')).toBe(true));
  expect(calls.find((c) => c.path === '/chats/seeded/proposals')!.body).toMatchObject({ edits: { addSeats: ['codex'] } });
});

it('a refused revision says the job was not changed and shows the card as crew holds it', async () => {
  revisionStatus = 409;
  render(<ChatHelpers chatId="seeded" roster={roster} />);
  await waitFor(() => expect(chip('pi').getAttribute('aria-pressed')).toBe('true'));
  fireEvent.click(chip('pi'));
  await screen.findByText(/The job's helpers were not changed/);
  expect(chip('pi').getAttribute('aria-pressed')).toBe('true');
  expect(calls.some((c) => c.path === '/chats/seeded/seats')).toBe(false);
});

it('a card dismissed since the row read it (Not now) is not revised: the press re-seats the chat (codex-check W12)', async () => {
  render(<ChatHelpers chatId="seeded" roster={roster} />);
  await waitFor(() => expect(screen.getByTestId('composer-seats').dataset.target).toBe('job'));
  // The person pressed Not now on the card; crew wrote its decision (chat-proposals.ts decided()).
  messages = [...messages, { at: Date.now(), turnId: 'person:2', kind: 'proposal_decided', pid: RECORD.proposal.pid, actor: 'local', decision: 'not_now', result: null }];
  fireEvent.click(chip('pi'));
  await waitFor(() => expect(calls.some((c) => c.path === '/chats/seeded/seats')).toBe(true));
  expect(calls.some((c) => c.path === '/chats/seeded/proposals')).toBe(false);
  expect(calls.find((c) => c.path === '/chats/seeded/seats')!.body).toEqual({ clis: ['claude', 'codex', 'copilot'] });
  expect(screen.getByTestId('composer-seats').dataset.target).toBe('chat');
});

it('the row reads again when the transcript does (a card drawn after it read)', async () => {
  messages = [];
  const { rerender } = render(<ChatHelpers chatId="seeded" roster={roster} rev={0} />);
  await waitFor(() => expect(screen.getByTestId('composer-seats').dataset.target).toBe('chat'));
  messages = [fixture.record];
  rerender(<ChatHelpers chatId="seeded" roster={roster} rev={1} />);
  await waitFor(() => expect(screen.getByTestId('composer-seats').dataset.target).toBe('job'));
});

it('a slow older read never paints a dropped helper back on (codex-check r2 W20)', async () => {
  const { rerender } = render(<ChatHelpers chatId="seeded" roster={roster} rev={0} />);
  await waitFor(() => expect(chip('codex').getAttribute('aria-pressed')).toBe('true'));
  // The transcript reads again (rev 1); that read is slow and holds card v1.
  holdReads = true;
  rerender(<ChatHelpers chatId="seeded" roster={roster} rev={1} />);
  await waitFor(() => expect(heldReads).toHaveLength(1));
  holdReads = false;
  fireEvent.click(chip('codex'));
  await waitFor(() => expect(calls.filter((c) => c.path === '/chats/seeded/proposals')).toHaveLength(1));
  await waitFor(() => expect(chip('codex').getAttribute('aria-pressed')).toBe('false'));
  // The slow read lands last: it is older than the revision's re-read, so it is dropped.
  heldReads.forEach((release) => release());
  await new Promise((r) => setTimeout(r, 50));
  expect(chip('codex').getAttribute('aria-pressed')).toBe('false');
});

it('a press carries what the person asked for: a chip drawn before the card changed never reverses it (codex-check r2 W20)', async () => {
  render(<ChatHelpers chatId="seeded" roster={roster} />);
  await waitFor(() => expect(chip('codex').getAttribute('aria-pressed')).toBe('true'));
  // Card v2 already left Codex out (another tab), and this row has not read it yet: Codex still shows on.
  const v2 = { ...RECORD, turnId: 'person:v2', proposal: { ...RECORD.proposal, pid: `${RECORD.proposal.pid}:v2`, revises: RECORD.proposal.pid, seats: { lead: 'claude', keys: ['claude', 'pi', 'copilot'], label: 'x' } } };
  messages = [...messages, v2];
  fireEvent.click(chip('codex')); // the person means: leave Codex out
  await waitFor(() => expect(chip('codex').getAttribute('aria-pressed')).toBe('false'));
  expect(calls.some((c) => c.method === 'POST')).toBe(false);
});

it('a card drawn since the row read is the one a press changes, not the chat (codex-check r2 W10)', async () => {
  messages = [];
  render(<ChatHelpers chatId="seeded" roster={roster} />);
  await waitFor(() => expect(screen.getByTestId('composer-seats').dataset.target).toBe('chat'));
  messages = [fixture.record]; // the card is drawn; this row has not read it yet
  fireEvent.click(chip('pi'));
  await waitFor(() => expect(calls.some((c) => c.path === '/chats/seeded/proposals')).toBe(true));
  expect(calls.find((c) => c.path === '/chats/seeded/proposals')!.body).toMatchObject({ edits: { removeSeats: ['pi'] } });
  expect(calls.some((c) => c.path === '/chats/seeded/seats')).toBe(false);
});

it('a revision whose answer is lost is not called refused: the chips show what crew holds (partial failure)', async () => {
  revisionLost = true;
  render(<ChatHelpers chatId="seeded" roster={roster} />);
  await waitFor(() => expect(chip('codex').getAttribute('aria-pressed')).toBe('true'));
  fireEvent.click(chip('codex'));
  await screen.findByText(/Crew did not answer/);
  expect(screen.queryByText(/were not changed/)).toBeNull();
  // Crew took it (card v2 without Codex): the re-read shows so, and a second press asking the same is a no-op.
  expect(chip('codex').getAttribute('aria-pressed')).toBe('false');
});

it('each press names its own revision: the card version, the seat and the intent (identity)', async () => {
  render(<ChatHelpers chatId="seeded" roster={roster} />);
  await waitFor(() => expect(chip('codex').getAttribute('aria-pressed')).toBe('true'));
  fireEvent.click(chip('codex'));
  await waitFor(() => expect(chip('codex').getAttribute('aria-pressed')).toBe('false'));
  fireEvent.click(chip('pi'));
  await waitFor(() => expect(chip('pi').getAttribute('aria-pressed')).toBe('false'));
  const revs = calls.filter((c) => c.path === '/chats/seeded/proposals').map((c) => c.body);
  expect(revs.map((b) => b['revises'])).toEqual([RECORD.proposal.pid, `${RECORD.proposal.pid}:v2`]);
  expect(new Set(revs.map((b) => b['requestId'])).size).toBe(2);
});

it('with no job card yet, the chips still re-seat the chat', async () => {
  messages = [];
  render(<ChatHelpers chatId="seeded" roster={roster} />);
  await waitFor(() => expect(chip('pi').getAttribute('aria-pressed')).toBe('true'));
  expect(screen.getByTestId('composer-seats').dataset.target).toBe('chat');
  fireEvent.click(chip('pi'));
  await waitFor(() => expect(calls.some((c) => c.path === '/chats/seeded/seats')).toBe(true));
  expect(calls.some((c) => c.path === '/chats/seeded/proposals')).toBe(false);
});
