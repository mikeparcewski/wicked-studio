/**
 * slash-catalog (operator 2026-11-04: "the slash commands in the chatbox don't match the list of
 * workflows when I see the new job modal"): the composer's `/` menu lists New job's catalog — the
 * same entries, titles and categories, "Your top" first, each entry once — and a pick starts what
 * New job's card starts. The fixture is the catalog the test rig served (24 entries).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoEntry, RosterSeat, WorkflowDef } from '../src/api/types.js';
import { LaunchWizard } from '../src/components/launch/LaunchWizard.js';
import { Composer } from '../src/components/session/Composer.js';
import { resetChatFlow, useChatFlow } from '../src/store/chatFlow.js';
import { useComposerChips } from '../src/store/composerChips.js';
import { resetComposerSeats } from '../src/store/composerSeats.js';
import { openLaunchWizard, resetLaunchWizard, useLaunchWizard } from '../src/store/launchWizard.js';
import { clearNewDocumentBrief, peekNewDocumentBrief } from '../src/store/newDocumentSeed.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { clearRepoCache } from '../src/store/repoCache.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { useSessionDrafts } from '../src/store/sessionDrafts.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';
import { peekWorkflowCatalog, resetWorkflowCatalog } from '../src/store/workflowCatalog.js';
import rig from './fixtures/workflowCatalog-rig.json';

const def = (id: string, extra: Partial<WorkflowDef> = {}): WorkflowDef =>
  ({ id, phases: [{ id: 'work', executes_code: true }], ...extra }) as unknown as WorkflowDef;
/** The rig's `GET /workflows`: its ordinary defs (the old menu listed exactly these), `distill-learnings`
 *  among them, and a system one. */
const WF: WorkflowDef[] = [
  'apps-publish', 'apps-turn', 'bug', 'docs', 'domain-extraction', 'editor-plugin', 'feature', 'learn', 'mcp-server',
  'migration', 'qe-author-tests', 'test-analysis', 'test-plan', 'validate-docs', 'review-recent-work', 'distill-learnings', 'run-evals',
].map((id) => def(id)).concat([def('chat', { is_system: true } as Partial<WorkflowDef>)]);
const SEAT = { key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true, signed_in: true } as RosterSeat;
const REPO = { id: 'repo-1', name: 'svc', root_path: '/srv/svc', default_branch: 'main', registered_at: 0 } as RepoEntry;

/** The rig's catalog in New job's order at the fixture's clock: "Your top" (bug 44 launches, the domain
 *  map 14, a feature 4), then each category in order, an entry listed once. */
const RIG_ROWS: Array<[string, string]> = [
  ['bug', 'Fix a bug'], ['domain-extraction', 'Map the domain'], ['feature', 'Build a feature'],
  ['apps', 'Apps'], ['docs', 'Write documentation'], ['document-interactive', 'Interactive document'], ['document-static', 'Document'],
  ['presentation', 'Presentation'], ['demo-video', 'Demo video'], ['phase-plugin', 'Studio phase plugin'], ['editor-plugin', 'Editor plugin'],
  ['mcp-server', 'MCP server'],
  ['migration', 'Migration'],
  ['review-recent-work', 'Review recent work'], ['validate-docs', 'Check documentation'],
  ['test-plan', 'Plan tests'], ['test-analysis', 'Analyze tests'], ['qe-author-tests', 'Write tests'],
  ['start-chat', 'Start a chat'], ['learn', 'Learn a topic'], ['draft-epics', 'Draft epics'], ['run-evals', 'Run the default evals'],
  ['apps-publish', 'Publish an app'], ['apps-turn', 'Change an app'],
];

let catalog: unknown = rig;
let catalogStatus = 200;
let gets: string[] = [];
function stubWire(): void {
  gets = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    const json = (body: unknown, status = 200): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
    if (init?.method === 'POST') return json({ ok: true });
    gets.push(path);
    if (path === '/workflows/catalog') return catalogStatus === 200 ? json(catalog) : json({ error: 'down' }, catalogStatus);
    return json(path === '/workflows' ? { workflows: WF } : path === '/roster' ? { roster: [SEAT] } : path === '/repos' ? { repos: [REPO] }
      : path === '/presets' ? { presets: [] } : path === '/projects' ? { projects: [] } : {});
  }));
}

function Harness({ navigate }: { navigate: (p: string) => void }): React.ReactElement {
  const [text, setText] = useState('');
  return <Composer composerKey="s1" text={text} setText={setText} onSend={() => {}} placeholder="p" ariaLabel="a" variant="session" navigate={navigate} />;
}
/** Put `text` in the box with the caret at `caret` (default: the end). */
function type(text: string, caret = text.length): void {
  const box = screen.getByTestId('session-composer-input') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text, selectionStart: caret } });
  box.setSelectionRange(caret, caret);
  fireEvent.select(box);
}
const startRows = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('[data-testid="composer-menu-item"][data-group="start-work"]')];
const rowsOf = (): Array<[string, string]> => startRows().map((r) => [r.dataset.entry ?? `(${r.dataset.cmd})`, r.querySelector('b')?.textContent ?? '']);
async function openMenu(text = '/', caret?: number): Promise<void> {
  type(text, caret);
  await waitFor(() => expect(startRows().length).toBeGreaterThan(0));
}
const row = (entry: string): HTMLElement => document.querySelector<HTMLElement>(`[data-testid="composer-menu-item"][data-entry="${entry}"]`)!;

