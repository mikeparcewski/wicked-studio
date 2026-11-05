/**
 * ux-tonight (operator 2026-11-04 on :7721): "clicking on a workflow opens a modal rather than starting an inline chat,
 * needs to be removed and chat done inline"; "are apps showing as coming soon (in chat)"; "don't I see a way to onboard
 * a repo anymore".
 *
 *  - a `/` pick puts the card on the chat's composer (no modal, nothing sent); Enter starts it INTO this chat, stopped
 *    at its plan (`humanConfirm: before:1`, and `power: false` on a daemon with power mode, which has no plan gate);
 *  - what the start still needs (the words, a repository, a project) is asked on the composer, never in a form;
 *  - New job's card click starts it in a chat too (a new chat when none is in view);
 *  - Apps (crew's `{kind: 'app'}`) is a new app by chat; Add a repository (`{kind: 'repo'}`) opens the register form.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoEntry, RosterSeat, WorkflowDef } from '../src/api/types.js';
import { catalogFromWire } from '../src/board/workflowCatalog.js';
import { LaunchWizard } from '../src/components/launch/LaunchWizard.js';
import { Composer } from '../src/components/session/Composer.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { resetChatFlow, useChatFlow } from '../src/store/chatFlow.js';
import { chipsOf, useComposerChips } from '../src/store/composerChips.js';
import { resetComposerSeats } from '../src/store/composerSeats.js';
import { openLaunchWizard, resetLaunchWizard, useLaunchWizard } from '../src/store/launchWizard.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { useProjectsStore } from '../src/store/projects.js';
import { clearRepoCache } from '../src/store/repoCache.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { useSessionDrafts } from '../src/store/sessionDrafts.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';
import { resetWorkflowCatalog } from '../src/store/workflowCatalog.js';
import rig from './fixtures/workflowCatalog-rig.json';

const def = (id: string): WorkflowDef => ({ id, phases: [{ id: 'work', executes_code: true }] }) as unknown as WorkflowDef;
const SEATS = [
  { key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true, signed_in: true },
  { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, signed_in: true },
] as RosterSeat[];
const repo = (id: string): RepoEntry => ({ id, name: id, root_path: `/srv/${id}`, default_branch: 'main', registered_at: 0 }) as RepoEntry;
const PROJECT = { id: 'p1', name: 'Payments', description: null, status: 'active', scope: 'project:p1', created_at: 0, updated_at: 0 };

/** The rig's catalog as crew serves it after crew#1349: Apps a new app by chat, Add a repository a card. */
const entries = (rig as { entries: Array<Record<string, unknown>> }).entries
  .filter((e) => e['id'] !== 'apps-turn' && e['id'] !== 'apps-publish')
  .map((e) => (e['id'] === 'apps' ? { ...e, status: 'available', statusNote: null, launch: { kind: 'app' },
    inputs: [{ id: 'intent', label: 'What should the app show?', kind: 'text', required: true }, { id: 'project', label: 'Project', kind: 'project', required: true }] } : e));
const CATALOG = { ...rig, entries: [...entries, {
  ...entries.find((e) => e['id'] === 'start-chat')!, id: 'add-repo', title: 'Add a repository', launch: { kind: 'repo' }, needs: ['nothing'],
  inputs: [{ id: 'project', label: 'Project', kind: 'project', required: false }], delivers: 'none',
}] };

