/**
 * studio#1436: on a launch the stand-in card's `preflight.signedIn` is the helpers PICKED for this job (wicked-core
 * `src/independence.rs` `IndependencePreflight.signed_in`: "the work seats the run would start with"), not every helper
 * signed in. With Codex and Pi signed in but not picked, the card said "Claude Code is the only helper signed in" and
 * offered "Sign in another helper". It now says what was picked, names the signed-in helpers left out, and offers to
 * pick one, which goes back to the form's helper options.
 *
 * The 409 body is a writer's output: crew 0.18.22's own `preflightRefusal` over the engine's preflight JSON (see the
 * fixture's `$comment`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import type { RepoEntry, RosterSeat, WorkflowDef } from '../src/api/types.js';
import { helperNamer, standInChoiceOf, standInChoiceWords } from '../src/board/standIn.js';
import { ChatInput } from '../src/components/ChatInput.js';
import { LaunchWizard } from '../src/components/launch/LaunchWizard.js';
import { Composer } from '../src/components/session/Composer.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useComposerChips } from '../src/store/composerChips.js';
import { resetComposerSeats } from '../src/store/composerSeats.js';
import { openLaunchWizard, resetLaunchWizard } from '../src/store/launchWizard.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { clearRepoCache } from '../src/store/repoCache.js';
import { takeRetryPrefill } from '../src/store/retryPrefill.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { resetWorkflowCatalog } from '../src/store/workflowCatalog.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';

const CHOICE = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/stand-in-choice-picked-one.crew.json'), 'utf8')) as { status: number; body: Record<string, unknown> };
const refusalError = (): ApiError => new ApiError(CHOICE.status, String(CHOICE.body['error']), CHOICE.body);
/** The engine's key for the picked helper in the writer's output. */
const PICKED = (CHOICE.body['preflight'] as { signedIn: string[] }).signedIn;

const seat = (key: string, display: string, signedIn = true): RosterSeat =>
  ({ key, display_name: display, binary: key, enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: signedIn, auth: signedIn ? 'signed_in' : 'signed_out' }) as RosterSeat;
/** Claude Code, Codex and Pi signed in; OpenCode signed out (it is never named as one to pick). */
const ROSTER = [seat(PICKED[0]!, 'Claude Code'), seat('codex', 'Codex'), seat('pi', 'Pi CLI'), seat('opencode', 'OpenCode', false)];
const name = helperNamer(ROSTER);
const SIGNED_IN_NOW = [PICKED[0]!, 'codex', 'pi'];

const OFF_SCREEN = /\bseat|roster|independen|\b409\b|stand_in|evaluator|qe_reviewer|rule_judge|party_excluded|\bQE\b|this service|daemon/i;