/** New job's cards for the same catalog, in the order it shows them, each entry once (a "Your top" card
 *  is also under its category there). */
async function newJobCards(): Promise<Array<[string, string]>> {
  const view = render(<LaunchWizard navigate={() => {}} />);
  act(() => openLaunchWizard({}));
  await waitFor(() => expect(screen.getByTestId('launch-catalog').dataset.source).toBe('catalog'));
  const seen = new Set<string>();
  const out: Array<[string, string]> = [];
  for (const el of document.querySelectorAll<HTMLElement>('[data-testid="launch-catalog-results"] [data-job]')) {
    const id = el.dataset.job!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push([id, el.querySelector('.wk-launch-wizard-choice-name')?.textContent ?? '']);
  }
  act(() => resetLaunchWizard());
  view.unmount();
  return out;
}

beforeEach(() => {
  // Your top is recency-weighted: the clock is the fixture's.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
  catalog = rig;
  catalogStatus = 200;
  stubWire();
  resetWorkflowCatalog();
  resetLaunchWizard();
  resetPlanCatalog();
  resetChatFlow();
  resetComposerSeats();
  clearNewDocumentBrief();
  clearRepoCache();
  clearCachedWorkflows();
  setCachedWorkflows(WF);
  clearCachedRoster();
  setCachedRoster([SEAT]);
  useComposerChips.setState({ byComposer: {} });
  useSessionDrafts.setState({ drafts: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('the `/` menu lists New job’s catalog', () => {
  it('the same entries and titles, in New job’s order (Your top first, each entry once)', async () => {
    const cards = await newJobCards();
    expect(cards).toEqual(RIG_ROWS);
    render(<Harness navigate={() => {}} />);
    await openMenu();
    expect(rowsOf()).toEqual(cards);
    // Grouped as New job groups them: its section titles, in its order.
    const groups = [...document.querySelectorAll<HTMLElement>('[data-testid="composer-menu-group"][data-group="start-work"]')];
    expect(groups.map((g) => g.textContent)).toEqual(['Your top', 'Create', 'Resolve', 'Analyze', 'Test', 'More']);
    // What the catalog leaves out is never offered: not the machine-owned `distill-learnings`, not a system flow.
    expect(startRows().map((r) => r.dataset.workflow)).not.toContain('distill-learnings');
    expect(startRows().map((r) => r.dataset.workflow)).not.toContain('chat');
  });

  it('a word narrows the rows to the entries it names, in the same order', async () => {
    render(<Harness navigate={() => {}} />);
    await openMenu('/doc');
    expect(rowsOf().map(([id]) => id)).toEqual(['docs', 'document-interactive', 'document-static', 'validate-docs']);
    type('/workflow-te');
    await waitFor(() => expect(rowsOf().map(([id]) => id)).toEqual(['test-plan', 'test-analysis']));
  });

  it('a coming-soon entry is shown as New job shows it and never starts', async () => {
    const nav = vi.fn();
    render(<Harness navigate={nav} />);
    await openMenu('/app');
    expect(row('apps')).toHaveAttribute('aria-disabled', 'true');
    // New job's card: the "Coming soon" tag and the catalog's note.
    expect(row('apps').querySelector('small')?.textContent).toBe('Coming soon · Design in progress.');
    fireEvent.mouseDown(row('apps'));
    expect(screen.getByTestId('composer-note').textContent).toBe('Apps is coming soon. Design in progress.');
    expect(useLaunchWizard.getState().open).toBe(false);
    expect(nav).not.toHaveBeenCalled();
  });

  it('a catalog that cannot be read says so and lists nothing in its place (never today’s list)', async () => {
    catalogStatus = 500;
    render(<Harness navigate={() => {}} />);
    type('/');
    await waitFor(() => expect(screen.getByTestId('composer-menu-empty').dataset.state).toBe('failed'));
    expect(screen.getByTestId('composer-menu-empty').textContent).toBe('Couldn’t read the workflows. Type / again to try again.');
    expect(startRows()).toHaveLength(0);
  });

  it('a catalog that lists nothing shows what New job shows: studio’s own kinds only', async () => {
    catalog = { categories: [], entries: [] };
    const cards = await newJobCards();
    render(<Harness navigate={() => {}} />);
    await openMenu();
    expect(rowsOf()).toEqual(cards);
    expect(rowsOf().map(([id]) => id)).toEqual(['demo-video', 'draft-epics']);
  });

  it('a box reads its catalog once when it mounts, so its first `/` lists at once', async () => {
    render(<Harness navigate={() => {}} />);
    await waitFor(() => expect(peekWorkflowCatalog(null)?.state).toBe('ready'));
    expect(gets.filter((p) => p === '/workflows/catalog')).toHaveLength(1);
    type('/');
    expect(rowsOf()).toEqual(RIG_ROWS);
  });

  it('each open of the menu reads the catalog again (Your top is as of now)', async () => {
    render(<Harness navigate={() => {}} />);
    await openMenu();
    const reads = gets.filter((p) => p === '/workflows/catalog').length;
    type('');
    type('/');
    await waitFor(() => expect(gets.filter((p) => p === '/workflows/catalog').length).toBe(reads + 1));
  });
});

describe('a pick starts what New job’s card starts', () => {
  it('Document: New document in the card’s format, the words as its brief', async () => {
    const wizNav = vi.fn();
    const wiz = render(<LaunchWizard navigate={wizNav} />);
    act(() => openLaunchWizard({}));
    await waitFor(() => expect(screen.getByTestId('launch-catalog').dataset.source).toBe('catalog'));
    fireEvent.click(document.querySelector<HTMLElement>('[data-testid="launch-catalog-results"] [data-job="document-static"]')!);
    expect(wizNav).toHaveBeenCalledTimes(1);
    expect(useLaunchWizard.getState().open).toBe(false);
    wiz.unmount();

    const nav = vi.fn();
    render(<Harness navigate={nav} />);
    // "/doc" typed in front of the words: the caret sits after the command.
    await openMenu('/doc the offsite one-pager', 4);
    fireEvent.mouseDown(row('document-static'));
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav.mock.calls[0]![0]).toBe(wizNav.mock.calls[0]![0]);
    expect(nav.mock.calls[0]![0]).toBe('/everything?tab=made&kind=documents&new=document&format=doc');
    expect(peekNewDocumentBrief()).toBe('the offsite one-pager');
    expect(useLaunchWizard.getState().open).toBe(false);
  });

  it('Start a chat: a new chat on its own page, the words as its first message', async () => {
    render(<Harness navigate={() => {}} />);
    await openMenu('/start why is checkout slow', 6);
    fireEvent.mouseDown(row('start-chat'));
    const chatId = useChatFlow.getState().request?.chatId ?? '';
    expect(chatId).not.toBe('');
    expect(useSessionDrafts.getState().drafts[chatId]).toBe('why is checkout slow');
    expect(useLaunchWizard.getState().open).toBe(false);
  });

  it.each(['bug', 'apps-turn', 'apps-publish', 'demo-video', 'draft-epics'])('%s: New job on that card, at the step its card goes to', async (id) => {
    // New job's own card click, for the draft and step it leads to.
    const wiz = render(<LaunchWizard navigate={() => {}} />);
    act(() => openLaunchWizard({}));
    await waitFor(() => expect(screen.getByTestId('launch-catalog').dataset.source).toBe('catalog'));
    fireEvent.click(document.querySelector<HTMLElement>(`[data-testid="launch-catalog-results"] [data-job="${id}"]`)!);
    const want = useLaunchWizard.getState().draft!;
    const wantStep = screen.getByTestId('launch-wizard-step').dataset.step;
    act(() => resetLaunchWizard());
    wiz.unmount();

    render(<><Harness navigate={() => {}} /><LaunchWizard navigate={() => {}} /></>);
    await openMenu(`/${id.split('-')[0]}`);
    fireEvent.mouseDown(row(id));
    const got = useLaunchWizard.getState().draft!;
    expect([got.workflowId, got.catalogEntryId]).toEqual([want.workflowId, want.catalogEntryId]);
    expect(got.catalogEntryId).toBe(id);
    expect((await screen.findByTestId('launch-wizard-step')).dataset.step).toBe(wantStep);
  });
});

describe('/workflow-<key> typed by hand (back-compat)', () => {
  it('names a workflow entry; the rest of the line is the intent', async () => {
    render(<Harness navigate={() => {}} />);
    await openMenu('/workflow-bug');
    type('/workflow-bug the charge never clears');
    fireEvent.keyDown(screen.getByTestId('session-composer-input'), { key: 'Enter' });
    expect(useLaunchWizard.getState().draft).toMatchObject({ workflowId: 'bug', catalogEntryId: 'bug', intent: 'the charge never clears' });
  });

  it('a workflow the catalog leaves out (distill-learnings) is not started', async () => {
    render(<Harness navigate={() => {}} />);
    await openMenu();
    type('/workflow-distill-learnings now');
    fireEvent.keyDown(screen.getByTestId('session-composer-input'), { key: 'Enter' });
    expect(screen.getByTestId('composer-note').textContent).toBe('This daemon lists no workflow named distill-learnings — nothing was sent.');
    expect(useLaunchWizard.getState().open).toBe(false);
  });
});
