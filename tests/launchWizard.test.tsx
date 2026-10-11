/**
 * The launch wizard (operator 2026-10-11 15:15Z): picking a workflow opens ONE modal — what, where,
 * options, review — instead of the composer's inline strip, and Launch sends exactly the body the
 * strip sent for the same choices (EXPECTED was recorded from the strip on main 7cf54b7).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoEntry, RosterSeat, WorkflowDef } from '../src/api/types.js';
import { Composer } from '../src/components/session/Composer.js';
import { LaunchWizard } from '../src/components/launch/LaunchWizard.js';
import { openLaunchWizard, resetLaunchWizard, useLaunchWizard } from '../src/store/launchWizard.js';
import { useComposerChips } from '../src/store/composerChips.js';
import { resetComposerSeats, useComposerSeats } from '../src/store/composerSeats.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { clearRepoCache } from '../src/store/repoCache.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';

const seat = (key: string): RosterSeat =>
  ({ key, display_name: key, binary: key, enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true }) as RosterSeat;
const ROSTER = [seat('claude'), seat('codex'), seat('pi'), seat('copilot')];
const WF = [{ id: 'mcp-server', phases: [{ id: 'build', executes_code: true }] }] as unknown as WorkflowDef[];
const REPO = { id: 'repo-1', name: 'svc', root_path: '/srv/svc', default_branch: 'main', registered_at: 0 } as RepoEntry;

const EXPECTED = {
  problem: 'build an MCP server for the ledger',
  workflow: 'mcp-server',
  clisJson: JSON.stringify([ROSTER[0], ROSTER[2], ROSTER[3]]),
  repoRef: 'repo-1',
  humanConfirm: 'all',
  deliver: 'pr',
};

let posts: Array<{ path: string; body: Record<string, unknown> }> = [];
function stubWire(): void {
  posts = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown> });
      return Promise.resolve(new Response(JSON.stringify({ runId: 'r-new' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    const body = path === '/roster' ? { roster: ROSTER } : path === '/repos' ? { repos: [REPO] } : path === '/workflows' ? { workflows: WF } : path === '/projects' ? { projects: [] } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
}

function Harness(): React.ReactElement {
  const [text, setText] = useState('');
  return (
    <>
      <Composer composerKey="desk" text={text} setText={setText} onSend={() => {}} placeholder="p" ariaLabel="a" variant="desk" navigate={() => {}} />
      <LaunchWizard navigate={() => {}} />
    </>
  );
}
function type(text: string): void {
  const box = screen.getByTestId('desk-composer-input') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text, selectionStart: text.length } });
  box.setSelectionRange(text.length, text.length);
  fireEvent.select(box);
}
const key = (k: string): void => { fireEvent.keyDown(screen.getByTestId('desk-composer-input'), { key: k }); };
const next = (): void => { fireEvent.click(screen.getByTestId('launch-wizard-next')); };

beforeEach(() => {
  stubWire();
  clearCachedRoster();
  setCachedRoster(ROSTER);
  resetComposerSeats();
  resetPlanCatalog();
  clearCachedWorkflows();
  setCachedWorkflows(WF);
  clearRepoCache();
  resetLaunchWizard();
  useComposerChips.setState({ byComposer: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetComposerSeats(); });

describe('launch wizard', () => {
  it('picking a workflow in the composer opens the wizard (a modal dialog), not the inline strip', async () => {
    render(<Harness />);
    type('/workflow-mcp-server');
    key('Enter');
    const dialog = await screen.findByTestId('launch-wizard');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.queryByTestId('composer-launch-row')).toBeNull();
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('what');
  });

  it('Launch sends the same body the strip sent for the same choices', async () => {
    render(<Harness />);
    act(() => { useComposerSeats.getState().toggle('codex'); });
    type('/workflow-mcp-server');
    key('Enter');
    await screen.findByTestId('launch-wizard');
    fireEvent.change(screen.getByTestId('launch-wizard-intent'), { target: { value: 'build an MCP server for the ledger' } });
    next();
    await waitFor(() => expect((screen.getByTestId('launch-wizard-repo') as HTMLSelectElement).value).toBe('repo-1'));
    next();
    fireEvent.change(screen.getByTestId('launch-wizard-gate'), { target: { value: 'all' } });
    next();
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('review');
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(posts.some((p) => p.path === '/runs')).toBe(true));
    expect(posts.find((p) => p.path === '/runs')!.body).toEqual(EXPECTED);
  });

  it('Escape closes it and the draft survives a reopen', async () => {
    render(<Harness />);
    act(() => { openLaunchWizard({ workflowId: 'mcp-server' }); });
    fireEvent.change(await screen.findByTestId('launch-wizard-intent'), { target: { value: 'keep me' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('launch-wizard')).toBeNull());
    expect(posts).toEqual([]);
    act(() => { openLaunchWizard({}); });
    expect(((await screen.findByTestId('launch-wizard-intent')) as HTMLTextAreaElement).value).toBe('keep me');
    expect(useLaunchWizard.getState().draft?.workflowId).toBe('mcp-server');
  });

  it('opened with no workflow it asks which one first, listing the daemon catalog', async () => {
    render(<Harness />);
    act(() => { openLaunchWizard({}); });
    expect((await screen.findByTestId('launch-wizard-step')).dataset.step).toBe('workflow');
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-mcp-server'));
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('what');
  });

  it('codex r1: a draft from one composer never resumes in another (a fresh job there)', () => {
    act(() => { openLaunchWizard({ workflowId: 'mcp-server', composerKey: 'chat-a', intent: 'job for chat a' }); });
    act(() => { useLaunchWizard.getState().close(); });
    act(() => { openLaunchWizard({ workflowId: 'mcp-server', composerKey: 'chat-b' }); });
    expect(useLaunchWizard.getState().draft).toMatchObject({ composerKey: 'chat-b', intent: '' });
  });
});
