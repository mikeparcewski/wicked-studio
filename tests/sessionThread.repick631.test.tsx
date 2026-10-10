import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamRow } from '../src/api/teamPlan.js';

/**
 * studio#631 (1): the PA failover is said in the thread. Reproduces the rig's first turn: the
 * question is sent, the PA (claude) never answers, the engine re-picks codex. No reply has landed,
 * so nothing re-reads the chat; the re-pick arrives as a LIVE `teamEvent` frame.
 */

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useTeamPlanStore } = await import('../src/store/teamPlan.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useSheets } = await import('../src/store/sheets.js');
const { makeUnit, makeView } = await import('./factories.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');

const T0 = 1_700_000_000_000;
const RUN = 'r-ask-631';
let eid = 10;
function row(type: string, payload: Record<string, unknown>, at: number): TeamRow {
  eid += 1;
  return { event_id: eid, event_type: `wicked.team.${type}`, emitted_at: at, payload: { run_id: RUN, ord: null, attempt: null, by: 'engine', re: null, at, ...payload } };
}
const STARTED = row('path.started', { cli: 'claude', selection: 'chosen', roster: ['claude', 'codex'], request: 'what changed?', workflow: null, plan: true }, T0 + 100);
const CLAIMED = row('step.claimed', { by: 'claude', ord: 1, attempt: 0, step_id: 'answer-1', role: 'creator', kind: 'agent', phase: 'understand', criterion: '', baseline_tree: null, repo: null, code_graph_db: null }, T0 + 200);
// The engine's own shape (wicked-core team/events_fixtures.json): seat ids carry their instance.
const REPICKED = row('path.repicked', { ord: 1, attempt: 0, from: 'claude#1', to: 'codex', reason: 'timed_out', selection: 'random', pick_seq: 1 }, T0 + 600_000);

const ASK_RUN = makeView({ id: RUN, status: 'executing', problem: 'what changed?', unit_ix: 1, chat_id: 'chat-631', created_at: T0 / 1000 } as never, [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: 'running' as never, assigned_cli: 'claude', description: 'answer-1 — what changed?' }),
]);

let chatBody: Record<string, unknown> = {};
let teamRows: TeamRow[] = [];

beforeEach(() => {
  // crew learns the path from `path.started`, which lands AFTER the first chat read: no `path` yet.
  chatBody = { chatId: 'chat-631', seats: ['claude', 'codex'], scope: { kind: 'none' }, messages: [{ at: T0, turnId: 't1', kind: 'user', seats: ['claude'], text: 'what changed?' }] };
  teamRows = [STARTED, CLAIMED];
  useCapabilities.setState({ loaded: true, runChatId: true, walkthroughRoots: false, askPath: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, turnGates: {}, replySeq: {}, paByChat: {}, retiredByChat: {}, answerOrds: {} });
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  useSheets.setState({ open: null, pointed: null, stopping: {} });
  setCachedRoster([{ key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true } as never, { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true } as never]);
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (path.includes('/considered')) return Promise.resolve(new Response('{}', { status: 404 }));
    if (path.startsWith('/chats/')) return ok(chatBody);
    if (path.endsWith('/team')) return ok({ runId: RUN, teamed: true, transport: 'bus', reason: null, planRev: 1, ended: false, units: [], rows: teamRows });
    if (path.endsWith('/events')) return ok({ events: [] });
    if (path === '/catalog') return ok({ entries: [] });
    return ok({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}
const texts = (testid: string): string[] => screen.queryAllByTestId(testid).map((e) => e.textContent?.replace(/\s+/g, ' ').trim() ?? '');

describe('studio#631 — the failover line, live, on a first turn with no reply', () => {
  it('a live path.repicked frame says the takeover in the thread', async () => {
    render(<SessionPage sessionId="chat-631" runs={[ASK_RUN]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await waitFor(() => expect(texts('ask-line').length).toBeGreaterThan(0));
    act(() => { useTeamPlanStore.getState().ingest({ type: 'teamEvent', event: REPICKED } as never); });
    await waitFor(() => expect(texts('ask-line')).toContain('codex takes over — claude#1 stopped answering'));
  });
});