describe('the words when other helpers are signed in but not picked', () => {
  it('the writer\'s body is the one-helper launch the card was wrong about', () => {
    expect(PICKED).toEqual(['tr2-claude']);
    expect(standInChoiceOf(refusalError())!.choices.map((c) => c.id)).toEqual(['job', 'always', 'sign_in', 'cancel']);
  });

  it('says what was picked, names the signed-in helpers left out, and offers to pick one', () => {
    const w = standInChoiceWords(standInChoiceOf(refusalError())!, name, SIGNED_IN_NOW);
    expect(w.title).toBe('Only one helper is picked for this job');
    expect(w.why).toMatch(/^Only Claude Code is picked for this job\. This job needs checks by helpers that did not build the work: /);
    expect(w.why).toMatch(/ Codex and Pi CLI are signed in but not picked: pick them to have the work checked by helpers that did not build it\.$/);
    expect(w.why).not.toMatch(/only helper signed in/);
    expect(w.why).not.toMatch(/OpenCode/);
    expect(w.choices.map((c) => [c.id, c.label])).toEqual([
      ['job', 'Use stand-ins for this job'], ['always', 'Use stand-ins for every job'], ['pick', 'Pick another helper'], ['cancel', 'Cancel'],
    ]);
    expect(w.choices[2]!.next).toBe('Opens this job\'s helpers. Nothing starts; turn another helper on, then start the job again.');
    for (const s of [w.title, w.why, w.meaning, w.record, ...w.choices.flatMap((c) => [c.label, c.next])]) expect(s).not.toMatch(OFF_SCREEN);
  });

  it('one helper left out is named alone', () => {
    const w = standInChoiceWords(standInChoiceOf(refusalError())!, name, [PICKED[0]!, 'codex']);
    expect(w.why).toMatch(/ Codex is signed in but not picked: pick it to have the work checked by a helper that did not build it\.$/);
  });

  it('a helper is left out by its key, not its name: a second "Claude Code" signed in is still one to pick (codex r1)', () => {
    const twin = helperNamer([...ROSTER, seat('claude#2', 'Claude Code')]);
    const w = standInChoiceWords(standInChoiceOf(refusalError())!, twin, [PICKED[0]!, 'claude#2']);
    expect(w.title).toBe('Only one helper is picked for this job');
    expect(w.choices.map((c) => c.id)).toContain('pick');
  });

  it('a helper the preflight benched is not one to pick', () => {
    const body = structuredClone(CHOICE.body) as { preflight: { benched: Array<{ seat: string; reason: string }> } };
    body.preflight.benched = [{ seat: 'pi', reason: 'out of quota' }];
    const w = standInChoiceWords(standInChoiceOf(new ApiError(409, 'x', body))!, name, SIGNED_IN_NOW);
    expect(w.why).toMatch(/ Codex is signed in but not picked: pick it /);
    expect(w.why).not.toMatch(/Pi CLI/);
  });

  it('nobody else signed in: the card still says sign in, as before', () => {
    const w = standInChoiceWords(standInChoiceOf(refusalError())!, name, [PICKED[0]!]);
    expect(w.title).toBe('Only one helper can check this job');
    expect(w.why).toMatch(/^Claude Code is the only helper signed in\./);
    expect(w.choices.map((c) => c.id)).toEqual(['job', 'always', 'sign_in', 'cancel']);
    expect(standInChoiceWords(standInChoiceOf(refusalError())!, name).choices.map((c) => c.id)).toEqual(['job', 'always', 'sign_in', 'cancel']);
  });
});

