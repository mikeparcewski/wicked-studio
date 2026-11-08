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
import type { CatalogInputKindV2, WorkflowCatalogV2Response } from 'wicked-crew-api-types';
import { SLASH_COMMANDS } from '../src/board/planDraft.js';
import { allCommandRows, cardForWorkflow, commandList, exactRow, KNOWN_INPUT_KINDS, parseCommandLine } from '../src/board/slashCatalog.js';
import { Composer } from '../src/components/session/Composer.js';
import { TEST_WORKFLOW_ID } from '../src/components/RouteRedirect.js';
import { CREATE_EDITOR_WORKFLOW_ID } from '../src/components/editors/EditorPluginsSettings.js';
import { LEARN_WORKFLOW_ID } from '../src/components/learn/learnModel.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { readCatalogV2, resetCatalogV2, resetLooksLike } from '../src/store/catalogV2.js';
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
/** Statuses the next proposal / seed posts answer with (default 201), in order. */
let proposalStatuses: number[] = [];
let seedStatuses: number[] = [];
/** Held until released: the v2 catalog read, and /health. */
let v2Gate: Promise<void> = Promise.resolve();
let healthGate: Promise<void> = Promise.resolve();
/** What the composer handed over as an ordinary chat message. */
let chatSends: string[] = [];
/** What /health advertises (the capabilities store reads it when nothing has yet). */
let healthCaps: Record<string, unknown> = {};
/** Held until released: the proposal and seed posts. */
let proposalGate: Promise<void> = Promise.resolve();
let seedGate: Promise<void> = Promise.resolve();
/** Extra fields on a seed's answer. */
let seedExtra: Record<string, unknown> = {};
/** The projects, and each one's members (F39: a repository's project). */
let projectList: Array<{ id: string; name: string }> = [];
let projectMembers: Record<string, Array<{ member_kind: string; member_ref: string }>> = {};
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
      const st = proposalStatuses.shift() ?? 201;
      return proposalGate.then(() => st >= 400 ? json({ code: 'boom', error: 'the daemon said no' }, st) : json({ view: { state: 'open', proposal: { pid: `${path.split('/')[2]}:person:1`, kind: 'job' } } }, 201));
    }
    if (method === 'POST' && path === '/chats') {
      const st = seedStatuses.shift() ?? 201;
      return seedGate.then(() => st >= 400 ? json({ code: 'boom', error: 'the daemon said no' }, st) : json({ chatId: 'seeded-1', seats: [], scope: null, refused: [], proposal: { state: 'open', proposal: { pid: 'seeded-1:person:1', kind: 'job' } }, ...seedExtra }, 201));
    }
    if (method !== 'GET') return json({ ok: true });
    const pm = /^\/projects\/([^/]+)\/members$/.exec(path);
    if (pm !== null) return json({ members: projectMembers[pm[1]!] ?? [] });
    if (path === '/projects') return json({ projects: projectList });
    if (path === '/health') return healthGate.then(() => json({ status: 'ok', capabilities: healthCaps }));
    if (path === '/workflows/catalog') return u.searchParams.get('v') === '2' ? v2Gate.then(() => json(v2)) : json(rigV1);
    return json(path === '/workflows' ? { workflows: WF } : path === '/roster' ? { roster: [SEAT] } : path === '/repos' ? { repos: [REPO] }
      : path === '/presets' ? { presets: [] } : path === '/projects' ? { projects: [] } : {});
  }));
}

function Harness({ chatId = 'c1', composerKey = 'c1' }: { chatId?: string | null; composerKey?: string }): React.ReactElement {
  const [text, setText] = useState('');
  return <Composer composerKey={composerKey} jobChatId={chatId} text={text} setText={setText} onSend={(m) => { chatSends.push(m); }} placeholder="p" ariaLabel="a" variant="session" navigate={() => {}} />;
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
  fireEvent.click(r);
};
/** The list is read (a `/` lists rows), then the box is cleared: what is typed next meets a read catalog. */
async function ready(): Promise<void> {
  await list('/');
  type('');
}
const proposals = (): Array<Record<string, unknown>> => nonGets().filter((c) => /\/proposals$/.test(c.path)).map((c) => c.body!);
const launches = (): string[] => nonGets().map((c) => c.path).filter((p) => p === '/runs' || /\/demo$|\/product\/compose$/.test(p));

function capable(on = true): void {
  useCapabilities.setState({ loaded: true, chatJobProposals: on, workflowCatalogV2: on, chatIdOnLaunch: true });
}

