/**
 * studio#664 (DES-PRESENTATION-EDITOR-001 D-S1): the New job wizard's "Demo video" — the way back in
 * to the demo recorder. The card opens a form (the running app, who it is for, what it shows, the
 * project), then the helpers, then the review; Launch calls crew's demo route, never `POST /runs`
 * (the route mints the run's demo folder and brief, which a plain run launch cannot).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RosterSeat, WorkflowDef } from '../src/api/types.js';
import { LaunchWizard } from '../src/components/launch/LaunchWizard.js';
import { demoBlocker, demoUrlProblem } from '../src/board/demoLaunch.js';
import { DEMO_VIDEO_ID, openLaunchWizard, resetLaunchWizard, useLaunchWizard } from '../src/store/launchWizard.js';
import { resetComposerSeats, useComposerSeats } from '../src/store/composerSeats.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { clearRepoCache } from '../src/store/repoCache.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';
import { useProjectsStore } from '../src/store/projects.js';

const seat = (key: string): RosterSeat =>
  ({ key, display_name: key, binary: key, enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true }) as RosterSeat;
const ROSTER = [seat('claude'), seat('codex')];
const WF = [{ id: 'bug', phases: [{ id: 'fix', executes_code: true }] }] as unknown as WorkflowDef[];
const APP = 'http://127.0.0.1:5173/';

let posts: Array<{ path: string; body: Record<string, unknown> }> = [];
let launchStatus = 201;
beforeEach(() => {
  posts = [];
  launchStatus = 201;
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown> });
      return Promise.resolve(launchStatus === 201
        ? new Response(JSON.stringify({ runId: 'r-demo' }), { status: 201, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ error: 'no seat' }), { status: launchStatus, headers: { 'content-type': 'application/json' } }));
    }
    const body = path === '/roster' ? { roster: ROSTER } : path === '/repos' ? { repos: [] } : path === '/workflows' ? { workflows: WF } : path === '/projects' ? { projects: [] } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
  clearCachedRoster();
  setCachedRoster(ROSTER);
  resetComposerSeats();
  resetPlanCatalog();
  clearCachedWorkflows();
  setCachedWorkflows(WF);
  clearRepoCache();
  resetLaunchWizard();
  useProjectsStore.setState({ projects: [
    { id: 'default', name: 'Unfiled', status: 'active' },
    { id: 'upload-endpoint', name: 'Upload endpoint', status: 'active' },
  ] as never });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetComposerSeats(); });

const step = (): string | undefined => screen.getByTestId('launch-wizard-step').dataset.step;
const next = (): void => { fireEvent.click(screen.getByTestId('launch-wizard-next')); };
function fillForm(): void {
  fireEvent.change(screen.getByTestId('launch-wizard-demo-url'), { target: { value: `  ${APP}  ` } });
  fireEvent.click(screen.getAllByTestId('launch-wizard-demo-audience-pick').find((b) => b.dataset.audience === 'Engineers')!);
  fireEvent.change(screen.getByTestId('launch-wizard-demo-show'), { target: { value: 'How a request goes from intake to done' } });
}

describe('the Demo video job (studio#664)', () => {
  it('the card opens the form; Launch posts the brief to the demo route of the chosen project and lands in its session', async () => {
    const navigate = vi.fn();
    render(<LaunchWizard navigate={navigate} />);
    act(() => openLaunchWizard({}));
    fireEvent.click(screen.getByTestId(`launch-wizard-workflow-${DEMO_VIDEO_ID}`));
    expect(step()).toBe('demo');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('New job: Demo video');
    expect(document.activeElement).toBe(screen.getByTestId('launch-wizard-demo-url'));
    fillForm();
    fireEvent.change(screen.getByTestId('launch-wizard-demo-project'), { target: { value: 'upload-endpoint' } });
    // Unfiled is the "Not in a project" choice, never listed twice.
    const opts = [...(screen.getByTestId('launch-wizard-demo-project') as HTMLSelectElement).options].map((o) => o.value);
    expect(opts).toEqual(['', 'upload-endpoint']);
    next();
    expect(step()).toBe('options');
    // A demo's gates are the preset's own (after the plan, after the review): no Ask me, no delivery, no QE.
    expect(screen.queryByTestId('launch-wizard-gate')).toBeNull();
    expect(screen.queryByTestId('launch-wizard-deliver')).toBeNull();
    expect(screen.getByTestId('launch-wizard-demo-gates')).toHaveTextContent('after the plan');
    act(() => { useComposerSeats.getState().toggle('codex'); });
    next();
    expect(step()).toBe('review');
    const review = screen.getByTestId('launch-wizard-review');
    expect(review).toHaveTextContent(APP);
    expect(review).toHaveTextContent('Engineers');
    expect(review).toHaveTextContent('Upload endpoint');
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      path: '/projects/upload-endpoint/demo',
      body: { url: APP, audience: 'Engineers', show: 'How a request goes from intake to done', clisJson: JSON.stringify([ROSTER[0]]) },
    });
    expect(posts.some((p) => p.path === '/runs')).toBe(false);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/s/run%3Ar-demo'));
    expect(useLaunchWizard.getState()).toMatchObject({ open: false, draft: null });
  });

  it('not in a project: the launch goes to the unfiled mount (crew launches it unfiled)', async () => {
    render(<LaunchWizard navigate={() => {}} />);
    act(() => openLaunchWizard({ workflowId: DEMO_VIDEO_ID }));
    expect(step()).toBe('demo');
    fillForm();
    next();
    next();
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.path).toBe('/projects/default/demo');
  });

  it('codex r1: an Unfiled door (the unfiled mount, named) never resumes a demo drafted for another project', () => {
    render(<LaunchWizard />);
    act(() => openLaunchWizard({ workflowId: DEMO_VIDEO_ID, projectId: 'upload-endpoint' }));
    fireEvent.change(screen.getByTestId('launch-wizard-demo-url'), { target: { value: APP } });
    act(() => useLaunchWizard.getState().close());
    act(() => openLaunchWizard({ workflowId: DEMO_VIDEO_ID, projectId: 'default' }));
    expect(useLaunchWizard.getState().draft).toMatchObject({ projectId: 'default', demoUrl: '' });
    // Shown as "Not in a project", and the launch goes to the unfiled mount.
    expect((screen.getByTestId('launch-wizard-demo-project') as HTMLSelectElement).value).toBe('');
  });

  it('Next waits for a real http(s) address, an audience and what to show, and says which is missing', () => {
    render(<LaunchWizard />);
    act(() => openLaunchWizard({ workflowId: DEMO_VIDEO_ID }));
    expect(screen.getByTestId('launch-wizard-next')).toBeDisabled();
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('Give the address of the running app.');
    fireEvent.change(screen.getByTestId('launch-wizard-demo-url'), { target: { value: 'localhost:5173' } });
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('http:// or https://');
    fireEvent.change(screen.getByTestId('launch-wizard-demo-url'), { target: { value: APP } });
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('Say who the video is for.');
    fireEvent.change(screen.getByTestId('launch-wizard-demo-audience'), { target: { value: 'New team leads' } });
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('Say what the video should show.');
    fireEvent.change(screen.getByTestId('launch-wizard-demo-show'), { target: { value: 'The approval flow' } });
    expect(screen.queryByTestId('launch-wizard-blocker')).toBeNull();
    expect(screen.getByTestId('launch-wizard-next')).not.toBeDisabled();
  });

  it('a refused launch keeps every choice and says so (the dialog stays open)', async () => {
    launchStatus = 409;
    render(<LaunchWizard navigate={() => {}} />);
    act(() => openLaunchWizard({ workflowId: DEMO_VIDEO_ID }));
    fillForm();
    next();
    next();
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await screen.findByTestId('launch-wizard-error');
    expect(useLaunchWizard.getState().draft).toMatchObject({ workflowId: DEMO_VIDEO_ID, demoUrl: APP, demoAudience: 'Engineers' });
    expect(screen.getByTestId('launch-wizard-launch')).toHaveTextContent('Try again');
  });

  it('the form rules match crew’s demo body (http(s) only, bounded)', () => {
    expect(demoUrlProblem('https://app.example.test/x')).toBeNull();
    expect(demoUrlProblem('ftp://x')).not.toBeNull();
    expect(demoUrlProblem('http://')).not.toBeNull();
    expect(demoUrlProblem(`http://x/${'a'.repeat(2048)}`)).not.toBeNull();
    expect(demoBlocker({ demoUrl: APP, demoAudience: 'a'.repeat(2001), intent: 'x' })).toContain('2000');
    expect(demoBlocker({ demoUrl: APP, demoAudience: 'a', intent: 'x'.repeat(4001) })).toContain('4000');
    expect(demoBlocker({ demoUrl: APP, demoAudience: 'a', intent: 'x' })).toBeNull();
  });
});