// ── /runs/new ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('/runs/new: Pick another helper opens the helper options', () => {
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

  /** A helper's box in the + options, opening them when they are closed. */
  async function optionsSeat(key: string): Promise<HTMLElement> {
    if (screen.queryByTestId(`launch-seat-${key}`) === null) fireEvent.click(screen.getByRole('button', { name: 'Open launch options' }));
    return screen.findByTestId(`launch-seat-${key}`);
  }

  /** Codex and Pi turned off in the + helper options, then Send: crew refuses with the one-helper body. */
  async function sendClaudeOnly(): Promise<{ launch: ReturnType<typeof vi.spyOn>; navigate: ReturnType<typeof vi.fn> }> {
    const launch = vi.spyOn(client.api, 'launchRun').mockRejectedValueOnce(refusalError());
    const navigate = vi.fn();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} navigate={navigate} />);
    fireEvent.change(screen.getByTestId('launch-problem'), { target: { value: 'fix the reader' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open launch options' }));
    for (const key of ['codex', 'pi']) {
      // The form's defaults land after the roster read: every signed-in helper on. Then this person turns two off.
      await waitFor(() => expect((screen.getByTestId(`launch-seat-${key}`) as HTMLInputElement).checked).toBe(true));
      fireEvent.click(screen.getByTestId(`launch-seat-${key}`));
      expect((screen.getByTestId(`launch-seat-${key}`) as HTMLInputElement).checked).toBe(false);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Open launch options' }));
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    fireEvent.click(screen.getByTestId('launch-submit'));
    await screen.findByTestId('launch-standin');
    const sent = JSON.parse(String((launch.mock.calls[0]![0] as { clisJson?: string }).clisJson)) as Array<{ key: string }>;
    expect(sent.map((x) => x.key)).toEqual([PICKED[0]]);
    return { launch, navigate };
  }

  it('the card names Codex and Pi; Pick another helper starts nothing and shows the helpers to turn on', async () => {
    const { launch, navigate } = await sendClaudeOnly();
    expect(screen.getByTestId('launch-standin-title')).toHaveTextContent('Only one helper is picked for this job');
    expect(screen.getByTestId('launch-standin-why')).toHaveTextContent('Codex and Pi CLI are signed in but not picked');
    expect(screen.queryByTestId('launch-standin-sign_in')).toBeNull();
    fireEvent.click(screen.getByTestId('launch-standin-pick'));
    expect(screen.queryByTestId('launch-standin')).toBeNull();
    expect((await screen.findByTestId('launch-seat-codex') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('launch-seat-pi') as HTMLInputElement).checked).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('the card says a signed-out helper is neither picked nor one to pick', async () => {
    await sendClaudeOnly();
    expect(screen.getByTestId('launch-standin-why').textContent).not.toMatch(/OpenCode/);
  });

  it('a helper turned on while the Send is out: the refusal that lands is not shown as this pick\'s card (codex delta)', async () => {
    let refuse: () => void = () => {};
    const launch = vi.spyOn(client.api, 'launchRun').mockImplementationOnce(() => new Promise((_r, reject) => { refuse = () => reject(refusalError()); }));
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} navigate={vi.fn()} />);
    fireEvent.change(screen.getByTestId('launch-problem'), { target: { value: 'fix the reader' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open launch options' }));
    for (const key of ['codex', 'pi']) {
      await waitFor(() => expect((screen.getByTestId(`launch-seat-${key}`) as HTMLInputElement).checked).toBe(true));
      fireEvent.click(screen.getByTestId(`launch-seat-${key}`));
    }
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    fireEvent.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    fireEvent.click(await optionsSeat('codex'));
    await act(async () => { refuse(); await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByTestId('launch-standin')).toBeNull();
    // Turning Codex off again is the refused request again: its card is back.
    fireEvent.click(await optionsSeat('codex'));
    expect(await screen.findByTestId('launch-standin')).toBeTruthy();
  });

  it('"every job" not saved after the pick changed meanwhile: the failure stays in view (codex delta)', async () => {
    let fail: () => void = () => {};
    vi.spyOn(client.api, 'updateSettings').mockImplementationOnce(() => new Promise((_r, reject) => { fail = () => reject(new ApiError(500, 'no')); }));
    const { launch } = await sendClaudeOnly();
    fireEvent.click(screen.getByTestId('launch-standin-always'));
    await waitFor(() => expect(client.api.updateSettings).toHaveBeenCalled());
    fireEvent.click(await optionsSeat('codex'));
    await act(async () => { fail(); await new Promise((r) => setTimeout(r, 20)); });
    expect(await screen.findByTestId('launch-standin-error')).toHaveTextContent('Settings could not be saved, so nothing started.');
    // The card's words answered Claude Code alone; Codex is picked now, so they are not shown (codex delta 2).
    expect(screen.queryByTestId('launch-standin')).toBeNull();
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('turning a helper on after the refusal drops the card: its "not picked" words no longer hold (codex r1)', async () => {
    const { launch } = await sendClaudeOnly();
    fireEvent.click(screen.getByRole('button', { name: 'Open launch options' }));
    fireEvent.click(await screen.findByTestId('launch-seat-codex'));
    await waitFor(() => expect(screen.queryByTestId('launch-standin')).toBeNull());
    expect(launch).toHaveBeenCalledTimes(1);
  });
});

// ── The launch wizard ────────────────────────────────────────────────────────────────────────────────────────────

const WF = [{ id: 'bug', phases: [{ id: 'build', executes_code: true }] }] as unknown as WorkflowDef[];
const REPO = { id: 'repo-1', name: 'svc', root_path: '/srv/svc', default_branch: 'main', registered_at: 0 } as RepoEntry;
let posts: Array<{ method: string; path: string; body?: string }> = [];
const wizardSeat = (key: string): HTMLElement => screen.getAllByTestId('launch-wizard-seat').find((b) => b.dataset.key === key)!;
/** The helper keys the wizard's first POST /runs sent. */
const launchedKeys = (): string[] => {
  const body = JSON.parse(posts.find((p) => p.method === 'POST' && p.path === '/runs')!.body ?? '{}') as { clisJson?: string };
  return (JSON.parse(body.clisJson ?? '[]') as Array<{ key: string }>).map((x) => x.key);
};

function stubWire(): void {
  posts = [];
  let refused = false;
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    const json = (status: number, body: unknown): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
    const method = init?.method ?? 'GET';
    if (method !== 'GET') posts.push({ method, path, body: String(init?.body ?? '') });
    if (method === 'POST' && path === '/runs') {
      if (!refused) { refused = true; return json(CHOICE.status, CHOICE.body); }
      return json(201, { runId: 'r-new' });
    }
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

describe('the launch wizard: Pick another helper goes back to Options', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  /** Codex and Pi turned off on Options, then Launch: crew refuses with the one-helper body. */
  async function launchClaudeOnly(navigate: (path: string) => void): Promise<void> {
    render(<Harness navigate={navigate} />);
    act(() => { openLaunchWizard({ workflowId: 'bug', composerKey: 'desk' }); });
    await screen.findByTestId('launch-wizard');
    fireEvent.change(screen.getByTestId('launch-wizard-intent'), { target: { value: 'fix the reader' } });
    for (let i = 0; i < 6 && screen.getByTestId('launch-wizard-step').dataset.step !== 'review'; i += 1) {
      await waitFor(() => expect(screen.getByTestId('launch-wizard-next')).toBeEnabled());
      if (screen.getByTestId('launch-wizard-step').dataset.step === 'options') {
        for (const key of ['codex', 'pi']) {
          if (wizardSeat(key).getAttribute('aria-pressed') === 'true') fireEvent.click(wizardSeat(key));
          expect(wizardSeat(key)).toHaveAttribute('aria-pressed', 'false');
        }
      }
      fireEvent.click(screen.getByTestId('launch-wizard-next'));
    }
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await screen.findByTestId('launch-wizard-standin');
    expect(launchedKeys()).toEqual([PICKED[0]]);
  }

  it('the card names Codex and Pi; Pick another helper starts nothing and opens the Options step', async () => {
    const navigate = vi.fn();
    await launchClaudeOnly(navigate);
    expect(screen.getByTestId('launch-wizard-standin-title')).toHaveTextContent('Only one helper is picked for this job');
    expect(screen.getByTestId('launch-wizard-standin-why')).toHaveTextContent('Codex and Pi CLI are signed in but not picked');
    fireEvent.click(screen.getByTestId('launch-wizard-standin-pick'));
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('options');
    expect(screen.queryByTestId('launch-wizard-standin')).toBeNull();
    expect(wizardSeat('codex')).toHaveAttribute('aria-pressed', 'false');
    expect(navigate).not.toHaveBeenCalled();
    expect(posts.filter((p) => p.method === 'POST' && p.path === '/runs')).toHaveLength(1);
  });

  it('Back to Options and turning a helper on drops the card; Back and Next alone keep it (codex r1)', async () => {
    await launchClaudeOnly(vi.fn());
    fireEvent.click(screen.getByTestId('launch-wizard-back'));
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('options');
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    expect(screen.getByTestId('launch-wizard-standin')).toBeTruthy();
    fireEvent.click(screen.getByTestId('launch-wizard-back'));
    fireEvent.click(wizardSeat('codex'));
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('review');
    expect(screen.queryByTestId('launch-wizard-standin')).toBeNull();
  });
});
