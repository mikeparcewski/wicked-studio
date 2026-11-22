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
import { resetWorkflowCatalog } from '../src/store/workflowCatalog.js';
import { useComposerChips } from '../src/store/composerChips.js';
import { resetComposerSeats, useLaunchSeats } from '../src/store/composerSeats.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { clearRepoCache } from '../src/store/repoCache.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { launchLead, workflowLaunchBody } from '../src/board/launchModel.js';
import { postureFieldsOfBody } from '../src/board/launchPosture.js';
import { sessionPath } from '../src/board/sessionModel.js';

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

function Harness({ navigate = () => {} }: { navigate?: (path: string) => void } = {}): React.ReactElement {
  const [text, setText] = useState('');
  return (
    <>
      <Composer composerKey="desk" text={text} setText={setText} onSend={() => {}} placeholder="p" ariaLabel="a" variant="desk" navigate={() => {}} />
      <LaunchWizard navigate={navigate} />
    </>
  );
}
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
  resetWorkflowCatalog();
  useComposerChips.setState({ byComposer: {} });
  useCapabilities.setState({ launchPrimary: false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetComposerSeats(); });

describe('launch wizard', () => {
  // ux-tonight: a composer's `/` pick starts in its chat (tests/inlineStart.test.tsx); the wizard is what a named
  // opener (Learn, Settings' editor plugin, Testing) opens on its workflow.
  it('a named opener opens the wizard (a modal dialog) on its workflow, not the inline strip', async () => {
    render(<Harness />);
    act(() => { openLaunchWizard({ workflowId: 'mcp-server', composerKey: 'desk' }); });
    const dialog = await screen.findByTestId('launch-wizard');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.queryByTestId('composer-launch-row')).toBeNull();
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('what');
  });

  it('Launch sends the same body the strip sent for the same choices', async () => {
    render(<Harness />);
    act(() => { useLaunchSeats.getState().toggle('codex'); });
    act(() => { openLaunchWizard({ workflowId: 'mcp-server', composerKey: 'desk' }); });
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

  it('opened with no workflow it asks which one first, listing the daemon catalog; a card click starts it in a chat', async () => {
    render(<Harness />);
    act(() => { openLaunchWizard({}); });
    expect((await screen.findByTestId('launch-wizard-step')).dataset.step).toBe('workflow');
    fireEvent.click(await screen.findByTestId('launch-wizard-workflow-mcp-server'));
    // ux-tonight: the modal closes and the job is shaped in a chat (tests/inlineStart.test.tsx).
    expect(screen.queryByTestId('launch-wizard')).toBeNull();
    expect(posts).toEqual([]);
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
    // Each greyed helper's Sign in opens its own sign-in modal over the wizard (operator 2026-10-27: it
    // used to close the wizard and open General settings); closing it leaves the wizard where it was.
    const signIns = screen.getAllByTestId('launch-wizard-signin');
    expect(signIns.map((b) => b.dataset.key)).toEqual(['copilot', 'pi']);
    fireEvent.click(signIns[1]!);
    expect((await screen.findByTestId('agents-modal')).dataset.agent).toBe('pi');
    expect(screen.getByTestId('launch-wizard-unusable-note')).toBeTruthy();
    fireEvent.click(screen.getByTestId('agents-modal-close'));
    await waitFor(() => expect(screen.queryByTestId('agents-modal')).toBeNull());
    expect(useLaunchWizard.getState().open).toBe(true);
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
    expect(screen.getByRole('combobox', { name: /^Lead helper/ })).toBe(pick);
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

  it('studio#856: a reviewer-only helper joins the job but is not offered as the lead', async () => {
    useCapabilities.setState({ launchPrimary: true });
    const reviewer = { ...seat('codex'), auth: 'signed_in', council_eligible: true, work_eligible: false, work_ineligible_reason: 'seat not eligible for work' } as RosterSeat;
    setCachedRoster([seat('claude'), reviewer, seat('pi')]);
    await toOptions();
    const chips = screen.getAllByTestId('launch-wizard-seat');
    expect(Object.fromEntries(chips.map((c) => [c.dataset.key, c.getAttribute('aria-pressed')]))).toEqual({ claude: 'true', codex: 'true', pi: 'true' });
    expect(chips.filter((c) => c.dataset.unusable === 'true')).toEqual([]);
    const pick = screen.getByTestId('launch-wizard-lead') as HTMLSelectElement;
    expect([...pick.options].map((o) => o.value)).toEqual(['', 'claude', 'pi']);
  });

  it('studio#856: a job whose only helper reviews is refused, by name (codex r1)', async () => {
    useCapabilities.setState({ launchPrimary: true });
    setCachedRoster([{ ...seat('codex'), auth: 'signed_in', council_eligible: true, work_eligible: false } as RosterSeat]);
    await toOptions();
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('only reviews');
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

describe('power mode in the New job form (DES-POWER-MODE §2)', () => {
  let settings: Record<string, unknown> = {};
  /** The workflows this daemon resolves to a preset; any other is a registered def crew plans the legacy way. */
  let presets = new Set(['mcp-server']);
  /** `POST /runs/preview`, answered by crew's rule (crew `core/launch-posture.ts`, the route's shape at
   *  `api/routes.ts` `${V}/runs/preview`): power when wanted (the body's `power`, else Settings, on when unset) for a
   *  repo-scoped preset launch; else phased, with `powerNotice` when power was wanted. */
  function crewPreview(b: Record<string, unknown>): Record<string, unknown> {
    const wanted = typeof b['power'] === 'boolean' ? b['power'] : b['repoRef'] !== undefined && b['workflow'] !== undefined ? settings['powerModeDefault'] !== false : false;
    const runsPower = wanted && b['repoRef'] !== undefined && presets.has(String(b['workflow']));
    const deliver = b['deliver'] === 'pr' ? 'pr' : 'none';
    return {
      posture: {
        power: runsPower,
        ...(runsPower ? { humanConfirm: 'none' } : {}),
        deliver,
        autoDeliver: b['deliverGate'] === 'auto',
        ...(wanted && !runsPower ? { powerNotice: 'power mode runs a repo-scoped plan or preset launch; this launch runs phased' } : {}),
      },
    };
  }
  beforeEach(() => {
    settings = {};
    presets = new Set(['mcp-server']);
    // Capabilities read once (a first test's own /health read would reset powerMode under it).
    useCapabilities.setState({ loaded: true });
    const inner = (globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>);
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (path === '/settings' && init?.method !== 'POST' && init?.method !== 'PUT' && init?.method !== 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify({ settings }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (path === '/runs/preview' && init?.method === 'POST') {
        const b = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        posts.push({ path, body: b });
        return Promise.resolve(new Response(JSON.stringify(crewPreview(b)), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return inner(url, init);
    }));
  });
  afterEach(() => { useCapabilities.setState({ powerMode: false }); });

  async function toOptions(): Promise<void> {
    render(<Harness />);
    act(() => { openLaunchWizard({ workflowId: 'mcp-server' }); });
    fireEvent.change(await screen.findByTestId('launch-wizard-intent'), { target: { value: 'build an MCP server for the ledger' } });
    next();
    await waitFor(() => expect((screen.getByTestId('launch-wizard-repo') as HTMLSelectElement).value).toBe('repo-1'));
    next();
  }
  async function launched(): Promise<Record<string, unknown>> {
    // Launch waits for crew's posture answer (studio#1305).
    await waitFor(() => expect((screen.getByTestId('launch-wizard-launch') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(posts.some((p) => p.path === '/runs')).toBe(true));
    return posts.find((p) => p.path === '/runs')!.body;
  }

  it('is not offered, and `power` is never sent, on a daemon without capabilities.powerMode', async () => {
    await toOptions();
    expect(screen.queryByTestId('launch-wizard-power')).toBeNull();
    next();
    expect(await launched()).not.toHaveProperty('power');
  });

  it('is preset On from Settings (absent = on): the Ask me choice gives way to the one hand-off question; power: true is sent', async () => {
    useCapabilities.setState({ powerMode: true });
    await toOptions();
    const sw = screen.getByTestId('launch-wizard-power-toggle');
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    expect(screen.queryByTestId('launch-wizard-gate')).toBeNull();
    expect(screen.getByTestId('launch-wizard-power-gates').textContent).toMatch(/once, at hand-off/);
    next();
    expect(screen.getByTestId('launch-wizard-review-power').textContent).toContain('On');
    expect(await launched()).toMatchObject({ power: true });
  });

  it('is preset Off when Settings say "Power mode for new jobs: Off", and can be turned on for this job', async () => {
    settings = { powerModeDefault: false };
    useCapabilities.setState({ powerMode: true });
    await toOptions();
    const sw = screen.getByTestId('launch-wizard-power-toggle');
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'));
    expect(screen.getByTestId('launch-wizard-gate')).toBeTruthy();
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(posts.some((p) => p.path === '/runs/preview' && p.body['power'] === true)).toBe(true));
    next();
    await waitFor(() => expect(screen.queryByTestId('launch-wizard-blocker')).toBeNull());
    expect(await launched()).toMatchObject({ power: true });
  });

  // studio#1305: crew runs a registered (non-preset) workflow phased. The switch, the gates and the review say what crew
  // will do, with crew's reason, and Launch sends power: false (never the On the form used to promise).
  it('a workflow crew runs phased reads Off with crew’s reason, keeps the Ask me choice, and launches phased', async () => {
    presets = new Set();
    useCapabilities.setState({ powerMode: true });
    await toOptions();
    await waitFor(() => expect(screen.getByTestId('launch-wizard-power-notice').textContent).toMatch(/repo-scoped plan or preset launch/));
    expect(screen.getByTestId('launch-wizard-power-toggle').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('launch-wizard-gate')).toBeTruthy();
    expect(screen.queryByTestId('launch-wizard-power-gates')).toBeNull();
    next();
    expect(screen.getByTestId('launch-wizard-review-power').textContent).toMatch(/Off: phased \(power mode runs a repo-scoped plan or preset launch/);
    expect(screen.getByTestId('launch-wizard-review').textContent).not.toMatch(/At hand-off/);
    const body = await launched();
    expect(body).toMatchObject({ power: false, humanConfirm: expect.any(String) });
    // The preview asked about exactly the posture fields of the body Launch sent (and no power: the person chose none).
    expect(posts.filter((p) => p.path === '/runs/preview').at(-1)!.body).toEqual(postureFieldsOfBody(body as never));
  });

  it('Launch waits while crew is asked, and then sends power as crew answered', async () => {
    useCapabilities.setState({ powerMode: true });
    const inner = (globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>);
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (path === '/runs/preview') return held.then(() => inner(url, init));
      return inner(url, init);
    }));
    await toOptions();
    next();
    await waitFor(() => expect(screen.getByTestId('launch-wizard-blocker').textContent).toBe('Checking how this job will run…'));
    expect((screen.getByTestId('launch-wizard-launch') as HTMLButtonElement).disabled).toBe(true);
    release();
    expect(await launched()).toMatchObject({ power: true });
  });

  it('a preview that fails says so with Retry, and Launch runs phased', async () => {
    useCapabilities.setState({ powerMode: true });
    const inner = (globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>);
    let fail = true;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (path === '/runs/preview' && fail) return Promise.resolve(new Response(JSON.stringify({ error: 'down' }), { status: 503, headers: { 'content-type': 'application/json' } }));
      return inner(url, init);
    }));
    await toOptions();
    await waitFor(() => expect(screen.getByTestId('launch-wizard-power-unchecked').dataset['reason']).toBe('failed'));
    expect(screen.getByTestId('launch-wizard-power-toggle').getAttribute('aria-checked')).toBe('false');
    fail = false;
    fireEvent.click(screen.getByTestId('launch-wizard-power-retry'));
    await waitFor(() => expect(screen.getByTestId('launch-wizard-power-toggle').getAttribute('aria-checked')).toBe('true'));
    expect(screen.queryByTestId('launch-wizard-power-unchecked')).toBeNull();
  });

  // codex r2: while crew is asked about the person's On, the form promises nothing about the run.
  it('an On still being checked says so, and crew’s phased answer then reads Off with its reason', async () => {
    presets = new Set();
    useCapabilities.setState({ powerMode: true });
    await toOptions();
    await waitFor(() => expect(screen.getByTestId('launch-wizard-power-notice')).toBeTruthy());
    const inner = (globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>);
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (path === '/runs/preview') return held.then(() => inner(url, init));
      return inner(url, init);
    }));
    fireEvent.click(screen.getByTestId('launch-wizard-power-toggle'));
    await waitFor(() => expect(screen.getByTestId('launch-wizard-power').textContent).toContain('Power mode: checking…'));
    expect(screen.getByTestId('launch-wizard-power-note').textContent).toMatch(/^Checking with Studio’s service/);
    expect(screen.getByTestId('launch-wizard-power').textContent).not.toMatch(/One orchestrator/);
    expect(screen.queryByTestId('launch-wizard-power-gates')).toBeNull();
    release();
    await waitFor(() => expect(screen.getByTestId('launch-wizard-power-toggle').getAttribute('aria-checked')).toBe('false'));
    expect(screen.getByTestId('launch-wizard-power').textContent).toContain('Power mode: Off');
    expect(screen.getByTestId('launch-wizard-power-notice').textContent).toMatch(/repo-scoped plan or preset launch/);
  });

  it('a failed preview launches phased, with the gate chosen here; so does an older daemon with no preview (404)', async () => {
    for (const status of [503, 404]) {
      cleanup();
      resetLaunchWizard();
      posts.length = 0;
      useCapabilities.setState({ powerMode: true });
      const inner = (globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>);
      vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
        const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
        if (path === '/runs/preview') return Promise.resolve(new Response(JSON.stringify({ error: 'no' }), { status, headers: { 'content-type': 'application/json' } }));
        return inner(url, init);
      }));
      await toOptions();
      await waitFor(() => expect(screen.getByTestId('launch-wizard-power-unchecked').dataset['reason']).toBe(status === 404 ? 'unsupported' : 'failed'));
      // Turned on by the person, still no answer: the switch says Off, as Launch runs it (codex r1).
      fireEvent.click(screen.getByTestId('launch-wizard-power-toggle'));
      await waitFor(() => {
        expect(screen.getByTestId('launch-wizard-power-unchecked')).toBeTruthy();
        expect(screen.getByTestId('launch-wizard-power-toggle').getAttribute('aria-checked')).toBe('false');
        expect(useLaunchWizard.getState().draft?.power).toBe(true);
      });
      expect(screen.getByTestId('launch-wizard-gate')).toBeTruthy();
      next();
      expect(await launched()).toMatchObject({ power: false, humanConfirm: expect.any(String) });
      vi.stubGlobal('fetch', inner);
    }
  });

  it('turned off for this job, it sends power: false and the gate posture again', async () => {
    useCapabilities.setState({ powerMode: true });
    await toOptions();
    await waitFor(() => expect(screen.getByTestId('launch-wizard-power-toggle').getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(screen.getByTestId('launch-wizard-power-toggle'));
    expect(screen.getByTestId('launch-wizard-gate')).toBeTruthy();
    next();
    expect(await launched()).toMatchObject({ power: false, humanConfirm: expect.any(String) });
  });

  it('workflowLaunchBody sends power only when chosen', () => {
    const base = { workflowId: 'bug', intent: 'x', seats: [seat('claude')], repoRef: null, projectId: null, humanConfirm: undefined, deliver: null, autoDeliverGate: false, reducedAssurance: false, skipQeReason: null, chatId: null };
    expect(workflowLaunchBody(base)).not.toHaveProperty('power');
    expect(workflowLaunchBody({ ...base, power: null })).not.toHaveProperty('power');
    expect(workflowLaunchBody({ ...base, power: false })).toMatchObject({ power: false });
  });
});


// studio#1239: `POST /runs` → 201 `assuranceNotice` (crew `core/assurance.ts` launchAssuranceNotice, the
// `single_cli_roster` words): the job started under full assurance and will wait for a judge. New job says crew's
// words before it goes to the job, and offers the relaunch in reduced assurance as an explicit, confirmed choice.
describe('studio#1239: New job shows crew’s assurance notice', () => {
  const NOTICE = {
    code: 'single_cli_roster',
    message: 'Every seat that can work (claude) runs the same CLI, so no other CLI can evaluate or judge this run\'s work. Under full assurance the engine refuses a review on its builder\'s seat and holds a gate that needs a judge, so if this run reviews or changes code it will wait at a gate for a distinct seat. Sign a second CLI in, or relaunch with "reducedAssurance": true to let it evaluate its own work, disclosed on every receipt.',
    seats: ['claude'],
    retryWith: { retryOf: 'r-new', reducedAssurance: true },
  };
  beforeEach(() => {
    const inner = (globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>);
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (path === '/runs' && init?.method === 'POST') {
        const b = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        posts.push({ path, body: b });
        const answer = b['retryOf'] !== undefined ? { runId: 'r-reduced' } : { runId: 'r-new', assuranceNotice: NOTICE };
        return Promise.resolve(new Response(JSON.stringify(answer), { status: 201, headers: { 'content-type': 'application/json' } }));
      }
      return inner(url, init);
    }));
  });
  beforeEach(() => { useCapabilities.setState({ chatIdOnLaunch: true }); });
  afterEach(() => { useCapabilities.setState({ reducedAssurance: false, chatIdOnLaunch: false }); });

  const nav = vi.fn();
  async function launchOnce(): Promise<void> {
    nav.mockReset();
    render(<Harness navigate={nav} />);
    // From a chat: the first launch binds to it (chatIdOnLaunch), so the relaunch's dropping it is observable.
    act(() => { openLaunchWizard({ workflowId: 'mcp-server', composerKey: 'chat-abc' }); });
    fireEvent.change(await screen.findByTestId('launch-wizard-intent'), { target: { value: 'build an MCP server for the ledger' } });
    next();
    await waitFor(() => expect((screen.getByTestId('launch-wizard-repo') as HTMLSelectElement).value).toBe('repo-1'));
    next();
    next();
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await screen.findByTestId('launch-wizard-assurance');
  }

  it('says crew’s notice after the launch, and the relaunch is confirmed before it is sent with retryWith', async () => {
    useCapabilities.setState({ reducedAssurance: true });
    await launchOnce();
    expect(screen.getByTestId('launch-wizard-assurance-message').textContent).toBe(NOTICE.message);
    expect(useLaunchWizard.getState().open).toBe(true);
    fireEvent.click(screen.getByTestId('launch-wizard-assurance-reduced'));
    // Nothing more is sent until the person confirms.
    expect(posts.filter((p) => p.path === '/runs')).toHaveLength(1);
    expect(screen.getByTestId('launch-wizard-assurance-confirm').textContent).toMatch(/labelled “Reduced assurance”/);
    fireEvent.click(screen.getByTestId('launch-wizard-assurance-relaunch'));
    await waitFor(() => expect(posts.filter((p) => p.path === '/runs')).toHaveLength(2));
    const [first, again] = posts.filter((p) => p.path === '/runs');
    expect(first!.body['chatId']).toBe('chat-abc');
    const { chatId: _c, ...sameJob } = first!.body;
    void _c;
    expect(again!.body).toEqual({ ...sameJob, retryOf: 'r-new', reducedAssurance: true });
    await waitFor(() => expect(useLaunchWizard.getState().open).toBe(false));
    expect(nav).toHaveBeenCalledWith(sessionPath('run:r-reduced'));
  });

  it('Open the job goes to it and sends nothing more; a daemon without reduced assurance offers no relaunch', async () => {
    await launchOnce();
    expect(screen.queryByTestId('launch-wizard-assurance-reduced')).toBeNull();
    expect(nav).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('launch-wizard-assurance-open'));
    await waitFor(() => expect(useLaunchWizard.getState().open).toBe(false));
    expect(nav).toHaveBeenCalledWith(sessionPath('chat-abc'));
    expect(posts.filter((p) => p.path === '/runs')).toHaveLength(1);
  });

  // codex r2: the notice belongs to the job that drew it; another job opened over the dialog starts without it.
  it('another job opened over the notice starts fresh: no notice, no relaunch of the first job', async () => {
    useCapabilities.setState({ reducedAssurance: true });
    await launchOnce();
    act(() => { openLaunchWizard({ workflowId: 'other-wf', composerKey: 'desk' }); });
    await waitFor(() => expect(screen.queryByTestId('launch-wizard-assurance')).toBeNull());
    expect(screen.getByTestId('launch-wizard-step').dataset.step).not.toBe('launched');
    expect(posts.filter((p) => p.path === '/runs')).toHaveLength(1);
  });
});
