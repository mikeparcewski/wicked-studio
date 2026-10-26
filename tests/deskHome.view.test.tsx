import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SessionView } from '../src/api/types.js';
import type { NeedRow } from '../src/board/needsYou.js';
import { DeskHome } from '../src/components/desk/DeskHome.js';
import { useBatchGateStore } from '../src/board/batchGates.js';
import { useLaunchWizard, resetLaunchWizard } from '../src/store/launchWizard.js';
import { useComposerPrefsStore } from '../src/store/composerPrefs.js';
import { NOW, deskRun } from './fixtures/deskV2.js';

/**
 * The landing (home v2) on screen: one sentence, the ask box starts the New job flow, ONE card with
 * at most two moves and "N more waiting", at most three jobs in progress, the closing line. What it
 * replaced stays reachable: every waiting item is one link away (the Nerve Center), every job is in
 * All jobs, the report is linked.
 */

const mocks = vi.hoisted(() => ({ runBatch: vi.fn(async () => {}) }));
vi.mock('../src/board/batchGates.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/board/batchGates.js')>();
  return { ...original, runBatchDecision: mocks.runBatch };
});

function need(id: string, kind: NeedRow['kind'], extra: Partial<NeedRow> = {}): NeedRow {
  const key = `${kind === 'failed-run' ? 'fail' : kind}:${id}`;
  return {
    key, kind, severity: kind === 'gate' ? 100 : kind === 'failed-run' ? 70 : 40, stakes: 1, subject: id, text: `line ${id}`,
    tone: kind === 'failed-run' ? 'fail' : 'gate', at: NOW - 60_000, subjectPath: `/s/run%3A${id}`,
    action: { kind: 'open', path: `/s/run%3A${id}#gate`, label: 'Open gate ›' }, ...extra,
  } as NeedRow;
}

function mount(over: Partial<React.ComponentProps<typeof DeskHome>> = {}): { navigate: ReturnType<typeof vi.fn> } {
  const navigate = vi.fn();
  render(
    <DeskHome runs={[]} runsShown read="known" needRows={[]} settled="complete" missing={[]} onRetryNeeds={vi.fn()} retryingNeeds={false}
      navigate={navigate} now={NOW} agentName={(c) => c} pathOfRun={(id) => `/s/run%3A${id}`} setup={[]}
      reportPath="/?tab=report" more={null} panelId="p" labelledBy="t" {...over} />,
  );
  return { navigate };
}

beforeEach(() => {
  resetLaunchWizard();
  useBatchGateStore.setState({ selected: [], running: false, queued: false, failures: [] });
  useComposerPrefsStore.setState((s) => ({ prefs: { ...s.prefs, startInChat: false } }));
  mocks.runBatch.mockClear();
});
afterEach(cleanup);

