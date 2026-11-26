/**
 * J6 S1 (DES-j6-build S1-S2): a domain model launch asks what the model should cover, shows crew's scope card for
 * those words and that repository on the review step, lets a phrase be added or dropped (asking again), and Launch
 * sends the scope with the hash of the card on screen. No card, a card still being read, or a signed-out writer or
 * checker holds Launch with words. The card is crew's own answer shape (tests/fixtures/domain-v3/README.md).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoEntry, RosterSeat, WorkflowDef } from '../src/api/types.js';
import type { DomainScopeCard } from '../src/api/domainModel-wire.js';
import { LaunchWizard } from '../src/components/launch/LaunchWizard.js';
import { openLaunchWizard, resetLaunchWizard } from '../src/store/launchWizard.js';
import { resetWorkflowCatalog } from '../src/store/workflowCatalog.js';
import { resetComposerSeats } from '../src/store/composerSeats.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { clearRepoCache } from '../src/store/repoCache.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';
import { useCapabilities } from '../src/store/capabilities.js';

// The launch's own check (`resolveHumanConfirm`, which waits on crew's plan preview for a preset) held open by a test,
// so the person can edit the scope while Launch waits on it. Unset: the real hook's answer.
const held = vi.hoisted(() => ({ gate: null as Promise<string | undefined> | null }));
vi.mock('../src/hooks/useLaunchPlan.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/hooks/useLaunchPlan.js')>();
  return {
    ...real,
    useLaunchPreview: (input: Parameters<typeof real.useLaunchPreview>[0]) => {
      const r = real.useLaunchPreview(input);
      return { ...r, resolveHumanConfirm: () => held.gate ?? r.resolveHumanConfirm() };
    },
  };
});

const CARD = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'domain-v3', 'scope-mini-cobol.crew.json'), 'utf8')) as DomainScopeCard;
const seat = (key: string, signedIn = true): RosterSeat =>
  ({ key, display_name: key, binary: key, enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: signedIn }) as RosterSeat;
// crew's own signed-out seat: `seatStanding(seat, false)` (crew packages/crew/src/api/seat-standing.ts:264, as
// roster-standing.ts:408 calls it) over a roster seat, printed by running it (j6-build S1 fold). A signed-out seat
// is also not work-eligible, which studio's standing says first (codex S1 r1).
const CODEX_SIGNED_OUT = {
  key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, health: { status: 'active', since: 'x' },
  auth: 'signed_out', login_check: 'unverified',
  login_note: 'login unverified — nothing asked codex whether its login works (no auth-status check), so its sign-in is read from its credential file; its first refused turn signs it out',
  council_eligible: false, council_ineligible_reason: 'signed out — a council would bench this seat on its first ballot; sign it in from the Helpers page',
  work_eligible: false, work_ineligible_reason: 'signed out — a council would bench this seat on its first ballot; sign it in from the Helpers page',
} as unknown as RosterSeat;
const WF = [{ id: 'domain-extraction', phases: [{ id: 'domain-run' }] }] as unknown as WorkflowDef[];
const REPO = { id: 'repo-1', name: 'payroll', root_path: '/srv/payroll', default_branch: 'main', registered_at: 0 } as RepoEntry;
const INTENT = 'How PAYCALC1 computes pay from the payroll file';

let posts: Array<{ path: string; body: Record<string, unknown> }> = [];
let preview: (body: Record<string, unknown>) => unknown | Promise<unknown> = () => ({ posture: { power: false, deliver: 'none', autoDeliver: false }, scopeCard: CARD });
function stubWire(roster: RosterSeat[]): void {
  posts = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    const json = (b: unknown): Promise<Response> => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } }));
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      posts.push({ path, body });
      if (path === '/runs/preview') return Promise.resolve(preview(body)).then(json);
      return json({ runId: 'r-new' });
    }
    return json(path === '/roster' ? { roster } : path === '/repos' ? { repos: [REPO] } : path === '/workflows' ? { workflows: WF } : path === '/projects' ? { projects: [] } : {});
  }));
}
const scopeAsks = (): Array<Record<string, unknown>> => posts.filter((p) => p.path === '/runs/preview' && p.body['domainScope'] !== undefined).map((p) => p.body);
const next = (): void => { fireEvent.click(screen.getByTestId('launch-wizard-next')); };

async function toReview(): Promise<void> {
  render(<LaunchWizard navigate={() => {}} />);
  act(() => { openLaunchWizard({ workflowId: 'domain-extraction', contextRepo: 'repo-1', composerKey: 'repo:repo-1' }); });
  await screen.findByTestId('launch-wizard');
  expect(screen.getByText('What should the model cover?')).toBeTruthy();
  // The words are required: they are what the model covers.
  next();
  expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('what');
  fireEvent.change(screen.getByTestId('launch-wizard-intent'), { target: { value: INTENT } });
  next();
  await waitFor(() => expect((screen.getByTestId('launch-wizard-repo') as HTMLSelectElement).value).toBe('repo-1'));
  next();
  next();
  expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('review');
}

function setup(roster: RosterSeat[]): void {
  stubWire(roster);
  clearCachedRoster();
  setCachedRoster(roster);
  resetComposerSeats();
  resetPlanCatalog();
  clearCachedWorkflows();
  setCachedWorkflows(WF);
  clearRepoCache();
  resetLaunchWizard();
  resetWorkflowCatalog();
  useCapabilities.setState({ launchPrimary: false });
}

afterEach(() => { held.gate = null; cleanup(); vi.unstubAllGlobals(); resetComposerSeats(); preview = () => ({ posture: { power: false, deliver: 'none', autoDeliver: false }, scopeCard: CARD }); });

describe('a domain model launch (J6 S1)', () => {
  beforeEach(() => setup([seat('claude'), seat('codex')]));

  it('shows the scope card for the words and repository, and Launch sends the scope with the hash shown', async () => {
    await toReview();
    const card = await screen.findByTestId('domain-scope-card');
    await waitFor(() => expect(card.dataset.state).toBe('ready'));
    expect(scopeAsks()).toEqual([{ workflow: 'domain-extraction', repoRef: 'repo-1', domainScope: { intent: INTENT } }]);
    expect(within(card).getByTestId('domain-scope-size')).toHaveTextContent('2 files · 4 targets');
    expect(within(card).getByTestId('domain-scope-phrase')).toHaveTextContent('PAYCALC1app/cbl/PAYCALC1.cbl');
    expect(within(card).getByTestId('domain-scope-reached')).toHaveTextContent('STEP1 -> PAYCALC1 (app/jcl/PAYJOB.jcl:2)');
    expect(within(card).getByTestId('domain-scope-seats')).toHaveTextContent('Writer: Claude Code · Checker: Codex');
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(posts.some((p) => p.path === '/runs')).toBe(true));
    const sent = posts.find((p) => p.path === '/runs')!.body;
    expect(sent['workflow']).toBe('domain-extraction');
    expect(sent['repoRef']).toBe('repo-1');
    expect(sent['domainScope']).toEqual({ intent: INTENT, scopeHash: CARD.scopeHash });
  });

  it('a typed phrase asks again, and Launch sends the phrases and the new hash', async () => {
    const second = { ...CARD, scopeHash: 'b'.repeat(64), phrases: { ...CARD.phrases, PAYJOB: ['app/jcl/PAYJOB.jcl'] } };
    preview = (body) => ({ posture: { power: false, deliver: 'none', autoDeliver: false }, scopeCard: (body['domainScope'] as { phrases?: string[] }).phrases !== undefined ? second : CARD });
    await toReview();
    await waitFor(() => expect(screen.getByTestId('domain-scope-card').dataset.state).toBe('ready'));
    // One phrase cannot be dropped: the scope would be empty.
    expect(screen.getByTestId('domain-scope-drop')).toBeDisabled();
    fireEvent.change(screen.getByTestId('domain-scope-add-input'), { target: { value: 'PAYJOB' } });
    fireEvent.click(screen.getByTestId('domain-scope-add'));
    // At once the card on screen is no longer the answer: Launch waits for the new one.
    expect(screen.getByTestId('domain-scope-card').dataset.state).toBe('loading');
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('Reading the code for the scope…');
    await waitFor(() => expect(screen.getAllByTestId('domain-scope-phrase')).toHaveLength(2));
    expect(scopeAsks().at(-1)).toEqual({ workflow: 'domain-extraction', repoRef: 'repo-1', domainScope: { intent: INTENT, phrases: ['PAYCALC1', 'PAYJOB'] } });
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(posts.some((p) => p.path === '/runs')).toBe(true));
    expect(posts.find((p) => p.path === '/runs')!.body['domainScope']).toEqual({ intent: INTENT, phrases: ['PAYCALC1', 'PAYJOB'], scopeHash: 'b'.repeat(64) });
  });

  it("no card holds Launch, with crew's words on the card; Read the code again asks again", async () => {
    let graph = false;
    preview = () => ({ posture: { power: false, deliver: 'none', autoDeliver: false }, ...(graph ? { scopeCard: CARD } : { scopeError: 'repository repo-1 has no code graph yet' }) });
    await toReview();
    expect(await screen.findByTestId('domain-scope-error')).toHaveTextContent('No scope yet: repository repo-1 has no code graph yet');
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('There is no scope to start from yet: see the card.');
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await new Promise((r) => setTimeout(r, 20));
    expect(posts.some((p) => p.path === '/runs')).toBe(false);
    // codex S1 r1: a failed answer is not final for the open form; the person asks again (the graph is built meanwhile).
    graph = true;
    const asked = scopeAsks().length;
    fireEvent.click(screen.getByTestId('domain-scope-refresh'));
    await waitFor(() => expect(screen.getByTestId('domain-scope-card').dataset.state).toBe('ready'));
    expect(scopeAsks()).toHaveLength(asked + 1);
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(posts.some((p) => p.path === '/runs')).toBe(true));
  });

  it('a phrase changed while Launch is being checked stops the launch instead of sending the older scope', async () => {
    const second = { ...CARD, scopeHash: 'b'.repeat(64), phrases: { ...CARD.phrases, PAYJOB: ['app/jcl/PAYJOB.jcl'] } };
    preview = (body) => ({ posture: { power: false, deliver: 'none', autoDeliver: false }, scopeCard: (body['domainScope'] as { phrases?: string[] }).phrases !== undefined ? second : CARD });
    let hold: ((v: string | undefined) => void) | null = null;
    await toReview();
    await waitFor(() => expect(screen.getByTestId('domain-scope-card').dataset.state).toBe('ready'));
    held.gate = new Promise((resolve) => { hold = resolve; });
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(hold).not.toBeNull());
    fireEvent.change(screen.getByTestId('domain-scope-add-input'), { target: { value: 'PAYJOB' } });
    fireEvent.click(screen.getByTestId('domain-scope-add'));
    await waitFor(() => expect(screen.getAllByTestId('domain-scope-phrase')).toHaveLength(2));
    await act(async () => { hold!(undefined); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByTestId('launch-wizard-error')).toHaveTextContent('This job changed while it was being checked'));
    expect(posts.some((p) => p.path === '/runs')).toBe(false);
    held.gate = null;
  });
});

describe('a domain model launch with a helper signed out', () => {
  beforeEach(() => setup([seat('claude'), CODEX_SIGNED_OUT]));

  it('says which helper to sign in and launches nothing', async () => {
    await toReview();
    const card = await screen.findByTestId('domain-scope-card');
    expect(within(card).getByTestId('domain-scope-seats')).toHaveTextContent('Checker: Codex (signed out)');
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('Sign in Codex to check the rules.');
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await new Promise((r) => setTimeout(r, 20));
    expect(posts.some((p) => p.path === '/runs')).toBe(false);
  });
});

describe('a domain model launch on a computer without the checker', () => {
  beforeEach(() => setup([seat('claude'), seat('pi')]));

  it('says the checker is not set up and launches nothing', async () => {
    await toReview();
    const card = await screen.findByTestId('domain-scope-card');
    expect(within(card).getByTestId('domain-scope-seats')).toHaveTextContent('Checker: Codex (not set up on this computer)');
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('Set up Codex on this computer to check the rules (Agents).');
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await new Promise((r) => setTimeout(r, 20));
    expect(posts.some((p) => p.path === '/runs')).toBe(false);
  });
});
