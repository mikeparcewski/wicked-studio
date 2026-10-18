// The run page's ONE right panel (src/board/runPanelModel.ts): the Details panel's Run tab and the ⋯ session sheet's
// 17 tabs, grouped into six folding sections — which open by default per run state, quiet sections, remembered choices.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  defaultOpenSections, PANEL_SECTIONS, panelPlaceOf, panelStateKind, parseRemembered, quietSections, RUN_PANEL_KEY, sectionOpen,
} from '../src/board/runPanelModel.js';
import { RUN_SECTION_TABS, SHEET_TABS } from '../src/board/objectActions.js';
import { RunTab } from '../src/components/session/RunTab.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { useRunAcceptanceStore } from '../src/store/runAcceptance.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { resetRunPanel, useRunPanel } from '../src/store/runPanel.js';
import { makeUnit, makeView } from './factories.js';

vi.mock('../src/api/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/api/client.js')>();
  return { ...original, api: { ...original.api, getRunEvents: vi.fn().mockResolvedValue({ events: [] }) } };
});

describe('the grouping', () => {
  it('every tab the ⋯ session sheet had has exactly one home in the panel (nothing lost)', () => {
    const items = PANEL_SECTIONS.flatMap((s) => s.items.map((i) => i.id));
    expect(new Set(items).size).toBe(items.length);
    for (const t of SHEET_TABS.session) expect(items).toContain(t.id);
    for (const t of RUN_SECTION_TABS) expect(panelPlaceOf(t.id).item).toBe(t.id);
    expect(PANEL_SECTIONS.map((s) => s.id)).toEqual(['now', 'plan', 'changes', 'checks', 'agents', 'record']);
  });

  it('a sheet tab lands in its section; no tab (or an unknown one) lands on Now', () => {
    expect(panelPlaceOf('governance')).toEqual({ section: 'checks', item: 'governance' });
    expect(panelPlaceOf('signins')).toEqual({ section: 'agents', item: 'signins' });
    expect(panelPlaceOf('steps')).toEqual({ section: 'plan', item: 'steps' });
    expect(panelPlaceOf('delivery')).toEqual({ section: 'changes', item: 'delivery' });
    expect(panelPlaceOf(undefined)).toEqual({ section: 'now', item: null });
    expect(panelPlaceOf('nope')).toEqual({ section: 'now', item: null });
  });
});

describe('which section opens by default', () => {
  const v = (status: string) => makeView({ status: status as never });
  it('reads the run state, the gate kind included', () => {
    expect(panelStateKind(undefined, undefined)).toBe('none');
    expect(panelStateKind(v('executing'), undefined)).toBe('running');
    expect(panelStateKind(v('completed'), undefined)).toBe('done');
    expect(panelStateKind(v('failed'), undefined)).toBe('failed');
    expect(panelStateKind(v('cancelled'), undefined)).toBe('stopped');
    expect(panelStateKind(v('awaiting_human'), { gateKind: 'plan_approval' })).toBe('gate-plan');
    expect(panelStateKind(v('awaiting_human'), { prompt: 'Approve plan rev 2 before unit 0 runs' })).toBe('gate-plan');
    expect(panelStateKind(v('awaiting_human'), { gateKind: 'deliver' })).toBe('gate-deliver');
    expect(panelStateKind(v('awaiting_human'), { gateKind: 'escalation' })).toBe('gate');
  });

  it('Now always; the plan at a plan gate and while running; changes when done or at a hand-over; checks at any other gate', () => {
    const open = (k: Parameters<typeof defaultOpenSections>[0]) => [...defaultOpenSections(k)].sort();
    expect(open('running')).toEqual(['now', 'plan']);
    expect(open('gate-plan')).toEqual(['now', 'plan']);
    expect(open('gate-deliver')).toEqual(['changes', 'now']);
    expect(open('gate')).toEqual(['checks', 'now']);
    expect(open('done')).toEqual(['changes', 'now']);
    expect(open('failed')).toEqual(['now']);
    expect(open('stopped')).toEqual(['now']);
  });

  it('a quiet section stays one closed line; the operator’s remembered choice (per state) wins; a link’s focus wins over all', () => {
    const fresh = makeView({ status: 'executing' }, [makeUnit({ ord: 0, status: 'distributed' })]);
    const quiet = quietSections(fresh);
    expect([...quiet].sort()).toEqual(['agents', 'changes', 'checks']);
    expect(sectionOpen('plan', 'running', {}, quiet)).toBe(true);
    expect(sectionOpen('checks', 'gate', {}, quiet)).toBe(false); // nothing checked yet: quiet beats the default
    expect(sectionOpen('checks', 'gate', { gate: { checks: true } }, quiet)).toBe(true);
    expect(sectionOpen('plan', 'running', { running: { plan: false } }, quiet)).toBe(false);
    expect(sectionOpen('plan', 'running', { done: { plan: false } }, quiet)).toBe(true); // another state's choice
    expect(sectionOpen('record', 'running', { running: { record: false } }, quiet, 'record')).toBe(true);
    const done = makeView({ status: 'completed' }, [makeUnit({ ord: 0, status: 'done', assigned_cli: 'claude' })]);
    expect(quietSections(done).size).toBe(0);
  });

  it('stored choices are parsed defensively (junk dropped, never thrown)', () => {
    expect(parseRemembered(null)).toEqual({});
    expect(parseRemembered('{oops')).toEqual({});
    expect(parseRemembered('[1]')).toEqual({});
    expect(parseRemembered(JSON.stringify({ done: { checks: true, plan: 'yes', bogus: true }, nope: { now: false }, gate: 3 }))).toEqual({ done: { checks: true } });
  });
});

