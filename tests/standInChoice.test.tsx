/**
 * DES-STANDIN-001 studio S0 (Refs wicked-core#1843): a launch crew refuses with `409 stand_in_choice` (too few
 * helpers signed in to check the job; nothing created) shows a first-time user a plain choice, not an error, and
 * each choice does what it says (DES §2.1 step 3); a mid-run `stand_in_needed` gate draws `use_stand_ins{scope}`.
 *
 * Both fixtures are DES EXAMPLES, marked as such in their files, which name the swap for the real writers' output.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import type { RepoEntry, RosterSeat, WorkflowDef } from '../src/api/types.js';
import { choiceTokens, contractChoices, type GateAction } from '../src/board/gateContract.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { helperNamer, saveStandInsEveryJob, SETTINGS_NOT_SAVED, standInChoiceOf, standInChoiceWords, standInRelaunchBody, type StandInChoiceRefusal } from '../src/board/standIn.js';
import { ChatInput } from '../src/components/ChatInput.js';
import { LaunchWizard } from '../src/components/launch/LaunchWizard.js';
import { Composer } from '../src/components/session/Composer.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useComposerChips } from '../src/store/composerChips.js';
import { resetComposerSeats } from '../src/store/composerSeats.js';
import type { OpenGate } from '../src/store/gates.js';
import { openLaunchWizard, resetLaunchWizard } from '../src/store/launchWizard.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { clearRepoCache } from '../src/store/repoCache.js';
import { takeRetryPrefill } from '../src/store/retryPrefill.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { resetWorkflowCatalog } from '../src/store/workflowCatalog.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures', name), 'utf8')) as Record<string, unknown>;
/** DES §5.2 + §3.9 example (§2.1: Claude Code only). */
const CHOICE = fixture('stand-in-choice.des-example.json') as { status: number; body: Record<string, unknown> };
const refusalError = (body: Record<string, unknown> = CHOICE.body): ApiError => new ApiError(CHOICE.status, String(body['error']), body);

const seat = (key: string, display: string): RosterSeat =>
  ({ key, display_name: display, binary: key, enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true }) as RosterSeat;
const ROSTER = [seat('claude', 'Claude Code')];
const name = helperNamer(ROSTER);

/** Words the brief keeps off the screen: engine terms, the status code and the refusal's code. */
const OFF_SCREEN = /\bseat|roster|independen|\b409\b|stand_in|evaluator|qe_reviewer|rule_judge|party_excluded|\bQE\b|\bsonnet\b|this service|daemon/i;

