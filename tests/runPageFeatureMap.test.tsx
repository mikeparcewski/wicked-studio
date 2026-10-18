// H3 — the run page is the chat (DES-EDITOR-PLUGIN-CONTRACT §2 goal 2, concepts "Run page: where today's
// features go"). Every SessionView feature is proven in its mapped home: the thread (inline, labelled with
// who responded), the chat header, or the host panel's Run tab. One `it` per row of the mapping table.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as client from '../src/api/client.js';
import type { SessionView } from '../src/api/types.js';
import { SessionPage, resetDetailsDefault } from '../src/components/session/SessionView.js';
import { useSheets } from '../src/store/sheets.js';
import { useRunEventStore } from '../src/store/events.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { useElicitationStore } from '../src/store/elicitations.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { useHostPanel } from '../src/editors/hostApi.js';
import { makeUnit, makeView } from './factories.js';
import { SinceYouLeft } from '../src/components/session/SinceYouLeft.js';
import { resetRunPanel, useRunPanel } from '../src/store/runPanel.js';
import { openSheet } from '../src/store/sheets.js';
import { RUN_PANEL_KEY } from '../src/board/runPanelModel.js';

/** Open one of the run panel's sections (Now and the state's own section start open). */
function openSection(id: string): void {
  const t = within(screen.getByTestId('host-panel')).getAllByTestId('run-panel-toggle').find((x) => x.dataset['section'] === id)!;
  if (t.getAttribute('aria-expanded') !== 'true') fireEvent.click(t);
}

const ROSTER = [
  { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true },
  { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true },
];

function live(status = 'awaiting_human', over: Record<string, unknown> = {}): SessionView {
  return makeView({ id: 'r1', status: status as never, workflow_id: 'feature', unit_ix: 1, repo_ref: 'tip-splitter', clis: ['claude', 'codex'], base_commit: 'abc1234', ...over }, [
    makeUnit({ id: 'r1:u0', session_id: 'r1', ord: 0, assigned_cli: 'claude', status: 'done', stage: 'build' }),
    makeUnit({ id: 'r1:u1', session_id: 'r1', ord: 1, assigned_cli: 'codex', status: 'distributed', stage: 'review' }),
  ]);
}

const REVIEW_GATE: OpenGate = { runId: 'r1', ord: 1, prompt: 'Does the change hold?', lifecycle: 'open', receivedAt: 1, gateKind: 'review' };

beforeEach(() => {
  localStorage.removeItem(RUN_PANEL_KEY);
  resetRunPanel();
  setCachedRoster(ROSTER as never);
  useSheets.setState({ open: null, stopping: {} } as never);
  useRunEventStore.setState({ byRun: { r1: [] } });
  useCapabilities.setState({ loaded: true, runChatId: true } as never);
  useGateStore.setState({ gates: {} });
  useElicitationStore.setState({ elicitations: {} });
  useHostPanel.setState({ group: null, folded: false } as never);
  vi.spyOn(client.api, 'getWatch').mockRejectedValue(new Error('404'));
  vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] } as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const page = (runs: SessionView[], over: Partial<Parameters<typeof SessionPage>[0]> = {}): ReturnType<typeof render> => render(
  <SessionPage sessionId="run:r1" runs={runs} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} {...over} />,
);
const panel = (): HTMLElement => screen.getByTestId('host-panel');
const thread = (): HTMLElement => screen.getByTestId('session-thread');

describe('run page B: the thread beside the one host panel', () => {
  it('the page is the thread, with the panel (base tab: the run) closed until Details opens it (DES-CHAT-NATIVE-RUN)', () => {
    resetDetailsDefault();
    page([live()]);
    const frame = screen.getByTestId('session-frame');
    expect(within(frame).getByTestId('session')).toBeTruthy();
    const toggle = screen.getByTestId('session-details-toggle');
    expect(screen.queryByTestId('host-panel')).toBeNull();
    expect(screen.queryByTestId('host-panel-ribbon')).toBeNull();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    act(() => { fireEvent.click(toggle); });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(panel()).getByTestId('run-tab')).toHaveAttribute('data-run-id', 'r1');
    act(() => { fireEvent.click(toggle); });
    expect(screen.queryByTestId('host-panel')).toBeNull();
  });
});

