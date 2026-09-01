import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '../src/api/types.js';
import { useGateStore } from '../src/store/gates.js';
import { takeRetryPrefill } from '../src/store/retryPrefill.js';
import { makeView } from './factories.js';

/**
 * The needs-you queue ON the home board (DES-HOME-COMMAND-CENTER §3): the
 * structural contradiction guard, the act-in-place wires (gate deep link,
 * Retry-as-prefill that POSTS NOTHING, re-index prefill, chat door), the calm
 * line's live count, and the fresh-install welcome (§6).
 */

let projects: Project[] = [];
let repos: Array<{ id: string; name: string }> = [];
let chats: Array<{ chatId: string; seats: string[]; idleSecs: number | null }> = [];

const launchSpy = vi.fn();
const confirmSpy = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjects: () => Promise.resolve({ projects }),
    listRepos: () => Promise.resolve({ repos }),
    listProjectMembers: () => Promise.resolve({ members: [] }),
    getRunEvents: () => Promise.resolve({ events: [] }),
    listChats: () => Promise.resolve({ chats }),
    // The write verbs exist ONLY as spies: the queue must never call them.
    launchRun: launchSpy,
    confirmGate: confirmSpy,
  },
}));

vi.mock('../src/api/interactive.js', () => ({
  listDocs: () => Promise.resolve([]),
}));

const { HomeBoard } = await import('../src/components/HomeBoard.js');

async function mountBoard(runs: ReturnType<typeof makeView>[], onOpenAsk = (): void => {}): Promise<ReturnType<typeof vi.fn>> {
  const navigate = vi.fn();
  render(<HomeBoard runs={runs} navigate={navigate} onOpenAsk={onOpenAsk} />);
  await screen.findByTestId('needs-you-queue');
  return navigate;
}