describe('the 409 stand_in_choice body, read', () => {
  it('reads the DES example whole', () => {
    const r = standInChoiceOf(refusalError())!;
    expect(r).not.toBeNull();
    expect(r.choices.map((c) => c.id)).toEqual(['job', 'always', 'sign_in', 'cancel']);
    expect(r.retryWith).toEqual({ standIns: true });
    expect(r.preflight.signedIn).toEqual(['claude']);
    expect(r.preflight.roles.filter((x) => x.shortBy > 0).map((x) => x.role)).toEqual(['evaluator', 'judge', 'qe_reviewer', 'rule_judge', 'council']);
  });

  it('is not a choice: another status, another code, no re-send, or no choice studio knows', () => {
    expect(standInChoiceOf(new ApiError(400, 'x', CHOICE.body))).toBeNull();
    expect(standInChoiceOf(new ApiError(409, 'x', { ...CHOICE.body, code: 'no_usable_helper' }))).toBeNull();
    expect(standInChoiceOf(refusalError({ ...CHOICE.body, retryWith: {} }))).toBeNull();
    expect(standInChoiceOf(refusalError({ ...CHOICE.body, choices: [{ id: 'later', label: 'Later' }] }))).toBeNull();
    expect(standInChoiceOf(new Error('409 stand_in_choice'))).toBeNull();
  });

  it('keeps only the listed choices it knows, once each, in crew\'s order', () => {
    const r = standInChoiceOf(refusalError({ ...CHOICE.body, choices: [{ id: 'cancel', label: '' }, { id: 'later', label: '' }, { id: 'job', label: '' }, { id: 'cancel', label: '' }] }))!;
    expect(r.choices.map((c) => c.id)).toEqual(['cancel', 'job']);
  });

  it('"every job" not saved, refused or not kept, says one plain sentence (coord round 2)', async () => {
    expect(SETTINGS_NOT_SAVED).toBe('Settings could not be saved, so nothing started. Choose “Use stand-ins for this job” instead, or try again.');
    expect(SETTINGS_NOT_SAVED).not.toMatch(OFF_SCREEN);
    const put = vi.spyOn(client.api, 'updateSettings').mockRejectedValueOnce(new ApiError(500, 'the daemon refused this'));
    await expect(saveStandInsEveryJob()).rejects.toThrow(SETTINGS_NOT_SAVED);
    put.mockResolvedValueOnce({ settings: {} } as never);
    await expect(saveStandInsEveryJob()).rejects.toThrow(SETTINGS_NOT_SAVED);
    put.mockResolvedValueOnce({ settings: { standInReview: 'always' } } as never);
    await expect(saveStandInsEveryJob()).resolves.toBeUndefined();
    put.mockRestore();
  });

  it('"this job" re-sends the exact request with retryWith, and nothing else changes', () => {
    const sent = { problem: 'fix the reader', workflow: 'bug', sessionId: 'r-1', clisJson: '[]', repoRef: 'repo-1', deliver: 'pr' as const };
    expect(standInRelaunchBody(sent, standInChoiceOf(refusalError())!)).toEqual({ ...sent, standIns: true });
  });
});

