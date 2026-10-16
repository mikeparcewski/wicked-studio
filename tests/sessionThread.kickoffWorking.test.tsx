// Operator feedback (2026-10-15): the run page showed nothing while agents worked — "lack of viewable
// progress makes people react and put more text in / click" — and opened on a header, not on what
// kicked the run off. The thread now starts with the operator's own bubble for a run started outside
// a chat, and says, at its foot, which step is being worked on while one executes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import * as client from '../src/api/client.js';
import { SessionPage } from '../src/components/session/SessionView.js';
import { useSheets } from '../src/store/sheets.js';
import { useRunEventStore } from '../src/store/events.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { markHeld } from '../src/board/heldRuns.js';
import { makeUnit, makeView } from './factories.js';

beforeEach(() => {
  useSheets.setState({ open: null, stopping: {} } as never);
  useRunEventStore.setState({ byRun: { r1: [] } });
  useCapabilities.setState({ loaded: true } as never);
  vi.spyOn(client.api, 'getWatch').mockRejectedValue(new Error('404'));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const PROBLEM = 'Fix the double charge on refunds';
const run = (status: string, unitStatus = 'distributed') => makeView({ id: 'r1', status: status as never, problem: PROBLEM, unit_ix: 0, created_at: 1_700_000_000 } as never, [
  makeUnit({ id: 'r1:build', session_id: 'r1', ord: 0, status: unitStatus as never, assigned_cli: 'claude', stage: 'build', description: 'build it' }),
]);
const page = (runs: ReturnType<typeof run>[]) => render(
  <SessionPage sessionId="run:r1" runs={runs} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />,
);

describe('the thread opens on what kicked the run off', () => {
  it('a run started outside a chat shows the operator’s words as their own bubble, first', () => {
    page([run('executing')]);
    const turns = screen.getAllByTestId('session-turn');
    expect(turns[0]).toHaveAttribute('data-who', 'you');
    expect(turns[0]).toHaveTextContent(PROBLEM);
  });
});

describe('a chat whose transcript holds none of your words', () => {
  it('once the transcript has loaded empty, the run’s own words stand in as your bubble', async () => {
    useCapabilities.setState({ loaded: true, runChatId: true } as never);
    vi.spyOn(client.api, 'getChat').mockResolvedValue({ chatId: 'chat-x', seats: ['claude'], scope: null, messages: [] } as never);
    const chatRun = makeView({ id: 'r1', status: 'awaiting_human', problem: 'hey', chat_id: 'chat-x', created_at: 1_700_000_000 } as never, []);
    render(<SessionPage sessionId="chat-x" runs={[chatRun]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    const turn = await screen.findByTestId('session-turn');
    expect(turn).toHaveAttribute('data-who', 'you');
    expect(turn).toHaveTextContent('hey');
  });
});

describe('the thread shows work in progress', () => {
  it('an executing step says it is being worked on, at the thread’s foot', () => {
    page([run('executing')]);
    const line = screen.getByTestId('session-working');
    expect(line).toHaveTextContent('Working on build…');
    expect(line).toHaveAttribute('aria-live', 'polite');
  });
  it('a finished run, or one Needs you holds, shows no working line', () => {
    page([run('completed', 'done')]);
    expect(screen.queryByTestId('session-working')).toBeNull();
    cleanup();
    page(markHeld([run('executing')], new Set(['r1'])));
    expect(screen.queryByTestId('session-working')).toBeNull();
  });
});
