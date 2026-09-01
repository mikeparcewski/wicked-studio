import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { CoreEvent, GovernanceClaim, Project } from '../src/api/types.js';
import type { Diagnostics } from '../src/api/diagnostics.js';
import { useRunEventStore } from '../src/store/events.js';
import { useRuntimeStore } from '../src/store/runtime.js';
import { makeView } from './factories.js';

/**
 * The command center's analytics column (DES-HOME-COMMAND-CENTER §4–§5): the
 * KPI folds (honest deltas, thresholds only where they mean something, the
 * needs-you tile counting the QUEUE's own fold), the essence strip (absent
 * wires are OMITTED, never zeros), and the recent-activity pulse.
 */

let projects: Project[] = [];
let repos: Array<{ id: string; name: string }> = [];
let chats: Array<{ chatId: string; seats: string[]; idleSecs: number | null }> | Error = [];
let claims: GovernanceClaim[] | Error = [];
let rules: unknown[] | Error = [];
let campaignsAnswer: unknown[] | Error = [];
let scoreboardAnswer: unknown | Error = new Error('absent');
let diagAnswer: Diagnostics | Error = new Error('absent');

const answer = <T,>(v: T | Error): Promise<T> =>
  v instanceof Error ? Promise.reject(v) : Promise.resolve(v);

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjects: () => Promise.resolve({ projects }),
    listRepos: () => Promise.resolve({ repos }),
    listProjectMembers: () => Promise.resolve({ members: [] }),
    getRunEvents: () => Promise.resolve({ events: [] }),
    listChats: () => answer(chats).then((c) => ({ chats: c })),
    listClaims: () => answer(claims).then((c) => ({ claims: c })),
    listConformanceRules: () => answer(rules).then((r) => ({ rules: r })),
  },
}));

vi.mock('../src/api/interactive.js', () => ({
  listDocs: () => Promise.resolve([]),
}));

vi.mock('../src/api/campaigns.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listCampaigns: () => answer(campaignsAnswer).then((c) => ({ campaigns: c })),
}));

vi.mock('../src/api/wiki.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getWikiScoreboard: () => answer(scoreboardAnswer).then((s) => ({ scoreboard: s })),
}));

vi.mock('../src/api/diagnostics.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDiagnostics: () => answer(diagAnswer),
}));

const { HomeBoard } = await import('../src/components/HomeBoard.js');

const NOW = Date.now();

async function mountBoard(runs: ReturnType<typeof makeView>[]): Promise<void> {
  render(<HomeBoard runs={runs} navigate={vi.fn()} onOpenAsk={() => {}} />);
  await screen.findByTestId('home-kpis');
}

/** 11 runs: 3 moving, 1 gated, 2 failed, 4 done, 1 cancelled. */
const RUNS = [
  makeView({ id: 'r-1', status: 'executing' }),
  makeView({ id: 'r-2', status: 'planning' }),
  makeView({ id: 'r-3', status: 'distributing' }),
  makeView({ id: 'r-4', status: 'awaiting_human' }),
  makeView({ id: 'r-5', status: 'failed' }),
  makeView({ id: 'r-6', status: 'failed' }),
  makeView({ id: 'r-7', status: 'completed' }),
  makeView({ id: 'r-8', status: 'completed' }),
  makeView({ id: 'r-9', status: 'completed' }),
  makeView({ id: 'r-10', status: 'completed' }),
  makeView({ id: 'r-11', status: 'cancelled' }),
];

