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
import { resetComposerSeats, useLaunchSeats } from '../src/store/composerSeats.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { clearRepoCache } from '../src/store/repoCache.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { launchLead, workflowLaunchBody } from '../src/board/launchModel.js';

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
  useCapabilities.setState({ launchPrimary: false });
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
    act(() => { useLaunchSeats.getState().toggle('codex'); });
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

  it('operator ruling 2026-10-11: opencode is UNTICKED in the wizard with "opt-in: known to stall", and is sent only once ticked', async () => {
    const withOpencode = [...ROSTER, seat('opencode')];
    setCachedRoster(withOpencode);
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (init?.method === 'POST') {
        posts.push({ path, body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown> });
        return Promise.resolve(new Response(JSON.stringify({ runId: 'r-new' }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      const body = path === '/roster' ? { roster: withOpencode } : path === '/repos' ? { repos: [REPO] } : path === '/workflows' ? { workflows: WF } : path === '/projects' ? { projects: [] } : {};
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    }));
    render(<Harness />);
    act(() => { openLaunchWizard({ workflowId: 'mcp-server' }); });
    fireEvent.change(await screen.findByTestId('launch-wizard-intent'), { target: { value: 'build it' } });
    next();
    await waitFor(() => expect((screen.getByTestId('launch-wizard-repo') as HTMLSelectElement).value).toBe('repo-1'));
    next();
    const chips = screen.getAllByTestId('launch-wizard-seat');
    const oc = chips.find((c) => c.dataset.key === 'opencode')!;
    expect(oc.getAttribute('aria-pressed')).toBe('false');
    expect(chips.filter((c) => c.dataset.key !== 'opencode').every((c) => c.getAttribute('aria-pressed') === 'true')).toBe(true);
    const note = screen.getByTestId('launch-wizard-optin-note');
    expect(note).toHaveTextContent('opt-in: known to stall');
    expect(oc.getAttribute('aria-describedby')).toBe(note.id);
    next();
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(posts.some((p) => p.path === '/runs')).toBe(true));
    const sent = JSON.parse(String(posts.find((p) => p.path === '/runs')!.body.clisJson)) as Array<{ key: string }>;
    expect(sent.map((x) => x.key)).not.toContain('opencode');
    // An explicit tick is the operator's choice: it is sent.
    expect(oc.getAttribute('aria-pressed')).toBe('false');
    act(() => { useLaunchSeats.getState().toggle('opencode'); });
    expect(useLaunchSeats.getState().picked).toContain('opencode');
  });

  it('PRODUCT-WORKS J4: only helpers that can take work are picked; a benched or signed-out one is greyed out with why, and joins only when ticked', async () => {
    const lift = new Date(Date.now() + 3_600_000).toISOString();
    const roster = [
      seat('claude'),
      seat('codex'),
      { ...seat('copilot'), benchedUntil: lift, benchReason: 'quota_exhausted', recent_bench: { kind: 'quota_exhausted', runs: 1, last_at: lift, lifts_at: lift, until_source: 'engine', strikes: 1, source: 'worker', reason: 'quota_exhausted' } } as RosterSeat,
      { ...seat('pi'), signed_in: false, auth: 'signed_out' } as RosterSeat,
    ];
    setCachedRoster(roster);
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (init?.method === 'POST') {
        posts.push({ path, body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown> });
        return Promise.resolve(new Response(JSON.stringify({ runId: 'r-new' }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      const body = path === '/roster' ? { roster } : path === '/repos' ? { repos: [REPO] } : path === '/workflows' ? { workflows: WF } : path === '/projects' ? { projects: [] } : {};
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    }));
    render(<Harness />);
    act(() => { openLaunchWizard({ workflowId: 'mcp-server' }); });
    fireEvent.change(await screen.findByTestId('launch-wizard-intent'), { target: { value: 'build it' } });
    next();
    await waitFor(() => expect((screen.getByTestId('launch-wizard-repo') as HTMLSelectElement).value).toBe('repo-1'));
    next();
    const chips = screen.getAllByTestId('launch-wizard-seat');
    const pressed = Object.fromEntries(chips.map((c) => [c.dataset.key, c.getAttribute('aria-pressed')]));
    expect(pressed).toEqual({ claude: 'true', codex: 'true', copilot: 'false', pi: 'false' });
    expect(chips.filter((c) => c.dataset.unusable === 'true').map((c) => c.dataset.key)).toEqual(['copilot', 'pi']);
    const note = screen.getByTestId('launch-wizard-unusable-note');
    expect(note).toHaveTextContent('copilot (out of quota — back by');
    expect(note).toHaveTextContent('pi (signed out)');
    expect(screen.getByTestId('launch-wizard-signin')).toBeTruthy();
    next();
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(posts.some((p) => p.path === '/runs')).toBe(true));
    const sent = JSON.parse(String(posts.find((p) => p.path === '/runs')!.body.clisJson)) as Array<{ key: string }>;
    expect(sent.map((x) => x.key)).toEqual(['claude', 'codex']);
    // The operator may still choose one: a tick is an explicit pick.
    act(() => { useLaunchSeats.getState().toggle('copilot', true); });
    expect(useLaunchSeats.getState().picked).toContain('copilot');
  });
});

