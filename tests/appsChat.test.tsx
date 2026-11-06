import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppDetail, AppSpec, CoreEvent, SessionView } from '../src/api/types.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { resetTurnHoldReads } from '../src/editors/apps/turnHold.js';
import { AppHostView } from '../src/components/editorHost/AppHostView.js';
import { rulesHoldHeadline } from '../src/board/gateHeadline.js';
import { AppChat, aboutComponent, appComposerKey } from '../src/components/apps/AppChat.js';
import { AppsPage } from '../src/components/apps/AppsPage.js';
import { busyText, changeLine, endedLine, slugFrom, suggestionsFor, turnsOf } from '../src/editors/apps/appTurns.js';
import { TileScheduler, tileEveryMs, tileKpis, type QueryOutcome } from '../src/editors/apps/liveTiles.js';
import { SAMPLE_APPS } from '../src/editors/apps/samples.js';
import { recordingPort, resetSnapshots, snapshotAt, snapshotPort } from '../src/editors/apps/previewSnapshots.js';
import { useComposerChips } from '../src/store/composerChips.js';
import { drainForSend } from '../src/editors/apps/appSession.js';

/**
 * DES-APPS-001 K5 (operator 2026-11-04: "I should be driving the changes mostly via chat"; "dashboard should show real
 * time information"): the app's chat is crew's turn log; a message is one turn with the selected components' ids; the
 * dashboard's cards read their KPI numbers live, only while seen, at most 3 queries at once, and say why when they can't.
 */

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; localStorage.clear(); useComposerChips.setState({ byComposer: {} }); });

const spec = (): AppSpec => structuredClone(SAMPLE_APPS['escalations']!.spec);
const turn = (over: Record<string, unknown>) => ({
  runId: 'apps-desk-000000000001', at: Date.now() - 60_000, actor: 'local', message: 'add a chart of breaches by priority', about: [], base: 2,
  state: 'landed', endedAt: Date.now() - 30_000, version: 3, change: 'Added 1 chart and 1 query', summary: 'Added chart `by_priority`', builder: 'claude', reviewer: 'codex', code: null, reason: null, ...over,
});
const detail = (over: Record<string, unknown> = {}): AppDetail => ({
  slug: 'desk', name: 'Desk', projectId: 'p', repoId: 'desk', createdAt: 1, head: { version: 3, tree: 't', receipt: 'reviewed' }, turn: null,
  spec: spec(), lock: { schema: 'wicked.apps.lock/v1', sources: {}, queries: {}, actions: {}, uploads: {} } as never, queryText: {},
  versions: [], history: { states: [1, 2, 3], pointer: 2, canUndo: true, canRedo: false }, turns: [turn({})], ...over,
}) as unknown as AppDetail;

