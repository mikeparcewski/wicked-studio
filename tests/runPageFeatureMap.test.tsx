// H3 — the run page is the chat (DES-EDITOR-PLUGIN-CONTRACT §2 goal 2, concepts "Run page: where today's
// features go"). Every SessionView feature is proven in its mapped home: the thread (inline, labelled with
// who responded), the chat header, or the host panel's Run tab. One `it` per row of the mapping table.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as client from '../src/api/client.js';
import type { SessionView } from '../src/api/types.js';
import { SessionPage } from '../src/components/session/SessionView.js';
import { useSheets } from '../src/store/sheets.js';
import { useRunEventStore } from '../src/store/events.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { useElicitationStore } from '../src/store/elicitations.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { useHostPanel } from '../src/editors/hostApi.js';
import { makeUnit, makeView } from './factories.js';
import { SinceYouLeft } from '../src/components/session/SinceYouLeft.js';

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
  it('the page is the thread plus the panel, whose base tab is the run', () => {
    page([live()]);
    const frame = screen.getByTestId('session-frame');
    expect(within(frame).getByTestId('session')).toBeTruthy();
    expect(within(panel()).getByTestId('run-tab')).toHaveAttribute('data-run-id', 'r1');
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

  it('Look underneath (sheet) → the Run tab’s “Look underneath”; the header’s ⋯ stays', () => {
    page([live()]);
    expect(screen.getByTestId('session-sheet-open')).toBeTruthy();
    fireEvent.click(within(panel()).getByTestId('run-tab-look'));
    expect(useSheets.getState().open).toMatchObject({ ref: { kind: 'session', sessionId: 'run:r1' } });
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
    const asking = within(block).getAllByTestId('turn-who').find((w) => w.textContent?.includes('is asking'));
    expect(asking).toHaveAttribute('data-role', 'seat');
    expect(asking).toHaveTextContent('Codex');
    expect(within(block).getByTestId('session-gate-row')).toBeTruthy();
  });

  it('the run block itself (status sentence, record lines) → turns from crew', () => {
    page([live()]);
    const first = within(thread()).getAllByTestId('turn-who')[0]!;
    expect(first).toHaveAttribute('data-role', 'crew');
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

  it('RunAssuranceLabel, acceptance → the Run tab’s “Checks and spend”', () => {
    page([live('executing', { cost_usd: 1.39 })]);
    const checks = within(panel()).getByTestId('run-tab-checks');
    expect(within(checks).getByTestId('run-tab-spend')).toHaveTextContent('$1.39');
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
