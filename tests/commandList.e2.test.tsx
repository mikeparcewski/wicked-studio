/**
 * DES-CATALOG-002 Lane E2 (§4.6, §8.4-8.6): the `/` command list from the v2 wire, a pick into the composer as a job
 * chip (card, option, depth), Enter posting the person-made proposal (into the chat, or as a new chat's seed) and never
 * a launch, hidden cards by their alias only, the named-launch bridge, and an older daemon's flow unchanged.
 * The fixture is the v2 catalog the test rig (crew 0.17.1) served.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoEntry, RosterSeat, WorkflowDef } from '../src/api/types.js';
import type { WorkflowCatalogV2Response } from 'wicked-crew-api-types';
import { SLASH_COMMANDS } from '../src/board/planDraft.js';
import { allCommandRows, cardForWorkflow, commandList, KNOWN_INPUT_KINDS, parseCommandLine } from '../src/board/slashCatalog.js';
import { Composer } from '../src/components/session/Composer.js';
import { TEST_WORKFLOW_ID } from '../src/components/RouteRedirect.js';
import { CREATE_EDITOR_WORKFLOW_ID } from '../src/components/editors/EditorPluginsSettings.js';
import { LEARN_WORKFLOW_ID } from '../src/components/learn/learnModel.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { resetCatalogV2, resetLooksLike } from '../src/store/catalogV2.js';
import { resetChatFlow, useChatFlow } from '../src/store/chatFlow.js';
import { chipsOf, useComposerChips } from '../src/store/composerChips.js';
import { resetComposerSeats } from '../src/store/composerSeats.js';
import { useStartNotes } from '../src/store/inlineStart.js';
import { DEMO_VIDEO_ID, DRAFT_EPICS_ID, openLaunchWizard, resetLaunchWizard, useLaunchWizard } from '../src/store/launchWizard.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { clearRepoCache } from '../src/store/repoCache.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { useSessionDrafts } from '../src/store/sessionDrafts.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';
import { resetWorkflowCatalog } from '../src/store/workflowCatalog.js';
import rigV1 from './fixtures/workflowCatalog-rig.json';
import rigV2 from './fixtures/workflowCatalogV2-rig.json';

const V2 = rigV2 as unknown as WorkflowCatalogV2Response;
const def = (id: string): WorkflowDef => ({ id, phases: [{ id: 'work', executes_code: true }] }) as unknown as WorkflowDef;
const WF = ['bug', 'feature', 'migration', 'test-analysis', 'test-plan', 'editor-plugin', 'mcp-server', 'qe-author-tests'].map(def);
const SEAT = { key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true, signed_in: true } as RosterSeat;
const REPO = { id: 'repo-1', name: 'svc', root_path: '/srv/svc', default_branch: 'main', registered_at: 0 } as RepoEntry;

let v2: unknown = V2;
/** What the detect route answers (a promise that never settles = a reading still out). */
let detect: () => Promise<unknown> = () => new Promise(() => {});
let calls: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
const nonGets = (): Array<{ method: string; path: string; body: Record<string, unknown> | null }> => calls.filter((c) => c.method !== 'GET');

function stubWire(): void {
  calls = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://x');
    const path = u.pathname.replace(/^\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ method, path: `${path}${u.search}`, body });
    const json = (b: unknown, status = 200): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } }));
    if (method === 'POST' && path === '/workflows/catalog/detect') return detect().then((g) => json(g));
    if (method === 'POST' && /^\/chats\/[^/]+\/proposals$/.test(path)) {
      return json({ view: { state: 'open', proposal: { pid: `${path.split('/')[2]}:person:1`, kind: 'job' } } }, 201);
    }
    if (method === 'POST' && path === '/chats') {
      return json({ chatId: 'seeded-1', seats: [], scope: null, refused: [], proposal: { state: 'open', proposal: { pid: 'seeded-1:person:1', kind: 'job' } } }, 201);
    }
    if (method !== 'GET') return json({ ok: true });
    if (path === '/workflows/catalog') return json(u.searchParams.get('v') === '2' ? v2 : rigV1);
    return json(path === '/workflows' ? { workflows: WF } : path === '/roster' ? { roster: [SEAT] } : path === '/repos' ? { repos: [REPO] }
      : path === '/presets' ? { presets: [] } : path === '/projects' ? { projects: [] } : {});
  }));
}

