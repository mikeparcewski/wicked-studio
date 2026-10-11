import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLaunchWizard } from '../src/store/launchWizard.js';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The learn page (DES-learn-workflow §5-§6): a repository's learned topics with their freshness and
 * refresh schedule. The wire is mocked at the model's `learnApi` and the client's `listRepos`.
 */

const topics = vi.fn();
const schedules = vi.fn();
const save = vi.fn();
const runNow = vi.fn();
const remove = vi.fn();
const listRepos = vi.fn();

vi.mock('../src/components/learn/learnModel.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/components/learn/learnModel.js')>();
  return {
    ...real,
    learnApi: {
      topics: (r: string) => topics(r) as Promise<unknown>,
      schedules: () => schedules() as Promise<unknown>,
      save: (b: unknown) => save(b) as Promise<unknown>,
      runNow: (id: string) => runNow(id) as Promise<unknown>,
      remove: (id: string) => remove(id) as Promise<unknown>,
    },
  };
});
vi.mock('../src/api/client.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/api/client.js')>();
  return { ...real, api: { ...real.api, listRepos: () => listRepos() as Promise<unknown> } };
});

const { LearnPage } = await import('../src/components/learn/LearnPage.js');
const model = await import('../src/components/learn/learnModel.js');
const { useComposerSeed } = await import('../src/store/composerSeed.js');
const { ApiError } = await import('../src/api/errors.js');