describe('the words a first-time user reads', () => {
  const words = standInChoiceWords(standInChoiceOf(refusalError())!, name);
  const all = [words.title, words.why, words.meaning, words.record, ...words.choices.flatMap((c) => [c.label, c.next])];

  it('one CLI: who is signed in, what the job needs, what a stand-in is, and what the record says', () => {
    expect(words.title).toBe('Only one helper can check this job');
    // coord round 2: the QE role by what it does; no model named (studio names none on screen).
    expect(words.why).toBe('Claude Code is the only helper signed in. This job needs checks by helpers that did not build the work: a reviewer, a judge, a tester who checks the result does what you asked, and a rules checker, plus a council of 3 if a disagreement comes up.');
    expect(words.meaning).toBe('wicked can fill those roles with stand-ins. A stand-in is Claude Code again, in a separate, fresh session: it sees the work but none of the builder\'s reasoning.');
    expect(words.record).toMatch(/say a stand-in did the check/);
    expect(words.record).toMatch(/never counted as a check by a different helper/);
  });

  it('each choice says what happens next', () => {
    expect(words.choices.map((c) => c.label)).toEqual(['Use stand-ins for this job', 'Use stand-ins for every job', 'Sign in another helper', 'Cancel']);
    expect(words.choices.map((c) => c.next)).toEqual([
      'Starts this job now. You will be asked again next time.',
      'Starts this job now and stops asking. You can change this later in Settings.',
      'Opens Helpers. Nothing starts; start the job again once another helper is signed in.',
      'Nothing starts. What you wrote is kept.',
    ]);
  });

  it('no engine term, status or code reaches the screen, whatever crew\'s own labels say', () => {
    const r = standInChoiceOf(refusalError({ ...CHOICE.body, choices: [{ id: 'job', label: 'stand_in_choice: seat roster lacks independence (409)' }] }))!;
    const w = standInChoiceWords(r, name);
    for (const s of [...all, w.choices[0]!.label]) expect(s).not.toMatch(OFF_SCREEN);
  });

  it('two CLIs, only a council short (DES §2.2): the council is what is asked about', () => {
    const body = structuredClone(CHOICE.body) as { preflight: { signedIn: string[]; roles: Array<Record<string, unknown>> } };
    body.preflight.signedIn = ['claude', 'codex'];
    body.preflight.roles = body.preflight.roles.map((r) => (r['role'] === 'council' ? r : { ...r, real: ['codex'], shortBy: 0 }));
    const w = standInChoiceWords(standInChoiceOf(refusalError(body as never))!, helperNamer([...ROSTER, seat('codex', 'Codex')]));
    expect(w.title).toBe('A disagreement would need 3 stand-ins');
    expect(w.why).toBe('Claude Code and Codex are signed in. If a disagreement comes up, it goes to a council of helpers that did not build or review the work. There are not enough of them left for that.');
    expect(w.meaning).toMatch(/^wicked can fill those roles with stand-ins\. A stand-in is Claude Code again/);
  });

  it('one council seat short reads "1 stand-in"', () => {
    const body = structuredClone(CHOICE.body) as { preflight: { signedIn: string[]; roles: Array<Record<string, unknown>> } };
    body.preflight.signedIn = ['claude', 'codex', 'pi'];
    body.preflight.roles = body.preflight.roles.map((r) => (r['role'] === 'council' ? { ...r, real: ['pi', 'codex'], shortBy: 1 } : { ...r, real: ['codex'], shortBy: 0 }));
    expect(standInChoiceWords(standInChoiceOf(refusalError(body as never))!, name).title).toBe('A disagreement would need 1 stand-in');
  });

  it('a helper the roster does not name is named the way studio names its family; no model said when none is known', () => {
    const body = structuredClone(CHOICE.body) as { preflight: { signedIn: string[]; roles: Array<{ standInFrom: { cli: string; models: (string | null)[] } }> } };
    body.preflight.signedIn = ['codex#2'];
    for (const r of body.preflight.roles) r.standInFrom = { cli: 'codex#2', models: [null] };
    const w = standInChoiceWords(standInChoiceOf(refusalError(body as never))!, helperNamer([]));
    expect(w.why).toMatch(/^Codex \(2\) is the only helper signed in\./);
    expect(w.meaning).toMatch(/Codex \(2\) again, in a separate, fresh session: it sees the work but none of the builder's reasoning\.$/);
  });
});

// ── The launch form (the wizard a first-time user starts a job from) ─────────────────────────────────────────────

const WF = [{ id: 'bug', phases: [{ id: 'build', executes_code: true }] }] as unknown as WorkflowDef[];
const REPO = { id: 'repo-1', name: 'svc', root_path: '/srv/svc', default_branch: 'main', registered_at: 0 } as RepoEntry;
let calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
let launchAnswers: Array<{ status: number; body: unknown }> = [];
let settingsEcho: Record<string, unknown> = { standInReview: 'always' };

function stubWire(): void {
  calls = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    const json = (status: number, body: unknown): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
    const method = init?.method ?? 'GET';
    if (method !== 'GET') calls.push({ method, path, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    if (method === 'POST' && path === '/runs') {
      const next = launchAnswers.shift() ?? { status: 201, body: { runId: 'r-new' } };
      return json(next.status, next.body);
    }
    if (method === 'PUT' && path === '/settings') return json(200, { settings: settingsEcho });
    if (method !== 'GET') return json(200, {});
    const body = path === '/roster' ? { roster: ROSTER } : path === '/repos' ? { repos: [REPO] } : path === '/workflows' ? { workflows: WF } : path === '/projects' ? { projects: [] } : {};
    return json(200, body);
  }));
}

function Harness({ navigate }: { navigate: (path: string) => void }): React.ReactElement {
  const [text, setText] = useState('');
  return (
    <>
      <Composer composerKey="desk" text={text} setText={setText} onSend={() => {}} placeholder="p" ariaLabel="a" variant="desk" navigate={() => {}} />
      <LaunchWizard navigate={navigate} />
    </>
  );
}