let repos: RepoEntry[] = [];
/** The presets the scope serves (a built-in `bug` preset makes the launch preview run), and what the preview says. */
let presets: unknown[] = [];
let preview: unknown = { steps: [] };
/** A health read that never answers (the capabilities stay unread). */
let holdHealth = false;
/** What `GET /health` answers: power mode on the daemon, or a failed read. */
let healthPower = true;
let healthFails = false;
let read: string[] = [];
const gets = (): string[] => read;
let posts: Array<{ path: string; body: Record<string, unknown> }> = [];
function stubWire(): void {
  posts = [];
  read = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    const json = (body: unknown, status = 200): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
    if (init?.method !== undefined && init.method !== 'GET') {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
      posts.push({ path, body });
      if (path === '/runs') return json({ runId: 'run-new' }, 201);
      if (path === '/plans/preview') return json(preview);
      if (path === '/apps') return json({ app: { slug: String(body['slug']), name: 'x', projectId: body['projectId'], head: { version: 1 } } }, 201);
      if (/^\/apps\/[^/]+\/turns$/.test(path)) return json({ runId: 'turn-run', turnId: 't1' }, 202);
      return json({ ok: true });
    }
    read.push(path);
    if (path === '/health' && holdHealth) return new Promise<Response>(() => {});
    if (path === '/health') return healthFails ? json({ error: 'down' }, 503) : json({ capabilities: { powerMode: healthPower, chatIdOnLaunch: true } });
    if (path === '/workflows/catalog') return json(CATALOG);
    return json(path === '/workflows' ? { workflows: ['bug', 'feature', 'domain-extraction', 'review-recent-work'].map(def) }
      : path === '/roster' ? { roster: SEATS } : path === '/repos' ? { repos }
        : path === '/presets' ? { presets } : path === '/projects' ? { projects: [PROJECT] } : path === '/settings' ? { settings: {} } : {});
  }));
}

function Harness({ navigate, composerKey = 'chat-1' }: { navigate: (p: string) => void; composerKey?: string }): React.ReactElement {
  const [text, setText] = useState('');
  return <Composer composerKey={composerKey} text={text} setText={setText} onSend={() => {}} placeholder="p" ariaLabel="a" variant="session" navigate={navigate} />;
}
const box = (): HTMLTextAreaElement => screen.getByTestId('session-composer-input') as HTMLTextAreaElement;
function type(text: string): void {
  fireEvent.change(box(), { target: { value: text, selectionStart: text.length } });
  box().setSelectionRange(text.length, text.length);
  fireEvent.select(box());
}
const row = (entry: string): HTMLElement => document.querySelector<HTMLElement>(`[data-testid="composer-menu-item"][data-entry="${entry}"]`)!;
async function pick(entry: string, query: string): Promise<void> {
  type(`/${query}`);
  await waitFor(() => expect(row(entry)).not.toBeNull());
  fireEvent.mouseDown(row(entry));
}
const enter = (): void => { fireEvent.keyDown(box(), { key: 'Enter' }); };
const wfChip = (key: string): { workflowId: string; entryId?: string } | undefined =>
  chipsOf(useComposerChips.getState(), key).find((c) => c.kind === 'workflow') as { workflowId: string; entryId?: string } | undefined;
const launches = (): Array<Record<string, unknown>> => posts.filter((p) => p.path === '/runs').map((p) => p.body);