describe('Draft epics — a launch-wizard job (operator 2026-10-12: the Product page retired)', () => {
  const REQS = {
    projectId: 'shop', offset: 0, limit: 50, totals: { repos: 1, ok: 1, absent: 0, errors: 0, dangling: 0, total: 2, corpus: 2 },
    rows: [{ repo: { id: 'r-api', name: 'shop-api' }, state: 'ok', total: 2, corpus: 2, orphanedOverrides: 0, items: [
      { key: 'k1', domain: 'billing', reqId: 'REQ-1', title: 'Refund rule 1', category: 'functional', statement: 's', status: 'draft', risk: false, riskSource: null, edited: false },
      { key: 'k2', domain: 'billing', reqId: 'REQ-2', title: 'Refund rule 2', category: 'functional', statement: 's', status: 'draft', risk: false, riskSource: null, edited: false },
    ] }],
  };
  function wireDraft(): void {
    posts = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (init?.method === 'POST') {
        posts.push({ path, body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown> });
        return Promise.resolve(new Response(JSON.stringify({ runId: 'r-draft', requirements: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      const body = path === '/projects' ? { projects: [{ id: 'shop', name: 'Shop', description: null, status: 'active', scope: 'project:shop', created_at: 1, updated_at: 1 }] }
        : path === '/projects/shop/requirements' ? REQS : path === '/workflows' ? { workflows: WF } : path === '/roster' ? { roster: ROSTER } : {};
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    }));
  }

  it('is offered beside the daemon’s workflows, asks for the requirements, and launches crew’s compose run', async () => {
    wireDraft();
    const navigate = vi.fn();
    render(<LaunchWizard navigate={navigate} />);
    act(() => openLaunchWizard({ projectId: 'shop' }));
    fireEvent.click(await screen.findByTestId('launch-wizard-workflow-draft-epics'));
    expect(screen.getByTestId('launch-wizard-step')).toHaveAttribute('data-step', 'requirements');
    expect(screen.getByTestId('launch-wizard-next')).toBeDisabled();
    const picks = await screen.findAllByTestId('requirement-pick');
    fireEvent.click(picks[1]!);
    fireEvent.change(screen.getByTestId('launch-wizard-draft-instructions'), { target: { value: 'one epic per domain' } });
    expect(screen.getByTestId('launch-wizard-chosen')).toHaveTextContent('1 requirement chosen');
    next();
    expect(screen.getByTestId('launch-wizard-review')).toHaveTextContent('Refund rule 2');
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/s/run%3Ar-draft'));
    expect(posts).toEqual([{ path: '/projects/shop/product/compose', body: { requirements: [{ repoId: 'r-api', key: 'k2' }], instructions: 'one epic per domain' } }]);
  });

  it('opened from a project with picks already chosen, it starts on its requirements step with them', async () => {
    wireDraft();
    render(<LaunchWizard navigate={vi.fn()} />);
    act(() => openLaunchWizard({ workflowId: 'draft-epics', projectId: 'shop', requirements: [{ repoId: 'r-api', key: 'k1', title: 'Refund rule 1' }] }));
    expect(await screen.findByTestId('launch-wizard-requirements')).toBeInTheDocument();
    expect(screen.getByTestId('launch-wizard-chosen')).toHaveTextContent('1 requirement chosen');
    expect(screen.getByTestId('launch-wizard-next')).toBeEnabled();
    expect(useLaunchWizard.getState().draft?.requirements).toHaveLength(1);
  });

  it('instructions carried in longer than a draft takes block the launch, so the review is what is sent', async () => {
    wireDraft();
    render(<LaunchWizard navigate={vi.fn()} />);
    act(() => openLaunchWizard({ workflowId: 'draft-epics', projectId: 'shop', intent: 'x'.repeat(600), requirements: [{ repoId: 'r-api', key: 'k1', title: 'Refund rule 1' }] }));
    await screen.findByTestId('launch-wizard-requirements');
    expect(screen.getByTestId('launch-wizard-next')).toBeDisabled();
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('Shorten the instructions to 500 characters.');
    expect(posts).toEqual([]);
  });

  it('a refused draft keeps the choice and says crew’s words; nothing navigates', async () => {
    wireDraft();
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ error: 'requirement r-api/k1 is not in the project' }), { status: 400, headers: { 'content-type': 'application/json' } }));
      return Promise.resolve(new Response(JSON.stringify(path === '/projects/shop/requirements' ? REQS : {}), { status: 200, headers: { 'content-type': 'application/json' } }));
    }));
    const navigate = vi.fn();
    render(<LaunchWizard navigate={navigate} />);
    act(() => openLaunchWizard({ workflowId: 'draft-epics', projectId: 'shop', requirements: [{ repoId: 'r-api', key: 'k1', title: 'Refund rule 1' }] }));
    await screen.findByTestId('launch-wizard-requirements');
    next();
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    expect(await screen.findByTestId('launch-wizard-error')).toBeInTheDocument();
    expect(useLaunchWizard.getState().draft?.requirements).toHaveLength(1);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('the Lead agent (DES-TEAMING-002 §8.1)', () => {
  async function toOptions(): Promise<void> {
    render(<Harness />);
    act(() => { openLaunchWizard({ workflowId: 'mcp-server' }); });
    fireEvent.change(await screen.findByTestId('launch-wizard-intent'), { target: { value: 'build an MCP server for the ledger' } });
    next();
    await waitFor(() => expect((screen.getByTestId('launch-wizard-repo') as HTMLSelectElement).value).toBe('repo-1'));
    next();
  }

  it('is not offered, and nothing is sent, on a daemon that does not take it', async () => {
    await toOptions();
    expect(screen.queryByTestId('launch-wizard-lead')).toBeNull();
    next();
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(posts.some((p) => p.path === '/runs')).toBe(true));
    expect(posts.find((p) => p.path === '/runs')!.body).not.toHaveProperty('primary');
  });

  it('defaults to Random (no primary sent), lists every helper on, and sends the one picked', async () => {
    useCapabilities.setState({ launchPrimary: true });
    await toOptions();
    const pick = screen.getByTestId('launch-wizard-lead') as HTMLSelectElement;
    expect(pick.value).toBe('');
    expect([...pick.options].map((o) => o.textContent)).toEqual(['Random', 'claude', 'codex', 'pi', 'copilot']);
    fireEvent.change(pick, { target: { value: 'codex' } });
    next();
    expect(screen.getByTestId('launch-wizard-review-lead').textContent).toContain('codex');
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(posts.some((p) => p.path === '/runs')).toBe(true));
    expect(posts.find((p) => p.path === '/runs')!.body).toMatchObject({ primary: 'codex' });
  });

  it('a signed-out helper is not offered as the lead', async () => {
    useCapabilities.setState({ launchPrimary: true });
    setCachedRoster([seat('claude'), { ...seat('codex'), signed_in: false } as RosterSeat, seat('pi')]);
    await toOptions();
    const pick = screen.getByTestId('launch-wizard-lead') as HTMLSelectElement;
    expect([...pick.options].map((o) => o.value)).toEqual(['', 'claude', 'pi']);
  });

  it('a lead whose helper is turned off reads as Random again', () => {
    expect(launchLead('codex', [seat('claude'), seat('pi')], true)).toBeNull();
    expect(launchLead('pi', [seat('claude'), seat('pi')], true)).toBe('pi');
    expect(launchLead('pi', [seat('claude'), seat('pi')], false)).toBeNull();
    const base = { workflowId: 'bug', intent: 'x', seats: [seat('claude')], repoRef: null, projectId: null, humanConfirm: undefined, deliver: null, autoDeliverGate: false, reducedAssurance: false, skipQeReason: null, chatId: null };
    expect(workflowLaunchBody({ ...base, primary: 'codex' })).not.toHaveProperty('primary');
    expect(workflowLaunchBody({ ...base, primary: 'claude' })).toMatchObject({ primary: 'claude' });
  });
});
