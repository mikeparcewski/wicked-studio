/**
 * New job's first step is the workflow catalog (launch-modal, operator 2026-11-01): search on top,
 * filters, "Best fit" for the words it was opened with, "Your top" (hidden for a new user), a
 * section per category; an older daemon gets today's list, uncategorised and still searchable.
 * A pick goes to the step that asks only for what that workflow needs.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoEntry, WorkflowDef } from '../src/api/types.js';
import { LaunchWizard } from '../src/components/launch/LaunchWizard.js';
import { openLaunchWizard, resetLaunchWizard, useLaunchWizard } from '../src/store/launchWizard.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { clearRepoCache } from '../src/store/repoCache.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';
import { resetWorkflowCatalog } from '../src/store/workflowCatalog.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { WorkflowCatalog } from '../src/components/launch/WorkflowCatalog.js';
import fixture from './fixtures/workflowCatalog.json';

const def = (id: string, phases: string[], extra: Partial<WorkflowDef> = {}): WorkflowDef =>
  ({ id, phases: phases.map((p) => ({ id: p, executes_code: true })), ...extra }) as unknown as WorkflowDef;
const WF = [
  def('bug', ['triage', 'reproduce', 'fix', 'verify']),
  def('chat', ['explore'], { is_system: true } as Partial<WorkflowDef>),
  def('feature', ['clarify', 'design', 'build']),
  def('qe-author-tests', ['recon', 'author', 'verify', 'review']),
  def('review-recent-work', ['analyze', 'interpret']),
  def('acme-release', ['tag', 'publish']),
];
const REPO = { id: 'repo-1', name: 'svc', root_path: '/srv/svc', default_branch: 'main', registered_at: 0 } as RepoEntry;
const REPO2 = { ...REPO, id: 'repo-2', name: 'web' } as RepoEntry;

let catalog: unknown = null;
let repos: RepoEntry[] = [REPO, REPO2];
let posts: Array<{ path: string; body: Record<string, unknown> }> = [];
function stubWire(): void {
  posts = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown> });
      return Promise.resolve(new Response(JSON.stringify({ runId: 'r-new' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    if (path === '/workflows/catalog') {
      return Promise.resolve(catalog === null
        ? new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify(catalog), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    const body = path === '/repos' ? { repos } : path === '/projects' ? { projects: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }] } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
}

beforeEach(() => {
  // Your top is recency-weighted: the clock is the fixture's (codex r1: real time made the order drift).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  catalog = null;
  repos = [REPO, REPO2];
  stubWire();
  resetPlanCatalog();
  clearCachedWorkflows();
  setCachedWorkflows(WF);
  clearRepoCache();
  resetWorkflowCatalog();
  resetLaunchWizard();
  clearCachedRoster();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const cardIds = (within0: HTMLElement): string[] =>
  [...within0.querySelectorAll<HTMLElement>('[data-testid^="launch-wizard-workflow-"], [data-testid^="launch-catalog-soon-"]:not([data-testid="launch-catalog-soon-tag"]), [data-testid^="launch-catalog-top-"], [data-testid^="launch-catalog-fit-"]')]
    .map((b) => b.dataset.testid!.replace(/^launch-(wizard-workflow|catalog-soon|catalog-top|catalog-fit)-/, ''));
const section = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-section="${id}"]`)!;
async function openCatalog(init: Parameters<typeof openLaunchWizard>[0] = {}): Promise<void> {
  render(<LaunchWizard />);
  act(() => openLaunchWizard(init));
  await waitFor(() => expect(screen.getByTestId('launch-catalog').dataset.source).not.toBe('loading'));
}
const search = (q: string): void => { fireEvent.change(screen.getByTestId('launch-catalog-search'), { target: { value: q } }); };

describe('an older daemon (no catalog)', () => {
  it('today’s list, uncategorised: the daemon’s workflows in order, then studio’s own; no system workflow, no top', async () => {
    await openCatalog();
    const panel = screen.getByTestId('launch-catalog-results');
    expect(screen.getByTestId('launch-catalog').dataset.source).toBe('fallback');
    expect(screen.getByTestId('launch-catalog-older')).toHaveTextContent('not grouped');
    expect(document.querySelector('[data-testid="launch-catalog-cat"]')).toBeNull();
    expect(screen.queryByTestId('launch-catalog-top')).toBeNull();
    expect(cardIds(panel)).toEqual(['bug', 'feature', 'qe-author-tests', 'review-recent-work', 'acme-release', 'demo-video', 'draft-epics', 'apps']);
    // Every card says what it gives and that it needs a repository (today's rule).
    const bug = screen.getByTestId('launch-wizard-workflow-bug');
    expect(bug).toHaveTextContent('Reproduce a bug, fix it and prove the fix');
    expect(bug).toHaveTextContent('Needs a repository');
    expect(bug.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('is still searchable', async () => {
    await openCatalog();
    search('tests');
    expect(cardIds(screen.getByTestId('launch-catalog-results'))[0]).toBe('qe-author-tests');
  });

  it('shows the loading state until the first answer, then the list', async () => {
    render(<LaunchWizard />);
    act(() => openLaunchWizard({}));
    expect(screen.getByTestId('launch-catalog-loading')).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(screen.queryByTestId('launch-catalog-loading')).toBeNull());
  });

  it('a daemon that lists no workflows of its own still offers studio’s kinds', async () => {
    clearCachedWorkflows();
    setCachedWorkflows([]);
    catalog = { categories: [], entries: [] };
    await openCatalog();
    expect(screen.queryByTestId('launch-catalog-empty')).toBeNull();
    expect(cardIds(screen.getByTestId('launch-catalog-results'))).toContain('demo-video');
  });

  it('the empty state: nothing at all to list says so and offers chat (agy r1: was untested)', () => {
    const onChat = vi.fn();
    render(<WorkflowCatalog view={{ source: 'catalog', categories: [], entries: [] }} pickedId={null} intent="" now={0} onPick={() => {}} onChat={onChat} />);
    const empty = screen.getByTestId('launch-catalog-empty');
    expect(empty).toHaveTextContent('This daemon lists no workflows.');
    fireEvent.click(within(empty).getByRole('button', { name: 'Talk it through first' }));
    expect(onChat).toHaveBeenCalledTimes(1);
  });

  it('filters that leave nothing say so, with Clear filters (agy r1: was a blank section)', async () => {
    // Today's list with none of the daemon's own: only studio's kinds, none of which needs a repository.
    clearCachedWorkflows();
    setCachedWorkflows([]);
    await openCatalog();
    fireEvent.change(screen.getByTestId('launch-catalog-repo'), { target: { value: 'needs' } });
    expect(document.querySelector('[data-section="all"]')).toBeNull();
    expect(screen.getByTestId('launch-catalog-noresults')).toHaveTextContent('No workflow fits these filters.');
    fireEvent.click(screen.getByTestId('launch-catalog-clear-filters'));
    expect(cardIds(screen.getByTestId('launch-catalog-results'))).toEqual(['demo-video', 'draft-epics', 'apps']);
  });
});

describe('a daemon with the catalog', () => {
  beforeEach(() => { catalog = fixture; });

  it('Your top first, then Create, Resolve, Analyze, Test and More, each with its cards', async () => {
    await openCatalog();
    const sections = [...document.querySelectorAll<HTMLElement>('[data-section]')].map((s) => s.dataset.section);
    expect(sections).toEqual(['top', 'create', 'resolve', 'analyze', 'test', 'more']);
    expect(cardIds(section('top'))).toEqual(['bug', 'feature', 'review-recent-work']);
    expect(cardIds(section('resolve'))).toEqual(['bug', 'migration']);
    expect(cardIds(section('create'))).toEqual([
      'apps', 'feature', 'document:docs', 'document:document-interactive', 'document:document-static', 'document:presentation',
      'demo-video', 'phase-plugin', 'editor-plugin', 'mcp-server',
    ].map((x) => (x === 'document:docs' ? 'docs' : x)));
    expect(cardIds(section('more'))).toEqual(['learn', 'draft-epics', 'chat:start-chat']);
    const feature = screen.getByTestId('launch-wizard-workflow-feature');
    expect(feature).toHaveTextContent('A pull request with the feature, its tests and a review');
    expect(feature).toHaveTextContent('Needs a repository · 30 min–1.5 h');
    // A top card names its category; a card in its own section does not repeat it.
    expect(screen.getByTestId('launch-catalog-top-bug')).toHaveTextContent('Resolve');
    expect(within(section('resolve')).getByTestId('launch-wizard-workflow-bug')).not.toHaveTextContent('Resolve');
  });

  it('a coming-soon workflow is shown, never offered: not a button, a click picks nothing', async () => {
    await openCatalog();
    const vibe = screen.getByTestId('launch-catalog-soon-apps');
    expect(vibe.tagName).not.toBe('BUTTON');
    expect(vibe).toHaveAttribute('aria-disabled', 'true');
    expect(vibe).toHaveTextContent('Coming soon Design in progress');
    expect(vibe.querySelector('a, button, [tabindex]')).toBeNull();
    fireEvent.click(vibe);
    expect(useLaunchWizard.getState().draft?.workflowId ?? null).toBeNull();
  });

  it('Your top is hidden for a new user', async () => {
    catalog = { ...fixture, entries: fixture.entries.map((e) => ({ ...e, usage: { launches: 0, lastUsedAt: null, medianMinutes: null } })) };
    await openCatalog();
    expect(screen.queryByTestId('launch-catalog-top')).toBeNull();
    expect(section('create')).not.toBeNull();
  });

  it('typing a sentence ranks the right workflow first, and Enter picks it', async () => {
    await openCatalog();
    search('write docs for the auth service');
    expect(screen.queryByTestId('launch-catalog-top')).toBeNull();
    expect(cardIds(section('results'))[0]).toBe('docs');
    expect(screen.getByTestId('launch-catalog-count')).toHaveTextContent(/workflows? match/);
    fireEvent.keyDown(screen.getByTestId('launch-catalog-search'), { key: 'Enter' });
    expect(useLaunchWizard.getState().draft?.workflowId).toBe('docs');
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('what');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('New job: Write docs in the repo');
    // Shaping: the words box is named by the workflow; what you get, what it needs, its other inputs.
    expect(screen.getByLabelText(/What should the docs cover\?/)).toBe(screen.getByTestId('launch-wizard-intent'));
    const shape = screen.getByTestId('launch-wizard-shape');
    expect(shape).toHaveTextContent('Docs in your repository, as a pull request');
    expect(shape).toHaveTextContent('Usually 15–40 min · low cost');
    expect(screen.getByTestId('launch-wizard-shape-needs')).toHaveTextContent('a repository');
    expect(screen.getByTestId('launch-wizard-shape-inputs')).toHaveTextContent('Who reads them (new engineers, operators, customers), if it matters');
  });

  it('no results: says so, and Clear search brings the sections back', async () => {
    await openCatalog();
    search('zzqx');
    expect(screen.getByTestId('launch-catalog-noresults')).toHaveTextContent('Nothing matches “zzqx”.');
    fireEvent.click(screen.getByTestId('launch-catalog-clear-search'));
    expect(screen.queryByTestId('launch-catalog-noresults')).toBeNull();
    expect(section('create')).not.toBeNull();
  });

  it('filters: a category, the repository need and coming soon; Clear filters resets them', async () => {
    await openCatalog();
    const cat = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-testid="launch-catalog-cat"][data-cat="${id}"]`)!;
    expect(cat('resolve')).toHaveTextContent('Resolve 2');
    fireEvent.click(cat('resolve'));
    expect(cat('resolve')).toHaveAttribute('aria-pressed', 'true');
    expect([...document.querySelectorAll<HTMLElement>('[data-section]')].map((s) => s.dataset.section)).toEqual(['resolve']);
    fireEvent.click(cat('all'));
    fireEvent.change(screen.getByTestId('launch-catalog-repo'), { target: { value: 'without' } });
    expect(screen.queryByTestId('launch-catalog-top')).toBeNull();
    const shown = cardIds(screen.getByTestId('launch-catalog-results'));
    expect(shown).toEqual(['apps', 'document:document-interactive', 'document:document-static', 'document:presentation', 'demo-video', 'review-recent-work', 'learn', 'draft-epics', 'chat:start-chat']);
    fireEvent.click(screen.getByTestId('launch-catalog-soon-toggle'));
    expect(cardIds(screen.getByTestId('launch-catalog-results'))).not.toContain('apps');
    search('migrate');
    expect(screen.getByTestId('launch-catalog-noresults')).toHaveTextContent('with these filters');
    fireEvent.click(screen.getByTestId('launch-catalog-clear-filters'));
    expect(screen.getByTestId('launch-catalog-search')).toHaveValue('');
    expect(section('top')).not.toBeNull();
  });

  it('opened with words (the desk ask): Best fit ranks the catalog by them, above Your top', async () => {
    await openCatalog({ intent: 'why did run 42 fail', composerKey: 'desk' });
    const sections = [...document.querySelectorAll<HTMLElement>('[data-section]')].map((s) => s.dataset.section);
    expect(sections.slice(0, 2)).toEqual(['fit', 'top']);
    expect(cardIds(section('fit'))[0]).toBe('review-recent-work');
    fireEvent.click(screen.getByTestId('launch-catalog-fit-review-recent-work'));
    // The words carry to the job.
    expect(useLaunchWizard.getState().draft?.intent).toBe('why did run 42 fail');
  });

  it('keyboard: focus starts in search; Down goes to the cards, Up from the first returns; Esc closes', async () => {
    await openCatalog();
    const box = screen.getByTestId('launch-catalog-search');
    expect(document.activeElement).toBe(box);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect((document.activeElement as HTMLElement).dataset.testid).toBe('launch-catalog-top-bug');
    const panel = screen.getByTestId('launch-catalog-results');
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    expect((document.activeElement as HTMLElement).dataset.testid).toBe('launch-catalog-top-feature');
    fireEvent.keyDown(panel, { key: 'ArrowLeft' });
    fireEvent.keyDown(panel, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(box);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useLaunchWizard.getState().open).toBe(false);
  });

  it('Change job comes back with the picked card pressed and focused', async () => {
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-migration'));
    fireEvent.click(screen.getByTestId('launch-wizard-change'));
    const card = within(section('resolve')).getByTestId('launch-wizard-workflow-migration');
    expect(card).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  it('a workflow that works without a repository does not ask for one, and offers no pull request', async () => {
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-review-recent-work'));
    expect(screen.getByTestId('launch-wizard-intent')).toBe(screen.getByLabelText(/Which runs, and what do you want to know\?/));
    expect(screen.queryByTestId('launch-wizard-shape-inputs')).toBeNull();
    fireEvent.change(screen.getByTestId('launch-wizard-intent'), { target: { value: 'my last three runs' } });
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('where');
    await waitFor(() => expect(screen.getByTestId('launch-wizard-repo').querySelectorAll('option')).toHaveLength(3));
    expect(screen.getByTestId('launch-wizard-repo')).toHaveValue('');
    expect(screen.getByTestId('launch-wizard-repo').querySelector('option')).toHaveTextContent('No repository');
    expect(screen.getByTestId('launch-wizard-repo-note')).toHaveTextContent('works without a repository');
    expect(screen.getByTestId('launch-wizard-next')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('options');
    expect(screen.queryByTestId('launch-wizard-deliver')).toBeNull();
  });

  it('a workflow that needs a repository still asks for one', async () => {
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-feature'));
    fireEvent.change(screen.getByTestId('launch-wizard-intent'), { target: { value: 'add dark mode' } });
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    await waitFor(() => expect(screen.getByTestId('launch-wizard-repo').querySelectorAll('option')).toHaveLength(3));
    expect(screen.getByTestId('launch-wizard-repo').querySelector('option')).toHaveTextContent('Choose a repository…');
    expect(screen.getByTestId('launch-wizard-next')).toBeDisabled();
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('Choose the repository this works in.');
  });

  it('a document entry opens New document on its list, in the draft\'s project; a chat entry is the chat flow', async () => {
    const navigate = vi.fn();
    render(<LaunchWizard navigate={navigate} />);
    act(() => openLaunchWizard({ projectId: 'p1' }));
    fireEvent.click(await screen.findByTestId('launch-wizard-workflow-document:presentation'));
    expect(navigate).toHaveBeenCalledWith('/everything?tab=made&project=p1&kind=decks&new=document&format=ppt');
    expect(useLaunchWizard.getState().open).toBe(false);
    act(() => openLaunchWizard({}));
    fireEvent.click(await screen.findByTestId('launch-wizard-workflow-chat:start-chat'));
    expect(useLaunchWizard.getState().open).toBe(false);
    expect(useLaunchWizard.getState().draft?.workflowId ?? null).toBeNull();
  });

  it('an unavailable workflow is shown with why, never offered', async () => {
    await openCatalog();
    const v = screen.getByTestId('launch-catalog-soon-validate-docs');
    expect(v.tagName).not.toBe('BUTTON');
    expect(v).toHaveTextContent('Not available Needs the next engine release');
  });

  it('Talk it through first leaves for the chat flow', async () => {
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-start-chat'));
    expect(useLaunchWizard.getState().open).toBe(false);
  });
});

describe('an older daemon whose workflow list never comes', () => {
  it('still offers studio’s own kinds, and the daemon’s join when they land', async () => {
    clearCachedWorkflows();
    render(<LaunchWizard />);
    act(() => openLaunchWizard({}));
    await waitFor(() => expect(screen.getByTestId('launch-catalog').dataset.source).toBe('fallback'));
    expect(cardIds(screen.getByTestId('launch-catalog-results'))).toEqual(['demo-video', 'draft-epics', 'apps']);
    act(() => setCachedWorkflows(WF));
    expect(cardIds(screen.getByTestId('launch-catalog-results'))).toContain('feature');
  });
});

describe('words a workflow does not require (live catalog: Check documentation, Review recent work)', () => {
  const ENTRY = (id: string, inputs: unknown[]) => ({
    id, category: 'analyze', title: id === 'validate-docs' ? 'Check documentation' : 'Review recent work',
    summary: id === 'validate-docs' ? 'Check your docs against the code. Every claim.' : 'Recommendations across your runs.',
    outcome: 'A report', needs: id === 'validate-docs' ? ['repo'] : ['runs'], inputs, status: 'available',
    launch: { kind: 'run', workflow: id }, usage: { launches: 0, lastUsedAt: null, medianMinutes: 283.1 },
  });
  beforeEach(() => {
    catalog = {
      categories: [{ id: 'analyze', title: 'Analyze', summary: 'Understand', subcategories: [] }],
      entries: [
        ENTRY('validate-docs', [{ id: 'intent', label: 'Which docs? (blank = the READMEs and docs/)', kind: 'text', required: false }, { id: 'repo', label: 'Repository', kind: 'repo', required: true }]),
        ENTRY('review-recent-work', [{ id: 'seats', label: 'Helpers', kind: 'seats', required: false }]),
      ],
    };
  });

  it('an optional first text input: Next with no words, and the launch says the workflow’s summary', async () => {
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-validate-docs'));
    expect(screen.getByLabelText(/Which docs\? \(blank = the READMEs and docs\/\) \(optional\)/)).toBe(screen.getByTestId('launch-wizard-intent'));
    expect(screen.getByTestId('launch-wizard-shape')).toHaveTextContent('your runs took about 4.7 h');
    expect(screen.getByTestId('launch-wizard-next')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    fireEvent.change(await screen.findByTestId('launch-wizard-repo'), { target: { value: 'repo-1' } });
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    expect(screen.getByTestId('launch-wizard-review')).toHaveTextContent('Check your docs against the code');
    expect(screen.queryByTestId('launch-wizard-blocker')).toBeNull();
  });

  it('no text input at all: the words are optional too', async () => {
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-review-recent-work'));
    expect(screen.getByLabelText(/Anything to focus on\? \(optional\)/)).toBe(screen.getByTestId('launch-wizard-intent'));
    expect(screen.getByTestId('launch-wizard-next')).not.toBeDisabled();
  });

  it('a workflow the catalog does not describe keeps the words required', async () => {
    catalog = null;
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-feature'));
    expect(screen.getByTestId('launch-wizard-next')).toBeDisabled();
  });
});

describe('launching from the catalog (xreview r1: the wire body, the picked card, what is still offered)', () => {
  const run = (id: string, workflow: string, extra: Record<string, unknown> = {}) => ({
    id, category: 'analyze', title: id, summary: `${id} summary. More words.`, outcome: `${id} outcome`, needs: ['runs'],
    inputs: [], status: 'available', launch: { kind: 'run', workflow }, usage: { launches: 0, lastUsedAt: null, medianMinutes: null }, ...extra,
  });
  const toReview = async (): Promise<void> => {
    for (let i = 0; i < 4 && screen.getByTestId('launch-wizard-step').dataset.step !== 'review'; i += 1) {
      fireEvent.click(screen.getByTestId('launch-wizard-next'));
    }
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('review');
  };

  it('no words for a workflow whose form has none: POST /runs carries launch.workflow and the summary as the problem', async () => {
    catalog = { categories: [{ id: 'analyze', title: 'Analyze' }], entries: [run('run:review', 'review-recent-work')] };
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-review-recent-work'));
    await toReview();
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(posts.some((p) => p.path === '/runs')).toBe(true));
    const body = posts.find((p) => p.path === '/runs')!.body;
    expect(body.workflow).toBe('review-recent-work');
    expect(body.problem).toBe('run:review summary');
    expect(body.repoRef).toBeUndefined();
    expect(body.deliver).toBeUndefined();
  });

  it('a workflow that works without a repository starts with none, even when there is only one', async () => {
    repos = [REPO];
    catalog = { categories: [{ id: 'analyze', title: 'Analyze' }], entries: [run('rr', 'review-recent-work')] };
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-review-recent-work'));
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    await waitFor(() => expect(screen.getByTestId('launch-wizard-repo').querySelectorAll('option')).toHaveLength(2));
    expect(screen.getByTestId('launch-wizard-repo')).toHaveValue('');
  });

  it('two cards for one workflow: the shaping step is the picked card’s', async () => {
    catalog = { categories: [{ id: 'analyze', title: 'Analyze' }], entries: [
      run('first', 'shared', { title: 'First card', needs: ['repo'] }),
      run('second', 'shared', { title: 'Second card', needs: ['runs'] }),
    ] };
    await openCatalog();
    const cards = screen.getAllByTestId('launch-wizard-workflow-shared');
    fireEvent.click(cards[1]!);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('New job: Second card');
    expect(screen.getByTestId('launch-wizard-shape-needs')).toHaveTextContent('runs to review');
  });

  it('a draft resumed after the catalog stopped offering its workflow cannot go on or launch', async () => {
    catalog = { categories: [{ id: 'analyze', title: 'Analyze' }], entries: [run('rr', 'review-recent-work')] };
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-review-recent-work'));
    act(() => useLaunchWizard.getState().close());
    catalog = { categories: [{ id: 'analyze', title: 'Analyze' }], entries: [run('rr', 'review-recent-work', { status: 'unavailable', statusNote: 'Gone' })] };
    act(() => openLaunchWizard({}));
    await waitFor(() => expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('This workflow is not available now.'));
    expect(screen.getByTestId('launch-wizard-next')).toBeDisabled();
    expect(posts).toEqual([]);
  });

  it('changing the project mid-shaping keeps the workflow’s rules while that project’s catalog is read', async () => {
    let release: ((r: Response) => void) | null = null;
    catalog = { categories: [{ id: 'analyze', title: 'Analyze' }], entries: [run('rr', 'review-recent-work')] };
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-review-recent-work'));
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (new URL(url, 'http://x').pathname.endsWith('/workflows/catalog')
      ? new Promise<Response>((r) => { release = r; }) : realFetch(url, init))));
    fireEvent.change(screen.getByTestId('launch-wizard-project'), { target: { value: 'p2' } });
    expect(release).not.toBeNull();
    expect(screen.getByTestId('launch-wizard-repo-note')).toHaveTextContent('works without a repository');
    expect(screen.getByTestId('launch-wizard-next')).not.toBeDisabled();
  });
});

describe('round 2 (xreview r2): the picked card stays the picked card; nothing not offered launches', () => {
  const card = (id: string, workflow: string, extra: Record<string, unknown> = {}) => ({
    id, category: 'analyze', title: id, summary: `${id} summary`, outcome: `${id} outcome`, needs: ['runs'],
    inputs: [], status: 'available', launch: { kind: 'run', workflow }, usage: { launches: 0, lastUsedAt: null, medianMinutes: null }, ...extra,
  });
  const cats = [{ id: 'analyze', title: 'Analyze' }];
  const reopen = async (): Promise<void> => {
    act(() => useLaunchWizard.getState().close());
    act(() => openLaunchWizard({}));
    await waitFor(() => expect(screen.getByTestId('launch-wizard')).toBeInTheDocument());
  };

  it('a workflow named like an Object.prototype key after another kind: no crash, its own empty words', async () => {
    catalog = { categories: cats, entries: [card('a', 'feature-x'), card('b', 'constructor')] };
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-feature-x'));
    fireEvent.change(screen.getByTestId('launch-wizard-intent'), { target: { value: 'words for a' } });
    fireEvent.click(screen.getByTestId('launch-wizard-change'));
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-constructor'));
    expect(screen.getByTestId('launch-wizard-intent')).toHaveValue('');
    expect(useLaunchWizard.getState().draft?.workflowId).toBe('constructor');
  });

  it('the picked card removed from the catalog: blocked, not matched to another card for the same workflow', async () => {
    catalog = { categories: cats, entries: [card('first', 'shared'), card('second', 'shared')] };
    await openCatalog();
    fireEvent.click(screen.getAllByTestId('launch-wizard-workflow-shared')[1]!);
    catalog = { categories: cats, entries: [card('first', 'shared')] };
    await reopen();
    await waitFor(() => expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('This workflow is not available now.'));
    expect(screen.getByTestId('launch-wizard-next')).toBeDisabled();
  });

  it('the picked card retargeted to "none": blocked', async () => {
    catalog = { categories: cats, entries: [card('rr', 'review-recent-work')] };
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-review-recent-work'));
    catalog = { categories: cats, entries: [card('rr', 'review-recent-work', { status: 'coming_soon', launch: { kind: 'none' } })] };
    await reopen();
    await waitFor(() => expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('This workflow is not available now.'));
  });

  it('a required text input after an optional first one keeps the words required', async () => {
    catalog = { categories: cats, entries: [card('a', 'wf-a', { inputs: [
      { id: 'scope', label: 'Which part?', kind: 'text', required: false },
      { id: 'goal', label: 'What for?', kind: 'text', required: true },
    ] })] };
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-wf-a'));
    expect(screen.getByLabelText(/Which part\?/)).toBe(screen.getByTestId('launch-wizard-intent'));
    expect(screen.queryByText(/Which part\? \(optional\)/)).toBeNull();
    expect(screen.getByTestId('launch-wizard-next')).toBeDisabled();
  });

  it('Change job after the second of two cards for one workflow: that card is pressed, not the first', async () => {
    catalog = { categories: cats, entries: [card('first', 'shared', { title: 'First' }), card('second', 'shared', { title: 'Second' })] };
    await openCatalog();
    fireEvent.click(screen.getAllByTestId('launch-wizard-workflow-shared')[1]!);
    fireEvent.click(screen.getByTestId('launch-wizard-change'));
    const [first, second] = screen.getAllByTestId('launch-wizard-workflow-shared');
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(document.activeElement).toBe(second));
  });

  it('a repository picked for one kind is not carried into a kind that needs none', async () => {
    catalog = { categories: cats, entries: [card('f', 'feature-x', { needs: ['repo'] }), card('rr', 'review-recent-work')] };
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-feature-x'));
    fireEvent.change(screen.getByTestId('launch-wizard-intent'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    fireEvent.change(await screen.findByTestId('launch-wizard-repo'), { target: { value: 'repo-1' } });
    fireEvent.click(screen.getByTestId('launch-wizard-back'));
    fireEvent.click(screen.getByTestId('launch-wizard-change'));
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-review-recent-work'));
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    expect(screen.getByTestId('launch-wizard-repo')).toHaveValue('');
  });

  it('a failed read for the newly chosen project keeps crew’s catalog (never today’s list) mid-shaping', async () => {
    catalog = { categories: cats, entries: [card('rr', 'review-recent-work')] };
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-review-recent-work'));
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (new URL(url, 'http://x').pathname.endsWith('/workflows/catalog')
      ? Promise.resolve(new Response(JSON.stringify({ error: 'busy' }), { status: 503, headers: { 'content-type': 'application/json' } }))
      : realFetch(url, init))));
    fireEvent.change(screen.getByTestId('launch-wizard-project'), { target: { value: 'p2' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByTestId('launch-wizard-repo-note')).toHaveTextContent('works without a repository');
    expect(screen.getByTestId('launch-wizard-next')).not.toBeDisabled();
  });
});

describe('round 3 (codex r3): a card picked from another project’s catalog waits for this project’s', () => {
  it('a project switch with this project’s read still out: the launch says it is checking, and waits', async () => {
    catalog = { categories: [{ id: 'analyze', title: 'Analyze' }], entries: [{
      id: 'rr', category: 'analyze', title: 'Review recent work', summary: 'Recommendations.', outcome: 'A report', needs: ['runs'], inputs: [],
      status: 'available', launch: { kind: 'run', workflow: 'review-recent-work' }, usage: { launches: 0, lastUsedAt: null, medianMinutes: null },
    }] };
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-review-recent-work'));
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (new URL(url, 'http://x').pathname.endsWith('/workflows/catalog')
      ? new Promise<Response>(() => {}) : realFetch(url, init))));
    fireEvent.change(screen.getByTestId('launch-wizard-project'), { target: { value: 'p2' } });
    // The rules stay (Next is not held), but the launch waits for p2's answer.
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('review');
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('Checking this workflow for the chosen project');
    expect(screen.getByTestId('launch-wizard-launch')).toBeDisabled();
  });
});

describe('round 4 (xreview r4)', () => {
  const rr = (extra: Record<string, unknown> = {}) => ({
    id: 'rr', category: 'analyze', title: 'Review recent work', summary: 'Recommendations.', outcome: 'A report', needs: ['runs'], inputs: [],
    status: 'available', launch: { kind: 'run', workflow: 'review-recent-work' }, usage: { launches: 0, lastUsedAt: null, medianMinutes: null }, ...extra,
  });
  const cats = [{ id: 'analyze', title: 'Analyze' }];
  const toReview = (): void => {
    for (let i = 0; i < 4 && screen.getByTestId('launch-wizard-step').dataset.step !== 'review'; i += 1) fireEvent.click(screen.getByTestId('launch-wizard-next'));
  };

  it('a failed read for the chosen project still holds the launch (agy + codex r4)', async () => {
    catalog = { categories: cats, entries: [rr()] };
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-review-recent-work'));
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (new URL(url, 'http://x').pathname.endsWith('/workflows/catalog')
      ? Promise.resolve(new Response(JSON.stringify({ error: 'busy' }), { status: 503, headers: { 'content-type': 'application/json' } }))
      : realFetch(url, init))));
    fireEvent.change(screen.getByTestId('launch-wizard-project'), { target: { value: 'p2' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    toReview();
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('Couldn’t check this workflow for the chosen project');
    expect(screen.getByTestId('launch-wizard-launch')).toBeDisabled();
    expect(posts.filter((p) => p.path === '/runs')).toEqual([]);
  });

  it('a card that works within a project asks for one (live domain-extraction: needs repo + project)', async () => {
    catalog = fixture;
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-domain-extraction'));
    fireEvent.change(screen.getByTestId('launch-wizard-intent'), { target: { value: 'map the billing domain' } });
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    fireEvent.change(await screen.findByTestId('launch-wizard-repo'), { target: { value: 'repo-1' } });
    expect(screen.getByTestId('launch-wizard-project-note')).toHaveTextContent('Required by this workflow');
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('Choose the project this works in.');
    expect(screen.getByTestId('launch-wizard-next')).toBeDisabled();
    fireEvent.change(screen.getByTestId('launch-wizard-project'), { target: { value: 'p1' } });
    expect(screen.getByTestId('launch-wizard-next')).not.toBeDisabled();
  });

  it('while launching, the job cannot be changed; a request that changed during the preview is not sent (codex r4)', async () => {
    catalog = { categories: cats, entries: [rr({ needs: ['repo'] })] };
    let releasePreview: ((r: Response) => void) | null = null;
    const realFetch = globalThis.fetch;
    const json = (b: unknown): Response => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname;
      // A preset of that name: its launch previews the plan (the await this guards).
      if (path.endsWith('/presets')) return Promise.resolve(json({ presets: [{ name: 'review-recent-work', steps: [{ id: 'analyze' }] }] }));
      if (path.endsWith('/plans/preview')) return new Promise<Response>((r) => { releasePreview = r; });
      return realFetch(url, init);
    }));
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-review-recent-work'));
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    fireEvent.change(await screen.findByTestId('launch-wizard-repo'), { target: { value: 'repo-1' } });
    toReview();
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(releasePreview).not.toBeNull(), { timeout: 3000 });
    expect(screen.getByTestId('launch-wizard-back')).toBeDisabled();
    // Anything that changes the request meanwhile (here, the draft's repository).
    act(() => useLaunchWizard.getState().update({ repoRef: 'repo-2' }));
    const PREVIEW = { score: 0, deterministic: 0, reasons: [], destructive: false, band: '0-39', high_risk: false, floor: [], floor_override: null, steps: [{ id: 'analyze' }] };
    await act(async () => {
      releasePreview!(json(PREVIEW));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(posts.filter((p) => p.path === '/runs')).toEqual([]);
    expect(screen.getByTestId('launch-wizard-error')).toBeInTheDocument();
    // The control: launched again with nothing changing meanwhile, it is sent, with what was reviewed.
    releasePreview = null;
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(releasePreview).not.toBeNull(), { timeout: 3000 });
    await act(async () => {
      releasePreview!(json(PREVIEW));
      await new Promise((r) => setTimeout(r, 20));
    });
    await waitFor(() => expect(posts.filter((p) => p.path === '/runs')).toHaveLength(1));
    expect(posts.find((p) => p.path === '/runs')!.body.repoRef).toBe('repo-2');
  });
});

describe('round 5 (xreview r5): the hold survives a close and reopen, covers drafts opened by id, and sees whole seats', () => {
  const rr = {
    id: 'rr', category: 'analyze', title: 'Review recent work', summary: 'Recommendations.', outcome: 'A report', needs: ['runs'], inputs: [],
    status: 'available', launch: { kind: 'run', workflow: 'review-recent-work' }, usage: { launches: 0, lastUsedAt: null, medianMinutes: null },
  };
  const cats = [{ id: 'analyze', title: 'Analyze' }];
  const toReview = (): void => {
    for (let i = 0; i < 4 && screen.getByTestId('launch-wizard-step').dataset.step !== 'review'; i += 1) fireEvent.click(screen.getByTestId('launch-wizard-next'));
  };
  const failCatalogFor = (project: string, how: 'fail' | 'hold'): void => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(url, 'http://x');
      if (u.pathname.endsWith('/workflows/catalog') && u.searchParams.get('projectId') === project) {
        return how === 'hold' ? new Promise<Response>(() => {})
          : Promise.resolve(new Response(JSON.stringify({ error: 'busy' }), { status: 503, headers: { 'content-type': 'application/json' } }));
      }
      return realFetch(url, init);
    }));
  };

  it('closed and reopened after the chosen project’s read failed: still held while the retry fails', async () => {
    catalog = { categories: cats, entries: [rr] };
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-review-recent-work'));
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    failCatalogFor('p2', 'fail');
    fireEvent.change(screen.getByTestId('launch-wizard-project'), { target: { value: 'p2' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    act(() => useLaunchWizard.getState().close());
    act(() => openLaunchWizard({}));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    // Every step says why it waits, and nothing can go on to a launch.
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('Couldn’t check this workflow for the chosen project');
    expect(screen.getByTestId('launch-wizard-next')).toBeDisabled();
    expect(posts.filter((p) => p.path === '/runs')).toEqual([]);
  });

  it('the catalog step says when it could not read the workflows (never today’s list in its place)', async () => {
    catalog = { categories: cats, entries: [rr] };
    await openCatalog();
    act(() => useLaunchWizard.getState().close());
    failCatalogFor('p2', 'fail');
    act(() => resetLaunchWizard());
    act(() => openLaunchWizard({ projectId: 'p2' }));
    await waitFor(() => expect(screen.getByTestId('launch-catalog-failed')).toHaveTextContent('Couldn’t read the workflows.'));
    expect(screen.queryByTestId('launch-catalog-older')).toBeNull();
  });

  it('a draft opened by workflow id waits for the chosen project’s catalog too', async () => {
    catalog = { categories: cats, entries: [rr] };
    render(<LaunchWizard />);
    act(() => openLaunchWizard({ workflowId: 'review-recent-work' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('what');
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    failCatalogFor('p2', 'hold');
    fireEvent.change(screen.getByTestId('launch-wizard-project'), { target: { value: 'p2' } });
    toReview();
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('Checking this workflow for the chosen project');
    expect(screen.getByTestId('launch-wizard-launch')).toBeDisabled();
  });
});

describe('round 5: the request snapshot is the whole request', () => {
  it('a seat changed under the same key while the preview is out: not sent (codex r5)', async () => {
    const seat = (binary: string) => ({ key: 'claude', display_name: 'Claude', binary, enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true });
    setCachedRoster([seat('claude')] as never);
    catalog = { categories: [{ id: 'analyze', title: 'Analyze' }], entries: [{
      id: 'rr', category: 'analyze', title: 'Review', summary: 'S.', outcome: 'O', needs: ['repo'], inputs: [], status: 'available',
      launch: { kind: 'run', workflow: 'review-recent-work' }, usage: { launches: 0, lastUsedAt: null, medianMinutes: null },
    }] };
    let releasePreview: ((r: Response) => void) | null = null;
    const realFetch = globalThis.fetch;
    const json = (b: unknown): Response => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname;
      if (path.endsWith('/presets')) return Promise.resolve(json({ presets: [{ name: 'review-recent-work', steps: [{ id: 'analyze' }] }] }));
      if (path.endsWith('/plans/preview')) return new Promise<Response>((r) => { releasePreview = r; });
      if (path.endsWith('/roster')) return Promise.resolve(json({ roster: [seat('claude')] }));
      return realFetch(url, init);
    }));
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-workflow-review-recent-work'));
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    fireEvent.change(await screen.findByTestId('launch-wizard-repo'), { target: { value: 'repo-1' } });
    for (let i = 0; i < 4 && screen.getByTestId('launch-wizard-step').dataset.step !== 'review'; i += 1) fireEvent.click(screen.getByTestId('launch-wizard-next'));
    fireEvent.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(releasePreview).not.toBeNull(), { timeout: 3000 });
    act(() => setCachedRoster([seat('/opt/other/claude')] as never));
    await act(async () => {
      releasePreview!(json({ score: 0, deterministic: 0, reasons: [], destructive: false, band: '0-39', high_risk: false, floor: [], floor_override: null, steps: [{ id: 'analyze' }] }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(posts.filter((p) => p.path === '/runs')).toEqual([]);
    expect(screen.getByTestId('launch-wizard-error')).toBeInTheDocument();
  });
});

describe('round 6 (xreview r6): this project’s own answer first, for every draft', () => {
  const card = (id: string, workflow: string) => ({
    id, category: 'analyze', title: id, summary: `${id} summary`, outcome: 'O', needs: ['runs'], inputs: [],
    status: 'available', launch: { kind: 'run', workflow }, usage: { launches: 0, lastUsedAt: null, medianMinutes: null },
  });
  const cats = [{ id: 'analyze', title: 'Analyze' }];
  const stubCatalog = (fn: (project: string | null) => Promise<Response>): void => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(url, 'http://x');
      return u.pathname.endsWith('/workflows/catalog') ? fn(u.searchParams.get('projectId')) : realFetch(url, init);
    }));
  };
  const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };

  it('a draft opened by id on a fresh page waits for the first answer before anything can launch', async () => {
    stubCatalog(() => new Promise<Response>(() => {}));
    render(<LaunchWizard />);
    act(() => openLaunchWizard({ workflowId: 'review-recent-work', intent: 'look at my runs' }));
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('Reading the workflows…');
    expect(screen.getByTestId('launch-wizard-next')).toBeDisabled();
  });

  it('a draft opened by id whose workflow the chosen project’s catalog does not offer is blocked once it answers', async () => {
    stubCatalog((p) => Promise.resolve(json({ categories: cats, entries: p === 'p2' ? [card('other', 'other')] : [card('rr', 'review-recent-work')] })));
    render(<LaunchWizard />);
    act(() => openLaunchWizard({ workflowId: 'review-recent-work', intent: 'look at my runs' }));
    await settle();
    expect(screen.getByTestId('launch-wizard-next')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('launch-wizard-next'));
    fireEvent.change(screen.getByTestId('launch-wizard-project'), { target: { value: 'p2' } });
    await settle();
    expect(screen.getByTestId('launch-wizard-blocker')).toHaveTextContent('This workflow is not available now.');
    expect(screen.getByTestId('launch-wizard-next')).toBeDisabled();
  });

  it('a failed first read is "couldn’t read", never today’s list, and stays so on a reopen', async () => {
    stubCatalog(() => Promise.resolve(json({ error: 'busy' }, 503)));
    render(<LaunchWizard />);
    act(() => openLaunchWizard({}));
    await settle();
    expect(screen.getByTestId('launch-catalog-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('launch-catalog-older')).toBeNull();
    act(() => useLaunchWizard.getState().close());
    act(() => openLaunchWizard({}));
    await settle();
    expect(screen.getByTestId('launch-catalog-failed')).toBeInTheDocument();
  });
});