beforeEach(() => {
  repos = [repo('svc')];
  presets = [];
  preview = { steps: [] };
  holdHealth = false;
  healthPower = true;
  healthFails = false;
  stubWire();
  resetWorkflowCatalog();
  resetPlanCatalog();
  resetLaunchWizard();
  resetChatFlow();
  resetComposerSeats();
  clearRepoCache();
  setCachedRoster(SEATS);
  setCachedWorkflows(['bug', 'feature', 'domain-extraction', 'review-recent-work'].map(def));
  useComposerChips.setState({ byComposer: {} });
  useSessionDrafts.setState({ drafts: {} });
  useProjectsStore.setState({ projects: [PROJECT] as never, loading: false, error: null });
  useCapabilities.setState({ loaded: true, chatIdOnLaunch: true, powerMode: true, runChatId: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearCachedRoster();
  clearCachedWorkflows();
  useCapabilities.setState({ chatIdOnLaunch: false, powerMode: false });
});

describe('crew\'s two new launch kinds', () => {
  it('reads Apps (app) and Add a repository (repo) as kinds studio starts; an unknown kind stays unstarted', () => {
    const view = catalogFromWire({ ...CATALOG, entries: [...CATALOG.entries, { id: 'later', launch: { kind: 'teleport' }, status: 'available' }] })!;
    const by = (id: string) => view.entries.find((e) => e.id === id)!;
    expect([by('apps').launchKind, by('apps').status]).toEqual(['app', 'ready']);
    expect([by('add-repo').launchKind, by('add-repo').status]).toEqual(['repo', 'ready']);
    expect([by('later').launchKind, by('later').status]).toEqual(['none', 'unavailable']);
  });
});

describe('a / pick starts the work in this chat', () => {
  it('puts the card on the composer: no modal, nothing sent, the words kept, the box asks the card\'s question', async () => {
    render(<><Harness navigate={() => {}} /><LaunchWizard navigate={() => {}} /></>);
    await pick('bug', 'bug');
    expect(wfChip('chat-1')).toMatchObject({ workflowId: 'bug', entryId: 'bug' });
    expect(useLaunchWizard.getState().open).toBe(false);
    expect(screen.queryByTestId('launch-wizard')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('composer-start-line')).toHaveTextContent('Enter starts Fix a bug in svc in this chat. It asks you to approve the plan before any step runs.'));
    expect(box().placeholder).not.toBe('p');
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(posts.filter((p) => p.path !== '/plan/preview')).toEqual([]);
  });

  it('Enter launches into this chat, held at its plan (before:1, power off): the plan gate still holds', async () => {
    const nav = vi.fn();
    render(<Harness navigate={nav} />);
    await pick('bug', 'bug');
    type('the charge never clears');
    await waitFor(() => expect(screen.getByTestId('composer-start-line')).toHaveTextContent('in svc'));
    enter();
    await waitFor(() => expect(launches()).toHaveLength(1));
    const body = launches()[0]!;
    expect(body).toMatchObject({ workflow: 'bug', problem: 'the charge never clears', repoRef: 'svc', chatId: 'chat-1', humanConfirm: 'before:1', power: false, deliver: 'pr' });
    expect(body['deliverGate']).toBeUndefined();
    expect(JSON.parse(String(body['clisJson'])).map((s: RosterSeat) => s.key)).toEqual(['claude', 'codex']);
    await waitFor(() => expect(nav).toHaveBeenCalledWith('/s/chat-1'));
    expect(wfChip('chat-1')).toBeUndefined();
  });

  it('without power mode on the daemon, the launch says nothing of power (an older schema) and still asks before step 1', async () => {
    healthPower = false;
    render(<Harness navigate={() => {}} />);
    await pick('bug', 'bug');
    type('x');
    await waitFor(() => expect(screen.getByTestId('composer-start-line')).toHaveTextContent('in svc'));
    enter();
    await waitFor(() => expect(launches()).toHaveLength(1));
    expect(launches()[0]!['power']).toBeUndefined();
    expect(launches()[0]!['humanConfirm']).toBe('before:1');
  });

  it('asks for a missing repository inline, as choices on the composer, and starts once one is picked', async () => {
    repos = [repo('svc'), repo('web')];
    render(<Harness navigate={() => {}} />);
    await pick('bug', 'bug');
    type('the charge never clears');
    await waitFor(() => expect(screen.getAllByTestId('composer-start-repo')).toHaveLength(2));
    expect(screen.getByTestId('composer-start-add-repo')).toHaveAttribute('href', '/repos/new');
    enter();
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(launches()).toEqual([]);
    expect(screen.getByTestId('session-composer-send')).toBeDisabled();
    fireEvent.click(screen.getAllByTestId('composer-start-repo')[1]!);
    expect(screen.queryByTestId('composer-start-repos')).toBeNull();
    enter();
    await waitFor(() => expect(launches()).toHaveLength(1));
    expect(launches()[0]!['repoRef']).toBe('web');
  });

  it('asks for the words when the card needs them: Enter with an empty box starts nothing', async () => {
    render(<Harness navigate={() => {}} />);
    await pick('bug', 'bug');
    expect(box().value).toBe('');
    enter();
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(launches()).toEqual([]);
    expect(screen.getByTestId('session-composer-send')).toBeDisabled();
  });

  it('asks for a missing project inline when the card works within one (Map the domain)', async () => {
    useProjectsStore.setState({ projects: [PROJECT, { ...PROJECT, id: 'p2', name: 'Web' }] as never });
    render(<Harness navigate={() => {}} />);
    await pick('domain-extraction', 'map');
    type('billing');
    await waitFor(() => expect(screen.getAllByTestId('composer-start-project')).toHaveLength(2));
    enter();
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(launches()).toEqual([]);
    fireEvent.click(screen.getAllByTestId('composer-start-project')[1]!);
    // That project's presets are read before the gate is placed (codex r1 P1).
    await waitFor(() => expect(screen.getByTestId('session-composer-send')).not.toBeDisabled());
    enter();
    await waitFor(() => expect(launches()).toHaveLength(1));
    expect(launches()[0]!['projectId']).toBe('p2');
  });

  it('/workflow-<key> typed whole puts that card on the composer with the rest of the line as its words', async () => {
    render(<><Harness navigate={() => {}} /><LaunchWizard navigate={() => {}} /></>);
    await waitFor(() => expect(gets()).toContain('/workflows/catalog'));
    type('/workflow-bug the charge never clears');
    enter();
    await waitFor(() => expect(wfChip('chat-1')).toMatchObject({ workflowId: 'bug' }));
    expect(box().value).toBe('the charge never clears');
    expect(useLaunchWizard.getState().open).toBe(false);
  });
});

describe('codex r1 on #982: the plan gate and the request are exactly what the row shows', () => {
  it('P1: a start reads what the daemon can do first; a failed read starts nothing (power could not be turned off)', async () => {
    healthFails = true;
    render(<Harness navigate={() => {}} />);
    await pick('bug', 'bug');
    type('the charge never clears');
    await waitFor(() => expect(screen.getByTestId('composer-start-line')).toHaveTextContent('in svc'));
    enter();
    await waitFor(() => expect(screen.getByTestId('composer-start-error')).toHaveTextContent('did not say what it can do'));
    expect(launches()).toEqual([]);
    healthFails = false;
    enter();
    await waitFor(() => expect(launches()).toHaveLength(1));
    expect(launches()[0]!['power']).toBe(false);
  });

  it('a card re-picked while the first start places its gate: the first start sends nothing, the new words stay', async () => {
    presets = [{ name: 'bug', scope: 'global', steps: [{ id: 'build', catalog: 'build' }], created_by: 'builtin', updated_at: 1 }];
    let release: (v: Response) => void = () => {};
    const slow = new Promise<Response>((r) => { release = r; });
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (String(url).includes('/plans/preview') && launches().length === 0 && !released ? slow : base(url, init))));
    let released = false;
    render(<Harness navigate={() => {}} />);
    await pick('bug', 'bug');
    type('old words');
    await waitFor(() => expect(screen.getByTestId('composer-start-line')).toHaveTextContent('in svc'));
    enter();
    try {
      // Remove the card, re-pick it and say something else before the first start's preview answers.
      fireEvent.click(screen.getByTestId('composer-chip-remove'));
      await pick('bug', 'bug');
      type('new words');
    } finally {
      await act(async () => { released = true; release(new Response(JSON.stringify({ steps: [] }), { status: 200, headers: { 'content-type': 'application/json' } })); await new Promise((r) => setTimeout(r, 150)); });
    }
    expect(launches().map((b) => b['problem'])).not.toContain('old words');
    expect(box().value).toBe('new words');
    expect(wfChip('chat-1')).toMatchObject({ workflowId: 'bug' });
  });

  it('a New job card click into a chat that already holds a draft keeps that draft', async () => {
    useSessionDrafts.setState({ drafts: { 'chat-1': 'my unsent question' } });
    function Page(): React.ReactElement {
      const text = useSessionDrafts((st) => st.drafts['chat-1'] ?? '');
      return <><Composer composerKey="chat-1" text={text} setText={(t) => useSessionDrafts.getState().setDraft('chat-1', t)} onSend={() => {}} placeholder="p" ariaLabel="a" variant="session" navigate={() => {}} /><LaunchWizard navigate={() => {}} /></>;
    }
    render(<Page />);
    act(() => openLaunchWizard({ composerKey: 'chat-1' }));
    await waitFor(() => expect(screen.getByTestId('launch-catalog').dataset.source).toBe('catalog'));
    fireEvent.click(document.querySelector<HTMLElement>('[data-testid="launch-catalog-results"] [data-job="bug"]')!);
    await waitFor(() => expect(wfChip('chat-1')).toMatchObject({ workflowId: 'bug' }));
    expect(useSessionDrafts.getState().drafts['chat-1']).toBe('my unsent question');
  });

  it('P1: a scoped preset holds before its first WORK step (before:2 past the scope step), off the preview', async () => {
    presets = [{ name: 'bug', scope: 'global', steps: [{ id: 'build', catalog: 'build' }], created_by: 'builtin', updated_at: 1 }];
    preview = { steps: [{ id: 'pa-scope', catalog: 'pa-scope' }, { id: 'build', catalog: 'build' }] };
    render(<Harness navigate={() => {}} />);
    await pick('bug', 'bug');
    type('the charge never clears');
    await waitFor(() => expect(screen.getByTestId('composer-start-line')).toHaveTextContent('in svc'));
    enter();
    await waitFor(() => expect(launches()).toHaveLength(1));
    expect(launches()[0]!['humanConfirm']).toBe('before:2');
    expect(posts.some((p) => p.path === '/plans/preview')).toBe(true);
  });

  it('a signed-out helper is off on the row and not sent; turned on by hand, it is', async () => {
    setCachedRoster([...SEATS, { key: 'pi', display_name: 'Pi', binary: 'pi', enabled_for_council: true, signed_in: false } as RosterSeat]);
    render(<Harness navigate={() => {}} />);
    await pick('bug', 'bug');
    const pi = (): HTMLElement => screen.getAllByTestId('composer-seat').find((b) => b.dataset.key === 'pi')!;
    await waitFor(() => expect(pi().getAttribute('aria-pressed')).toBe('false'));
    type('x');
    await waitFor(() => expect(screen.getByTestId('composer-start-line')).toHaveTextContent('in svc'));
    enter();
    await waitFor(() => expect(launches()).toHaveLength(1));
    expect(JSON.parse(String(launches()[0]!['clisJson'])).map((x: RosterSeat) => x.key)).toEqual(['claude', 'codex']);
  });

  it('a default repository (the only one, or the session\'s) can be changed inline', async () => {
    repos = [repo('svc'), repo('web')];
    function WithRun(): React.ReactElement {
      const [text, setText] = useState('');
      const run = { session: { id: 'r-1', status: 'completed', problem: 'p', repo_ref: 'svc' }, units: [] } as never;
      return <Composer composerKey="chat-1" text={text} setText={setText} onSend={() => {}} placeholder="p" ariaLabel="a" variant="session" navigate={() => {}} runs={[run]} />;
    }
    render(<WithRun />);
    await pick('bug', 'bug');
    type('x');
    await waitFor(() => expect(screen.getByTestId('composer-start-line')).toHaveTextContent('in svc'));
    fireEvent.click(screen.getByTestId('composer-start-repo-change'));
    fireEvent.click(screen.getAllByTestId('composer-start-repo').find((b) => b.dataset.repo === 'web')!);
    enter();
    await waitFor(() => expect(launches()).toHaveLength(1));
    expect(launches()[0]!['repoRef']).toBe('web');
  });

  it('Unfiled is not a project: Apps still asks which one', async () => {
    useProjectsStore.setState({ projects: [PROJECT, { ...PROJECT, id: 'p2', name: 'Web' }] as never });
    useComposerChips.setState({ byComposer: { 'chat-1': [{ kind: 'project', key: 'p:default', label: 'Unfiled', projectId: 'default' }] } });
    render(<Harness navigate={() => {}} />);
    await pick('apps', 'apps');
    type('Open tickets');
    await waitFor(() => expect(screen.getAllByTestId('composer-start-project')).toHaveLength(2));
    expect(screen.getByTestId('session-composer-send')).toBeDisabled();
  });

  it('a card a catalog refresh retargets to another workflow is not started under the old chip', async () => {
    render(<Harness navigate={() => {}} />);
    await pick('bug', 'bug');
    type('x');
    await waitFor(() => expect(screen.getByTestId('composer-start-line')).toHaveTextContent('in svc'));
    // The same card id now launches another workflow: the composer holds, naming no card.
    act(() => useComposerChips.setState({ byComposer: { 'chat-1': [{ kind: 'workflow', key: 'wf', label: 'Fix a bug', workflowId: 'bug-v2', entryId: 'bug' }] } }));
    await waitFor(() => expect(screen.getByTestId('composer-start').dataset.entry).toBe(''));
    enter();
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(launches()).toEqual([]);
  });

  it('a card removed while its gate is being placed sends nothing', async () => {
    presets = [{ name: 'bug', scope: 'global', steps: [{ id: 'build', catalog: 'build' }], created_by: 'builtin', updated_at: 1 }];
    let release: (v: Response) => void = () => {};
    const slow = new Promise<Response>((r) => { release = r; });
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (String(url).includes('/plans/preview') ? slow : base(url, init))));
    render(<Harness navigate={() => {}} />);
    await pick('bug', 'bug');
    type('x');
    await waitFor(() => expect(screen.getByTestId('composer-start-line')).toHaveTextContent('in svc'));
    enter();
    act(() => useComposerChips.setState({ byComposer: { 'chat-1': [] } }));
    await act(async () => { release(new Response(JSON.stringify({ steps: [] }), { status: 200, headers: { 'content-type': 'application/json' } })); await new Promise((r) => setTimeout(r, 100)); });
    expect(launches()).toEqual([]);
  });

  it('on a run\'s page the start is its own job (no chat id), and says so', async () => {
    render(<Harness navigate={() => {}} composerKey="run:r-9" />);
    await pick('bug', 'bug');
    type('x');
    await waitFor(() => expect(screen.getByTestId('composer-start-line')).toHaveTextContent('as its own job'));
    enter();
    await waitFor(() => expect(launches()).toHaveLength(1));
    expect(launches()[0]!['chatId']).toBeUndefined();
  });
});