const launches = (): Array<Record<string, unknown>> => calls.filter((c) => c.method === 'POST' && c.path === '/runs').map((c) => c.body);

describe('the launch wizard asks instead of failing', () => {
  beforeEach(() => {
    stubWire();
    launchAnswers = [{ status: 409, body: CHOICE.body }];
    settingsEcho = { standInReview: 'always' };
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

  async function launchRefused(navigate = vi.fn()): Promise<ReturnType<typeof vi.fn>> {
    render(<Harness navigate={navigate} />);
    act(() => { openLaunchWizard({ workflowId: 'bug', composerKey: 'desk' }); });
    await screen.findByTestId('launch-wizard');
    fireEvent.change(screen.getByTestId('launch-wizard-intent'), { target: { value: 'fix the reader' } });
    for (let i = 0; i < 6 && screen.getByTestId('launch-wizard-step').dataset.step !== 'review'; i += 1) {
      await waitFor(() => expect(screen.getByTestId('launch-wizard-next')).toBeEnabled());
      fireEvent.click(screen.getByTestId('launch-wizard-next'));
    }
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('review');
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await screen.findByTestId('launch-wizard-standin');
    return navigate;
  }

  it('the refusal is the choice, with no error line; nothing else was sent', async () => {
    await launchRefused();
    expect(screen.queryByTestId('launch-wizard-error')).toBeNull();
    expect(screen.getByTestId('launch-wizard-standin-title')).toHaveTextContent('Only one helper can check this job');
    expect(screen.getByTestId('launch-wizard-standin-why')).toHaveTextContent('Claude Code is the only helper signed in.');
    expect(screen.getByTestId('launch-wizard-standin').textContent).not.toMatch(OFF_SCREEN);
    expect(screen.getByTestId('launch-wizard-standin-job')).toHaveAccessibleDescription('Starts this job now. You will be asked again next time.');
    expect(launches()).toHaveLength(1);
  });

  it('"this job": the same request again with standIns, then the job opens', async () => {
    const navigate = await launchRefused();
    fireEvent.click(screen.getByTestId('launch-wizard-standin-job'));
    await waitFor(() => expect(launches()).toHaveLength(2));
    const [first, second] = launches();
    expect(second).toEqual({ ...first, standIns: true });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/s/run%3Ar-new'));
    expect(calls.some((c) => c.path === '/settings')).toBe(false);
  });

  it('"every job": the setting first, then the same request unchanged (consent comes from the setting)', async () => {
    const navigate = await launchRefused();
    fireEvent.click(screen.getByTestId('launch-wizard-standin-always'));
    await waitFor(() => expect(launches()).toHaveLength(2));
    const order = calls.map((c) => `${c.method} ${c.path}`);
    expect(order.indexOf('PUT /settings')).toBeLessThan(order.lastIndexOf('POST /runs'));
    expect(calls.find((c) => c.path === '/settings')!.body).toEqual({ standInReview: 'always' });
    const [first, second] = launches();
    expect(second).toEqual(first);
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });

  it('"every job" on a service that does not keep the setting: nothing starts, the card stays and says so, and "this job" still works (codex r1)', async () => {
    settingsEcho = {};
    const navigate = await launchRefused();
    fireEvent.click(screen.getByTestId('launch-wizard-standin-always'));
    await screen.findByTestId('launch-wizard-standin-error');
    expect(screen.getByTestId('launch-wizard-standin-error')).toHaveTextContent('Settings could not be saved, so nothing started. Choose “Use stand-ins for this job” instead, or try again.');
    expect(screen.queryByTestId('launch-wizard-error')).toBeNull();
    expect(launches()).toHaveLength(1);
    expect(navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('launch-wizard-standin-job')).toBeEnabled());
    fireEvent.click(screen.getByTestId('launch-wizard-standin-job'));
    await waitFor(() => expect(launches()).toHaveLength(2));
    expect(launches()[1]).toEqual({ ...launches()[0], standIns: true });
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });

  it('"cancel" starts nothing, writes nothing, and keeps the job as written (codex r1)', async () => {
    const navigate = await launchRefused();
    fireEvent.click(screen.getByTestId('launch-wizard-standin-cancel'));
    expect(screen.queryByTestId('launch-wizard-standin')).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(launches()).toHaveLength(1);
    expect(calls.some((c) => c.path === '/settings')).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('launch-wizard-review')).toHaveTextContent('fix the reader');
  });

  it('"sign in another helper" opens Helpers, starts nothing, and keeps the draft', async () => {
    const navigate = await launchRefused();
    fireEvent.click(screen.getByTestId('launch-wizard-standin-sign_in'));
    expect(navigate).toHaveBeenCalledWith('/agents');
    expect(launches()).toHaveLength(1);
    expect(calls.some((c) => c.path === '/settings')).toBe(false);
    act(() => { openLaunchWizard({ workflowId: 'bug', composerKey: 'desk' }); });
    expect((await screen.findByTestId('launch-wizard-intent') as HTMLTextAreaElement).value).toBe('fix the reader');
  });

  async function toReview(): Promise<void> {
    for (let i = 0; i < 6 && screen.getByTestId('launch-wizard-step').dataset.step !== 'review'; i += 1) {
      await waitFor(() => expect(screen.getByTestId('launch-wizard-next')).toBeEnabled());
      fireEvent.click(screen.getByTestId('launch-wizard-next'));
    }
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('review');
  }
  async function backToWhat(): Promise<void> {
    while (screen.getByTestId('launch-wizard-step').dataset.step !== 'what') {
      await waitFor(() => expect(screen.getByTestId('launch-wizard-back')).toBeEnabled());
      fireEvent.click(screen.getByTestId('launch-wizard-back'));
    }
  }

  it('an edit after the refusal is what a choice sends: nothing is replayed from the refused attempt (codex r1 + delta)', async () => {
    await launchRefused();
    await backToWhat();
    expect(screen.queryByTestId('launch-wizard-standin')).toBeNull();
    fireEvent.change(screen.getByTestId('launch-wizard-intent'), { target: { value: 'fix the writer instead' } });
    await toReview();
    fireEvent.click(screen.getByTestId('launch-wizard-standin-job'));
    await waitFor(() => expect(launches()).toHaveLength(2));
    const [first, second] = launches();
    expect(second).toEqual({ ...first, problem: 'fix the writer instead', standIns: true });
  });

  it('while "every job" is saving, Launch, Back and Close wait: one launch, after the save (codex delta 2)', async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    const wire = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(((url: string, init?: RequestInit) => (init?.method === 'PUT' ? held.then(() => wire(url, init)) : wire(url, init))) as never);
    const navigate = await launchRefused();
    fireEvent.click(screen.getByTestId('launch-wizard-standin-always'));
    await waitFor(() => expect(screen.getByTestId('launch-wizard-standin-always')).toHaveTextContent('Starting…'));
    expect(screen.getByTestId('launch-wizard-launch')).toBeDisabled();
    expect(screen.getByTestId('launch-wizard-back')).toBeDisabled();
    expect(screen.getByTestId('launch-wizard-close')).toBeDisabled();
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    expect(launches()).toHaveLength(1);
    await act(async () => { release(); });
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(launches()).toHaveLength(2);
    expect(launches()[1]).toEqual(launches()[0]);
  });

  it('going back and forth without an edit keeps the card for the same request', async () => {
    await launchRefused();
    fireEvent.click(screen.getByTestId('launch-wizard-back'));
    expect(screen.queryByTestId('launch-wizard-standin')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('launch-wizard-next')).toBeEnabled());
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    expect(screen.getByTestId('launch-wizard-standin')).toBeTruthy();
  });

  it('another refusal is still an error line, not the card', async () => {
    launchAnswers = [{ status: 409, body: { code: 'no_usable_helper', error: 'No signed-in helper can check this job.' } }];
    render(<Harness navigate={vi.fn()} />);
    act(() => { openLaunchWizard({ workflowId: 'bug', composerKey: 'desk' }); });
    await screen.findByTestId('launch-wizard');
    fireEvent.change(screen.getByTestId('launch-wizard-intent'), { target: { value: 'fix the reader' } });
    for (let i = 0; i < 6 && screen.getByTestId('launch-wizard-step').dataset.step !== 'review'; i += 1) {
      await waitFor(() => expect(screen.getByTestId('launch-wizard-next')).toBeEnabled());
      fireEvent.click(screen.getByTestId('launch-wizard-next'));
    }
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await screen.findByTestId('launch-wizard-error');
    expect(screen.queryByTestId('launch-wizard-standin')).toBeNull();
  });
});

