/**
 * Power mode, rendered (DES-POWER-MODE; mockup design/mockups/power-mode.html): the header's switch and rigor chip,
 * the thread's intake card, activity rows, checkpoint and rigor markers and hand-off card, and the "this grew" dock —
 * nothing of it on a daemon without `capabilities.powerMode`.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import type { WorkUnit } from '../src/api/types.js';
import { resetDecisionsForTest, setUndoWindowForTest } from '../src/board/undoQueue.js';
import { PowerPauseCard, PowerSwitchButton, RigorChipButton } from '../src/components/session/PowerMode.js';
import { RunBlock, resetStepOutputs } from '../src/components/session/RunConversation.js';
import { usePowerLocal } from '../src/hooks/usePower.js';
import { resetRunCoverage } from '../src/hooks/useRunCoverage.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import { useLaunchWizard, resetLaunchWizard } from '../src/store/launchWizard.js';
import { makeUnit, makeView } from './factories.js';
import { buildEvents, plan, state } from './powerFixtures.js';

const RUN = 'r-pm';
const unit = (key: string, ord: number, status: string, cli: string | null, stage = 'build'): WorkUnit =>
  makeUnit({ id: `${RUN}:${key}`, session_id: RUN, ord, status, assigned_cli: cli, stage, description: key } as never);
const UNITS = [unit('intake', 0, 'done', 'pi', 'test_plan'), unit('build', 1, 'executing', 'claude'), unit('review', 2, 'pending', 'codex', 'review')];

let posts: Array<{ path: string; body: Record<string, unknown> }> = [];
let answer: (path: string, body: Record<string, unknown>) => { status: number; body: unknown } = () => ({ status: 200, body: state() });

beforeEach(() => {
  posts = [];
  resetStepOutputs();
  resetRunCoverage();
  resetLaunchWizard();
  usePowerLocal.setState({ byRun: {}, atByRun: {} });
  useCapabilities.setState({ loaded: true, powerMode: true });
  useGateStore.setState({ gates: {}, approaching: {} });
  useRunEventStore.setState({ byRun: { [RUN]: buildEvents() as never } });
  answer = () => ({ status: 200, body: state() });
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] } as never);
  vi.spyOn(client.api, 'getWatch').mockResolvedValue({ coverage: [] } as never);
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] } as never);
  vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: null } as never);
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (init?.method === 'POST') posts.push({ path, body });
    const a = init?.method === 'POST' ? answer(path, body) : { status: 200, body: {} };
    return Promise.resolve(new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } }));
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useCapabilities.setState({ powerMode: false }); setUndoWindowForTest(null); resetDecisionsForTest(); });

const view = (over: Record<string, unknown> = {}, status = 'executing') => makeView({ id: RUN, problem: 'Invoice PDFs show $ for EUR accounts', status, power: state(), ...over } as never, UNITS);

describe('the header: the switch beside the name and the rigor chip', () => {
  it('the switch is On; flipping it asks first, then POSTs {on: false}', async () => {
    render(<PowerSwitchButton view={view()} power={state()} />);
    const sw = screen.getByTestId('power-switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    expect(screen.getByTestId('power-switch-confirm').textContent).toMatch(/rest of the work goes phased/);
    expect(posts).toEqual([]);
    answer = () => ({ status: 200, body: state({ on: false }) });
    await act(async () => { fireEvent.click(screen.getByTestId('power-switch-yes')); });
    await waitFor(() => expect(posts).toEqual([{ path: `/runs/${RUN}/power`, body: { on: false } }]));
    expect(usePowerLocal.getState().byRun[RUN]?.on).toBe(false);
  });

  it('phased required: Off, disabled, the reason in its tooltip; a click sends nothing', () => {
    const p = state({ on: false, available: false, refusedReason: 'regulated repo' });
    render(<PowerSwitchButton view={view({ power: p })} power={p} />);
    const sw = screen.getByTestId('power-switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('aria-disabled')).toBe('true');
    expect(sw.title).toBe('Phased is required: regulated repo');
    fireEvent.click(sw);
    expect(screen.queryByTestId('power-switch-confirm')).toBeNull();
    expect(posts).toEqual([]);
  });

  it('a refused flip says why (409 {reason})', async () => {
    const p = state({ on: false });
    answer = () => ({ status: 409, body: { error: 'phased is required', reason: 'the plan requires phased for payments' } });
    render(<PowerSwitchButton view={view({ power: p })} power={p} />);
    fireEvent.click(screen.getByTestId('power-switch'));
    await act(async () => { fireEvent.click(screen.getByTestId('power-switch-yes')); });
    expect((await screen.findByTestId('power-switch-error')).textContent).toBe('Not switched: the plan requires phased for payments');
  });

  it('the chip says "Rigor high ↑" and opens the rigor history; a raise POSTs atLeast', async () => {
    render(<RigorChipButton view={view()} power={state()} />);
    const chip = screen.getByTestId('rigor-chip');
    expect(chip.textContent).toBe('Rigor high ↑');
    fireEvent.click(chip);
    const rows = screen.getAllByTestId('rigor-history-row');
    expect(rows.map((r) => r.dataset['trigger'])).toEqual(['intake', 'commit']);
    expect(rows[1]!.textContent).toMatch(/checkpoint 2, sign-in module touched, score 34 → 58$/);
    fireEvent.click(screen.getByTestId('rigor-raise'));
    expect(screen.getAllByTestId('rigor-raise-to').map((b) => b.dataset['rigor'])).toEqual(['highest']);
    await act(async () => { fireEvent.click(screen.getByTestId('rigor-raise-to')); });
    await waitFor(() => expect(posts[0]).toMatchObject({ path: `/runs/${RUN}/rigor`, body: { atLeast: 'highest' } }));
    expect(await screen.findByTestId('rigor-raise-done')).toBeTruthy();
  });
});

describe('the thread', () => {
  it('shows the intake card, the orchestrator\'s turn as a message, activity rows and the markers', async () => {
    render(<RunBlock view={view()} badge={0} sessionId={`run:${RUN}`} />);
    const intake = await screen.findByTestId('power-intake');
    expect(within(intake).getByTestId('power-intake-line').textContent).toBe('Rigor standard — targeted tests, a different reviewer and QE acceptance at hand-off');
    const turn = screen.getByTestId('power-turn');
    expect(within(turn).getByTestId('turn-who').textContent).toMatch(/^claude · orchestrator · (\d+ \w{3} )?\d\d:\d\d$/);
    expect(screen.getAllByTestId('power-act')).toHaveLength(5);
    expect(screen.getAllByTestId('power-checkpoint').map((m) => m.textContent)).toEqual([
      expect.stringContaining('Checkpoint 1 · commit 1 · rigor stays standard (score 34 → 36)'),
      expect.stringContaining('Checkpoint 2 · commit 2 · picked up your note'),
    ]);
    expect(screen.getByTestId('power-rigor-mark').textContent).toContain('Rigor ↑ standard → high · sign-in module touched — hand-off now runs the full suite');
    // The intake and build units' own step messages are not said twice; the plan's message gives way to the card.
    expect(screen.queryAllByTestId('chat-step').map((s) => s.dataset['ord'])).not.toContain('0');
    expect(screen.queryByTestId('chat-plan')).toBeNull();
  });

  it('the hand-off: a divider, then one card of steps with their status', async () => {
    useRunEventStore.setState({ byRun: { [RUN]: buildEvents(true) as never } });
    render(<RunBlock view={view()} badge={0} sessionId={`run:${RUN}`} />);
    const card = await screen.findByTestId('power-handoff');
    expect(screen.getByTestId('power-handoff-divider').textContent).toMatch(/^Hand-off · \d\d:\d\d$/);
    expect(within(card).getAllByTestId('power-handoff-row').map((r) => `${r.dataset['step']}:${within(r).getByTestId('power-handoff-result').textContent}`))
      .toEqual(['checks:✓ Passed', 'review:✓ Approved', 'qe:Running', 'compliance:Waiting']);
  });

  it('nothing of power mode on a daemon without the capability', async () => {
    useCapabilities.setState({ powerMode: false });
    render(<RunBlock view={view()} badge={0} sessionId={`run:${RUN}`} />);
    await screen.findByTestId('session-run');
    expect(screen.queryByTestId('power-intake')).toBeNull();
    expect(screen.queryByTestId('power-checkpoint')).toBeNull();
    expect(screen.queryByTestId('power-act')).toBeNull();
  });

  it('a phased run with an intake plan keeps its plan message', async () => {
    const p = state({ on: false, plan: plan({ rigor: 'high' }) });
    useRunEventStore.setState({ byRun: { [RUN]: [buildEvents()[2]!] as never } });
    const v = makeView({ id: RUN, problem: 'x', status: 'executing', power: p } as never, [unit('pa-scope', 0, 'done', 'claude', 'scope'), unit('design', 1, 'executing', 'claude')]);
    render(<RunBlock view={v} badge={0} sessionId={`run:${RUN}`} />);
    expect(await screen.findByTestId('power-intake')).toBeTruthy();
    expect(screen.getByTestId('chat-plan')).toBeTruthy();
  });
});

describe('the "this grew" dock (a pause, not an engine gate: POST /runs/:id/power/pause)', () => {
  const pause = { at: 0, checkpoint: 3, reasons: ['The diff now spans 3 packages', 'A new dependency in a sensitive area'], recommended: 'split' as const };
  beforeEach(() => { setUndoWindowForTest(0); });
  const card = (rec: 'split' | 'switch_phased' | 'continue_high' | 'stop' = 'split') => render(<PowerPauseCard view={view()} power={state({ pause: { ...pause, recommended: rec } })} />);
  const pausePosts = () => posts.filter((p) => p.path === `/runs/${RUN}/power/pause`).map((p) => p.body);

  /** The person's path: the recommended card is preselected; the primary sends it; Stop asks why first. */
  const answer = async (reason = 'out of scope'): Promise<void> => {
    await act(async () => { fireEvent.click(screen.getByTestId('power-pause-confirm')); await new Promise((r) => setTimeout(r, 5)); });
    const box = screen.queryByTestId('power-pause-reason');
    if (box !== null) {
      fireEvent.change(box, { target: { value: reason } });
      await act(async () => { fireEvent.click(screen.getByTestId('power-pause-confirm')); await new Promise((r) => setTimeout(r, 5)); });
    }
  };

  it('marks and preselects the recommendation; the reasons are listed; every way on is a card', () => {
    card();
    expect(screen.getByTestId('power-pause-question').textContent).toBe('This change grew past its plan. How should it go on?');
    expect(screen.getByTestId('power-pause-reasons').textContent).toContain('The diff now spans 3 packages');
    const cards = screen.getAllByTestId('power-pause-choice');
    expect(cards.map((b) => b.dataset['choice'])).toEqual(['split', 'switch_phased', 'continue_high', 'stop']);
    expect(cards[0]!.getAttribute('aria-checked')).toBe('true');
    expect(cards.slice(1).every((b) => b.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(screen.queryByTestId('power-pause-more')).toBeNull();
    expect(screen.getByTestId('power-pause-confirm').textContent).toBe('Split into lanes');
  });

  it('each way on answers the pause route with its decision (after the undo window); Stop carries its reason', async () => {
    for (const rec of ['continue_high', 'switch_phased', 'stop'] as const) {
      posts = [];
      const { unmount } = card(rec);
      await answer();
      await waitFor(() => expect(pausePosts()).toEqual([rec === 'stop' ? { decision: 'stop', note: 'out of scope' } : { decision: rec }]));
      expect(posts.some((p) => p.path === `/runs/${RUN}/gate`)).toBe(false);
      unmount();
    }
  });

  it('answered, the cards collapse to one line with the undo countdown; Undo sends nothing', async () => {
    setUndoWindowForTest(5_000);
    posts = [];
    card('continue_high');
    await answer();
    expect(screen.getByTestId('power-pause-chosen').textContent).toBe('You chose: Continue at high rigor');
    expect(screen.queryAllByTestId('power-pause-choice')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('power-pause-undo'));
    expect(screen.getAllByTestId('power-pause-choice')).toHaveLength(4);
    await new Promise((r) => setTimeout(r, 20));
    expect(pausePosts()).toEqual([]);
  });

  it('Split opens a New job prefilled with the rest (nothing launched) and tells this run to finish only the original change', async () => {
    card('split');
    await answer();
    expect(useLaunchWizard.getState().draft?.intent).toContain('The diff now spans 3 packages');
    await waitFor(() => expect(pausePosts()).toEqual([{ decision: 'continue', note: expect.stringContaining('Split into lanes: finish only the original change here') }]));
    expect(posts.some((p) => p.path === '/runs')).toBe(false);
  });

  it('the thread shows the pause card when the run is paused, with no gate open', async () => {
    render(<RunBlock view={view({ power: state({ pause }) })} badge={0} sessionId={`run:${RUN}`} />);
    expect(await screen.findByTestId('power-pause')).toBeTruthy();
  });
});