function Harness({ chatId = 'c1', composerKey = 'c1' }: { chatId?: string | null; composerKey?: string }): React.ReactElement {
  const [text, setText] = useState('');
  return <Composer composerKey={composerKey} jobChatId={chatId} text={text} setText={setText} onSend={() => {}} placeholder="p" ariaLabel="a" variant="session" navigate={() => {}} />;
}
function type(text: string): void {
  const box = screen.getByTestId('session-composer-input') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text, selectionStart: text.length } });
  box.setSelectionRange(text.length, text.length);
  fireEvent.select(box);
}
const enter = (): void => { fireEvent.keyDown(screen.getByTestId('session-composer-input'), { key: 'Enter' }); };
const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="composer-menu-item"][data-group="start-work"]')];
const cmds = (): string[] => rows().map((r) => r.dataset.cmd ?? `(${r.dataset.card})`);
async function list(text = '/'): Promise<void> {
  type(text);
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
}
const pickRow = (cmd: string): void => {
  const r = rows().find((x) => x.dataset.cmd === cmd);
  if (r === undefined) throw new Error(`no row ${cmd}: ${cmds().join(', ')}`);
  fireEvent.mouseDown(r);
};
const proposals = (): Array<Record<string, unknown>> => nonGets().filter((c) => /\/proposals$/.test(c.path)).map((c) => c.body!);
const launches = (): string[] => nonGets().map((c) => c.path).filter((p) => p === '/runs' || /\/demo$|\/product\/compose$/.test(p));

function capable(on = true): void {
  useCapabilities.setState({ loaded: true, chatJobProposals: on, workflowCatalogV2: on, chatIdOnLaunch: true });
}

