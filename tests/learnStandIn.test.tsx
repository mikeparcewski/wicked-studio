import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fakeDaemon, type FakeDaemon } from './learnFakeDaemon.js';

/**
 * wicked-crew#1932 (repro 3): Learn my style is a launch crew can answer with `409 stand_in_choice`. Before, the
 * Learn page printed the refusal as a line of text, so a person could neither choose stand-ins nor sign a helper in
 * from there. Now Style and the first run's style ask show the stand-in card, and each choice does what it says.
 *
 * The 409 body is crew's own, written by its route's writer for Learn my style on Claude Code alone (the fixture's
 * `$comment` names the writer).
 */

const { LearnHub } = await import('../src/components/learn/LearnHub.js');
const { FirstRun } = await import('../src/components/desk/FirstRun.js');
const { resetFirstRun } = await import('../src/store/firstRun.js');
const { useProjectsStore } = await import('../src/store/projects.js');

const CHOICE = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/stand-in-choice.learn-one-helper.crew.json'), 'utf8')) as { status: number; body: Record<string, unknown> };
const refused = (): never => { throw Object.assign(new Error('refused'), { status: CHOICE.status, body: CHOICE.body }); };

let d: FakeDaemon;
const settings: Record<string, unknown> = {};
const nav = vi.fn();

