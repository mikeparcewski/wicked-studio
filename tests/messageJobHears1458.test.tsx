import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * studio#1458 (round 2 of studio#1456): the job page's "Message the job" opened the working step's message box, but a
 * step already dispatched on this attempt reads no new message until it is dispatched again; only a power build reads
 * between its turns (wicked-core#1967, src/actor.rs owner check: `last_attempt == attempt && !(power.on &&
 * orchestrator.ord == ord)` is refused). crew's inject route answers that refusal 409 `{ error: <the engine's sentence> }`
 * (crew packages/crew/src/api/routes.ts, `POST /runs/:id/inject`: `reply.code(409).send({ error: message(err) })`), and
 * the sheet said only "The message could not be sent." So: the link only where the step can hear, and the sheet says the
 * engine's reason in the open.
 */

const inject = vi.fn();
vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { ObjectSheet } = await import('../src/components/sheets/ObjectSheet.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useSessionDrafts } = await import('../src/store/sessionDrafts.js');
const { useSheets } = await import('../src/store/sheets.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');
const { api } = await import('../src/api/client.js');
const { ApiError } = await import('../src/api/errors.js');
const { makeUnit, makeView } = await import('./factories.js');
const { state: powerState, at: powerAt } = await import('./powerFixtures.js');
const { useRunEventStore } = await import('../src/store/events.js');
const { usePowerLocal } = await import('../src/hooks/usePower.js');

const CHAT = 'chat-polish';
const T0 = Date.now() - 600_000;
const units = (runId: string) => [
  makeUnit({ id: `${runId}:u1`, session_id: runId, ord: 1, status: 'done', stage: 'build', assigned_cli: 'claude', description: 'build — polish' }),
  makeUnit({ id: `${runId}:u2`, session_id: runId, ord: 2, status: 'distributed', stage: 'review', assigned_cli: 'codex', description: 'review — polish' }),
];
/** A phased job mid-review: step 2 (codex) was dispatched on this attempt, so it is mid-turn. */
const PHASED = makeView({ id: 'r-job', status: 'executing', problem: 'polish the math helpers', unit_ix: 1, chat_id: CHAT, created_at: T0 / 1000 } as never, units('r-job'));
/** A power job whose orchestrator is step 2: it reads a message at its next turn. */
const POWER = makeView({ ...PHASED.session, power: powerState({ orchestrator: { cli: 'codex', ord: 2, turns: 3, inTurn: true, sessionRestarts: 0 } }) } as never, units('r-job'));
const ASK = makeView({ id: 'r-ask', status: 'awaiting_human', problem: 'what changed?', unit_ix: 1, chat_id: CHAT, ask_path: true, ask_turn: true, created_at: (T0 + 300_000) / 1000 } as never, [
  makeUnit({ id: 'r-ask:u1', session_id: 'r-ask', ord: 1, status: 'done', assigned_cli: 'claude', description: 'answer-1 — what changed?' }),
]);

function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

beforeEach(() => {
  useCapabilities.setState({ loaded: true, runChatId: true, walkthroughRoots: false, askPath: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(['r-ask']), replySeq: {}, paByChat: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  useSessionDrafts.setState({ drafts: {}, scroll: {} } as never);
  useSheets.setState({ open: null } as never);
  useRunEventStore.setState({ byRun: {} } as never);
  usePowerLocal.setState({ byRun: {}, answeredByRun: {} });
  setCachedRoster([{ key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true } as never]);
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (path.includes('/considered')) return Promise.resolve(new Response('{}', { status: 404 }));
    if (path.startsWith('/chats/')) return ok({ chatId: CHAT, seats: ['claude'], scope: { kind: 'none' }, messages: [], path: null });
    if (path.endsWith('/events')) return ok({ events: [] });
    return ok({});
  }));
  inject.mockReset();
  vi.spyOn(api, 'injectMessage').mockImplementation((...a: unknown[]) => inject(...a));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('"Message the job" only where the step can hear it', () => {
  it('a phased job\'s step mid-turn reads no new message: no link', async () => {
    render(<SessionPage sessionId={CHAT} runs={[PHASED, ASK]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await screen.findByTestId('session-composer-scope');
    expect(screen.queryByTestId('session-composer-message-job')).toBeNull();
  });

  it('a power build reads it at its next turn: the link opens its step', async () => {
    render(<SessionPage sessionId={CHAT} runs={[POWER, ASK]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    fireEvent.click(await screen.findByTestId('session-composer-message-job'));
    expect(useSheets.getState().open).toMatchObject({ ref: { kind: 'step', runId: 'r-job', ord: 2 } });
  });

  it('a power run whose working step is not the orchestrator\'s (a review mid-turn): no link', async () => {
    const review = makeView({ ...POWER.session, power: powerState({ orchestrator: { cli: 'claude', ord: 1, turns: 3, inTurn: false, sessionRestarts: 0 } }) } as never, units('r-job'));
    render(<SessionPage sessionId={CHAT} runs={[review, ASK]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await screen.findByTestId('session-composer-scope');
    expect(screen.queryByTestId('session-composer-message-job')).toBeNull();
  });
});

describe('round 1 (codex P2, P3): the power state as the page holds it now', () => {
  it('power switched off (the orchestrator\'s ord kept on the record): no link', async () => {
    const off = makeView({ ...POWER.session, power: powerState({ on: false, orchestrator: { cli: 'codex', ord: 2, turns: 3, inTurn: false, sessionRestarts: 0 } }) } as never, units('r-job'));
    render(<SessionPage sessionId={CHAT} runs={[off, ASK]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await screen.findByTestId('session-composer-scope');
    expect(screen.queryByTestId('session-composer-message-job')).toBeNull();
  });

  it('a live powerToggled frame (off) since the run list was read: no link', async () => {
    useRunEventStore.setState({ byRun: { 'r-job': [{ type: 'powerToggled', session: 'r-job', ts: powerAt(30), toggle: { at: powerAt(30), on: false, by: 'you', reason: null, stayPhased: [] } }] } } as never);
    render(<SessionPage sessionId={CHAT} runs={[POWER, ASK]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await screen.findByTestId('session-composer-scope');
    expect(screen.queryByTestId('session-composer-message-job')).toBeNull();
  });

  it('this page\'s own power-off answer (before the run list catches up): no link', async () => {
    const base = powerState({ orchestrator: { cli: 'codex', ord: 2, turns: 3, inTurn: true, sessionRestarts: 0 } });
    usePowerLocal.setState({ byRun: { 'r-job': { ...base, on: false, toggles: [{ at: powerAt(30), on: false, by: 'you', reason: null, stayPhased: [] }], history: [...base.history, { ...base.history.at(-1)!, seq: 9, at: powerAt(30) }] } as never }, answeredByRun: {} });
    render(<SessionPage sessionId={CHAT} runs={[POWER, ASK]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await screen.findByTestId('session-composer-scope');
    expect(screen.queryByTestId('session-composer-message-job')).toBeNull();
  });
});

describe('a refused message says the engine\'s reason in the open', () => {
  /** core#1967's sentence (src/actor.rs, the owner check's refusal), as crew's route sends it: 409 `{ error }`. */
  const SENTENCE = 'step 2 (codex) is already working on this attempt and reads no new message until it is dispatched again, so this one would not reach it; it was not sent. Steer the step at its gate instead (a note, or request changes)';

  it('the alert carries the reason, not only "could not be sent"', async () => {
    inject.mockRejectedValue(new ApiError(409, SENTENCE, { error: SENTENCE }));
    useSheets.setState({ open: { ref: { kind: 'step', runId: 'r-job', ord: 2 }, tab: null, compose: 1 } } as never);
    render(<ObjectSheet runs={[PHASED]} navigate={() => {}} needCount={0} />);
    const input = await screen.findByTestId('sheet-message-input');
    fireEvent.change(input, { target: { value: 'check the README too' } });
    fireEvent.click(screen.getByTestId('sheet-message-send'));
    const alert = await screen.findByTestId('sheet-message-error');
    await waitFor(() => expect(alert.textContent).toContain('reads no new message until it is dispatched again'));
    expect(alert.textContent).toContain('Steer the step at its gate instead');
    // Round 1 (codex P3): the whole line, in studio's own framing of a refusal (the translated sentence, never bare wire).
    expect(alert.textContent).toBe(`The message could not be sent: ${new ApiError(409, SENTENCE, { error: SENTENCE }).message}`);
  });

  it.each([
    ['a server fault (500)', () => new ApiError(500, 'internal error', { error: 'internal error' })],
    ['a refusal with no words (409, empty)', () => new ApiError(409, '  ', {})],
    ['a network failure', () => new TypeError('Failed to fetch')],
  ])('round 1 (codex P3, pi P3): %s keeps the plain line, its words behind the details', async (_name, err) => {
    inject.mockRejectedValue(err());
    useSheets.setState({ open: { ref: { kind: 'step', runId: 'r-job', ord: 2 }, tab: null, compose: 1 } } as never);
    render(<ObjectSheet runs={[PHASED]} navigate={() => {}} needCount={0} />);
    fireEvent.change(await screen.findByTestId('sheet-message-input'), { target: { value: 'check the README too' } });
    fireEvent.click(screen.getByTestId('sheet-message-send'));
    expect((await screen.findByTestId('sheet-message-error')).textContent).toBe('The message could not be sent.');
  });
});