describe('Apps and Add a repository from the / menu', () => {
  it('Apps is offered (not coming soon) and Enter makes a new app by chat, opening its page', async () => {
    const nav = vi.fn();
    render(<Harness navigate={nav} />);
    type('/apps');
    await waitFor(() => expect(row('apps')).not.toBeNull());
    expect(row('apps')).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.mouseDown(row('apps'));
    expect(wfChip('chat-1')).toMatchObject({ entryId: 'apps' });
    expect(screen.queryByTestId('composer-seats')).toBeNull();
    type('Open tickets by region');
    enter();
    await waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
    expect(posts.map((p) => p.path)).toEqual(['/apps', expect.stringMatching(/^\/apps\/[^/]+\/turns$/)]);
    expect(posts[0]!.body['projectId']).toBe('p1');
    expect(nav.mock.calls[0]![0]).toMatch(/^\/apps\//);
    expect(launches()).toEqual([]);
  });

  it('Add a repository opens the register form in the project the pick is made in; nothing is sent', async () => {
    const nav = vi.fn();
    render(<Harness navigate={nav} />);
    await pick('add-repo', 'add');
    expect(nav).toHaveBeenCalledWith('/repos/new');
    expect(posts).toEqual([]);
  });
});

describe('New job\'s card click starts the work in a chat, not in the modal', () => {
  it('from the Desk: the modal closes and a new chat opens with the card on its composer and the words kept', async () => {
    render(<LaunchWizard navigate={() => {}} />);
    act(() => openLaunchWizard({ intent: 'the charge never clears', composerKey: 'desk' }));
    await waitFor(() => expect(screen.getByTestId('launch-catalog').dataset.source).toBe('catalog'));
    fireEvent.click(document.querySelector<HTMLElement>('[data-testid="launch-catalog-results"] [data-job="bug"]')!);
    expect(useLaunchWizard.getState().open).toBe(false);
    const chatId = useChatFlow.getState().request?.chatId ?? '';
    expect(chatId).not.toBe('');
    expect(wfChip(chatId)).toMatchObject({ workflowId: 'bug', entryId: 'bug' });
    expect(useSessionDrafts.getState().drafts[chatId]).toBe('the charge never clears');
    expect(posts).toEqual([]);
  });

  it('Demo video keeps its own steps in New job (its form is not inline yet)', async () => {
    render(<LaunchWizard navigate={() => {}} />);
    act(() => openLaunchWizard({ composerKey: 'desk' }));
    await waitFor(() => expect(screen.getByTestId('launch-catalog').dataset.source).toBe('catalog'));
    fireEvent.click(document.querySelector<HTMLElement>('[data-testid="launch-catalog-results"] [data-job="demo-video"]')!);
    expect(useLaunchWizard.getState().open).toBe(true);
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('demo');
  });
});