function mockFetch(handler: (path: string, init?: RequestInit) => { status?: number; body: unknown } | null): { calls: Array<{ path: string; body: unknown }> } {
  const calls: Array<{ path: string; body: unknown }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, 'http://studio.local').pathname.replace(/^\/api\/v1/u, '');
    calls.push({ path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    const r = handler(path, init);
    if (r === null) return new Response(JSON.stringify({ error: 'no route' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch);
  return { calls };
}

describe('the app chat: crew\'s turn log, in words', () => {
  it('reads crew\'s records defensively and says each outcome in crew\'s words', () => {
    const d = detail({ turns: [turn({}), { runId: 1 }, turn({ runId: 'r2', state: 'refused', code: 'check_failed', reason: 'crew\'s check refused the change: pg_sleep is not allowed. Nothing landed.', version: null }), turn({ runId: 'r3', state: 'bogus' })] });
    const t = turnsOf(d);
    expect(t.map((x) => x.runId)).toStrictEqual(['apps-desk-000000000001', 'r2']);
    expect(changeLine(t[0]!)).toBe('v3 · Added 1 chart and 1 query · reviewed by Codex');
    expect(endedLine(t[1]!)).toBe('Nothing landed: crew\'s check refused the change: pg_sleep is not allowed');
    expect(turnsOf(detail({ turns: undefined }))).toStrictEqual([]);
    // An old record in the engine's words reads in crew's own (the stored record is not rewritten).
    const old = turnsOf(detail({ turns: [
      turn({ runId: 'r9', state: 'failed', code: 'step_failed', version: null, reason: 'The build did not pass: executes-code phase reported done but left no change in the worktree (done is re-derived from the diff, never asserted)' }),
      turn({ runId: 'r8', summary: 'Counts: derived 3 / submitted 3 / failed 0. Memories proposed 0: nothing bit.' }),
    ] }));
    expect(old[0]).toMatchObject({ code: 'no_change', reason: 'The builder made no change it could hand on. Nothing landed.' });
    expect(endedLine(old[0]!)).toBe('This turn could not finish, so nothing landed: The builder made no change it could hand on');
    expect(old[1]!.summary).toBeNull();
  });

  it('busy text names the step and its seat; a new app\'s slug comes from the message\'s own words', () => {
    const view = { session: { id: 'r', status: 'executing' }, units: [{ id: 'r:build', ord: 1, status: 'done', assigned_cli: 'claude' }, { id: 'r:check', ord: 2, status: 'done' }, { id: 'r:review', ord: 3, status: 'distributed', assigned_cli: 'codex' }] } as unknown as SessionView;
    expect(busyText(view)).toMatchObject({ line: 'Reviewing it · Codex…', step: 'review', ord: 3 });
    expect(busyText(null).line).toBe('Starting the turn…');
    expect(slugFrom('a dashboard of escalations by region from support-pg')).toBe('escalations-region-support');
    expect(slugFrom('!!!')).toBe('new-app');
    expect(suggestionsFor(spec(), ['support-pg', 'finance']).length).toBeGreaterThan(0);
    expect(suggestionsFor({ ...spec(), pages: [{ id: 'p', title: 'P', components: [] }], queries: [] }, ['support-pg'])[0]).toBe('Show the main numbers from support-pg as KPIs');
  });

  it('a message is ONE turn on the head, about the selected components\' ids; a refused send keeps the words', async () => {
    const { calls } = mockFetch((path) => {
      if (path === '/mcp/servers') return { body: { servers: [{ name: 'support-pg', kind: 'sql' }], discovered: [] } };
      if (path === '/apps/desk/turns') return calls.filter((c) => c.path === '/apps/desk/turns').length === 1 ? { status: 202, body: { runId: 'apps-desk-000000000002', turn: {} } } : { status: 409, body: { code: 'turn_in_flight', error: 'a turn (run x) is changing desk' } };
      return null;
    });
    const onSent = vi.fn();
    render(<AppChat slug="desk" detail={detail()} runs={[]} framed={false} navigate={vi.fn()} onSent={onSent} onUndo={vi.fn()} />);
    expect(screen.getByTestId('app-chat-change').textContent).toBe('v3 · Added 1 chart and 1 query · reviewed by Codex');
    act(() => aboutComponent('desk', 'open_kpi', 'KPI “Open” (Overview, v3)'));
    const box = screen.getByTestId('app-composer-input') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'make this a line chart' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(calls.find((c) => c.path === '/apps/desk/turns')!.body).toStrictEqual({ base: 3, message: 'make this a line chart', about: ['open_kpi'] });
    // A message crew took leaves the box (xreview r2: it stayed, to be sent twice).
    await waitFor(() => expect((screen.getByTestId('app-composer-input') as HTMLTextAreaElement).value).toBe(''));
    fireEvent.change(box, { target: { value: 'and another' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('app-chat-note').textContent).toMatch(/already running/));
    expect((screen.getByTestId('app-composer-input') as HTMLTextAreaElement).value).toBe('and another');
    expect(useComposerChips.getState().byComposer[appComposerKey('desk')] ?? []).toStrictEqual([]);
  });

  it('a message crew does not take keeps its words AND its components; a framed studio sends nothing and undoes nothing', async () => {
    const { calls } = mockFetch((path) => (path === '/apps/desk/turns' ? { status: 409, body: { code: 'stale_base', error: 'made on v2' } } : path === '/mcp/servers' ? { body: { servers: [] } } : null));
    const { unmount } = render(<AppChat slug="desk" detail={detail()} runs={[]} framed={false} navigate={vi.fn()} onSent={vi.fn()} onUndo={vi.fn()} />);
    act(() => aboutComponent('desk', 'open_kpi', 'KPI “Open”'));
    const box = screen.getByTestId('app-composer-input') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'make it red' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('app-chat-note').textContent).toMatch(/changed meanwhile/));
    expect((screen.getByTestId('app-composer-input') as HTMLTextAreaElement).value).toBe('make it red');
    expect(screen.getAllByTestId('app-composer-chip').map((c) => c.textContent)).toStrictEqual(['about: KPI “Open”']);
    unmount();
    // Framed: the thread is shown, nothing can be sent or undone, and no question is answered from here.
    const before = calls.length;
    render(<AppChat slug="desk" detail={detail()} runs={[]} framed navigate={vi.fn()} onSent={vi.fn()} onUndo={vi.fn()} />);
    expect(screen.getByTestId('app-composer-readonly').textContent).toMatch(/inside another page/);
    expect((screen.getByTestId('app-composer-send') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByTestId('app-composer-input'), { key: 'Enter' });
    expect(screen.queryByTestId('app-chat-undo')).toBeNull();
    expect(calls.slice(before).filter((c) => c.path.endsWith('/turns'))).toHaveLength(0);
  });

  it('a refusal that lands after the next message was typed keeps the refused one whole, to put back', async () => {
    let release: (() => void) | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/turns')) {
        await new Promise<void>((r) => { release = r; });
        return new Response(JSON.stringify({ code: 'turn_in_flight', error: 'busy' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ servers: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch);
    render(<AppChat slug="desk" detail={detail()} runs={[]} framed={false} navigate={vi.fn()} onSent={vi.fn()} onUndo={vi.fn()} />);
    const box = screen.getByTestId('app-composer-input') as HTMLTextAreaElement;
    const long = `first ${'x'.repeat(300)}`;
    fireEvent.change(box, { target: { value: long } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(release).not.toBeNull());
    fireEvent.change(box, { target: { value: 'second' } });
    act(() => release!());
    await waitFor(() => expect(screen.getByTestId('app-chat-putback')).toBeTruthy());
    expect((screen.getByTestId('app-composer-input') as HTMLTextAreaElement).value).toBe('second');
    expect(screen.getByTestId('app-chat-kept').textContent).toMatch(/^Kept, not sent: “first x/u);
    fireEvent.click(screen.getByTestId('app-chat-putback'));
    expect((screen.getByTestId('app-composer-input') as HTMLTextAreaElement).value).toBe(long);
    // The draft it replaced is kept in its place, to put back in turn.
    expect(screen.getByTestId('app-chat-kept').textContent).toMatch(/second/u);
  });

  it('framed, a running turn shows its steps but no live controls; a turn\'s Undo waits while an edit saves', () => {
    mockFetch(() => null);
    const runs = [{ session: { id: 'apps-desk-000000000009', status: 'executing' }, units: [{ id: 'apps-desk-000000000009:build', ord: 1, status: 'distributed', assigned_cli: 'claude' }] }] as unknown as SessionView[];
    const running = detail({ turn: { runId: 'apps-desk-000000000009', startedAt: 1, base: 3, actor: 'local' }, turns: [turn({ runId: 'apps-desk-000000000009', state: 'running', endedAt: null, version: null })] });
    const { unmount } = render(<AppChat slug="desk" detail={running} runs={runs} framed navigate={vi.fn()} onSent={vi.fn()} onUndo={vi.fn()} />);
    expect(screen.getByTestId('app-chat-busy')).toBeTruthy();
    expect(document.querySelector('[data-testid="live-activity"], [data-testid="inflight-check"]')).toBeNull();
    unmount();
    render(<AppChat slug="desk" detail={detail()} runs={[]} framed={false} pending={1} navigate={vi.fn()} onSent={vi.fn()} onUndo={vi.fn()} />);
    expect(screen.queryByTestId('app-chat-undo')).toBeNull();
  });

  it('Send drains every pending edit, those made while one landed included; a failed save or a stream of edits waits', async () => {
    // A session whose first save lands one edit while another arrives (it stays pending), then lands that one too.
    const fake = { pending: 2, head: 3, saves: 0, async flush() { this.saves += 1; this.head += 1; this.pending -= 1; return true; } };
    expect(await drainForSend(fake)).toBe(5);
    expect(fake.saves).toBe(2);
    expect(await drainForSend({ pending: 1, head: 3, flush: async () => false })).toBeNull();
    const busy = { pending: 1, head: 3, flush: async () => true };
    expect(await drainForSend(busy)).toBeNull();
    expect(await drainForSend({ pending: 0, head: 7, flush: async () => true })).toBe(7);
  });

  it('an edit burst the person just made lands before the message, which is sent on the head it made', async () => {
    const { calls } = mockFetch((path) => (path === '/apps/desk/turns' ? { status: 202, body: { runId: 'r', turn: {} } } : path === '/mcp/servers' ? { body: { servers: [] } } : null));
    const prepareSend = vi.fn(async () => 4);
    render(<AppChat slug="desk" detail={detail()} runs={[]} framed={false} navigate={vi.fn()} onSent={vi.fn()} onUndo={vi.fn()} prepareSend={prepareSend} />);
    const box = screen.getByTestId('app-composer-input') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'go' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(calls.some((c) => c.path === '/apps/desk/turns')).toBe(true));
    expect(prepareSend).toHaveBeenCalledTimes(1);
    expect(calls.find((c) => c.path === '/apps/desk/turns')!.body).toMatchObject({ base: 4 });
  });

  it('a running turn shows its steps and is read-only for the next message; refused shows the code and the reason', () => {
    mockFetch(() => null);
    const runs = [{ session: { id: 'apps-desk-000000000009', status: 'executing' }, units: [{ id: 'apps-desk-000000000009:build', ord: 1, status: 'distributed', assigned_cli: 'claude' }] }] as unknown as SessionView[];
    const d = detail({ turn: { runId: 'apps-desk-000000000009', startedAt: 1, base: 3, actor: 'local' }, turns: [turn({ runId: 'r0', state: 'refused', code: 'review_refused', reason: 'The reviewer refused the change: reads a column nobody asked for. Nothing landed.', version: null }), turn({ runId: 'apps-desk-000000000009', state: 'running', endedAt: null, version: null })] });
    render(<AppChat slug="desk" detail={d} runs={runs} framed={false} navigate={vi.fn()} onSent={vi.fn()} onUndo={vi.fn()} />);
    expect(screen.getByTestId('app-chat-busy').textContent).toMatch(/Building the change · Claude Code…/);
    expect(screen.getAllByTestId('app-chat-step').map((s) => s.getAttribute('data-state'))).toStrictEqual(['now', 'pending', 'pending']);
    expect(screen.getByTestId('app-chat-code').textContent).toBe('review_refused');
    expect(screen.getByTestId('app-chat-reason').textContent).toBe('Nothing landed: The reviewer refused the change: reads a column nobody asked for');
    expect(screen.queryByTestId('app-chat-undo')).toBeNull();
  });
});

describe('the app chat: a review held on steering rules is answered here (F22)', () => {
  const RUN = 'apps-desk-00000000000a';
  const HOLD = '1 steering rule(s) need you: learn-accessible unchecked (the judge did not answer for it, in its batch or asked alone).';
  const units = [
    { id: `${RUN}:build`, session_id: RUN, ord: 1, status: 'done', assigned_cli: 'claude', role: 'creator' },
    { id: `${RUN}:check`, session_id: RUN, ord: 2, status: 'done', assigned_cli: null },
    { id: `${RUN}:review`, session_id: RUN, ord: 3, status: 'rejected', assigned_cli: 'codex', role: 'evaluator', denial_reason: HOLD, denial: { phase: 'unit-3', source: 'rules_unchecked', reason: HOLD } },
  ];
  const runs = [{ session: { id: RUN, status: 'awaiting_human', unit_ix: 2, clis: ['claude', 'codex', 'pi'] }, units }] as unknown as SessionView[];
  const bareRuns = (denial?: unknown) => [{ ...runs[0]!, units: units.map((u) => (u.ord === 3 ? { ...u, denial } : u)) }] as unknown as SessionView[];
  const gate: OpenGate = { runId: RUN, ord: 3, prompt: `Unit 3's steering rules are UNCHECKED or waived by your instruction — ${HOLD} The work was not rejected.`, gateKind: 'escalation', lifecycle: 'open', receivedAt: 1 };
  const rules = [{ ruleId: 'learn-small-prs', status: 'kept', how: 'judge', reason: 'apps.json', ruleKey: 'k1' }, { ruleId: 'learn-accessible', status: 'unchecked', how: 'none', reason: 'the judge did not answer', ruleKey: 'k2' }];
  const receipt = { mode: 'full', required: ['distinct_evaluator'], ran: ['distinct_evaluator', 'judge', 'rule_check'], skipped: [], creator: 'claude', evaluator: 'codex', judge: 'pi', tree: 't', attempt: 0, rules };
  const seq = (list: Array<Record<string, unknown>>): CoreEvent[] => list.map((e, i) => ({ session: RUN, seq: i + 1, ts: i + 1, ...e })) as unknown as CoreEvent[];
  const holdTrail = seq([
    { type: 'unitDispatched', ord: 3, attempt: 0 },
    { type: 'gateEvaluated', ord: 3, denial: { source: 'rules_unchecked', reason: HOLD, claimId: null, ruleIds: ['learn-accessible'], deniedTool: null, phase: 'unit-3' }, assurance: receipt },
    { type: 'gateEscalated', ord: 3, attempt: 0, condition: 'rules_unchecked', denialSource: 'rules_unchecked', verdictSummary: HOLD },
  ]);
  /** Attempt 0 held on rules, re-checked, then attempt 1 dispatched and found the rule BROKEN. */
  const brokenTrail = seq([...holdTrail.map((e) => e as unknown as Record<string, unknown>), { type: 'gateDecided', ord: 3, allow: true }, { type: 'unitDispatched', ord: 3, attempt: 1 },
    { type: 'gateEvaluated', ord: 3, denial: { source: 'rule_check', reason: 'broken' }, assurance: { ...receipt, attempt: 1, rules: [{ ...rules[1]!, status: 'broken', how: 'judge' }] } },
    { type: 'gateEscalated', ord: 3, attempt: 1, condition: 'rule_broken', denialSource: 'rule_check', verdictSummary: 'broken' }]);
  /** The daemon's recorded trail for the run (what `GET /runs/:id/events` answers). */
  const serve = (trail: CoreEvent[]) => mockFetch((path) => (path === `/runs/${RUN}/events` ? { body: { runId: RUN, total: trail.length, returned: trail.length, events: trail } } : null));
  const running = () => detail({ turn: { runId: RUN, startedAt: 1, base: 3, actor: 'local' }, turns: [turn({ runId: RUN, state: 'running', endedAt: null, version: null })] });
  const show = (r: SessionView[], framed = false) => render(<AppChat slug="desk" detail={running()} runs={r} framed={framed} navigate={vi.fn()} onSent={vi.fn()} onUndo={vi.fn()} />);
  const steps = () => screen.getAllByTestId('app-chat-step').map((s) => s.getAttribute('data-state'));
  afterEach(() => { useGateStore.setState({ gates: {} }); useRunEventStore.setState({ byRun: {} }); resetTurnHoldReads(); });

  it('reads the run\'s trail, then shows the run page\'s gate with Re-check the rules and Confirm or skip; the held review reads waiting, not failed', async () => {
    const { calls } = serve(holdTrail);
    useGateStore.setState({ gates: { [RUN]: gate } });
    show(runs);
    expect(steps()).toStrictEqual(['done', 'done', 'now']);
    await waitFor(() => expect(screen.getByTestId('app-chat-gate').textContent).toContain('Re-check the rules'));
    expect(screen.getByTestId('app-chat-gate').textContent).toContain('Confirm or skip learn-accessible');
    expect(calls.filter((c) => c.path === `/runs/${RUN}/events`)).toHaveLength(1);
    // The busy line and the gate's heading say it is a call on a rule, in plain words (not "asks a question", not
    // "The step was escalated").
    expect(screen.getByTestId('app-chat-busy').querySelector('.wk-appchat-busyline')!.textContent).toBe('Waiting on you: a rule needs your call');
    expect(screen.getByTestId('session-gate-question').textContent).toBe('The rule learn-accessible needs your call before this step can go on');
  });

  it('the rules-hold headline names the rule, or counts them', () => {
    const r = (ruleId: string, status: string) => ({ ruleId, status, how: 'none', reason: '', cite: null }) as never;
    expect(rulesHoldHeadline([r('a', 'kept'), r('b', 'unchecked')])).toBe('The rule b needs your call before this step can go on');
    expect(rulesHoldHeadline([r('b', 'unchecked'), r('c', 'waived'), r('d', 'broken')])).toBe('2 steering rules need your call before this step can go on');
    expect(rulesHoldHeadline([])).toBe('A steering rule needs your call before this step can go on');
  });

  it('the app page\'s "Needs you" strip counts the hold the chat shows (one reading, one trail read)', async () => {
    const app = { ...running(), slug: 'desk' };
    const { calls } = mockFetch((path) => (path === `/runs/${RUN}/events` ? { body: { events: holdTrail } }
      : path === '/apps/desk' ? { body: { app } } : path === '/editors' ? { body: { editors: [] } } : path === '/mcp/servers' ? { body: { servers: [], discovered: [] } } : null));
    useGateStore.setState({ gates: { [RUN]: gate } });
    const caps = { apps: { query: true, actions: true, turns: true, publish: false, uploads: false, sourceCheck: true } } as never;
    render(<AppHostView editor="wicked-apps" version="0.13.0" sha={'a'.repeat(64)} app="desk" sample={null} caps={caps} runs={runs} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('apps-dock-count').textContent).toBe('1 waiting'), { timeout: 4000 });
    expect(screen.getByTestId('apps-dock-rules-hold').textContent).toBe('A rule needs your call: answer it in the chat.');
    await waitFor(() => expect(screen.getByTestId('app-chat-gate')).toBeTruthy());
    expect(calls.filter((c) => c.path === `/runs/${RUN}/events`)).toHaveLength(1);
  });

  it('a live buffer that missed the hold (a reconnect) is completed from the trail; a hold the log alone names (no unit denial) reads the same', async () => {
    serve(holdTrail);
    useRunEventStore.setState({ byRun: { [RUN]: [holdTrail[0]!] } });
    useGateStore.setState({ gates: { [RUN]: gate } });
    const { unmount } = show(bareRuns(undefined));
    await waitFor(() => expect(screen.getByTestId('app-chat-gate').textContent).toContain('Confirm or skip learn-accessible'));
    expect(steps()).toStrictEqual(['done', 'done', 'now']);
    unmount();
  });

  it('a stale hold on the unit record is voided by the trail: re-dispatched and BROKEN, no answers here and the review reads failed', async () => {
    const { calls } = serve(brokenTrail);
    // The live buffer still holds attempt 0's hold; the polled record still names it too.
    useRunEventStore.setState({ byRun: { [RUN]: holdTrail } });
    useGateStore.setState({ gates: { [RUN]: { ...gate, receivedAt: 2 } } });
    show(runs);
    await waitFor(() => expect(calls.some((c) => c.path === `/runs/${RUN}/events`)).toBe(true));
    await waitFor(() => expect(steps()).toStrictEqual(['done', 'done', 'failed']));
    expect(screen.queryByTestId('app-chat-gate')).toBeNull();
  });

  it('a refusal gate, or one whose kind is unknown (an older late join), is not answered here', async () => {
    const refused = seq([{ type: 'unitDispatched', ord: 3, attempt: 0 }, { type: 'gateEvaluated', ord: 3, denial: { source: 'evaluator_verdict', reason: 'FAIL' } }, { type: 'gateEscalated', ord: 3, attempt: 0, condition: 'verdict_not_pass', denialSource: 'evaluator_verdict', verdictSummary: 'FAIL' }]);
    const { calls } = serve(refused);
    useGateStore.setState({ gates: { [RUN]: gate } });
    const { unmount } = show(bareRuns({ source: 'evaluator_verdict', reason: 'FAIL' }));
    await waitFor(() => expect(calls.some((c) => c.path === `/runs/${RUN}/events`)).toBe(true));
    expect(screen.queryByTestId('app-chat-gate')).toBeNull();
    expect(steps()).toStrictEqual(['done', 'done', 'failed']);
    unmount();
    useRunEventStore.setState({ byRun: {} });
    useGateStore.setState({ gates: { [RUN]: { ...gate, gateKind: undefined, receivedAt: 3 } as unknown as OpenGate } });
    const second = show(bareRuns({ source: 'rule_check', reason: 'broken' }));
    await waitFor(() => expect(calls.filter((c) => c.path === `/runs/${RUN}/events`)).toHaveLength(2));
    expect(screen.queryByTestId('app-chat-gate')).toBeNull();
    second.unmount();
    // A kind this chat does not know, over a stale buffer that once held (the trail says attempt 1 broke it): no answers
    // here, before or after the read (codex r5).
    calls.length = 0;
    serve(brokenTrail);
    useRunEventStore.setState({ byRun: { [RUN]: holdTrail } });
    useGateStore.setState({ gates: { [RUN]: { ...gate, gateKind: 'future_kind', receivedAt: 4 } } });
    show(bareRuns({ source: 'rule_check', reason: 'broken' }));
    expect(screen.queryByTestId('app-chat-gate')).toBeNull();
    await waitFor(() => expect(steps()).toStrictEqual(['done', 'done', 'failed']));
    expect(screen.queryByTestId('app-chat-gate')).toBeNull();
  });

  it('a failed trail read answers nothing yet (See the job still does) and is tried again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let fail = true;
      const { calls } = mockFetch((path) => (path === `/runs/${RUN}/events` ? (fail ? { status: 503, body: { error: 'busy' } } : { body: { events: holdTrail } }) : null));
      useGateStore.setState({ gates: { [RUN]: gate } });
      show(runs);
      await waitFor(() => expect(calls.filter((c) => c.path === `/runs/${RUN}/events`)).toHaveLength(1));
      expect(screen.queryByTestId('app-chat-gate')).toBeNull();
      expect(screen.getByTestId('app-chat-job')).toBeTruthy();
      fail = false;
      await act(async () => { vi.advanceTimersByTime(5100); });
      await waitFor(() => expect(screen.getByTestId('app-chat-gate').textContent).toContain('Re-check the rules'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('framed, or with no open gate, there is no gate here and nothing is read', async () => {
    const { calls } = serve(holdTrail);
    useGateStore.setState({ gates: { [RUN]: gate } });
    const { unmount } = show(runs, true);
    expect(screen.queryByTestId('app-chat-gate')).toBeNull();
    unmount();
    useGateStore.setState({ gates: {} });
    show(runs);
    expect(screen.queryByTestId('app-chat-gate')).toBeNull();
    expect(steps()).toStrictEqual(['done', 'done', 'failed']);
    expect(calls.filter((c) => c.path === `/runs/${RUN}/events`)).toHaveLength(0);
  });
});

// ── live numbers ────────────────────────────────────────────────────────────────────────────

describe('the dashboard\'s live numbers', () => {
  const s = spec();

  it('a card reads the first page\'s KPIs (up to 3) every 30 s, or its own faster refresh (never under 10 s)', () => {
    const two: AppSpec = { ...s, pages: [
      { id: 'a', title: 'A', components: [
        { id: 'f', type: 'filter', filter: 'select', box: { x: 0, y: 0, w: 2, h: 1 }, default: 'East' },
        { id: 'k1', type: 'kpi', box: { x: 0, y: 1, w: 3, h: 2 }, data: { query: 'q1', params: { region: 'filter.f' } }, value: 'n' },
        { id: 'k2', type: 'kpi', box: { x: 3, y: 1, w: 3, h: 2 }, data: { query: 'q1' }, value: 'n' },
        { id: 'k3', type: 'kpi', box: { x: 6, y: 1, w: 3, h: 2 }, data: { query: 'q2' }, value: 'm' },
        { id: 'k4', type: 'kpi', box: { x: 9, y: 1, w: 3, h: 2 }, data: { query: 'q3' }, value: 'o' },
      ] as never },
      { id: 'b', title: 'B', components: [{ id: 'k9', type: 'kpi', box: { x: 0, y: 0, w: 3, h: 2 }, data: { query: 'q9' }, value: 'z' }] as never },
    ] };
    // The first page's first three KPIs, with the parameters the app opens with (a filter's default).
    expect(tileKpis(two).map((k) => [k.query, k.params])).toStrictEqual([['q1', { region: 'East' }], ['q1', {}], ['q2', {}]]);
    // As the runtime starts: a date range's last N days (30 unset) through .from/.to, values in their declared types.
    const typed = { ...two, queries: [{ id: 'q1', source: 's', kind: 'sql', params: { type: 'object', properties: { top: { type: 'integer' }, since: { type: 'string' }, until: { type: 'string' } } }, output: [{ name: 'n', type: 'integer' }] }], pages: [{ id: 'a', title: 'A', components: [
      { id: 'lim', type: 'filter', filter: 'select', box: { x: 0, y: 0, w: 2, h: 1 }, default: '10' },
      { id: 'dates', type: 'filter', filter: 'date-range', box: { x: 2, y: 0, w: 2, h: 1 }, default: { lastDays: 7 } },
      { id: 'k', type: 'kpi', box: { x: 0, y: 1, w: 3, h: 2 }, data: { query: 'q1', params: { top: 'filter.lim', since: 'filter.dates.from', until: 'filter.dates.to' } }, value: 'n' },
    ] as never }] } as AppSpec;
    const p = tileKpis(typed)[0]!.params;
    expect(p['top']).toBe(10);
    expect(String(p['until'])).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect((Date.parse(String(p['until'])) - Date.parse(String(p['since']))) / 86_400_000).toBe(7);
    expect(tileEveryMs(s, tileKpis(s))).toBe(30_000);
    const fast = { ...s, queries: s.queries.map((q) => ({ ...q, refresh: { mode: 'every', seconds: 4 } })) } as AppSpec;
    expect(tileEveryMs(fast, tileKpis(fast))).toBe(10_000);
  });

  it('never more than 3 queries at once across every card; nothing while the tab is hidden or a card is off screen', async () => {
    let t = 0;
    let hidden = false;
    const pending: Array<() => void> = [];
    const q = vi.fn(async (): Promise<QueryOutcome> => new Promise((res) => { pending.push(() => res({ ok: true, answer: { columns: [{ name: 'open' }], rows: [[1]] } })); }));
    const sch = new TileScheduler({ query: q, now: () => t, hidden: () => hidden, staggerMs: 0 });
    const handles = Array.from({ length: 6 }, (_, i) => sch.register(`c${i}`, { slug: `a${i}`, version: 1, spec: s }, () => undefined));
    // Off screen: nothing.
    sch.tick();
    expect(q).not.toHaveBeenCalled();
    // Hidden tab: nothing, even when seen.
    hidden = true;
    for (const h of handles) h.seen(true);
    sch.tick();
    expect(q).not.toHaveBeenCalled();
    hidden = false;
    for (let i = 0; i < 6; i += 1) sch.tick();
    await Promise.resolve();
    expect(q.mock.calls.length).toBe(3);
    while (pending.length > 0) { pending.shift()!(); await new Promise((r) => setTimeout(r, 0)); }
    expect(sch.peak).toBeLessThanOrEqual(3);
    expect(q.mock.calls.length).toBeGreaterThan(3);
    // Due again only after its period.
    const before = q.mock.calls.length;
    t = 10_000;
    sch.tick();
    expect(q.mock.calls.length).toBe(before);
  });

  it('the preview reads nothing: it draws the app page\'s last render in this tab, bounded, or no rows at all', async () => {
    resetSnapshots();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const rows = { columns: [{ name: 'open', type: 'integer' }], rows: Array.from({ length: 80 }, (_, i) => [i]), truncated: false, hasMore: false, ms: 1, cachedAt: null, sample: false };
    const inner = { kind: { queries: 'crew', actions: 'crew' }, query: vi.fn(async () => rows), prepare: vi.fn(), run: vi.fn(), viewer: () => ({ email: null, sample: false }) } as never;
    const page = recordingPort('desk', inner);
    await page.query(3, 'open_count', {});
    expect(snapshotAt('desk', 3)).not.toBeNull();
    expect(snapshotAt('desk', 4)).toBeNull();
    const tile = snapshotPort('desk', 3);
    const got = await tile.query(3, 'open_count', {});
    expect('error' in got ? null : got.rows.length).toBe(50);
    expect('error' in got ? null : got.truncated).toBe(true);
    expect(await tile.query(3, 'other', {})).toMatchObject({ error: 'unavailable' });
    expect(await snapshotPort('desk', 4).query(4, 'open_count', {})).toMatchObject({ error: 'unavailable' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a card that is gone sends nothing more and hears nothing back (its queued read is skipped)', async () => {
    const pending: Array<() => void> = [];
    const q = vi.fn(async (): Promise<QueryOutcome> => new Promise((res) => { pending.push(() => res({ ok: true, answer: { columns: [{ name: 'open' }], rows: [[1]] } })); }));
    const sch = new TileScheduler({ query: q, staggerMs: 0, hidden: () => false, maxConcurrent: 1 });
    const heard: string[] = [];
    const a = sch.register('a', { slug: 'a', version: 1, spec: s }, () => heard.push('a'));
    const b = sch.register('b', { slug: 'b', version: 1, spec: s }, () => heard.push('b'));
    a.seen(true);
    b.seen(true);
    sch.tick();
    await Promise.resolve();
    const started = q.mock.calls.length;
    b.dispose();
    a.dispose();
    while (pending.length > 0) { pending.shift()!(); await new Promise((r) => setTimeout(r, 0)); }
    // Nothing queued for a disposed card ran, and no listener heard from a disposed card.
    expect(q.mock.calls.length).toBe(started);
    expect(heard).toStrictEqual([]);
  });

  it('a failed refresh shows no numbers and crew\'s code, never the last number as if live', async () => {
    let fail = false;
    const sch = new TileScheduler({ query: async () => (fail ? { ok: false, code: 'contract_changed' } : { ok: true, answer: { columns: tileKpis(s).map((k) => ({ name: k.column })), rows: [tileKpis(s).map(() => 42)] } }), now: () => (fail ? 60_000 : 0), staggerMs: 0, hidden: () => false });
    const seen: Array<{ code: string | null; ok: boolean[] }> = [];
    const h = sch.register('c', { slug: 'a', version: 1, spec: s }, (st) => seen.push({ code: st.code, ok: st.values.map((v) => v.ok) }));
    h.seen(true);
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]!.code).toBeNull();
    fail = true;
    sch.tick();
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]).toStrictEqual({ code: 'contract_changed', ok: tileKpis(s).map(() => false) });
  });

  it('on the page: a card on screen shows crew\'s live values and "updated"; one crew refuses shows the code and no number', async () => {
    class SeenIO {
      constructor(private readonly cb: IntersectionObserverCallback) {}
      observe(el: Element): void { this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
      disconnect(): void {}
    }
    vi.stubGlobal('IntersectionObserver', SeenIO);
    const kpis = tileKpis(s);
    const { calls } = mockFetch((path) => {
      if (path === '/health') return { body: { status: 'ok', capabilities: { apps: { query: true, actions: true, turns: true, publish: false, uploads: false, sourceCheck: true } } } };
      if (path === '/apps') return { body: { apps: [{ slug: 'desk', name: 'Desk' }, { slug: 'ops', name: 'Ops' }] } };
      if (path === '/apps/desk' || path === '/apps/ops') return { body: { app: { ...detail(), slug: path.slice(6), name: path.slice(6) } } };
      if (path === '/apps/desk/query') return { body: { columns: kpis.map((k) => ({ name: k.column, type: 'integer' })), rows: [kpis.map(() => 5100)], truncated: false, hasMore: false, ms: 3, cachedAt: null } };
      if (path === '/apps/ops/query') return { status: 409, body: { code: 'not_accepted', error: 'no receipt' } };
      if (path === '/editors') return { body: { editors: [] } };
      if (path === '/projects') return { body: { projects: [{ id: 'p', name: 'Mikes' }] } };
      if (path === '/mcp/servers') return { body: { servers: [], discovered: [] } };
      return null;
    });
    render(<AppsPage navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('apps-card-kpi-value').length).toBeGreaterThan(0), { timeout: 4000 });
    const desk = screen.getAllByTestId('apps-card').find((c) => c.getAttribute('data-slug') === 'desk')!;
    const values = [...desk.querySelectorAll('[data-testid="apps-card-kpi-value"]')].map((d) => d.textContent ?? '');
    expect(values).toHaveLength(3);
    expect(values[0]).toMatch(/^5[,.\s ]?100$/u);
    expect(values.every((v) => v !== '—')).toBe(true);
    expect(desk.querySelector('[data-testid="apps-card-updated"]')!.textContent).toMatch(/^updated \d+s ago$/u);
    await waitFor(() => expect(screen.getByTestId('apps-card-code').textContent).toBe('not_accepted'), { timeout: 4000 });
    const ops = screen.getAllByTestId('apps-card').find((c) => c.getAttribute('data-slug') === 'ops')!;
    expect(ops.querySelectorAll('[data-testid="apps-card-kpi-value"]')).toHaveLength(0);
    // Every read went through crew's query route with the app's version, and the new-app chat is offered.
    expect(calls.filter((c) => c.path.endsWith('/query')).every((c) => (c.body as { version?: unknown }).version === 3)).toBe(true);
    expect(screen.getByTestId('apps-new-chat')).toBeTruthy();
  });
});