describe('the landing', () => {
  it('nothing waiting: a calm line, no card, and the sentence says so', () => {
    mount();
    expect(screen.getByTestId('desk-story')).toHaveTextContent('Nothing needs you, and nothing is running.');
    expect(screen.getByTestId('desk-needs-calm')).toBeInTheDocument();
    expect(screen.queryByTestId('desk-card')).not.toBeInTheDocument();
  });

  it('one card for the top item, at most two moves, and the rest one link away', () => {
    const runs = [deskRun('g', { status: 'awaiting_human' }), deskRun('f', { status: 'failed' })];
    const rows = [need('f', 'failed-run', { action: { kind: 'retry-prefill', prefill: {} as never, label: 'Retry ›' } }), need('g', 'gate', { question: 'Should it go on?' }), need('p', 'proposal')];
    const { navigate } = mount({ runs, needRows: rows });
    // Two need you (the gate and the failure); the proposal is a review, not counted.
    expect(screen.getByTestId('desk-story')).toHaveTextContent(/^Two things need you\./);
    const card = screen.getByTestId('desk-card');
    expect(card).toHaveAttribute('data-key', 'gate:g');
    expect(within(card).getByTestId('desk-card-body')).toHaveTextContent('“Fix g” is paused at step 2 of 2 until you answer.');
    expect(within(card).getByTestId('desk-card-title')).toHaveTextContent('Should it go on?');
    expect(within(card).getAllByRole('link').length + within(card).queryAllByRole('button').length).toBeLessThanOrEqual(2);
    fireEvent.click(within(card).getByTestId('desk-card-primary'));
    expect(navigate).toHaveBeenCalledWith('/s/run%3Ag#gate');
    const more = screen.getByTestId('desk-needs-more');
    expect(more).toHaveTextContent('1 more waiting');
    fireEvent.click(more);
    // Every waiting item, with its moves: Needs you in full.
    expect(navigate).toHaveBeenLastCalledWith('/?tab=inbox');
  });

  it('a simple low-impact plan is approved in place through the one audited batch path', () => {
    const runs = [deskRun('g', { status: 'awaiting_human' })];
    mount({ runs, needRows: [need('g', 'gate', { groupKey: 'approval', action: { kind: 'open', path: '/s/run%3Ag#gate', label: 'Approve plan… ›' } })] });
    const card = screen.getByTestId('desk-card');
    expect(within(card).getByTestId('desk-card-secondary')).toHaveTextContent('See the plan');
    fireEvent.click(within(card).getByTestId('desk-card-primary'));
    expect(useBatchGateStore.getState().selected).toEqual(['g']);
    expect(mocks.runBatch).toHaveBeenCalledWith({ approve: true });
  });

  it('nothing can run: the agents setup item leads the card; other setup only when nothing waits', () => {
    mount({ needRows: [need('g', 'gate')], runs: [deskRun('g', { status: 'awaiting_human' })],
      setup: [{ key: 'agents', tone: 'fail', title: 'Set up your agents', line: 'None can work yet.', action: { label: 'Set up agents', path: '/?tab=agents' } }] });
    expect(screen.getByTestId('desk-card')).toHaveAttribute('data-setup', 'agents');
    expect(screen.getByTestId('desk-needs-more')).toHaveTextContent('1 more waiting');
    cleanup();
    // Another setup item waits behind any need, and is the card only when nothing needs you.
    const memory = { key: 'memory-empty' as const, tone: 'gate' as const, title: 'Your memory is empty', line: 'Index a repository.', action: { label: 'Build memory', path: '/?tab=repositories' } };
    mount({ setup: [memory], needRows: [need('g', 'gate')], runs: [deskRun('g', { status: 'awaiting_human' })] });
    expect(screen.getByTestId('desk-card')).toHaveAttribute('data-key', 'gate:g');
    cleanup();
    mount({ setup: [memory] });
    expect(screen.getByTestId('desk-card')).toHaveAttribute('data-setup', 'memory-empty');
    expect(screen.getByText('Set up studio')).toBeInTheDocument();
  });

  it('in progress: at most three rows, each a link with a status word and step x of y', () => {
    const runs = ['a', 'b', 'c', 'd'].map((id) => deskRun(id, { status: 'executing' }));
    const { navigate } = mount({ runs });
    const rows = screen.getAllByTestId('desk-progress-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Working');
    expect(rows[0]).toHaveTextContent('Step 2 of 2');
    expect(screen.getByTestId('desk-progress-more')).toHaveTextContent('1 more in progress');
    fireEvent.click(rows[0]!);
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/s\/run%3A/));
    expect(screen.getByTestId('desk-story')).toHaveTextContent('Nothing needs you. Four jobs are running.');
  });

  it('the ask box starts the New job flow with the words typed', () => {
    mount();
    fireEvent.change(screen.getByTestId('desk-ask-input'), { target: { value: 'Fix the flaky test' } });
    fireEvent.click(screen.getByTestId('desk-ask-start'));
    expect(useLaunchWizard.getState().open).toBe(true);
    expect(useLaunchWizard.getState().draft?.intent).toBe('Fix the flaky test');
  });

  it('closes with what shipped today and a link to the report', () => {
    const { navigate } = mount({ runs: [] as SessionView[] });
    expect(screen.getByTestId('desk-shipped')).toHaveTextContent('Nothing shipped yet today · See the report');
    fireEvent.click(screen.getByTestId('desk-shipped-report'));
    expect(navigate).toHaveBeenCalledWith('/?tab=report');
  });
});