const NOW = Date.parse('2026-10-11T00:00:00Z');
const topic = (over: Partial<import('../src/components/learn/learnModel.js').LearnTopic> = {}) => ({
  slug: 'sqlite-wal',
  title: 'SQLite WAL mode',
  kind: 'topic' as const,
  refreshedAt: '2026-10-08T00:00:00Z',
  claims: { active: 12, superseded: 1, contradicted: 0, retired: 2 },
  oldestVerifiedAt: '2026-10-01T00:00:00Z',
  staleActive: 0,
  sources: 5,
  problem: null,
  ...over,
});
const schedule = (over = {}) => ({
  id: 'r1:sqlite-wal', repoRef: 'r1', slug: 'sqlite-wal', topic: 'SQLite WAL mode', everyHours: 720, enabled: true,
  nextDueAt: '2026-10-14T00:00:00Z', lastRunId: null, lastRunAt: null, lastOutcome: null, failures: 0, lastError: null,
  indexedTree: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...over,
});
const repos = { repos: [{ id: 'r1', name: 'demo', root_path: '/r', default_branch: 'main', registered_at: 0 }] };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('learnModel', () => {
  it('words: what a topic holds, its freshness, and when it refreshes', () => {
    expect(model.holdsLine(topic())).toBe('12 claims from 5 sources · 1 replaced · 2 retired');
    expect(model.holdsLine(topic({ claims: { active: 0, superseded: 0, contradicted: 0, retired: 0 } }))).toBe('Nothing saved yet');
    expect(model.freshness(topic({ staleActive: 3 }))).toEqual({ word: '3 claims not re-checked lately', tone: 'warn' });
    expect(model.freshness(topic())).toEqual({ word: 'Up to date', tone: 'ok' });
    expect(model.dueIn(NOW + 3 * 86_400_000, NOW)).toBe('in 3 days');
    expect(model.dueIn(NOW - 1, NOW)).toBe('due now');
    expect(model.everyOf(168)).toBe('weekly');
    expect(model.everyOf(800)).toBe('monthly');
    expect(model.defaultEvery('event')).toBe('weekly');
  });

  it('joins a schedule whose topic has not merged yet', () => {
    const rows = model.joinRows('r1', [], [schedule({ slug: 'new-topic', id: 'r1:new-topic', topic: 'New topic' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.topic.title).toBe('New topic');
  });
});

describe('LearnPage', () => {
  it('lists a topic with its freshness and schedule, and saves an interval change', async () => {
    listRepos.mockResolvedValue(repos);
    schedules.mockResolvedValue({ schedules: [schedule()] });
    topics.mockResolvedValue({ repoRef: 'r1', topics: [topic({ staleActive: 2 })] });
    save.mockResolvedValue(schedule({ everyHours: 168 }));
    render(<LearnPage navigate={() => undefined} />);
    expect(await screen.findByText('SQLite WAL mode')).toBeTruthy();
    expect(screen.getByTestId('learn-fresh-sqlite-wal').textContent).toBe('2 claims not re-checked lately');
    expect(screen.getByTestId('learn-next-sqlite-wal').textContent).toMatch(/^Next refresh /);
    fireEvent.click(screen.getByRole('radio', { name: 'Weekly' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ repoRef: 'r1', slug: 'sqlite-wal', topic: 'SQLite WAL mode', everyHours: 168, enabled: true }));
  });

  it('a topic with no schedule refreshes only when started, and turning it on saves a schedule', async () => {
    listRepos.mockResolvedValue(repos);
    schedules.mockResolvedValue({ schedules: [] });
    topics.mockResolvedValue({ repoRef: 'r1', topics: [topic({ kind: 'event' })] });
    save.mockResolvedValue(schedule());
    render(<LearnPage navigate={() => undefined} />);
    expect((await screen.findByTestId('learn-next-sqlite-wal')).textContent).toBe('Not on a schedule. Turn on automatic refresh to keep it current.');
    fireEvent.click(screen.getByRole('switch', { name: 'Refresh automatically' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, everyHours: 168 })));
  });

  it('keeps an interval set elsewhere when only the switch changes (codex r1)', async () => {
    listRepos.mockResolvedValue(repos);
    schedules.mockResolvedValue({ schedules: [schedule({ everyHours: 24 })] });
    topics.mockResolvedValue({ repoRef: 'r1', topics: [topic()] });
    save.mockResolvedValue(schedule({ everyHours: 24, enabled: false }));
    render(<LearnPage navigate={() => undefined} />);
    expect((await screen.findByTestId('learn-custom-sqlite-wal')).textContent).toMatch(/Set elsewhere to every day;/);
    fireEvent.click(screen.getByRole('switch', { name: 'Refresh automatically' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ everyHours: 24, enabled: false })));
  });

  it('ignores a slow read for a repository the user already left (codex r1)', async () => {
    const two = { repos: [...repos.repos, { id: 'r2', name: 'other', root_path: '/o', default_branch: 'main', registered_at: 0 }] };
    listRepos.mockResolvedValue(two);
    schedules.mockResolvedValue({ schedules: [] });
    let releaseA: (v: unknown) => void = () => undefined;
    topics.mockImplementation((r: string) =>
      r === 'r1' ? new Promise((res) => { releaseA = res; }) : Promise.resolve({ repoRef: 'r2', topics: [topic({ slug: 'b-topic', title: 'B topic' })] }));
    render(<LearnPage navigate={() => undefined} />);
    await waitFor(() => expect(topics).toHaveBeenCalledWith('r1'));
    // the select is not rendered until the first load commits; drive a second load directly
    releaseA({ repoRef: 'r1', topics: [topic({ slug: 'a-topic', title: 'A topic' })] });
    expect(await screen.findByText('A topic')).toBeTruthy();
    topics.mockImplementation((r: string) =>
      r === 'r1' ? new Promise((res) => { releaseA = res; }) : Promise.resolve({ repoRef: 'r2', topics: [topic({ slug: 'b-topic', title: 'B topic' })] }));
    fireEvent.change(screen.getByTestId('learn-repo'), { target: { value: 'r1' } });
    fireEvent.change(screen.getByTestId('learn-repo'), { target: { value: 'r2' } });
    expect(await screen.findByText('B topic')).toBeTruthy();
    releaseA({ repoRef: 'r1', topics: [topic({ slug: 'a-late', title: 'A late' })] });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('A late')).toBeNull();
  });

  it('says nothing is learned yet, and "Learn something new" opens the launch wizard for learn', async () => {
    listRepos.mockResolvedValue(repos);
    schedules.mockResolvedValue({ schedules: [] });
    topics.mockResolvedValue({ repoRef: 'r1', topics: [] });
    const navigate = vi.fn();
    render(<LearnPage navigate={navigate} />);
    expect(await screen.findByText('Nothing learned in demo yet.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('learn-new'));
    expect(useLaunchWizard.getState()).toMatchObject({ open: true, draft: { workflowId: 'learn' } });
    expect(useComposerSeed.getState().seed).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a failed read shows one banner and no counts, never a zero', async () => {
    listRepos.mockResolvedValue(repos);
    schedules.mockRejectedValue(new ApiError(503, 'down'));
    render(<LearnPage navigate={() => undefined} />);
    expect(await screen.findByTestId('learn-error')).toBeTruthy();
    expect(screen.queryByTestId('learn-topics')).toBeNull();
    expect(screen.queryByText(/0 claims/)).toBeNull();
  });
});
