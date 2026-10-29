import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamRow } from '../src/api/teamPlan.js';

/**
 * studio#816 (E2E chat ae8ffa61): crew drops a chat's transcript when the chat closes and at boot,
 * so a CLOSED ask's thread read `messages: []` and lost the answer the run still holds. The thread
 * reads each done answer step's stored output and shows it as the reply it was — at its step's
 * completion, with its findings under it (codex r1 on #818: by its unit, never by position).
 */

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useAskAnswers } = await import('../src/hooks/useAskAnswers.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useTeamPlanStore } = await import('../src/store/teamPlan.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useSheets } = await import('../src/store/sheets.js');
const { makeUnit, makeView } = await import('./factories.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');

const T0 = 1_700_000_000_000;
const RUN = 'r-closed';
let eid = 10;
function row(type: string, payload: Record<string, unknown>, at: number): TeamRow {
  eid += 1;
  return { event_id: eid, event_type: `wicked.team.${type}`, emitted_at: at, payload: { run_id: RUN, ord: null, attempt: null, by: 'engine', re: null, at, ...payload } };
}
const ROWS = [
  row('path.started', { cli: 'pi', selection: 'random', roster: ['pi'], request: 'what does sum() get wrong?', workflow: null, plan: true }, T0 + 100),
  row('step.claimed', { by: 'pi', ord: 1, attempt: 0, step_id: 'answer-1', role: 'creator', kind: 'agent', phase: 'understand', criterion: '', baseline_tree: null, repo: null, code_graph_db: null }, T0 + 200),
  row('step.completed', { by: 'pi', ord: 1, attempt: 0, step_id: 'answer-1', status: 'ok', tree: null, output_bytes: 40, output_ref: `unit:${RUN}:1:0`, answers_presented: true }, T0 + 900),
  row('finding.raised', { by: 'codex', ord: 1, attempt: 0, raise_seq: 1, finding_id: 'f-1', member_id: 'm1', line_key: null, anchor: null, anchor_source: 'none', severity: 'medium', target: 'output', path: 'answer-1', line: 1, evidence: 'sum.js:3', claim: 'the first answer cites the wrong line', suggestion: 'cite line 3', tree: '', in_diff: false, corroborated_by: [] }, T0 + 1200),
  row('step.claimed', { by: 'pi', ord: 2, attempt: 0, step_id: 'answer-2', role: 'creator', kind: 'agent', phase: 'understand', criterion: '', baseline_tree: null, repo: null, code_graph_db: null }, T0 + 1500),
  row('step.completed', { by: 'pi', ord: 2, attempt: 0, step_id: 'answer-2', status: 'ok', tree: null, output_bytes: 40, output_ref: `unit:${RUN}:2:0`, answers_presented: true }, T0 + 2000),
];

const CLOSED_RUN = makeView({ id: RUN, status: 'cancelled', problem: 'what does sum() get wrong?', unit_ix: 2, chat_id: 'chat-closed', created_at: T0 / 1000 } as never, [
  makeUnit({ id: `${RUN}:answer-1`, session_id: RUN, ord: 1, status: 'done', assigned_cli: 'pi', description: 'answer-1 — what does sum() get wrong?' }),
  makeUnit({ id: `${RUN}:answer-2`, session_id: RUN, ord: 2, status: 'done', assigned_cli: 'pi', description: 'answer-2 — and the fix?' }),
]);

let outputs: Record<string, string | null> = {};
let rows: TeamRow[] = ROWS;
let outputReads: string[] = [];