describe('HomeBoard — the portfolio KPI band', () => {
  beforeEach(() => {
    projects = [{ id: 'p-1', name: 'proj', description: null, status: 'active', scope: 's', created_at: 1, updated_at: 1 }];
    repos = [];
    chats = [];
    claims = [];
    rules = new Error('absent');
    campaignsAnswer = new Error('absent');
    scoreboardAnswer = new Error('absent');
    diagAnswer = new Error('absent');
    useRunEventStore.setState({ byRun: {} });
    useRuntimeStore.setState({ logs: {} });
  });

  afterEach(() => cleanup());

  it('folds the six tiles from the shared metric modules — every count honest', async () => {
    claims = [
      { scope: 'wicked-agent/r-1/unit', decision: 'allow', evaluated_at: Math.floor(NOW / 1000) },
      { scope: 'r-4', decision: 'deny', evaluated_at: Math.floor(NOW / 1000) },
    ] as unknown as GovernanceClaim[];
    await mountBoard(RUNS);

    expect(screen.getByTestId('home-kpi-active')).toHaveAttribute('data-value', '3');
    // 11 rows < two full windows ⇒ NO delta — "—", never a fabricated 0%.
    const runsTile = screen.getByTestId('home-kpi-runs');
    expect(runsTile).toHaveAttribute('data-value', '11');
    expect(runsTile).toHaveAttribute('data-delta', 'none');
    expect(runsTile.textContent).toContain('no prior window');

    // The needs-you tile counts the QUEUE's fold: 1 gate + 2 failed = 3.
    await vi.waitFor(() => {
      expect(screen.getByTestId('home-kpi-needs')).toHaveAttribute('data-value', '3');
      expect(screen.getByTestId('needs-you-queue')).toHaveAttribute('data-count', '3');
    });

    const failedTile = screen.getByTestId('home-kpi-failed');
    expect(failedTile).toHaveAttribute('data-value', '2');
    expect(failedTile).toHaveAttribute('data-delta', 'none');

    // done 4 of terminal 7 (cancelled counts in the denominator) = 57%.
    expect(screen.getByTestId('home-kpi-success')).toHaveAttribute('data-value', '57%');

    // Governed: 2 of 11 live runs saw ≥1 recorded evaluation = 18%.
    await vi.waitFor(() => {
      expect(screen.getByTestId('home-kpi-governed')).toHaveAttribute('data-value', '18%');
    });
    expect(screen.getByTestId('home-kpi-governed').textContent).toContain('2 of 11');
  });

  it('a daemon without the claims wire gets an honest "—" governed tile', async () => {
    claims = new Error('route absent');
    await mountBoard(RUNS);
    const tile = screen.getByTestId('home-kpi-governed');
    expect(tile).toHaveAttribute('data-value', '—');
    expect(tile.textContent).toContain('not served by this daemon');
  });

  it('no terminal runs in the window ⇒ success rate has no verdict, no color', async () => {
    await mountBoard([makeView({ id: 'r-a', status: 'executing' })]);
    const tile = screen.getByTestId('home-kpi-success');
    expect(tile).toHaveAttribute('data-value', '—');
    expect(tile.textContent).toContain('no finished runs in the window');
  });
});