describe('where today’s features go (one row each)', () => {
  it('title, status, Stop with confirm → the chat header; Stop also in the Run tab', () => {
    page([live('executing')]);
    expect(screen.getByTestId('session-title')).toBeTruthy();
    expect(screen.getByTestId('session-status')).toBeTruthy();
    fireEvent.click(screen.getByTestId('session-stop'));
    expect(screen.getByTestId('session-stop-confirm-row')).toBeTruthy();
    fireEvent.click(screen.getByTestId('session-stop-keep'));
    fireEvent.click(within(panel()).getByTestId('run-tab-stop'));
    fireEvent.click(within(panel()).getByTestId('run-tab-stop-confirm'));
    expect(useSheets.getState().stopping['r1']).toBeDefined();
  });

  it('Look underneath (the ⋯ sheet) → the same panel: no ⋯ in the header, and a sheet asked for this session opens the panel there', () => {
    page([live()]);
    expect(screen.queryByTestId('session-sheet-open')).toBeNull();
    act(() => { openSheet({ kind: 'session', sessionId: 'run:r1' }, 'evidence'); });
    expect(useSheets.getState().open).toBeNull();
    expect(useRunPanel.getState().focus).toMatchObject({ section: 'checks', item: 'evidence' });
    const checks = within(panel()).getAllByTestId('run-panel-section').find((s) => s.dataset['section'] === 'checks')!;
    expect(checks).toHaveAttribute('data-open', 'true');
    expect(within(checks).getByTestId('sheet-evidence')).toBeTruthy();
    // Another session's sheet is still a sheet.
    act(() => { openSheet({ kind: 'session', sessionId: 'run:elsewhere' }, 'steps'); });
    expect(useSheets.getState().open).toMatchObject({ ref: { kind: 'session', sessionId: 'run:elsewhere' } });
  });

  it('ChainLine (phases) → the Run tab’s Phases; the per-step detail stays inline in the run’s block', () => {
    page([live()]);
    expect(within(panel()).getByTestId('run-tab-phases')).toBeTruthy();
    expect(within(thread()).getByTestId('session-run')).toBeTruthy();
  });

  it('GateRow (Approve, Send back, Reassign, Stop) → an inline gate card labelled with the seat that is asking', () => {
    useGateStore.setState({ gates: { r1: REVIEW_GATE } });
    page([live()]);
    const block = within(thread()).getByTestId('session-run');
    // DES-CHAT-NATIVE-RUN: the question is an assistant message from the seat asking it.
    const asking = within(within(block).getByTestId('chat-gate')).getAllByTestId('turn-who').find((w) => w.textContent?.includes('needs your answer'));
    expect(asking).toHaveAttribute('data-role', 'seat');
    expect(asking).toHaveTextContent('Codex');
    expect(within(block).getByTestId('session-gate-row')).toBeTruthy();
  });

  it('the run block itself (status sentence, record lines) → turns from crew', () => {
    page([live()]);
    // The thread opens on what kicked the run off (your bubble); crew introduces the run's block.
    const whos = within(thread()).getAllByTestId('turn-who');
    expect(whos[0]).toHaveAttribute('data-role', 'operator');
    expect(whos.some((w) => w.getAttribute('data-role') === 'crew')).toBe(true);
    expect(within(thread()).getByTestId('session-status-sentence')).toBeTruthy();
  });

  it('closed chat line, run pending → inline turns from crew', () => {
    page([], { sessionId: 'run:r-gone' });
    expect(screen.getByTestId('session-run-pending')).toBeTruthy();
  });

  it('StrandedCard (orphaned delivery) → an inline card from crew, plus a Run tab warning', () => {
    const v = makeView({ id: 'r1', status: 'completed', workflow_id: 'feature', repo_ref: 'studio-api', workdir: '/w/r1' }, [makeUnit({ ord: 0, status: 'done', session_id: 'r1' })]);
    (v.session as unknown as { delivery: string }).delivery = 'stranded';
    page([v]);
    expect(within(thread()).getByTestId('session-stranded')).toBeTruthy();
    expect(within(panel()).getByTestId('run-tab-stranded')).toBeTruthy();
  });

  it('the orphaned line → inline in the run’s block, plus a Run tab warning', () => {
    useRunEventStore.setState({ byRun: { r1: [{ type: 'runOrphaned', session: 'r1', ord: 1, ts: 5 } as never] } });
    page([live('executing')]);
    expect(within(thread()).getByTestId('session-orphaned')).toBeTruthy();
    expect(within(panel()).getByTestId('run-tab-orphaned')).toBeTruthy();
  });

  it('RunAssuranceLabel, acceptance → “Checks and evidence”; spend → “Agents and spend” (its header says it closed)', () => {
    page([live('executing', { cost_usd: 1.39 })]);
    expect(within(panel()).getByTestId('run-tab-checks')).toBeTruthy();
    const agents = within(panel()).getAllByTestId('run-panel-section').find((s) => s.dataset['section'] === 'agents')!;
    expect(within(agents).getByTestId('run-panel-summary')).toHaveTextContent('$1.39');
    openSection('agents');
    expect(within(agents).getByTestId('run-tab-spend')).toHaveTextContent('$1.39');
  });

  it('RunQuestions → an inline question card from the asking seat', () => {
    act(() => { useElicitationStore.getState().setElicitation({ runId: 'r1', elicitationId: 'e1', message: 'Which region?', options: null, receivedAt: new Date().toISOString() }); });
    page([live('executing')]);
    const q = within(thread()).getByTestId('session-run-questions');
    const who = within(q).getByTestId('turn-who');
    expect(who).toHaveAttribute('data-role', 'seat');
    expect(who).toHaveTextContent('Codex');
  });

  it('CodebaseDownload → the Run tab’s actions (and the delivery turn, unchanged)', () => {
    page([live('completed')]);
    expect(within(panel()).getByTestId('run-tab-download')).toBeTruthy();
  });

  it('Tech details (run id, base commit, CLIs) → the Run tab, behind “Tech details”', () => {
    page([live()]);
    const tech = within(panel()).getByTestId('run-tab-tech');
    expect(tech).toHaveTextContent('r1');
    expect(tech).toHaveTextContent('abc1234');
    expect(tech).toHaveTextContent('claude, codex');
  });

  it('agents and their roles, the workflow and the repo → the Run tab', () => {
    page([live()]);
    expect(within(panel()).getAllByTestId('run-tab-agent').map((a) => a.textContent)).toEqual(['Claude Code builds', 'Codex reviews']);
    expect(within(panel()).getByTestId('run-tab-repo')).toHaveTextContent('tip-splitter');
  });

  it('the composer, slash menu and about: chips → unchanged, at the bottom of the thread', () => {
    page([live()]);
    expect(screen.getByTestId('session').querySelector('.wk-session-composer')).not.toBeNull();
  });

  it('SinceYouLeft → the first card in the thread on return, from crew, still one line collapsed', () => {
    render(<SinceYouLeft card={{ away: '5 h', summary: '1 finished', finished: ['r1'], failed: [], needsYou: 0 } as never} runs={[live('completed')]} />);
    const card = screen.getByTestId('since-you-left');
    const who = within(card).getByTestId('turn-who');
    expect(who).toHaveAttribute('data-role', 'crew');
    expect(who.tagName).toBe('SPAN');
    expect(who.closest('.wk-since-head')).not.toBeNull();
  });
});
