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
function stubWire(): void {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (path === '/workflows/catalog') {
      return Promise.resolve(catalog === null
        ? new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify(catalog), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    const body = path === '/repos' ? { repos: [REPO, REPO2] } : path === '/projects' ? { projects: [] } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
}

beforeEach(() => {
  catalog = null;
  stubWire();
  resetPlanCatalog();
  clearCachedWorkflows();
  setCachedWorkflows(WF);
  clearRepoCache();
  resetWorkflowCatalog();
  resetLaunchWizard();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
    expect(cardIds(panel)).toEqual(['bug', 'feature', 'qe-author-tests', 'review-recent-work', 'acme-release', 'demo-video', 'draft-epics', 'vibe']);
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

  it('a daemon that lists no workflows says so and offers chat', async () => {
    clearCachedWorkflows();
    setCachedWorkflows([]);
    catalog = { categories: [], workflows: [] };
    await openCatalog();
    // Studio's own kinds still show; an empty catalog with nothing at all is the empty state.
    expect(screen.queryByTestId('launch-catalog-empty')).toBeNull();
    expect(cardIds(screen.getByTestId('launch-catalog-results'))).toContain('demo-video');
  });
});

describe('a daemon with the catalog', () => {
  beforeEach(() => { catalog = fixture; });

  it('Your top first, then Create, Resolve, Analyze, Test and More, each with its cards', async () => {
    await openCatalog();
    const sections = [...document.querySelectorAll<HTMLElement>('[data-section]')].map((s) => s.dataset.section);
    expect(sections).toEqual(['top', 'create', 'resolve', 'analyze', 'test', 'more']);
    expect(cardIds(section('top'))).toEqual(['bug', 'feature', 'review-recent-work', 'migration']);
    expect(cardIds(section('resolve'))).toEqual(['bug', 'migration']);
    // Crew's demo is studio's Demo video (one card), Draft epics and Learn sit under More.
    expect(cardIds(section('create'))).toEqual(['vibe', 'feature', 'documentation', 'presentation', 'demo-video', 'phase-plugin', 'editor-plugin', 'mcp-server']);
    expect(cardIds(section('more'))).toEqual(['learn', 'draft-epics']);
    const feature = screen.getByTestId('launch-wizard-workflow-feature');
    expect(feature).toHaveTextContent('A pull request with the feature, its tests and a review');
    expect(feature).toHaveTextContent('Needs a repository · 30–90 min · $$');
    // A top card names its category; a card in its own section does not repeat it.
    expect(screen.getByTestId('launch-catalog-top-bug')).toHaveTextContent('Resolve');
    expect(within(section('resolve')).getByTestId('launch-wizard-workflow-bug')).not.toHaveTextContent('Resolve');
  });

  it('a coming-soon workflow is shown, never offered: not a button, a click picks nothing', async () => {
    await openCatalog();
    const vibe = screen.getByTestId('launch-catalog-soon-vibe');
    expect(vibe.tagName).not.toBe('BUTTON');
    expect(vibe).toHaveAttribute('aria-disabled', 'true');
    expect(vibe).toHaveTextContent('Coming soon');
    expect(vibe.querySelector('a, button, [tabindex]')).toBeNull();
    fireEvent.click(vibe);
    expect(useLaunchWizard.getState().draft?.workflowId ?? null).toBeNull();
  });

  it('Your top is hidden for a new user', async () => {
    catalog = { ...fixture, usage: [] };
    await openCatalog();
    expect(screen.queryByTestId('launch-catalog-top')).toBeNull();
    expect(section('create')).not.toBeNull();
  });

  it('typing a sentence ranks the right workflow first, and Enter picks it', async () => {
    await openCatalog();
    search('write docs for the auth service');
    expect(screen.queryByTestId('launch-catalog-top')).toBeNull();
    expect(cardIds(section('results'))[0]).toBe('documentation');
    expect(screen.getByTestId('launch-catalog-count')).toHaveTextContent(/workflows? match/);
    fireEvent.keyDown(screen.getByTestId('launch-catalog-search'), { key: 'Enter' });
    expect(useLaunchWizard.getState().draft?.workflowId).toBe('documentation');
    expect(screen.getByTestId('launch-wizard-step').dataset.step).toBe('what');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('New job: Documentation');
    // Shaping: what you get, what it needs, and the inputs it asks you to say.
    const shape = screen.getByTestId('launch-wizard-shape');
    expect(shape).toHaveTextContent('Docs for a service or feature');
    expect(screen.getByTestId('launch-wizard-shape-needs')).toHaveTextContent('a repository');
    expect(screen.getByTestId('launch-wizard-shape-inputs')).toHaveTextContent('Who reads it (optional) New engineers');
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
    expect(shown).toEqual(['vibe', 'presentation', 'demo-video', 'review-recent-work', 'learn', 'draft-epics']);
    fireEvent.click(screen.getByTestId('launch-catalog-soon-toggle'));
    expect(cardIds(screen.getByTestId('launch-catalog-results'))).not.toContain('vibe');
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
    expect(screen.getByTestId('launch-wizard-shape-inputs')).toHaveTextContent('Runs to review Name one or more runs');
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

  it('Talk it through first leaves for the chat flow', async () => {
    await openCatalog();
    fireEvent.click(screen.getByTestId('launch-wizard-start-chat'));
    expect(useLaunchWizard.getState().open).toBe(false);
  });
});