beforeEach(() => {
  v2 = V2;
  proposalStatuses = [];
  seedStatuses = [];
  v2Gate = Promise.resolve();
  healthGate = Promise.resolve();
  chatSends = [];
  healthCaps = {};
  proposalGate = Promise.resolve();
  seedGate = Promise.resolve();
  seedExtra = {};
  projectList = [];
  projectMembers = {};
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
    // A card that takes an input kind this studio does not know is hidden (and comes back once the kind is known). CS12
    // taught studio `documents` and `sources`, so a future kind stands in for the unknown one here.
    const docs = structuredClone(V2);
    docs.cards.find((c) => c.id === 'risk')!.inputs.push({ id: 'docs', label: 'Later', kind: 'later-kind' as CatalogInputKindV2, required: true });
    expect(KNOWN_INPUT_KINDS.has('later-kind' as CatalogInputKindV2)).toBe(false);
    expect(allCommandRows(docs).some((r) => r.card === 'risk')).toBe(false);
    // CS12: `documents` and `sources` are now known, so a card taking them is listed (not “needs a newer studio”).
    expect(KNOWN_INPUT_KINDS.has('documents')).toBe(true);
    expect(KNOWN_INPUT_KINDS.has('sources')).toBe(true);
    const known = structuredClone(V2);
    known.cards.find((c) => c.id === 'risk')!.inputs.push({ id: 'docs', label: 'Documents', kind: 'documents', required: true }, { id: 'srcs', label: 'Sources', kind: 'sources', required: false });
    expect(allCommandRows(known).some((r) => r.card === 'risk')).toBe(true);
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
    await ready();
    type('/migrate upgrade to node 22');
    // A command typed whole with words after it closes the list: Enter posts it, once.
    expect(document.querySelector('[data-testid="composer-menu"]')).toBeNull();
    enter();
    await waitFor(() => expect(proposals()).toHaveLength(1));
    expect(chatSends).toEqual([]);
    expect(proposals()[0]).toMatchObject({ card: 'migrate', option: 'upgrade', words: 'to node 22', source: 'command' });
    expect(launches()).toEqual([]);
  });
  it('/workflow-test-analysis makes the hidden test-analysis card’s proposal, never a Plan tests one', async () => {
    render(<Harness />);
    await list('/workflow-test');
    expect(rows().map((r) => r.dataset.card)).not.toContain('test-analysis');
    type('/workflow-test-analysis the coverage gaps');
    enter();
    await waitFor(() => expect(proposals()).toHaveLength(1));
    expect(chatSends).toEqual([]);
    expect(proposals()[0]).toMatchObject({ card: '/workflow-test-analysis', words: 'the coverage gaps', source: 'command' });
    expect(proposals()[0]!.card).not.toBe('plan-tests');
  });
  it('a coming command starts nothing and posts nothing', async () => {
    render(<Harness />);
    await ready();
    type('/due-diligence acme corp');
    enter();
    expect(screen.getByTestId('composer-note').textContent).toMatch(/isn’t available on this daemon/);
    expect(chatSends).toEqual([]);
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
    fireEvent.click(rows()[0]!);
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

describe('review folds (r1): the path holds under failure, races and edge input', () => {
  it('a leading space is the same command line: never the v1 list, never a launch', async () => {
    render(<Harness />);
    await ready();
    type(' /bug');
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(rows().every((r) => r.dataset.kind !== undefined)).toBe(true); // v2 rows only
    type(' /bug login crashes');
    enter();
    await waitFor(() => expect(proposals()).toHaveLength(1));
    expect(proposals()[0]).toMatchObject({ card: 'bug', words: 'login crashes', source: 'command' });
    expect(launches()).toEqual([]);
    expect(screen.queryByTestId('composer-start')).toBeNull(); // ux-tonight's launch row never shows
  });
  it('no helper set up: a job is still posted (a proposal is not a message to a seat), never sent as chat', async () => {
    setCachedRoster([]);
    render(<Harness />);
    await ready();
    type('/bug login crashes');
    enter();
    await waitFor(() => expect(proposals()).toHaveLength(1));
    expect(chatSends).toEqual([]);
  });
  it('a command typed before the list is read is held, never sent as a chat message', async () => {
    let release!: () => void;
    v2Gate = new Promise((r) => { release = r; });
    render(<Harness />);
    type('/due-diligence acme corp');
    enter();
    expect(screen.getByTestId('composer-note').textContent).toMatch(/Reading/);
    expect(chatSends).toEqual([]);
    expect(nonGets()).toEqual([]);
    release();
    // Once read, the same line — untouched — gets its own answer on the next Enter, and still nothing is sent.
    await waitFor(() => expect(document.querySelector('[data-testid="composer-menu"]')).toBeNull());
    enter();
    expect(screen.getByTestId('composer-note').textContent).toMatch(/isn’t available on this daemon/);
    expect(chatSends).toEqual([]);
    expect(nonGets()).toEqual([]);
  });
  it('before the daemon’s capabilities are read, `/` offers no list and Enter sends nothing', async () => {
    useCapabilities.setState({ loaded: false, chatJobProposals: false, workflowCatalogV2: false });
    let release!: () => void;
    healthGate = new Promise((r) => { release = r; });
    render(<Harness />);
    type('/');
    await waitFor(() => expect(screen.getByTestId('composer-menu-empty').dataset.state).toBe('loading'));
    expect(rows()).toEqual([]);
    type('/bug login crashes');
    enter();
    expect(chatSends).toEqual([]);
    expect(nonGets()).toEqual([]);
    // The store's one read in flight is let go, so the next test reads afresh.
    release();
    await waitFor(() => expect(useCapabilities.getState().loaded).toBe(true));
  });
  it('a failed post says why where the person is and keeps the job; a retry is the same request; new words, a new one', async () => {
    proposalStatuses = [500, 500];
    render(<Harness />);
    await list('/bug');
    pickRow('/bug');
    type('login crashes');
    enter();
    await waitFor(() => expect(screen.getByTestId('composer-start-note').textContent).toMatch(/Nothing was started: .*the daemon said no/));
    expect(screen.getByTestId('composer-start-note').getAttribute('role')).toBe('alert');
    expect(chipsOf(useComposerChips.getState(), 'c1')).toHaveLength(1);
    expect((screen.getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe('login crashes');
    enter();
    await waitFor(() => expect(proposals()).toHaveLength(2));
    expect(proposals()[1]!.requestId).toBe(proposals()[0]!.requestId);
    type('login crashes on safari');
    enter();
    await waitFor(() => expect(proposals()).toHaveLength(3));
    expect(proposals()[2]!.requestId).not.toBe(proposals()[0]!.requestId);
    await waitFor(() => expect(chipsOf(useComposerChips.getState(), 'c1')).toEqual([]));
  });
  it('a typed command posted is spent: the same command again is a new request', async () => {
    render(<Harness />);
    await ready();
    type('/bug login crashes');
    enter();
    await waitFor(() => expect(proposals()).toHaveLength(1));
    await waitFor(() => expect((screen.getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe(''));
    type('/bug login crashes');
    enter();
    await waitFor(() => expect(proposals()).toHaveLength(2));
    expect(proposals()[1]!.requestId).not.toBe(proposals()[0]!.requestId);
  });
  it('two Enters before a re-render post once', async () => {
    render(<Harness />);
    await list('/bug');
    pickRow('/bug');
    type('x');
    // Two Enters in one batch: nothing renders between them, so only a ref (not the render's state) can hold the second.
    const box = screen.getByTestId('session-composer-input');
    act(() => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await waitFor(() => expect(proposals()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(proposals()).toHaveLength(1);
  });
  it('an @project chip sends the job to a new chat in that project, not this chat', async () => {
    render(<Harness />);
    act(() => useComposerChips.setState({ byComposer: { c1: [{ kind: 'project', key: 'p:p2', label: 'P2', projectId: 'p2' }] } }));
    await list('/bug');
    pickRow('/bug');
    enter();
    await waitFor(() => expect(nonGets()).toHaveLength(1));
    expect(nonGets()[0]).toMatchObject({ path: '/chats', body: { projectId: 'p2', seed: { card: 'bug' } } });
  });
  it('§9.2 (q) end to end: substituted commands drive the rendered list, the pick and the typed command', async () => {
    const sub = structuredClone(V2);
    const m = sub.cards.find((c) => c.id === 'migrate')!;
    m.command = '/port';
    for (const o of m.variant!.options) { o.command = `/port ${o.optionWord!}-x`; o.optionWord = `${o.optionWord!}-x`; }
    v2 = sub;
    render(<Harness />);
    await list('/po');
    expect(cmds()).toEqual(['/port', '/port move-x', '/port in-place-x', '/port upgrade-x']);
    pickRow('/port upgrade-x');
    enter();
    await waitFor(() => expect(proposals()).toHaveLength(1));
    expect(proposals()[0]).toMatchObject({ card: 'migrate', option: 'upgrade', source: 'pick' });
    type('/port move-x the db');
    enter();
    await waitFor(() => expect(proposals()).toHaveLength(2));
    expect(proposals()[1]).toMatchObject({ card: 'migrate', option: 'move', words: 'the db', source: 'command' });
    type('/migrate upgrade x');
    enter();
    await new Promise((r) => setTimeout(r, 30));
    expect(proposals()).toHaveLength(2); // the old spelling is not a command here
    expect(launches()).toEqual([]);
  });
  it('a named opener’s seed that fails keeps its requirements and scope; Enter on its new chat retries the same request', async () => {
    seedStatuses = [500];
    act(() => openLaunchWizard({ workflowId: DRAFT_EPICS_ID, projectId: 'p1', contextRepo: 'repo-1', requirements: [{ repoId: 'r1', key: 'REQ-1', title: 'One' }] }));
    await waitFor(() => expect(useStartNotes.getState().notes[useChatFlow.getState().request?.chatId ?? '']).toMatch(/could not be started/));
    const fresh = useChatFlow.getState().request!.chatId;
    const first = nonGets()[0]!.body!;
    render(<Harness chatId={null} composerKey={fresh} />);
    expect(screen.getByTestId('composer-start-note').textContent).toMatch(/Press Enter to try again/);
    enter();
    await waitFor(() => expect(nonGets()).toHaveLength(3));
    expect(nonGets()[1]!.body).toMatchObject({ requestId: first.requestId, projectId: 'p1', repoRefs: ['repo-1'], seed: { card: 'backlog', option: 'epics' } });
    expect(nonGets()[2]).toMatchObject({ path: '/chats/seeded-1/proposals', body: { edits: { inputs: { requirements: { kind: 'requirements', refs: [{ repoId: 'r1', key: 'REQ-1' }] } } } } });
  });
  it('a named opener replaced before its catalog is read posts nothing and opens nothing', async () => {
    let release!: () => void;
    v2Gate = new Promise((r) => { release = r; });
    act(() => openLaunchWizard({ workflowId: CREATE_EDITOR_WORKFLOW_ID }));
    act(() => openLaunchWizard({ intent: 'something else', composerKey: 'desk' }));
    const now = useChatFlow.getState().request!.chatId;
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(nonGets()).toEqual([]);
    expect(useChatFlow.getState().request!.chatId).toBe(now);
  });
  it('a named opener racing another read of the catalog shares it: one read, and the opener still posts its card', async () => {
    let release!: () => void;
    v2Gate = new Promise((r) => { release = r; });
    act(() => openLaunchWizard({ workflowId: CREATE_EDITOR_WORKFLOW_ID }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/workflows/catalog?v=2')).toHaveLength(1));
    void readCatalogV2(null); // a competing reader (a composer's `/`)
    void readCatalogV2(null);
    release();
    await waitFor(() => expect(nonGets().find((c) => c.path === '/chats')?.body).toMatchObject({ seed: { card: '/workflow-editor-plugin' } }));
    expect(calls.filter((c) => c.path === '/workflows/catalog?v=2')).toHaveLength(1);
    expect(useLaunchWizard.getState().open).toBe(false);
  });
  it('New job keeps a draft already on the composer: the list opens in a new chat', async () => {
    render(<Harness />);
    act(() => { useSessionDrafts.getState().setDraft('c1', 'half a thought'); });
    act(() => openLaunchWizard({ composerKey: 'c1' }));
    const id = useChatFlow.getState().request?.chatId;
    expect(id).toBeDefined();
    expect(id).not.toBe('c1');
  });
  it('New job clicked before the capabilities are read waits for them: a capable daemon never shows the modal', async () => {
    useCapabilities.setState({ loaded: false, chatJobProposals: false, workflowCatalogV2: false });
    healthCaps = { chatJobProposals: true, workflowCatalogV2: true };
    act(() => openLaunchWizard({ workflowId: CREATE_EDITOR_WORKFLOW_ID }));
    expect(useLaunchWizard.getState().open).toBe(false);
    await waitFor(() => expect(nonGets().find((c) => c.path === '/chats')?.body).toMatchObject({ seed: { card: '/workflow-editor-plugin' } }));
    expect(useLaunchWizard.getState().open).toBe(false);
  });
  it('no helper set up: a typed command is a job — Send is on, no helpers row, and a refused command says its own reason', async () => {
    setCachedRoster([]);
    render(<Harness />);
    await ready();
    type('/bug login crashes');
    expect(screen.queryByTestId('composer-seats')).toBeNull();
    expect((screen.getByTestId('session-composer-send') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('session-composer-send'));
    await waitFor(() => expect(proposals()).toHaveLength(1));
    type('/due-diligence acme corp');
    enter();
    expect(screen.getByTestId('composer-note').textContent).toMatch(/isn’t available on this daemon/);
    expect(proposals()).toHaveLength(1);
  });
  it('the list filters sub-commands by the wire’s option word, as the parser reads it', () => {
    const sub = structuredClone(V2);
    const up = sub.cards.find((c) => c.id === 'migrate')!.variant!.options.find((o) => o.id === 'upgrade')!;
    up.optionWord = 'bump'; // the command still reads `/migrate upgrade`
    const st = commandList(sub, '/migrate bu');
    expect(st.open && st.rows.map((r) => r.option)).toEqual(['upgrade']);
    expect(parseCommandLine(sub, '/migrate bump to 22')).toMatchObject({ option: 'upgrade', words: 'to 22' });
  });

  it('a card command and option typed whole, key by key, then Enter picks that option, not the card (e2e-1105 CJ9)', async () => {
    const sub = structuredClone(V2);
    sub.cards.find((c) => c.id === 'studio-plugin')!.variant!.options.find((o) => o.id === 'phase')!.status = 'available';
    v2 = sub;
    render(<Harness />);
    await ready();
    const line = '/plugin phase';
    for (let i = 1; i <= line.length; i += 1) type(line.slice(0, i));
    await waitFor(() => expect(cmds()).toEqual(['/plugin phase']));
    enter();
    expect(chipsOf(useComposerChips.getState(), 'c1')[0]).toMatchObject({ card: 'studio-plugin', option: 'phase' });
  });

  it('a full command typed exactly wins the highlight even when it reads as free words, and its pick keeps no words (e2e-1105 CJ9)', async () => {
    const sub = structuredClone(V2);
    sub.cards.find((c) => c.id === 'studio-plugin')!.variant!.options.find((o) => o.id === 'phase')!.status = 'available';
    // `/ plugin phase` (a space after the slash) is free words: the scorer lists the card first, then its options.
    const st = commandList(sub, '/ plugin phase');
    expect(st.open && st.rows.map((r) => r.command).slice(0, 3)).toEqual(['/plugin phase', '/plugin', '/plugin editor']);
    expect(st.open && st.rows.filter((r) => r.command === '/plugin phase')).toHaveLength(1);
    v2 = sub;
    render(<Harness />);
    await ready();
    type('/ plugin phase');
    await waitFor(() => expect(cmds()[0]).toBe('/plugin phase'));
    expect(rows()[0]!.getAttribute('aria-selected')).toBe('true');
    enter();
    expect(chipsOf(useComposerChips.getState(), 'c1')[0]).toMatchObject({ card: 'studio-plugin', option: 'phase' });
    expect((screen.getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe('');
  });

  it('the exact match is the parser\'s reading: the wire\'s option word, and a command the scorer does not find (codex r1)', () => {
    const sub = structuredClone(V2);
    const migrate = sub.cards.find((c) => c.id === 'migrate')!;
    migrate.variant!.options.find((o) => o.id === 'upgrade')!.optionWord = 'bump';
    // `/ migrate bump` names Upgrade (the parser reads its option word); `/ migrate upgrade` is the card with words.
    const bump = commandList(sub, '/ migrate bump');
    expect(bump.open && bump.rows[0]).toMatchObject({ card: 'migrate', option: 'upgrade' });
    expect(exactRow(sub, '/ migrate upgrade')).toBeNull();
    // A command spelled so the scorer matches nothing still leads, once, when typed exactly.
    const renamed = structuredClone(V2);
    const m2 = renamed.cards.find((c) => c.id === 'migrate')!;
    m2.command = '/modernise';
    const up = m2.variant!.options.find((o) => o.id === 'upgrade')!;
    up.command = '/modernise uplift';
    up.optionWord = 'uplift';
    const st = commandList(renamed, '/ modernise uplift');
    expect(st.open && st.rows[0]).toMatchObject({ card: 'migrate', option: 'upgrade', command: '/modernise uplift' });
    expect(st.open && st.rows.filter((r) => r.key === st.rows[0]!.key)).toHaveLength(1);
    // Words after the command, a depth, or a prefix are never an exact match.
    expect(exactRow(V2, '/ migrate upgrade to node 22')).toBeNull();
    expect(exactRow(V2, '/mig')).toBeNull();
  });
});

describe('review folds (r2)', () => {
  it('an older daemon whose capabilities land after its catalog lists its workflows without another key', async () => {
    useCapabilities.setState({ loaded: false, chatJobProposals: false, workflowCatalogV2: false });
    let release!: () => void;
    healthGate = new Promise((r) => { release = r; });
    render(<Harness />);
    type('/');
    await waitFor(() => expect(calls.some((c) => c.path === '/workflows/catalog')).toBe(true));
    expect(rows()).toEqual([]);
    release();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(rows().every((r) => r.dataset.entry !== undefined)).toBe(true);
  });
  it('an unavailable default never hides an available sibling (the card row goes, the sub-command stays)', () => {
    const sub = structuredClone(V2);
    const p = sub.cards.find((c) => c.id === 'propose')!;
    p.status = 'unavailable';
    p.variant!.options.find((o) => o.id === 'knowledge')!.status = 'unavailable';
    const all = allCommandRows(sub).filter((r) => r.card === 'propose').map((r) => r.command);
    expect(all).toEqual(['/propose rules', '/propose memories']);
    expect(parseCommandLine(sub, '/propose rules from runs')).toMatchObject({ option: 'rules', refused: null });
    expect(parseCommandLine(sub, '/workflow-learn x')!.refused).toMatch(/isn’t available/);
    const st = commandList(sub, '/propose');
    expect(st.open && st.rows.map((r) => r.command)).toEqual(['/propose rules', '/propose memories']);
  });
  it('a typed command retried after a remount is the same request', async () => {
    proposalStatuses = [500];
    const v = render(<Harness />);
    await ready();
    type('/bug login crashes');
    enter();
    await waitFor(() => expect(screen.getByTestId('composer-start-note')).toBeTruthy());
    v.unmount();
    render(<Harness />);
    await ready();
    type('/bug login crashes');
    enter();
    await waitFor(() => expect(proposals()).toHaveLength(2));
    expect(proposals()[1]!.requestId).toBe(proposals()[0]!.requestId);
  });
  it('a job posted before another New job never navigates over it', async () => {
    let release!: () => void;
    seedGate = new Promise((r) => { release = r; });
    render(<Harness chatId={null} composerKey="desk" />);
    await list('/bug');
    pickRow('/bug');
    enter();
    await waitFor(() => expect(nonGets()).toHaveLength(1));
    act(() => openLaunchWizard({ intent: 'something else', composerKey: 'desk' }));
    const now = useChatFlow.getState().request!.chatId;
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(useChatFlow.getState().request!.chatId).toBe(now);
  });
  it('an old post never clears a replacement pick’s words', async () => {
    let release!: () => void;
    proposalGate = new Promise((r) => { release = r; });
    render(<Harness />);
    await list('/bug');
    pickRow('/bug');
    type('login crashes');
    enter();
    await waitFor(() => expect(proposals()).toHaveLength(1));
    const a = chipsOf(useComposerChips.getState(), 'c1')[0]!;
    act(() => useComposerChips.setState({ byComposer: { c1: [] } }));
    type('/feat');
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    pickRow('/feature');
    type('login crashes');
    expect(chipsOf(useComposerChips.getState(), 'c1')[0]!.key).not.toBe(a.key);
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect((screen.getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe('login crashes');
    expect(chipsOf(useComposerChips.getState(), 'c1')[0]).toMatchObject({ card: 'feature' });
  });
  it('a named opener for a job this studio cannot collect posts nothing and says why', async () => {
    const sub = structuredClone(V2);
    sub.cards.find((c) => c.id === 'studio-plugin')!.variant!.options.find((o) => o.id === 'editor')!.inputs.push({ id: 'docs', label: 'Later', kind: 'later-kind' as CatalogInputKindV2, required: true });
    v2 = sub;
    act(() => openLaunchWizard({ workflowId: CREATE_EDITOR_WORKFLOW_ID }));
    await waitFor(() => expect(Object.values(useStartNotes.getState().notes).join(' ')).toMatch(/needs a newer studio/));
    expect(nonGets()).toEqual([]);
    expect(useLaunchWizard.getState().open).toBe(false);
  });
  it('a seed whose chat could not be filed in the project says so on that chat', async () => {
    seedExtra = { projectAttachError: 'project p1 is archived' };
    act(() => openLaunchWizard({ workflowId: CREATE_EDITOR_WORKFLOW_ID, projectId: 'p1' }));
    await waitFor(() => expect(useStartNotes.getState().notes['seeded-1']).toMatch(/not filed in the project \(project p1 is archived\)/));
    expect(useChatFlow.getState().request?.chatId).toBe('seeded-1');
  });
});

describe('review folds (r3)', () => {
  afterEach(() => { window.history.replaceState({}, '', '/'); });
  it('a seed answered after the person opened another chat (the rail, Back) does not navigate over it', async () => {
    let release!: () => void;
    seedGate = new Promise((r) => { release = r; });
    render(<Harness chatId={null} composerKey="desk" />);
    await list('/bug');
    pickRow('/bug');
    enter();
    await waitFor(() => expect(nonGets()).toHaveLength(1));
    const before = useChatFlow.getState().request;
    window.history.pushState({}, '', '/s/another-chat');
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(useChatFlow.getState().request).toBe(before);
  });
  it('a named opener whose catalog read outlives another chat opening posts nothing', async () => {
    let release!: () => void;
    v2Gate = new Promise((r) => { release = r; });
    act(() => openLaunchWizard({ workflowId: CREATE_EDITOR_WORKFLOW_ID }));
    await waitFor(() => expect(calls.some((c) => c.path === '/workflows/catalog?v=2')).toBe(true));
    window.history.pushState({}, '', '/s/another-chat');
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(nonGets()).toEqual([]);
  });
  it('a named opener whose seed fails after the person moved on opens no fallback over them', async () => {
    let release!: () => void;
    seedGate = new Promise((r) => { release = r; });
    seedStatuses = [500];
    act(() => openLaunchWizard({ workflowId: CREATE_EDITOR_WORKFLOW_ID }));
    await waitFor(() => expect(nonGets()).toHaveLength(1));
    const before = useChatFlow.getState().request;
    window.history.pushState({}, '', '/s/another-chat');
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(useChatFlow.getState().request).toBe(before);
    expect(useStartNotes.getState().notes).toEqual({});
  });
  it('a filing failure and a requirements failure on one start are both said', async () => {
    seedExtra = { projectAttachError: 'project p1 is archived' };
    proposalStatuses = [500];
    act(() => openLaunchWizard({ workflowId: DRAFT_EPICS_ID, projectId: 'p1', requirements: [{ repoId: 'r1', key: 'REQ-1', title: 'One' }] }));
    await waitFor(() => expect(useStartNotes.getState().notes['seeded-1']).toMatch(/requirements you chose were not added/));
    expect(useStartNotes.getState().notes['seeded-1']).toMatch(/not filed in the project/);
  });
  it('free words and Looks like keep an available sub-command under an unavailable default', () => {
    const sub = structuredClone(V2);
    const p = sub.cards.find((c) => c.id === 'propose')!;
    p.status = 'unavailable';
    p.variant!.options.find((o) => o.id === 'knowledge')!.status = 'unavailable';
    const free = commandList(sub, '/rules and memories from our past runs');
    expect(free.open && free.rows.filter((r) => r.card === 'propose').map((r) => r.command)).toEqual(['/propose rules', '/propose memories']);
    const guess = { card: 'propose', option: 'rules', depth: null, confidence: 0.9, band: 'sure' as const, reason: 'Rules words', available: true, question: null, source: 'words' as const, catalogRev: sub.rev };
    const led = commandList(sub, '/rules and memories from our past runs', guess);
    expect(led.open && [led.rows[0]?.kind, led.rows[0]?.option]).toEqual(['looks', 'rules']);
    expect(commandList(sub, '/rules and memories from our past runs', { ...guess, option: null }).open && (commandList(sub, '/rules and memories from our past runs', { ...guess, option: null }) as { rows: Array<{ kind: string }> }).rows.some((r) => r.kind === 'looks')).toBe(false);
  });
});

describe('F39: the Requirements page’s "Generate it" files its job in the repository’s project', () => {
  const generate = (): void => act(() => openLaunchWizard({
    workflowId: 'domain-extraction', intent: 'Map the domain of svc', contextRepo: 'repo-1', composerKey: 'repo:repo-1',
  }));
  it('opens Analyze a codebase · Domain (its old command), the design’s card for mapping a repository’s domain', () => {
    expect(cardForWorkflow(V2, 'domain-extraction')).toMatchObject({ wireCard: '/workflow-domain-extraction', card: { id: 'analyze-codebase' }, option: 'domain' });
  });
  it('a repository in one project: the seed names that project', async () => {
    projectList = [{ id: 'default', name: 'Unfiled' }, { id: 'p1', name: 'reqgraph' }, { id: 'p2', name: 'other' }];
    projectMembers = { p1: [{ member_kind: 'crew.repo', member_ref: 'repo-1' }] };
    generate();
    await waitFor(() => expect(nonGets().find((c) => c.path === '/chats')).toBeDefined());
    expect(nonGets().find((c) => c.path === '/chats')!.body).toMatchObject({ seed: { card: '/workflow-domain-extraction', option: 'domain' }, projectId: 'p1', repoRefs: ['repo-1'] });
  });
  it('a repository in no project (or in several): the seed names none, and the passage asks with chips', async () => {
    projectList = [{ id: 'p1', name: 'reqgraph' }, { id: 'p2', name: 'other' }];
    projectMembers = { p1: [{ member_kind: 'crew.repo', member_ref: 'repo-1' }], p2: [{ member_kind: 'crew.repo', member_ref: 'repo-1' }] };
    generate();
    await waitFor(() => expect(nonGets().find((c) => c.path === '/chats')).toBeDefined());
    expect(nonGets().find((c) => c.path === '/chats')!.body!.projectId).toBeUndefined();
  });
  it('a membership that could not be read picks no project for the person', async () => {
    projectList = [{ id: 'p1', name: 'reqgraph' }, { id: 'p2', name: 'other' }];
    projectMembers = { p1: [{ member_kind: 'crew.repo', member_ref: 'repo-1' }] };
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (new URL(url, 'http://x').pathname.endsWith('/projects/p2/members')
      ? Promise.resolve(new Response('{"error":"down"}', { status: 503, headers: { 'content-type': 'application/json' } }))
      : (real as (u: string, i?: RequestInit) => Promise<Response>)(url, init))));
    generate();
    await waitFor(() => expect(nonGets().find((c) => c.path === '/chats')).toBeDefined());
    expect(nonGets().find((c) => c.path === '/chats')!.body!.projectId).toBeUndefined();
  });
});


describe('F41: a command typed in a new chat opens on the repository its words name', () => {
  const seedOf = (): Record<string, unknown> | undefined => nonGets().find((c) => c.path === '/chats')?.body ?? undefined;
  it('/analyze domain naming a registered repository: the seed is scoped on it, in the project that solely holds it', async () => {
    projectList = [{ id: 'p1', name: 'reqgraph' }, { id: 'p2', name: 'other' }];
    projectMembers = { p1: [{ member_kind: 'crew.repo', member_ref: 'repo-1' }] };
    render(<Harness chatId={null} composerKey="new" />);
    await ready();
    type('/analyze domain Map the domain of repo-1: what it does');
    enter();
    await waitFor(() => expect(seedOf()).toBeDefined());
    expect(seedOf()).toMatchObject({ seed: { card: 'analyze-codebase', option: 'domain', words: 'Map the domain of repo-1: what it does', source: 'command' }, repoRefs: ['repo-1'], projectId: 'p1' });
  });
  it('a repository named like a word (svc) is never picked from the words: the passage asks, the chips lead with it', async () => {
    render(<Harness chatId={null} composerKey="new" />);
    await ready();
    type('/analyze domain Map the domain of svc');
    enter();
    await waitFor(() => expect(seedOf()).toBeDefined());
    expect(seedOf()!['repoRefs']).toBeUndefined();
  });
  it('the person went elsewhere while the repositories were read: nothing is posted, and the command stays on the box', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (new URL(url, 'http://x').pathname.endsWith('/repos')
      ? held.then(() => new Response(JSON.stringify({ repos: [REPO] }), { status: 200, headers: { 'content-type': 'application/json' } }))
      : (real as (u: string, i?: RequestInit) => Promise<Response>)(url, init))));
    render(<Harness chatId={null} composerKey="new" />);
    await ready();
    type('/analyze domain Map the domain of repo-1');
    enter();
    await new Promise((r) => setTimeout(r, 30));
    act(() => { useChatFlow.setState({ request: { chatId: 'elsewhere', nonce: 99 } as never }); });
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(seedOf()).toBeUndefined();
    expect((screen.getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe('/analyze domain Map the domain of repo-1');
  });
  it('words that name no registered repository: the seed names none (the passage asks, with chips)', async () => {
    render(<Harness chatId={null} composerKey="new" />);
    await ready();
    type('/analyze domain Map the domain of the billing service');
    enter();
    await waitFor(() => expect(seedOf()).toBeDefined());
    expect(seedOf()!['repoRefs']).toBeUndefined();
  });
});