describe('HomeBoard — the section essence strip', () => {
  beforeEach(() => {
    projects = [{ id: 'p-1', name: 'proj', description: null, status: 'active', scope: 's', created_at: 1, updated_at: 1 }];
    repos = [{ id: 'repo-1', name: 'a' }, { id: 'repo-2', name: 'b' }];
    chats = [
      { chatId: 'c-1', seats: ['claude'], idleSecs: 5 },
      { chatId: 'c-2', seats: ['codex'], idleSecs: 9 },
    ];
    claims = [];
    rules = [
      { id: 'sec-001', retired: false },
      { id: 'sec-002', retired: false },
      { id: 'old-001', retired: true },
    ];
    campaignsAnswer = [];
    scoreboardAnswer = {
      evidence: { per_rule: [{ rule_id: 'sec-001', denial_claims: 2, governs_evidence: 1 }] },
    };
    diagAnswer = {
      components: { crew: '0.7.7', studioBundle: '0.4.7', coreTs: null, engineBinaries: {} },
      daemon: { uptimeMs: 2 * 3_600_000, startedAt: NOW, port: 7701 },
      stores: [], recentErrors: [], acp: { byCli: {} },
    };
    useRunEventStore.setState({ byRun: {} });
    useRuntimeStore.setState({ logs: {} });
  });

  afterEach(() => cleanup());

  it('one number + one door per ANSWERED section — repos ride the board read', async () => {
    // The repos' newest state is "never onboarded", which also queues rows —
    // give each repo a completed onboard so the strip is what's under test.
    await mountBoard([
      makeView({ id: 'r-ob1', status: 'completed', workflow_id: 'onboarding', repo_ref: 'repo-1' }),
      makeView({ id: 'r-ob2', status: 'completed', workflow_id: 'onboarding', repo_ref: 'repo-2' }),
    ]);
    await vi.waitFor(() => {
      const strip = screen.getByTestId('home-essence');
      const bySection = new Map(
        within(strip).getAllByTestId('essence-entry').map((e) => [e.getAttribute('data-section'), e]),
      );
      expect(bySection.get('projects')).toHaveAttribute('data-value', '1');
      expect(bySection.get('chats')).toHaveAttribute('data-value', '2');
      expect(bySection.get('repos')).toHaveAttribute('data-value', '2');
      expect(bySection.get('campaigns')).toHaveAttribute('data-value', '0');
      expect(bySection.get('steering')).toHaveAttribute('data-value', '2 rules · 1 unused');
      expect(bySection.get('daemon')).toHaveAttribute('data-value', 'crew 0.7.7 · up 2h');
      expect(bySection.get('projects')).toHaveAttribute('href', '/projects');
      expect(bySection.get('steering')).toHaveAttribute('href', '/steering');
    });
  });

  it('an absent wire is an OMITTED entry — never a fabricated zero', async () => {
    chats = new Error('no /chats on this daemon');
    campaignsAnswer = new Error('404');
    rules = new Error('404');
    diagAnswer = new Error('404');
    await mountBoard([makeView({ id: 'r-a', status: 'executing' })]);
    // Let the wires settle (they all reject asynchronously).
    await vi.waitFor(() => {
      expect(screen.getByTestId('home-essence')).toBeInTheDocument();
    });
    const sections = screen.getAllByTestId('essence-entry').map((e) => e.getAttribute('data-section'));
    expect(sections).toContain('projects');
    expect(sections).toContain('repos');
    expect(sections).not.toContain('chats');
    expect(sections).not.toContain('campaigns');
    expect(sections).not.toContain('steering');
    expect(sections).not.toContain('daemon');
  });
});

describe('HomeBoard — the recent-activity pulse', () => {
  beforeEach(() => {
    projects = [{ id: 'p-1', name: 'proj', description: null, status: 'active', scope: 's', created_at: 1, updated_at: 1 }];
    repos = [];
    chats = [];
    claims = [];
    rules = new Error('absent');
    campaignsAnswer = new Error('absent');
    scoreboardAnswer = new Error('absent');
    diagAnswer = new Error('absent');
    useRunEventStore.setState({ byRun: {} });
    useRuntimeStore.setState({ logs: {} });
  });

  afterEach(() => cleanup());

  it('narrates observed runs newest-first, each line a door to its run', async () => {
    const started = (session: string): CoreEvent => ({ type: 'sessionStarted', session });
    useRunEventStore.setState({
      byRun: { 'r-old': [started('r-old')], 'r-new': [{ type: 'sessionCompleted', session: 'r-new' }] },
    });
    useRuntimeStore.setState({
      logs: {
        'r-old': [{ seq: 1, type: 'sessionStarted', ts: NOW - 60_000, detail: 'x' }],
        'r-new': [{ seq: 2, type: 'sessionCompleted', ts: NOW - 1_000, detail: 'y' }],
      },
    });
    await mountBoard([
      makeView({ id: 'r-old', status: 'executing', problem: 'older work' }),
      makeView({ id: 'r-new', status: 'completed', problem: 'newer work' }),
    ]);
    const strip = await screen.findByTestId('home-activity');
    const lines = within(strip).getAllByTestId('activity-line');
    expect(lines.map((l) => l.getAttribute('data-run-id'))).toEqual(['r-new', 'r-old']);
    expect(lines[0]!.textContent).toContain('Run completed');
    expect(lines[0]).toHaveAttribute('href', '/runs/r-new/timeline');
  });

  it('nothing observed ⇒ the strip is ABSENT, never an empty frame', async () => {
    await mountBoard([makeView({ id: 'r-a', status: 'executing' })]);
    expect(screen.queryByTestId('home-activity')).toBeNull();
  });
});