describe('HomeBoard — the needs-you queue', () => {
  beforeEach(() => {
    projects = [];
    repos = [];
    chats = [];
    useGateStore.setState({ gates: {}, approaching: {} });
    takeRetryPrefill(); // drain any deposit a prior test left
  });

  afterEach(() => {
    cleanup();
    launchSpy.mockClear();
    confirmSpy.mockClear();
  });

  it('CONTRADICTION GUARD: 21 failed runs can NEVER render the calm copy', async () => {
    repos = [{ id: 'repo-1', name: 'a-repo' }]; // not fresh, and repo has no failed onboard
    const runs = Array.from({ length: 21 }, (_, i) => makeView({ id: `r-f${i}`, status: 'failed' }));
    await mountBoard(runs);
    const queue = screen.getByTestId('needs-you-queue');
    await vi.waitFor(() => {
      // 21 failed rows (+1 never-indexed repo row once the repos read lands).
      expect(Number(queue.getAttribute('data-count'))).toBeGreaterThanOrEqual(21);
    });
    // The calm state derives from the SAME fold — with rows it cannot exist.
    expect(screen.queryByTestId('home-calm')).toBeNull();
    expect(screen.getAllByTestId('need-row').filter((r) => r.getAttribute('data-kind') === 'failed-run')).toHaveLength(21);
  });

  it('the empty queue is the ONLY calm state, and its count is live', async () => {
    projects = [{ id: 'p-1', name: 'proj', description: null, status: 'active', scope: 's', created_at: 1, updated_at: 1 }];
    await mountBoard([
      makeView({ id: 'r-a', status: 'executing' }),
      makeView({ id: 'r-b', status: 'executing' }),
      makeView({ id: 'r-c', status: 'completed' }),
    ]);
    expect(screen.getByTestId('home-calm')).toHaveTextContent('Nothing needs you — 2 runs working.');
    expect(screen.queryAllByTestId('need-row')).toHaveLength(0);
  });

  it('gate rows deep-link to the run approval dock and never post', async () => {
    const runs = [makeView({ id: 'r-gate', status: 'awaiting_human', problem: 'deploy it', project_id: 'proj-1' })];
    act(() => {
      useGateStore.getState().setGate({
        runId: 'r-gate', ord: 0, prompt: 'ship to prod?', lifecycle: 'open', receivedAt: Date.now(),
      });
    });
    await mountBoard(runs);
    const row = screen.getAllByTestId('need-row').find((r) => r.getAttribute('data-key') === 'gate:r-gate')!;
    // The narrator's own awaitingHuman line, and the dock deep link.
    expect(within(row).getByTestId('need-line').textContent).toContain('Gate: waiting on you — ship to prod?');
    const door = within(row).getByTestId('need-act');
    expect(door).toHaveAttribute('data-act', 'open');
    expect(door).toHaveAttribute('href', '/p/proj-1/build/r-gate#gate');
    expect(launchSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('Retry is a PREFILL: deposits the launch config, navigates, posts NOTHING', async () => {
    const navigate = await mountBoard([
      makeView({ id: 'r-fail', status: 'failed', problem: 'fix ci', clis: ['claude'], workflow_id: 'dev' }),
    ]);
    const row = screen.getAllByTestId('need-row').find((r) => r.getAttribute('data-key') === 'fail:r-fail')!;
    const retry = within(row).getByTestId('need-act');
    expect(retry).toHaveAttribute('data-act', 'retry-prefill');
    await userEvent.setup().click(retry);
    expect(navigate).toHaveBeenCalledWith('/runs/new');
    const deposit = takeRetryPrefill();
    expect(deposit?.retryOf).toBe('r-fail');
    expect(deposit?.problem).toBe('fix ci');
    // NOTHING launched, nothing confirmed — tweak-before-send is the point.
    expect(launchSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('a repo whose graph build failed offers re-index-as-prefill', async () => {
    repos = [{ id: 'repo-1', name: 'wicked-x' }];
    const navigate = await mountBoard([
      makeView({ id: 'r-onboard', status: 'failed', workflow_id: 'onboarding', repo_ref: 'repo-1' }),
    ]);
    await vi.waitFor(() => {
      expect(screen.getAllByTestId('need-row').some((r) => r.getAttribute('data-kind') === 'repo-graph')).toBe(true);
    });
    const rows = screen.getAllByTestId('need-row');
    // The failed onboard run is SUPPRESSED in favor of the repo row (dedupe).
    expect(rows.filter((r) => r.getAttribute('data-kind') === 'failed-run')).toHaveLength(0);
    const repoRow = rows.find((r) => r.getAttribute('data-key') === 'repo:repo-1')!;
    const reindex = within(repoRow).getByTestId('need-act');
    expect(reindex).toHaveAttribute('data-act', 'reindex-prefill');
    await userEvent.setup().click(reindex);
    expect(navigate).toHaveBeenCalledWith('/runs/new');
    expect(takeRetryPrefill()?.repoRef).toBe('repo-1');
    expect(launchSpy).not.toHaveBeenCalled();
  });

  it('a stalled live chat rows with its door', async () => {
    projects = [{ id: 'p-1', name: 'proj', description: null, status: 'active', scope: 's', created_at: 1, updated_at: 1 }];
    chats = [{ chatId: 'chat-42', seats: ['claude', 'codex'], idleSecs: 900 }];
    await mountBoard([makeView({ id: 'r-a', status: 'executing' })]);
    await vi.waitFor(() => {
      expect(screen.getAllByTestId('need-row').some((r) => r.getAttribute('data-kind') === 'stalled-chat')).toBe(true);
    });
    const row = screen.getAllByTestId('need-row').find((r) => r.getAttribute('data-kind') === 'stalled-chat')!;
    expect(within(row).getByTestId('need-act')).toHaveAttribute('href', '/chat/chat-42');
  });

  it('FRESH INSTALL: verbs + Ask prominent, and NO fabricated numbers anywhere', async () => {
    const onOpenAsk = vi.fn();
    render(<HomeBoard runs={[]} navigate={vi.fn()} onOpenAsk={onOpenAsk} />);
    await screen.findByTestId('home-welcome');
    expect(screen.getByTestId('home-verbs')).toBeInTheDocument();
    expect(screen.getByTestId('home-verb-work')).toBeInTheDocument();
    // No queue frame, no KPI zeros, no essence zeros, no wall.
    expect(screen.queryByTestId('needs-you-queue')).toBeNull();
    expect(screen.queryByTestId('home-kpis')).toBeNull();
    expect(screen.queryByTestId('home-essence')).toBeNull();
    expect(screen.queryByTestId('project-board')).toBeNull();
    // The Ask invite opens the app-wide dock — the same one the rail opens.
    await userEvent.setup().click(screen.getByTestId('home-ask'));
    expect(onOpenAsk).toHaveBeenCalledTimes(1);
  });

  it('the board-level Ask invite is on the working board too', async () => {
    projects = [{ id: 'p-1', name: 'proj', description: null, status: 'active', scope: 's', created_at: 1, updated_at: 1 }];
    const onOpenAsk = vi.fn();
    await mountBoard([makeView({ id: 'r-a', status: 'executing' })], onOpenAsk);
    await userEvent.setup().click(screen.getByTestId('home-ask'));
    expect(onOpenAsk).toHaveBeenCalledTimes(1);
  });
});
