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
let path: Record<string, unknown> | null = { runId: RUN, pa: 'claude', selection: 'random', reviewer: 'pi', helpers: ['codex'], stepId: 'answer-1' };

beforeEach(() => {
  useCapabilities.setState({ loaded: true, runChatId: true, walkthroughRoots: false, askPath: true });
  setCachedRoster([{ key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true } as never, { key: 'pi', display_name: 'Pi', binary: 'pi', enabled_for_council: true } as never]);
  useSheets.setState({ open: { ref: { kind: 'session', sessionId: 'chat-ask' }, tab: 'helpers' }, pointed: null, stopping: {} });
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const p = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (p.startsWith('/chats/')) return ok({ chatId: 'chat-ask', seats: ['claude', 'pi'], scope: { kind: 'none' }, messages: [], path });
    if (p === '/roster') return ok({ seats: [] });
    return ok({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}
const texts = (): string[] => screen.queryAllByTestId('sheet-helper-role').map((e) => e.textContent?.replace(/\s+/g, ' ').trim() ?? '');

describe('the Helpers tab of an ask session', () => {
  it('names the primary helper and its pick, the reviewer and the helpers that answered — then the run rows', async () => {
    render(<ObjectSheet runs={[VIEW]} navigate={() => {}} needCount={0} />);
    await waitFor(() => expect(screen.queryAllByTestId('sheet-helper-role').length).toBe(3));
    expect(texts()).toStrictEqual([
      'claude answers · picked at random',
      'pi reviews — watches the answers, raises findings as quiet lines',
      'codex helped — answered a question the primary helper asked',
    ]);
    expect(screen.getAllByTestId('sheet-helper-open').map((b) => b.getAttribute('data-cli'))).toStrictEqual(['claude']);
  });

  it('no reviewer (one seat): the row says so and Sign in opens the Sign-ins tab', async () => {
    path = { runId: RUN, pa: 'claude', selection: 'chosen', reviewer: null, helpers: [], stepId: 'answer-1' };
    render(<ObjectSheet runs={[VIEW]} navigate={() => {}} needCount={0} />);
    await waitFor(() => expect(screen.queryAllByTestId('sheet-helper-role').length).toBe(2));
    expect(texts()[0]).toBe('claude answers · your pick');
    expect(texts()[1]).toContain('No reviewer — only claude is signed in.');
    screen.getByTestId('sheet-helper-signin').click();
    await waitFor(() => expect(useSheets.getState().open?.tab).toBe('signins'));
  });

  it('without the capability the tab is the run rows alone', async () => {
    useCapabilities.setState({ askPath: false });
    render(<ObjectSheet runs={[VIEW]} navigate={() => {}} needCount={0} />);
    await screen.findByTestId('sheet-helpers');
    expect(screen.queryAllByTestId('sheet-helper-role')).toHaveLength(0);
    expect(screen.getAllByTestId('sheet-helper-open')).toHaveLength(1);
  });
});
