import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ASK-S3 (DES-ASK-TEAM-CHAT-001 §10): the session sheet's Helpers tab names the ask path's seats by
 * role — the primary helper and how it was picked, the reviewer (or its absence with Sign in), the
 * helpers that answered — from `GET /chats/:id.path`, under the capability only.
 */

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { ObjectSheet } = await import('../src/components/sheets/ObjectSheet.js');
const { useSheets } = await import('../src/store/sheets.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');
const { makeUnit, makeView } = await import('./factories.js');

const RUN = 'r-ask';
const VIEW = makeView({ id: RUN, status: 'awaiting_human', problem: 'why no trim?', unit_ix: 0, chat_id: 'chat-ask' } as never, [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: 'done', assigned_cli: 'claude', description: 'answer-1 — why no trim?' }),
]);
let path: Record<string, unknown> | null = { runId: RUN, pa: 'claude', selection: 'random', reviewer: 'pi', helpers: ['codex', 'pi'], stepId: 'answer-1' };
let chatReads = 0;
let rosterSeats: Array<Record<string, unknown>> = [
  { key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true, signed_in: true },
  { key: 'pi', display_name: 'Pi', binary: 'pi', enabled_for_council: true, signed_in: true },
];

beforeEach(() => {
  chatReads = 0;
  path = { runId: RUN, pa: 'claude', selection: 'random', reviewer: 'pi', helpers: ['codex', 'pi'], stepId: 'answer-1' };
  rosterSeats = [
    { key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true, signed_in: true },
    { key: 'pi', display_name: 'Pi', binary: 'pi', enabled_for_council: true, signed_in: true },
  ];
  useCapabilities.setState({ loaded: true, runChatId: true, walkthroughRoots: false, askPath: true });
  setCachedRoster(rosterSeats as never);
  useSheets.setState({ open: { ref: { kind: 'session', sessionId: 'chat-ask' }, tab: 'helpers' }, pointed: null, stopping: {} });
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const p = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (p.startsWith('/chats/')) { chatReads += 1; return path === null ? Promise.resolve(new Response('{}', { status: 404 })) : ok({ chatId: 'chat-ask', seats: ['claude', 'pi'], scope: { kind: 'none' }, messages: [], path }); }
    if (p === '/roster') return ok({ seats: rosterSeats });
    return ok({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}
const texts = (): string[] => screen.queryAllByTestId('sheet-helper-role').map((e) => e.textContent?.replace(/\s+/g, ' ').trim() ?? '');

describe('the Helpers tab of an ask session', () => {
  it('names the primary helper and its pick, the reviewer (who also helped) and the helpers that answered — by role, each openable — then the run rows', async () => {
    render(<ObjectSheet runs={[VIEW]} navigate={() => {}} needCount={0} />);
    await waitFor(() => expect(screen.queryAllByTestId('sheet-helper-role').length).toBe(3));
    expect(texts()).toStrictEqual([
      'claude primary helper · picked at random',
      'pi reviewer · also answered a question the primary helper asked',
      'codex helped — answered a question the primary helper asked',
    ]);
    // Every named seat opens its helper sheet, the run row's too.
    expect(screen.getAllByTestId('sheet-helper-open').map((b) => b.getAttribute('data-cli'))).toStrictEqual(['claude', 'pi', 'codex', 'claude']);
    expect(chatReads).toBe(1);
  });

  it('no reviewer: with another seat signed in (or unknown) it simply has not attached; with every other seat signed OUT, the F1 words and Sign in (opens the Sign-ins tab)', async () => {
    path = { runId: RUN, pa: 'claude', selection: 'chosen', reviewer: null, helpers: ['claude'], stepId: 'answer-1' };
    render(<ObjectSheet runs={[VIEW]} navigate={() => {}} needCount={0} />);
    await waitFor(() => expect(screen.queryAllByTestId('sheet-helper-role').length).toBe(2));
    expect(texts()[0]).toBe('claude primary helper · your pick · also answered a question the primary helper asked');
    expect(texts()[1]).toBe('No reviewer attached.');
    expect(screen.queryByTestId('sheet-helper-signin')).toBeNull();
    cleanup();
    // Unknown sign-in state on the other seat: still the neutral words (no evidence either way).
    rosterSeats = [{ key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true, signed_in: true }, { key: 'pi', display_name: 'Pi', binary: 'pi', enabled_for_council: true, signed_in: null }];
    setCachedRoster(rosterSeats as never);
    render(<ObjectSheet runs={[VIEW]} navigate={() => {}} needCount={0} />);
    await waitFor(() => expect(screen.queryAllByTestId('sheet-helper-role').length).toBe(2));
    expect(texts()[1]).toBe('No reviewer attached.');
    cleanup();
    rosterSeats = [{ key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true, signed_in: true }, { key: 'pi', display_name: 'Pi', binary: 'pi', enabled_for_council: true, signed_in: false }];
    setCachedRoster(rosterSeats as never);
    render(<ObjectSheet runs={[VIEW]} navigate={() => {}} needCount={0} />);
    await waitFor(() => expect(screen.queryAllByTestId('sheet-helper-role').length).toBe(2));
    expect(texts()[1]).toContain('No reviewer — only claude is signed in.');
    screen.getByTestId('sheet-helper-signin').click();
    await waitFor(() => expect(useSheets.getState().open?.tab).toBe('signins'));
  });

  it('without the capability the tab is the run rows alone and the chat is never read', async () => {
    useCapabilities.setState({ askPath: false });
    render(<ObjectSheet runs={[VIEW]} navigate={() => {}} needCount={0} />);
    await screen.findByTestId('sheet-helpers');
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryAllByTestId('sheet-helper-role')).toHaveLength(0);
    expect(screen.getAllByTestId('sheet-helper-open')).toHaveLength(1);
    expect(chatReads).toBe(0);
  });

  it('a run-only session (the chat read answers 404) is silent: the run rows stay, no role rows, no error', async () => {
    path = null;
    useSheets.setState({ open: { ref: { kind: 'session', sessionId: `run:${RUN}` }, tab: 'helpers' }, pointed: null, stopping: {} });
    render(<ObjectSheet runs={[VIEW]} navigate={() => {}} needCount={0} />);
    await screen.findByTestId('sheet-helpers');
    await waitFor(() => expect(chatReads).toBe(1));
    await new Promise((r) => setTimeout(r, 30)); // the 404 settled
    expect(screen.queryAllByTestId('sheet-helper-role')).toHaveLength(0);
    expect(screen.getAllByTestId('sheet-helper-open').map((b) => b.getAttribute('data-cli'))).toStrictEqual(['claude']);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