beforeEach(() => {
  resetFirstRun();
  nav.mockReset();
  for (const k of Object.keys(settings)) delete settings[k];
  d = fakeDaemon();
  d.on('GET /settings', () => ({ settings }));
  d.on('PUT /settings', (b) => { Object.assign(settings, b as object); return { settings }; });
  d.on('GET /projects', { projects: [{ id: 'default', name: 'Unfiled' }] });
  d.on('GET /repos', { repos: [{ id: 'r1', name: 'web-store', root_path: '/x/web-store', default_branch: 'main', registered_at: 0 }] });
  d.on('GET /governance/rules', { rules: [] });
  d.on('GET /runs/rr', { run: { session: { id: 'rr', status: 'executing', unit_ix: 0 }, units: [{}, {}, {}] } });
  d.on('GET /proposals', { proposals: [] });
  d.on('GET /setup/known', { git: { name: 'Sam Rivera', email: 'sam@acme.dev' }, languages: [], filesCounted: 0, nearby: [] });
  useProjectsStore.setState({ projects: [] });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** POST /runs: crew's refusal first, then (once the person chose) the run. */
function runsRefuseOnce(): void {
  let n = 0;
  d.on('POST /runs', () => { n += 1; return n === 1 ? refused() : { runId: 'rr' }; });
}

async function learnMyStyle(): Promise<void> {
  render(<LearnHub navigate={nav} search="" />);
  fireEvent.change(await screen.findByTestId('style-kind'), { target: { value: 'repo' } });
  await waitFor(() => expect(screen.getByTestId('style-repo')).toBeTruthy());
  fireEvent.change(screen.getByTestId('style-repo'), { target: { value: 'r1' } });
  fireEvent.click(screen.getByTestId('style-add'));
  fireEvent.click(screen.getByTestId('style-go'));
}

describe('Learn → Style: Learn my style, refused for want of helpers (crew#1932 repro 3)', () => {
  it('shows the stand-in card, not a line of text, and nothing has started', async () => {
    runsRefuseOnce();
    await learnMyStyle();
    const card = await screen.findByTestId('style-standin');
    expect(within(card).getByTestId('style-standin-title').textContent).toBe('Only one helper can check this job');
    expect(within(card).getByTestId('style-standin-why').textContent).toContain('Claude Code is the only helper signed in.');
    expect(screen.queryByTestId('style-launch-error')).toBeNull();
    expect(d.sent('POST /runs')).toHaveLength(1);
    expect(settings['studio.learn.style']).toBeUndefined();
  });

  it('"Use stand-ins for this job" starts the same job again with crew\'s retryWith, and Style follows it', async () => {
    runsRefuseOnce();
    await learnMyStyle();
    fireEvent.click(await screen.findByTestId('style-standin-job'));
    await waitFor(() => expect(d.sent('POST /runs')).toHaveLength(2));
    const [first, again] = d.sent('POST /runs') as Record<string, unknown>[];
    expect(again).toEqual({ ...first, standIns: true });
    expect(first).toMatchObject({ workflow: 'capture-learnings', repoRef: 'r1' });
    await waitFor(() => expect(screen.queryByTestId('style-standin')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('style-runline').textContent).toContain('Running as 1 job'));
    expect((settings['studio.learn.style'] as { jobs: Array<{ runId: string; kind: string; sources: string[] }> }).jobs)
      .toEqual([{ runId: 'rr', kind: 'repo', sources: ['web-store'] }]);
  });

  it('"Use stand-ins for every job" saves the setting first, then starts the job as it was sent', async () => {
    runsRefuseOnce();
    await learnMyStyle();
    fireEvent.click(await screen.findByTestId('style-standin-always'));
    await waitFor(() => expect(d.sent('POST /runs')).toHaveLength(2));
    expect(d.sent('PUT /settings')).toContainEqual({ standInReview: 'always' });
    const [first, again] = d.sent('POST /runs') as Record<string, unknown>[];
    expect(again).toEqual(first);
    await waitFor(() => expect(screen.getByTestId('style-runline').textContent).toContain('Running as 1 job'));
  });

  it('a setting that was not saved starts nothing and keeps the choices', async () => {
    runsRefuseOnce();
    d.on('PUT /settings', () => ({ settings: {} }));
    await learnMyStyle();
    fireEvent.click(await screen.findByTestId('style-standin-always'));
    await waitFor(() => expect(screen.getByTestId('style-standin-error')).toBeTruthy());
    expect(d.sent('POST /runs')).toHaveLength(1);
    expect(screen.getByTestId('style-standin-job')).toBeTruthy();
  });

  it('"Sign in another helper" opens Helpers; Cancel closes the card; neither starts anything', async () => {
    runsRefuseOnce();
    await learnMyStyle();
    fireEvent.click(await screen.findByTestId('style-standin-sign_in'));
    expect(nav).toHaveBeenCalledWith('/agents');
    fireEvent.click(screen.getByTestId('style-standin-cancel'));
    await waitFor(() => expect(screen.queryByTestId('style-standin')).toBeNull());
    expect(d.sent('POST /runs')).toHaveLength(1);
  });
});

describe('First run → the style ask, refused for want of helpers (crew#1932)', () => {
  const agents = [{ key: 'claude', name: 'Claude Code', usable: true, optIn: false, issues: [], login: null }] as never;

  it('shows the stand-in card; "this job" starts it with retryWith, then files it under Learn → Style and answers the ask', async () => {
    settings['studio.firstRun'] = { answers: Object.fromEntries(['repos', 'agents'].map((k) => [k, { line: k, words: k, done: true }])) };
    runsRefuseOnce();
    render(<FirstRun navigate={nav} agents={agents} hasRoster />);
    const ask = await screen.findByTestId('first-run-ask-style');
    const repo = within(ask).getAllByTestId('ask-option').find((o) => o.getAttribute('data-ask-option') === 'repo:r1')!;
    fireEvent.click(repo);
    fireEvent.click(within(ask).getByTestId('ask-confirm'));
    const card = await screen.findByTestId('first-run-standin');
    expect(within(card).getByTestId('first-run-standin-title').textContent).toBe('Only one helper can check this job');
    expect(screen.queryByTestId('first-run-error')).toBeNull();
    expect(settings['studio.learn.style']).toBeUndefined();
    fireEvent.click(within(card).getByTestId('first-run-standin-job'));
    await waitFor(() => expect(d.sent('POST /runs')).toHaveLength(2));
    const [first, again] = d.sent('POST /runs') as Record<string, unknown>[];
    expect(again).toEqual({ ...first, standIns: true });
    await waitFor(() => expect((settings['studio.learn.style'] as { jobs: unknown[] } | undefined)?.jobs).toEqual([{ runId: 'rr', kind: 'repo', sources: ['web-store'] }]));
    await waitFor(() => expect(screen.queryByTestId('first-run-standin')).toBeNull());
    expect((settings['studio.firstRun'] as { answers: Record<string, { done: boolean }> }).answers['style']?.done).toBe(true);
  });
});