beforeEach(() => {
  v2 = V2;
  detect = () => new Promise(() => {});
  stubWire();
  capable();
  resetCatalogV2();
  resetLooksLike();
  resetWorkflowCatalog();
  resetLaunchWizard();
  resetPlanCatalog();
  resetChatFlow();
  resetComposerSeats();
  clearRepoCache();
  clearCachedWorkflows();
  setCachedWorkflows(WF);
  clearCachedRoster();
  setCachedRoster([SEAT]);
  useComposerChips.setState({ byComposer: {} });
  useSessionDrafts.setState({ drafts: {} });
  useStartNotes.setState({ notes: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the v2 command list (pure)', () => {
  const all = allCommandRows(V2);
  it('lists verbs in order, each card’s command, its variants as sub-commands, then Yours', () => {
    expect([...new Set(all.map((r) => r.group))]).toEqual(['plan', 'build', 'test', 'investigate', 'analyze', 'judge', 'create', 'organize', 'improve', 'yours']);
    const migrate = all.filter((r) => r.card === 'migrate').map((r) => [r.kind, r.command]);
    expect(migrate).toEqual([['card', '/migrate'], ['option', '/migrate move'], ['option', '/migrate in-place'], ['option', '/migrate upgrade']]);
    expect(all.filter((r) => r.kind === 'yours').map((r) => r.card)).toEqual(['demo-human-review', 'sourced-report']);
  });
  it('shows only what can start here: no hidden, coming, unavailable or unknown-input card or option (ruling: available or hidden)', () => {
    const ids = new Set(all.map((r) => r.card));
    for (const hidden of ['test-analysis']) expect(ids.has(hidden)).toBe(false);
    for (const coming of ['competitive', 'due-diligence', 'research', 'analyze-documents', 'critique', 'respond', 'rework', 'estimate-price', 'run-cost', 'app', 'setup-project', 'tune']) expect(ids.has(coming), coming).toBe(false);
    expect(ids.has('review-change')).toBe(false); // unavailable on this daemon
    expect(all.some((r) => r.command === '/plugin phase')).toBe(false); // a coming option
    expect(all.some((r) => r.command === '/plugin editor')).toBe(true);
    // A card that takes an input kind this studio does not know is hidden (and comes back once the kind is known).
    const docs = structuredClone(V2);
    docs.cards.find((c) => c.id === 'risk')!.inputs.push({ id: 'docs', label: 'Documents', kind: 'documents', required: true });
    expect(KNOWN_INPUT_KINDS.has('documents')).toBe(false);
    expect(allCommandRows(docs).some((r) => r.card === 'risk')).toBe(false);
  });
  it('filters by command prefix, then by option word; a whole command and words closes it', () => {
    expect(commandList(V2, '/mig')).toMatchObject({ open: true, freeWords: null });
    const st = commandList(V2, '/migrate up');
    expect(st.open && st.rows.map((r) => r.command)).toEqual(['/migrate upgrade']);
    expect(commandList(V2, '/migrate upgrade the node service')).toEqual({ open: false });
    // An alias typed by its prefix lists the card or option it is bound to.
    const al = commandList(V2, '/workflow-mcp');
    expect(al.open && al.rows.map((r) => [r.kind, r.card, r.option])).toEqual([['alias', 'start-new', 'mcp-server']]);
  });
  it('free words rank cards with the one scorer; crew’s Looks like leads only for a listed card', () => {
    const st = commandList(V2, '/upgrade our node service to 22');
    expect(st.open && st.freeWords).toBe('upgrade our node service to 22');
    expect(st.open && st.rows[0]?.card).toBe('migrate');
    const guess = { card: 'migrate', option: 'upgrade', depth: null, confidence: 0.9, band: 'sure' as const, reason: 'Upgrade words', available: true, question: null, source: 'words' as const, catalogRev: V2.rev };
    const led = commandList(V2, '/upgrade our node service to 22', guess);
    expect(led.open && [led.rows[0]?.kind, led.rows[0]?.card, led.rows[0]?.option, led.rows[0]?.groupTitle]).toEqual(['looks', 'migrate', 'upgrade', 'Looks like']);
    // A coming card or an `ask` is never a Looks like row.
    expect(commandList(V2, '/x y z w', { ...guess, card: 'due-diligence', option: null, available: false }).open).toBe(true);
    const coming = commandList(V2, '/diligence on acme corp', { ...guess, card: 'due-diligence', option: null, available: false });
    expect(coming.open && coming.rows.some((r) => r.kind === 'looks')).toBe(false);
  });
  it('parses commands, option words, depth and aliases off the wire', () => {
    expect(parseCommandLine(V2, '/migrate upgrade to node 22')).toMatchObject({ card: { id: 'migrate' }, option: 'upgrade', words: 'to node 22', wireCard: 'migrate', refused: null });
    expect(parseCommandLine(V2, '/workflow-migration the db')).toMatchObject({ card: { id: 'migrate' }, option: 'in-place', words: 'the db', wireCard: '/workflow-migration' });
    expect(parseCommandLine(V2, '/incident deep why the queue stalls')).toMatchObject({ card: { id: 'incident' }, depth: 'deep', words: 'why the queue stalls' });
    expect(parseCommandLine(V2, '/bug quick fix')).toMatchObject({ card: { id: 'bug' }, depth: null, words: 'quick fix' });
    expect(parseCommandLine(V2, 'just words')).toBeNull();
    expect(parseCommandLine(V2, '/nothing here')).toBeNull();
  });
  it('/workflow-test-analysis is the hidden test-analysis card (by its alias), never Plan tests', () => {
    const hit = parseCommandLine(V2, '/workflow-test-analysis the coverage gaps');
    expect(hit).toMatchObject({ card: { id: 'test-analysis' }, wireCard: '/workflow-test-analysis', words: 'the coverage gaps', refused: null });
    expect(parseCommandLine(V2, '/workflow-test-plan x')).toMatchObject({ card: { id: 'plan-tests' } });
  });
  it('a coming command starts nothing and says it is not available, never "coming" or a release', () => {
    for (const cmd of ['/due-diligence acme', '/plugin phase timings', '/review-change 12']) {
      const hit = parseCommandLine(V2, cmd)!;
      expect(hit.refused, cmd).toMatch(/isn’t available on this daemon\..*Nothing was sent\./);
      expect(hit.refused, cmd).not.toMatch(/coming|1\.1|1\.2/i);
    }
  });
  it('§9.2 (q): commands come from the wire — substituted commands drive the list and the parser', () => {
    const sub = structuredClone(V2);
    const m = sub.cards.find((c) => c.id === 'migrate')!;
    m.command = '/port';
    for (const o of m.variant!.options) { o.command = `/port ${o.optionWord!}-x`; o.optionWord = `${o.optionWord!}-x`; }
    m.aliases = [{ command: '/workflow-oldport', option: 'move' }];
    const rowsSub = allCommandRows(sub);
    expect(rowsSub.filter((r) => r.card === 'migrate').map((r) => r.command)).toEqual(['/port', '/port move-x', '/port in-place-x', '/port upgrade-x']);
    expect(parseCommandLine(sub, '/migrate upgrade x')).toBeNull();
    expect(parseCommandLine(sub, '/port upgrade-x go')).toMatchObject({ card: { id: 'migrate' }, option: 'upgrade', words: 'go' });
    expect(parseCommandLine(sub, '/workflow-oldport')).toMatchObject({ card: { id: 'migrate' }, option: 'move', wireCard: '/workflow-oldport' });
  });
  it('§9.2 (q): every shown command, option command and alias typed makes what a pick of it makes', () => {
    for (const r of allCommandRows(V2)) {
      if (r.command === null) continue;
      const hit = parseCommandLine(V2, `${r.command} some words`);
      expect(hit, r.command).not.toBeNull();
      expect([hit!.card.id, hit!.option, hit!.refused], r.command).toEqual([r.card, r.option, null]);
    }
    for (const c of V2.cards) {
      for (const a of c.aliases) {
        const hit = parseCommandLine(V2, a.command)!;
        expect([hit.card.id, hit.option, hit.wireCard], a.command).toEqual([c.id, a.option, a.command]);
      }
    }
  });
  it('§9.2 (q): no command collides with a composer step command', () => {
    const steps = new Set(SLASH_COMMANDS.map((s) => `/${s.cmd}`));
    for (const c of V2.cards) if (c.command !== null) expect(steps.has(c.command), c.command).toBe(false);
  });
  it('the named-launch bridge reads each opener’s card off the wire', () => {
    expect(cardForWorkflow(V2, CREATE_EDITOR_WORKFLOW_ID)).toMatchObject({ wireCard: '/workflow-editor-plugin', card: { id: 'studio-plugin' }, option: 'editor' });
    expect(cardForWorkflow(V2, TEST_WORKFLOW_ID)).toMatchObject({ wireCard: '/workflow-qe-author-tests', card: { id: 'write-tests' } });
    expect(cardForWorkflow(V2, LEARN_WORKFLOW_ID)).toMatchObject({ wireCard: '/workflow-learn', card: { id: 'propose' }, option: 'knowledge' });
    expect(cardForWorkflow(V2, DEMO_VIDEO_ID)).toMatchObject({ wireCard: 'demo-video', card: { id: 'demo-video' }, option: null });
    expect(cardForWorkflow(V2, DRAFT_EPICS_ID)).toMatchObject({ wireCard: 'backlog', card: { id: 'backlog' }, option: 'epics' });
    expect(cardForWorkflow(V2, 'demo-human-review')).toBeNull(); // a Yours workflow keeps today's form
  });
});

describe('picking into the composer, and Enter', () => {
  it('lists the v2 commands on `/`, from the wire', async () => {
    render(<Harness />);
    await list();
    expect(cmds().slice(0, 4)).toEqual(['/plan-it', '/feature', '/bug', '/migrate']);
    expect(cmds()).toContain('/migrate upgrade');
    expect(cmds()).not.toContain('/workflow-test-analysis');
    expect(calls.some((c) => c.path === '/workflows/catalog?v=2')).toBe(true);
  });
  it('a pick posts nothing; Enter posts exactly one proposal into the chat and calls no launch route', async () => {
    render(<Harness />);
    await list('/migrate up');
    pickRow('/migrate upgrade');
    const chip = chipsOf(useComposerChips.getState(), 'c1')[0]!;
    expect(chip).toMatchObject({ kind: 'workflow', job: true, card: 'migrate', entryId: 'migrate', option: 'upgrade', depth: null, label: 'Migrate or modernize · Upgrade' });
    expect(nonGets()).toEqual([]);
    type('to node 22');
    expect(nonGets()).toEqual([]);
    enter();
    await waitFor(() => expect(proposals()).toHaveLength(1));
    expect(nonGets().map((c) => c.path)).toEqual(['/chats/c1/proposals']);
    expect(proposals()[0]).toMatchObject({ card: 'migrate', option: 'upgrade', words: 'to node 22', source: 'pick' });
    expect(typeof proposals()[0]!.requestId).toBe('string');
    expect(launches()).toEqual([]);
    await waitFor(() => expect(chipsOf(useComposerChips.getState(), 'c1')).toEqual([]));
  });
  it('two variants sharing one workflow keep their own option through the pick, extra words, a remount and Enter', async () => {
    const view = render(<Harness />);
    await list('/migrate in');
    pickRow('/migrate in-place');
    type('the orders db');
    view.unmount();
    render(<Harness />);
    expect(chipsOf(useComposerChips.getState(), 'c1')[0]).toMatchObject({ option: 'in-place', workflowId: 'migration' });
    type('the orders db and its views');
    enter();
    await waitFor(() => expect(proposals()).toHaveLength(1));
    expect(proposals()[0]).toMatchObject({ card: 'migrate', option: 'in-place', words: 'the orders db and its views' });
    type('');
    await list('/migrate up');
    pickRow('/migrate upgrade');
    enter();
    await waitFor(() => expect(proposals()).toHaveLength(2));
    expect(proposals()[1]).toMatchObject({ card: 'migrate', option: 'upgrade' });
  });
  it('a command typed whole and Enter posts the same proposal (source: command)', async () => {
    render(<Harness />);
    type('/migrate upgrade to node 22');
    // Once the list is read, a command typed whole with words after it closes the list: Enter posts it.
    await waitFor(() => expect(document.querySelector('[data-testid="composer-menu"]')).toBeNull());
    await waitFor(() => { enter(); expect(proposals()).toHaveLength(1); });
    expect(proposals()[0]).toMatchObject({ card: 'migrate', option: 'upgrade', words: 'to node 22', source: 'command' });
    expect(launches()).toEqual([]);
  });
  it('/workflow-test-analysis makes the hidden test-analysis card’s proposal, never a Plan tests one', async () => {
    render(<Harness />);
    await list('/workflow-test');
    expect(rows().map((r) => r.dataset.card)).not.toContain('test-analysis');
    type('/workflow-test-analysis the coverage gaps');
    await waitFor(() => { enter(); expect(proposals()).toHaveLength(1); });
    expect(proposals()[0]).toMatchObject({ card: '/workflow-test-analysis', words: 'the coverage gaps', source: 'command' });
    expect(proposals()[0]!.card).not.toBe('plan-tests');
  });
  it('a coming command starts nothing and posts nothing', async () => {
    render(<Harness />);
    type('/due-diligence acme corp');
    await waitFor(() => expect(calls.some((c) => c.path === '/workflows/catalog?v=2')).toBe(true));
    await waitFor(() => { enter(); expect(screen.getByTestId('composer-note').textContent).toMatch(/isn’t available on this daemon/); });
    expect(screen.getByTestId('composer-note').textContent).not.toMatch(/coming/i);
    expect(nonGets()).toEqual([]);
  });
  it('no chat yet (the Desk, a fresh chat): Enter seeds a new chat with the job and opens it', async () => {
    render(<Harness chatId={null} composerKey="desk" />);
    await list('/bug');
    pickRow('/bug');
    type('login crashes');
    enter();
    await waitFor(() => expect(nonGets()).toHaveLength(1));
    expect(nonGets()[0]).toMatchObject({ method: 'POST', path: '/chats' });
    expect(nonGets()[0]!.body).toMatchObject({ seed: { card: 'bug', words: 'login crashes', source: 'pick' }, accepts: ['job'] });
    expect(typeof nonGets()[0]!.body!.requestId).toBe('string');
    await waitFor(() => expect(useChatFlow.getState().request?.chatId).toBe('seeded-1'));
    expect(useChatFlow.getState().fresh['seeded-1']).toBeUndefined();
  });
  it('the list never waits for a seat: rows show while crew reads the words, and the reading is words only', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Harness />);
      type('/upgrade our node service to 22');
      await waitFor(() => expect(rows().length).toBeGreaterThan(0));
      expect(rows()[0]!.dataset.card).toBe('migrate');
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      const asked = nonGets().filter((c) => c.path === '/workflows/catalog/detect');
      expect(asked).toHaveLength(1);
      expect(asked[0]!.body).toMatchObject({ text: 'upgrade our node service to 22', seat: false });
      expect(rows().length).toBeGreaterThan(0); // still listed, the reading still out
    } finally { vi.useRealTimers(); }
  });
  it('Looks like leads once crew answers, and its pick keeps the words', async () => {
    detect = () => Promise.resolve({ card: 'migrate', option: 'upgrade', depth: null, confidence: 0.9, band: 'sure', reason: 'Upgrade words', available: true, question: null, source: 'words', catalogRev: V2.rev });
    render(<Harness />);
    type('/upgrade our node service to 22');
    await waitFor(() => expect(rows()[0]?.dataset.kind).toBe('looks'), { timeout: 3000 });
    fireEvent.mouseDown(rows()[0]!);
    expect(chipsOf(useComposerChips.getState(), 'c1')[0]).toMatchObject({ card: 'migrate', option: 'upgrade' });
    expect((screen.getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe('upgrade our node service to 22');
  });
  it('typing words with no `/` sends nothing, and fewer than 4 words asks crew nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Harness />);
      type('fix the login crash please now');
      type('/fix login');
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(nonGets()).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});

describe('§9.2 (u) and older daemons: today’s flow', () => {
  it('without chatJobProposals the `/` list is ux-tonight’s, and a pick never posts a proposal', async () => {
    capable(false);
    render(<Harness />);
    type('/');
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(rows().every((r) => r.dataset.entry !== undefined)).toBe(true); // v1 rows (by entry), not v2 commands
    expect(calls.some((c) => c.path === '/workflows/catalog?v=2')).toBe(false);
    fireEvent.mouseDown(rows().find((r) => r.dataset.entry === 'bug')!);
    expect(chipsOf(useComposerChips.getState(), 'c1')[0]).toMatchObject({ kind: 'workflow', workflowId: 'bug' });
    expect(chipsOf(useComposerChips.getState(), 'c1')[0]!.kind === 'workflow' && (chipsOf(useComposerChips.getState(), 'c1')[0] as { job?: true }).job).toBeUndefined();
    expect(screen.getByTestId('composer-start')).toBeTruthy(); // ux-tonight's inline start row
    expect(proposals()).toEqual([]);
  });
});

describe('the named-launch bridge and New job on a capable daemon', () => {
  const seedOf = (): Record<string, unknown> | null => nonGets().find((c) => c.path === '/chats')?.body ?? null;
  it.each([
    ['EditorPluginsSettings', { workflowId: CREATE_EDITOR_WORKFLOW_ID }, { card: '/workflow-editor-plugin', option: 'editor' }],
    ['RouteRedirect', { workflowId: TEST_WORKFLOW_ID, projectId: null }, { card: '/workflow-qe-author-tests' }],
    ['Learn', { workflowId: LEARN_WORKFLOW_ID }, { card: '/workflow-learn', option: 'knowledge' }],
    ['EverythingPage', { workflowId: DEMO_VIDEO_ID, projectId: 'p1' }, { card: 'demo-video' }],
  ])('%s: a seeded chat with its card, no modal', async (_who, init, seed) => {
    act(() => openLaunchWizard(init));
    await waitFor(() => expect(seedOf()).not.toBeNull());
    expect(seedOf()).toMatchObject({ seed: { ...seed, source: 'pick' } });
    expect(useLaunchWizard.getState().open).toBe(false);
    expect(launches()).toEqual([]);
    await waitFor(() => expect(useChatFlow.getState().request?.chatId).toBe('seeded-1'));
  });
  it('ProjectRequirementsPage: Draft epics with the chosen requirements, filled as the person’s answer', async () => {
    act(() => openLaunchWizard({ workflowId: DRAFT_EPICS_ID, projectId: 'p1', requirements: [{ repoId: 'r1', key: 'REQ-1', title: 'One' }], composerKey: 'desk' }));
    await waitFor(() => expect(nonGets()).toHaveLength(2));
    expect(nonGets()[0]!.body).toMatchObject({ seed: { card: 'backlog', option: 'epics' }, projectId: 'p1' });
    expect(nonGets()[1]).toMatchObject({ path: '/chats/seeded-1/proposals', body: { revises: 'seeded-1:person:1', source: 'question', edits: { inputs: { requirements: { kind: 'requirements', refs: [{ repoId: 'r1', key: 'REQ-1' }] } } } } });
  });
  it('a workflow with no card (a saved one) keeps today’s form', async () => {
    act(() => openLaunchWizard({ workflowId: 'demo-human-review' }));
    await waitFor(() => expect(useLaunchWizard.getState().open).toBe(true));
    expect(nonGets()).toEqual([]);
  });
  it('a plain New job opens the `/` list on the composer on screen, never the modal, sending nothing', async () => {
    render(<Harness />);
    act(() => openLaunchWizard({ composerKey: 'c1' }));
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(cmds()).toContain('/bug');
    expect(useLaunchWizard.getState().open).toBe(false);
    expect(nonGets()).toEqual([]);
  });
  it('a plain New job with words opens a new chat with them waiting in its composer', () => {
    act(() => openLaunchWizard({ intent: 'the login page crashes', projectId: null, composerKey: 'desk' }));
    const id = useChatFlow.getState().request!.chatId;
    expect(useSessionDrafts.getState().drafts[id]).toBe('the login page crashes');
    expect(useLaunchWizard.getState().open).toBe(false);
    expect(nonGets()).toEqual([]);
  });
});