describe('the panel', () => {
  beforeEach(() => {
    localStorage.removeItem(RUN_PANEL_KEY);
    resetRunPanel();
    useGateStore.setState({ gates: {}, approaching: {} });
    useRunEventStore.setState({ byRun: {} });
    useRunAcceptanceStore.setState({ byRun: {} });
    setCachedRoster([{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true }]);
    vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected transport read')));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const sections = (): Record<string, string> => Object.fromEntries(screen.getAllByTestId('run-panel-section').map((s) => [s.dataset['section'], s.dataset['open']]));
  const toggle = (id: string): HTMLElement => screen.getAllByTestId('run-panel-toggle').find((t) => t.dataset['section'] === id)!;
  const mount = async (view = makeView({ status: 'completed', delivery: 'delivered', deliverUrl: 'https://github.com/a/b/pull/12' } as never, [makeUnit({ ord: 0, status: 'done', assigned_cli: 'claude' })])) => {
    let r!: ReturnType<typeof render>;
    await act(async () => { r = render(<RunTab runs={[view]} sessionId="run:run-1" title="Fix it" />); });
    return r;
  };

  it('a finished run opens Now and Changes; every header is a button with aria-expanded controlling its region', async () => {
    await mount();
    expect(sections()).toEqual({ now: 'true', plan: 'false', changes: 'true', checks: 'false', agents: 'false', record: 'false' });
    for (const t of screen.getAllByTestId('run-panel-toggle')) {
      expect(t.tagName).toBe('BUTTON');
      const region = document.getElementById(t.getAttribute('aria-controls')!)!;
      expect(region.hidden).toBe(t.getAttribute('aria-expanded') !== 'true');
    }
    expect(within(toggle('changes')).getByTestId('run-panel-summary')).toHaveTextContent('Pull request #12');
  });

  it('a run at its plan gate opens the plan; a step’s question opens checks', async () => {
    const view = makeView({ status: 'awaiting_human', unit_ix: 1 }, [makeUnit({ ord: 0, status: 'done', assigned_cli: 'claude' }), makeUnit({ ord: 1 })]);
    useGateStore.setState({ gates: { 'run-1': { runId: 'run-1', ord: 1, prompt: 'Approve plan rev 1 before unit 1 runs', lifecycle: 'open', receivedAt: 1, gateKind: 'plan_approval' } } });
    const r = await mount(view);
    expect(sections()).toMatchObject({ now: 'true', plan: 'true', checks: 'false' });
    expect(screen.getByTestId('run-tab-goto-question')).toBeTruthy();
    r.unmount();
    useGateStore.setState({ gates: { 'run-1': { runId: 'run-1', ord: 1, prompt: 'Does the change hold?', lifecycle: 'open', receivedAt: 1, gateKind: 'escalation' } } });
    await mount(view);
    expect(sections()).toMatchObject({ now: 'true', plan: 'false', checks: 'true' });
  });

  it('a failed run opens Now alone (it says why it stopped); quiet sections say so in one line', async () => {
    await mount(makeView({ status: 'failed' }, [makeUnit({ ord: 0, status: 'rejected', assigned_cli: 'claude' })]));
    expect(sections()).toEqual({ now: 'true', plan: 'false', changes: 'false', checks: 'false', agents: 'false', record: 'false' });
    cleanup();
    await mount(makeView({ status: 'executing' }, [makeUnit({ ord: 0, status: 'distributed' })]));
    const quiet = screen.getAllByTestId('run-panel-section').filter((s) => s.dataset['quiet'] === 'true').map((s) => s.dataset['section']);
    expect(quiet.sort()).toEqual(['agents', 'changes', 'checks']);
    expect(within(toggle('changes')).getByTestId('run-panel-summary')).toHaveTextContent('Nothing changed yet');
  });

  it('remembers what the operator opens or closes, per run state, in this browser (and survives blocked storage)', async () => {
    const r = await mount();
    fireEvent.click(toggle('changes'));
    fireEvent.click(toggle('record'));
    expect(sections()).toMatchObject({ changes: 'false', record: 'true' });
    expect(JSON.parse(localStorage.getItem(RUN_PANEL_KEY)!)).toEqual({ done: { changes: false, record: true } });
    r.unmount();
    resetRunPanel(); // a new page load reads it back
    await mount();
    expect(sections()).toMatchObject({ changes: 'false', record: 'true' });
    cleanup();
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await mount();
    expect(() => fireEvent.click(toggle('plan'))).not.toThrow();
    expect(sections()).toMatchObject({ plan: 'true' });
    set.mockRestore();
  });

  it('a link to a sheet tab opens its section and its fold; the fold’s content mounts only then', async () => {
    await mount();
    expect(screen.queryByTestId('sheet-evidence')).toBeNull();
    act(() => { useRunPanel.getState().focusOn('checks', 'evidence'); });
    expect(sections()).toMatchObject({ checks: 'true' });
    const item = screen.getAllByTestId('run-panel-item').find((i) => i.dataset['item'] === 'evidence')!;
    expect(item).toHaveAttribute('data-open', 'true');
    expect(within(item).getByTestId('sheet-evidence')).toBeTruthy();
    // Closing the section the link opened clears the link's hold on it.
    fireEvent.click(toggle('checks'));
    expect(sections()).toMatchObject({ checks: 'false' });
    expect(useRunPanel.getState().focus).toBeNull();
  });
});
