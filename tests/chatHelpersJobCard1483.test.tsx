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
const chip = (key: string): HTMLElement => screen.getAllByTestId('composer-seat').find((b) => b.dataset.key === key)!;

beforeEach(() => {
  messages = [fixture.record];
  chatSeats = ['claude', 'codex', 'pi', 'copilot'];
  revisionStatus = 201;
  calls = [];
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
        // Crew answers with card v2, and the transcript gains it (the open card of the lineage).
        const keys = RECORD.proposal.seats.keys.filter((k) => !((body['edits'] as { removeSeats?: string[] }).removeSeats ?? []).includes(k));
        const v2 = { ...RECORD, turnId: 'person:v2', proposal: { ...RECORD.proposal, pid: `${RECORD.proposal.pid}:v2`, revises: RECORD.proposal.pid, seats: { lead: keys[0], keys, label: keys.join(', ') } } };
        messages = [...messages, v2];
        answer = { view: { state: 'open', proposal: v2.proposal } };
      } else answer = { code: 'proposal_stale', error: 'this card was changed in another tab' };
    }
    return Promise.resolve(new Response(JSON.stringify(answer), { status, headers: { 'content-type': 'application/json' } }));
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

it('with no job card yet, the chips still re-seat the chat', async () => {
  messages = [];
  render(<ChatHelpers chatId="seeded" roster={roster} />);
  await waitFor(() => expect(chip('pi').getAttribute('aria-pressed')).toBe('true'));
  expect(screen.getByTestId('composer-seats').dataset.target).toBe('chat');
  fireEvent.click(chip('pi'));
  await waitFor(() => expect(calls.some((c) => c.path === '/chats/seeded/seats')).toBe(true));
  expect(calls.some((c) => c.path === '/chats/seeded/proposals')).toBe(false);
});