/** A Send mints its own session id each time (the refused one created nothing); the rest is compared. */
const withoutId = (b: unknown): Record<string, unknown> => { const o = { ...(b as Record<string, unknown>) }; delete o['sessionId']; return o; };

describe('the /runs/new launch form asks too', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    takeRetryPrefill();
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
    vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
    vi.spyOn(client.api, 'getHealth').mockResolvedValue({ status: 'ok', version: 'test', capabilities: {} } as never);
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: ROSTER });
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('a refused Send shows the choice; "this job" re-sends it with standIns and opens the job', async () => {
    const launch = vi.spyOn(client.api, 'launchRun').mockRejectedValueOnce(refusalError()).mockResolvedValueOnce({ runId: 'r-new' });
    const onLaunched = vi.fn();
    render(<ChatInput runId={null} runStatus={null} onLaunched={onLaunched} />);
    fireEvent.change(screen.getByTestId('launch-problem'), { target: { value: 'fix the reader' } });
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    fireEvent.click(screen.getByTestId('launch-submit'));
    await screen.findByTestId('launch-standin');
    expect(screen.queryByTestId('launch-error')).toBeNull();
    expect(onLaunched).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('launch-standin-job'));
    await waitFor(() => expect(onLaunched).toHaveBeenCalledWith('r-new'));
    const [first, second] = launch.mock.calls.map((c) => withoutId(c[0]));
    expect(second).toEqual({ ...first, standIns: true });
    expect(screen.queryByTestId('launch-standin')).toBeNull();
  });

  it('an edit while "every job" is saving is what is sent, unflagged, once the setting is saved (codex delta)', async () => {
    let release: () => void = () => {};
    vi.spyOn(client.api, 'updateSettings').mockImplementation(() => new Promise((r) => { release = () => r({ settings: { standInReview: 'always' } } as never); }));
    const launch = vi.spyOn(client.api, 'launchRun').mockRejectedValueOnce(refusalError()).mockResolvedValueOnce({ runId: 'r-new' });
    const onLaunched = vi.fn();
    render(<ChatInput runId={null} runStatus={null} onLaunched={onLaunched} />);
    fireEvent.change(screen.getByTestId('launch-problem'), { target: { value: 'fix the reader' } });
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    fireEvent.click(screen.getByTestId('launch-submit'));
    await screen.findByTestId('launch-standin');
    fireEvent.click(screen.getByTestId('launch-standin-always'));
    await waitFor(() => expect(client.api.updateSettings).toHaveBeenCalledWith({ standInReview: 'always' }));
    fireEvent.change(screen.getByTestId('launch-problem'), { target: { value: 'fix the writer instead' } });
    expect(screen.getByTestId('launch-submit')).toBeDisabled();
    fireEvent.click(screen.getByTestId('launch-submit'));
    expect(launch).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    await waitFor(() => expect(onLaunched).toHaveBeenCalledWith('r-new'));
    const [first, second] = launch.mock.calls.map((c) => withoutId(c[0]));
    expect(second).toEqual({ ...first, problem: 'fix the writer instead' });
  });

  it('a choice on a form that cannot launch says why, and saves and sends nothing (codex delta 2)', async () => {
    const settings = vi.spyOn(client.api, 'updateSettings');
    const launch = vi.spyOn(client.api, 'launchRun').mockRejectedValueOnce(refusalError());
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    fireEvent.change(screen.getByTestId('launch-problem'), { target: { value: 'fix the reader' } });
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    fireEvent.click(screen.getByTestId('launch-submit'));
    await screen.findByTestId('launch-standin');
    fireEvent.change(screen.getByTestId('launch-problem'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('launch-standin-always'));
    expect(await screen.findByTestId('launch-standin-error')).toHaveTextContent('Say what the job is');
    expect(settings).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('an edit to the words after the refusal is what "this job" sends (codex r1 + delta)', async () => {
    const launch = vi.spyOn(client.api, 'launchRun').mockRejectedValueOnce(refusalError()).mockResolvedValueOnce({ runId: 'r-new' });
    const onLaunched = vi.fn();
    render(<ChatInput runId={null} runStatus={null} onLaunched={onLaunched} />);
    fireEvent.change(screen.getByTestId('launch-problem'), { target: { value: 'fix the reader' } });
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    fireEvent.click(screen.getByTestId('launch-submit'));
    await screen.findByTestId('launch-standin');
    fireEvent.change(screen.getByTestId('launch-problem'), { target: { value: 'fix the writer instead' } });
    fireEvent.click(screen.getByTestId('launch-standin-job'));
    await waitFor(() => expect(onLaunched).toHaveBeenCalledWith('r-new'));
    const [first, second] = launch.mock.calls.map((c) => withoutId(c[0]));
    expect(second).toEqual({ ...first, problem: 'fix the writer instead', standIns: true });
  });
});

// ── The mid-run gate (DES S0 row: before core C3) ────────────────────────────────────────────────────────────────

describe('a stand_in_needed gate draws use_stand_ins with its scope', () => {
  const shape = (fixture('stand-in-needed-gate.des-example.json') as Record<string, { ord: number; gateKind: string; actions: GateAction[] }>)['stand-in-needed']!;

  it('the controls are the list, and each scope sends {action: use_stand_ins, scope}', () => {
    const { choices, overflow } = contractChoices(shape.actions, (c) => c);
    const all = [...choices, ...overflow];
    expect(choiceTokens(all).sort()).toEqual(['approve', 'reject', 'use_stand_ins']);
    const stand = all.filter((c) => c.key.startsWith('stand-ins:'));
    expect(stand.map((c) => [c.label, c.decision])).toEqual([
      ['Use a stand-in for this job', { approve: true, action: 'use_stand_ins', scope: 'job' }],
      ['Use stand-ins for every job', { approve: true, action: 'use_stand_ins', scope: 'always' }],
    ]);
    for (const c of stand) {
      expect(c.note).toBe('none');
      expect(`${c.label} ${c.title ?? ''}`).not.toMatch(OFF_SCREEN);
    }
  });

  it('the session gate row draws the same list', () => {
    const gate: OpenGate = { runId: 'r', ord: shape.ord, prompt: 'No helper left to judge this step.', lifecycle: 'open', receivedAt: 1, gateKind: shape.gateKind };
    const model = sessionGateChoices({ runId: 'r', gate, units: [], events: [], pool: ['claude'], roster: null, actions: shape.actions });
    const all = [...model!.choices, ...model!.overflow];
    expect(choiceTokens(all).sort()).toEqual(['approve', 'reject', 'use_stand_ins']);
    expect(all.filter((c) => c.key.startsWith('stand-ins:')).map((c) => (c.decision as { scope?: string }).scope)).toEqual(['job', 'always']);
  });
});

// Type-level: the refusal type is the DES §5.2 shape.
const _shape: StandInChoiceRefusal['retryWith'] = { standIns: true };
void _shape;