beforeEach(() => {
  outputs = { 'answer-1': 'SCOPE answer\nThe loop starts at i = 1.', 'answer-2': 'Start it at i = 0.\nPLAN+ {"steps":[]}' };
  outputReads = [];
  rows = ROWS;
  useCapabilities.setState({ loaded: true, runChatId: true, walkthroughRoots: false, askPath: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, chatClosed: {}, turnGates: {}, replySeq: {}, paByChat: {}, retiredByChat: {}, answerOrds: {} });
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  useSheets.setState({ open: null, pointed: null, stopping: {} });
  setCachedRoster([{ key: 'pi', display_name: 'Pi CLI', binary: 'pi', enabled_for_council: true } as never]);
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (path.includes('/considered')) return Promise.resolve(new Response('{}', { status: 404 }));
    // crew's answer for a chat it no longer holds: no scope, no messages.
    if (path.startsWith('/chats/')) return ok({ chatId: 'chat-closed', seats: [], scope: null, messages: [] });
    const out = /\/units\/([^/]+)\/output$/.exec(path);
    if (out !== null) { outputReads.push(out[1]!); return ok({ output: outputs[out[1]!] ?? null }); }
    if (path.endsWith('/team')) return ok({ runId: RUN, teamed: true, transport: 'bus', reason: null, planRev: 2, ended: true, units: [], rows });
    if (path.endsWith('/events')) return ok({ events: [] });
    if (path === '/catalog') return ok({ entries: [] });
    return ok({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

const order = (): string[] => [...document.querySelectorAll('[data-testid="session-turn"], [data-testid="ask-line"]')]
  .map((el) => el.getAttribute('data-testid') === 'ask-line' ? `line:${el.getAttribute('data-kind')}` : `turn:${el.getAttribute('data-who')}:${el.textContent?.replace(/\s+/g, ' ').trim().slice(-24)}`);

describe('studio#816 — a closed ask keeps its answers', () => {
  it('shows each answer from its run, control lines dropped, the finding under ITS reply', async () => {
    render(<SessionPage sessionId="chat-closed" runs={[CLOSED_RUN]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await screen.findByText(/Start it at i = 0\./);
    await screen.findByText(/The loop starts at i = 1\./);
    expect(document.body.textContent).not.toMatch(/SCOPE answer|PLAN\+/);
    await waitFor(() => expect(order().some((o) => o === 'line:finding')).toBe(true));
    const o = order();
    const first = o.findIndex((x) => x.includes('starts at i = 1.'));
    const second = o.findIndex((x) => x.includes('Start it at i = 0.'));
    const finding = o.indexOf('line:finding');
    expect(first).toBeGreaterThan(-1);
    expect(finding).toBe(first + 1);
    expect(second).toBeGreaterThan(finding);
  });

  it('an answer whose output is gone is not shown, and the next one does not take its finding (codex r1 on #818)', async () => {
    outputs['answer-1'] = null;
    render(<SessionPage sessionId="chat-closed" runs={[CLOSED_RUN]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await screen.findByText(/Start it at i = 0\./);
    await waitFor(() => expect(order().some((o) => o === 'line:finding')).toBe(true));
    const o = order();
    // The finding about answer 1 stays at its own time, BEFORE answer 2 — never moved under it.
    expect(o.indexOf('line:finding')).toBeLessThan(o.findIndex((x) => x.includes('Start it at i = 0.')));
  });
});

describe('message timestamps on a closed ask (xreview on studio#929)', () => {
  const helperTimes = (): (string | null)[] => [...document.querySelectorAll('[data-testid="session-turn"][data-who="helper"]')]
    .map((t) => t.querySelector('[data-testid="turn-who-at"]')?.textContent ?? null);
  const hhmm = (ms: number): string => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  it('an answer placed at its step\'s completion row says that time', async () => {
    render(<SessionPage sessionId="chat-closed" runs={[CLOSED_RUN]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await screen.findByText(/Start it at i = 0\./);
    await waitFor(() => expect(helperTimes()).toHaveLength(2));
    // T0 is another day: the day leads the time ("14 Nov 17:13").
    const got = helperTimes();
    expect(got[0]).toMatch(new RegExp(` · \\d+ \\w{3} ${hhmm(T0 + 900)}$`));
    expect(got[1]).toMatch(new RegExp(` · \\d+ \\w{3} ${hhmm(T0 + 2000)}$`));
  });

  it('an answer placed only by step order (no completion row) shows no time, never its ordering key', async () => {
    rows = ROWS.filter((r) => r.event_type !== 'wicked.team.step.completed');
    render(<SessionPage sessionId="chat-closed" runs={[CLOSED_RUN]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await screen.findByText(/Start it at i = 0\./);
    await waitFor(() => expect(helperTimes()).toHaveLength(2));
    expect(helperTimes()).toEqual([null, null]);
  });
});

describe('useAskAnswers — a re-run step is read again (codex r1 on #818)', () => {
  it('a step that leaves done and finishes again shows its new answer', async () => {
    outputs['answer-1'] = 'Original answer.';
    const one = (status: 'done' | 'distributed') => [makeView({ id: RUN, status: 'cancelled' } as never, [
      makeUnit({ id: `${RUN}:answer-1`, session_id: RUN, ord: 1, status, assigned_cli: 'pi' }),
    ])];
    const { result, rerender } = renderHook(({ views }) => useAskAnswers(views, true), { initialProps: { views: one('done') } });
    await waitFor(() => expect(result.current.map((a) => a.text)).toEqual(['Original answer.']));
    rerender({ views: one('distributed') });
    await waitFor(() => expect(result.current).toEqual([]));
    outputs['answer-1'] = 'Revised answer.';
    await act(async () => { rerender({ views: one('done') }); });
    await waitFor(() => expect(result.current.map((a) => a.text)).toEqual(['Revised answer.']));
    expect(outputReads).toEqual(['answer-1', 'answer-1']);
  });
});
