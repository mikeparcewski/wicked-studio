/**
 * core#820 (studio half): the consent gate offers the engine's install choices — Install for
 * workers (default, marked, never preselected) / Also install into my CLIs / Decline — and each
 * shows the files it writes, `~/` form, the operator's own files said so.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent } from '../src/api/types.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { consentAsksOf, consentChoicesOf, consentMissingOf, sessionGateChoices } from '../src/board/gateRowModel.js';
import { setUndoWindowForTest } from '../src/board/undoQueue.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { chooseGate } from './askGateHelpers.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-820';
const NOW = 1_700_000_000_000;
const HOME = '/home/op';
const UNITS = [makeUnit({ id: `${RUN}:install`, session_id: RUN, ord: 9, stage: 'build', tool_cmd: ['bash', '-c', 'install'] as never })];
const PROMPT = 'Consent needed before unit 9 runs — nothing in it has run yet. Install for workers writes …; Also install into my CLIs also writes your own ~/.codex/config.toml …';

const WORKER = [
  { path: `${HOME}/.wicked/mcp-servers/giphy/current`, what: 'install root', operatorOwned: false },
  { path: `${HOME}/.wicked-worker/claude/.claude.json`, what: 'claude MCP config', cli: 'claude', operatorOwned: false },
];
const OPERATOR = [...WORKER, { path: `${HOME}/.codex/config.toml`, what: 'codex MCP config (codex mcp add)', cli: 'codex', operatorOwned: true }];

const FRAME = {
  type: 'awaitingHuman', session: RUN, ord: 9, prompt: PROMPT, gateKind: 'consent',
  choices: ['consent:worker', 'consent:operator', 'reject'], recommended: 0,
  choiceLabels: { 'consent:worker': 'Install for workers', 'consent:operator': 'Also install into my CLIs', reject: 'Decline' },
  writeTargets: { 'consent:worker': WORKER, 'consent:operator': OPERATOR, reject: [] },
  writePlanOrd: 8,
} as unknown as CoreEvent;

const gate = (): OpenGate => ({
  runId: RUN, ord: 9, prompt: PROMPT, lifecycle: 'open', receivedAt: NOW, gateKind: 'consent',
  choices: ['consent:worker', 'consent:operator', 'reject'], recommended: 0,
});

const ASKS = [
  { editor: 'notes', permission: 'artifact.read', why: 'Open the notes.' },
  { editor: 'preview', permission: 'network.media', why: 'Show images.' },
  { editor: 'notes', permission: 'artifact.write', why: 'Save changes.' },
  { editor: 'notes', permission: 'future.permission', why: 'A newer permission.' },
];
const withAsks = (consentAsks: unknown): CoreEvent => ({ ...FRAME, consentAsks }) as unknown as CoreEvent;

describe('crew#1424 — consent asks model', () => {
  const model = (events: CoreEvent[]) => sessionGateChoices({ runId: RUN, gate: gate(), units: UNITS, events, pool: [], roster: null })!;

  it('reads the latest awaitingHuman frame for this ord and exposes its asks', () => {
    const events = [withAsks([ASKS[1]]), withAsks(ASKS), { ...withAsks([]), ord: 10 }, { ...withAsks([]), type: 'gateConfirmed' }] as CoreEvent[];
    expect(consentAsksOf(gate(), events)).toEqual(ASKS);
    expect(model(events).consentAsks).toEqual(ASKS);
  });

  it('drops malformed rows, requiring editor, permission and why to be strings', () => {
    const events = [withAsks([
      null, false, 7, 'ask', [], {},
      { ...ASKS[0], editor: 1 }, { ...ASKS[0], permission: null },
      { ...ASKS[0], why: false }, { editor: 'notes', permission: 'artifact.read' },
      ...ASKS,
    ])];
    expect(consentAsksOf(gate(), events)).toEqual(ASKS);
    expect(model(events).consentAsks).toEqual(ASKS);
  });

  it.each([undefined, null, {}, 'asks', [], [null, {}]])('omits empty or malformed asks: %j', (asks) => {
    const events = [withAsks(asks)];
    expect(consentAsksOf(gate(), events)).toBeUndefined();
    expect(model(events)).not.toHaveProperty('consentAsks');
  });

  it('does not fall back to older or unrelated frames when asks are absent', () => {
    for (const events of [[], [withAsks(ASKS), FRAME], [{ ...withAsks(ASKS), ord: 10 } as CoreEvent]]) {
      expect(consentAsksOf(gate(), events)).toBeUndefined();
      expect(model(events)).not.toHaveProperty('consentAsks');
    }
    expect(consentAsksOf(gate(), null)).toBeUndefined();
  });

  it('exposes asks even without install file lists', () => {
    const frame = { ...withAsks(ASKS), writeTargets: undefined } as unknown as CoreEvent;
    expect(model([frame]).consentAsks).toEqual(ASKS);
  });
});

describe('core#820 — the model', () => {
  it('three choices, the engine\'s labels and per-choice files; the default marked, nothing preselected', () => {
    const m = sessionGateChoices({ runId: RUN, gate: gate(), units: UNITS, events: [FRAME], pool: [], roster: null })!;
    expect(m.reason).toBe('consent');
    expect(m.recommended).toBeNull();
    expect(m.choices.map((c) => [c.label, c.decision, c.isDefault === true])).toEqual([
      ['Install for workers', { approve: true, action: 'consent:worker' }, true],
      ['Also install into my CLIs', { approve: true, action: 'consent:operator' }, false],
      ['Decline', { approve: false }, false],
    ]);
    expect(m.choices[1]!.writes?.filter((w) => w.operatorOwned).map((w) => w.path)).toEqual([`${HOME}/.codex/config.toml`]);
    expect(m.choices[1]!.title).toBe('Install now: writes 3 files, 1 of them your own.');
  });

  it('no plan on the frame (an older engine, or writeTargetsMissing): Approve / Decline as before', () => {
    const missing = { ...(FRAME as unknown as Record<string, unknown>), choices: undefined, writeTargets: undefined, writeTargetsMissing: true } as unknown as CoreEvent;
    const { choices: _omit, ...bare } = gate();
    void _omit;
    expect(consentChoicesOf(bare, [missing])).toBeNull();
    const m = sessionGateChoices({ runId: RUN, gate: bare, units: UNITS, events: [missing], pool: [], roster: null })!;
    expect(m.choices.map((c) => c.key)).toEqual(['approve', 'decline']);
    expect(consentChoicesOf(gate(), [])).toBeNull();
  });
});

describe('studio#639 — no install plan: the engine says why, where the file lists would be', () => {
  const SAID = 'No install plan ran, so the files each choice writes cannot be listed (the dry-run step was skipped).';
  const missing = { ...(FRAME as unknown as Record<string, unknown>), choices: undefined, writeTargets: undefined, writeTargetsMissing: SAID } as unknown as CoreEvent;
  const { choices: _omit, ...bare } = gate();
  void _omit;

  it('the model carries the sentence; the choices stay Approve / Decline', () => {
    expect(consentMissingOf(bare, [missing])).toBe(SAID);
    const m = sessionGateChoices({ runId: RUN, gate: bare, units: UNITS, events: [missing], pool: [], roster: null })!;
    expect(m.consentMissing).toBe(SAID);
    expect(m.choices.map((c) => c.key)).toEqual(['approve', 'decline']);
    // A frame WITH a plan carries no such sentence.
    expect(sessionGateChoices({ runId: RUN, gate: gate(), units: UNITS, events: [FRAME], pool: [], roster: null })!.consentMissing).toBeUndefined();
  });

  it('the row shows it', async () => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: { [RUN]: bare } });
    useGateActionStore.setState({ byGate: {} });
    useRunEventStore.setState({ byRun: { [RUN]: [missing] } });
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '' } as never);
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS)} gate={bare} />);
    expect(await screen.findByTestId('session-gate-consent-missing')).toHaveTextContent(SAID);
    expect(screen.queryByTestId('session-gate-consent-writes')).toBeNull();
    cleanup();
  });
});

describe('core#820 — the row', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setUndoWindowForTest(0);
    useGateStore.setState({ gates: { [RUN]: gate() } });
    useGateActionStore.setState({ byGate: {} });
    useRunEventStore.setState({ byRun: { [RUN]: [FRAME] } });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' } as never);
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '' } as never);
  });
  afterEach(() => cleanup());

  it('shows asks under the choices, grouped by editor in permission words, with later Plugins consent', async () => {
    useRunEventStore.setState({ byRun: { [RUN]: [withAsks(ASKS)] } });
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS)} gate={gate()} />);
    const block = await screen.findByTestId('gate-consent-asks');
    expect(within(block).getByText('It will ask to:')).toBeVisible();
    expect(within(block).getByText('notes: read what it opens, change it (you can undo), future.permission')).toBeVisible();
    expect(within(block).getByText('preview: load images and fonts from the internet')).toBeVisible();
    expect(within(block).getByText('You allow each one later in Plugins.')).toBeVisible();
    expect(block.closest('details')).toBeNull();
    const choices = screen.getByTestId('session-gate-choices');
    expect(choices.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });

  it('shows no asks block when the frame has none', async () => {
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS)} gate={gate()} />);
    await screen.findAllByTestId('session-gate-choice');
    expect(screen.queryByTestId('gate-consent-asks')).toBeNull();
    expect(screen.queryByText('You allow each one later in Plugins.')).toBeNull();
  });

  it('renders each choice\'s files and sends the chosen token', async () => {
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS)} gate={gate()} />);
    const buttons = await screen.findAllByTestId('session-gate-choice');
    expect(buttons.map((b) => b.dataset['choiceKey'])).toEqual(['consent:worker', 'consent:operator', 'decline']);
    expect(buttons.every((b) => b.dataset['recommended'] === 'false')).toBe(true);
    // The producer's default is marked, never preselected: consent is asked every time.
    expect(buttons.every((b) => b.getAttribute('aria-checked') === 'false')).toBe(true);
    // the default is marked exactly once, on its own card
    const marks = screen.getAllByTestId('ask-option-meta');
    expect(marks.map((m) => m.textContent)).toEqual(['default']);
    expect(buttons.map((b) => (b.textContent ?? '').match(/default/g)?.length ?? 0).reduce((x, y) => x + y, 0)).toBe(1);
    const lists = screen.getAllByTestId('session-gate-consent-writes');
    expect(lists.map((l) => l.dataset['choiceKey'])).toEqual(['consent:worker', 'consent:operator']);
    const own = screen.getAllByTestId('session-gate-consent-write').filter((li) => li.dataset['own'] === 'true');
    expect(own).toHaveLength(1);
    expect(own[0]!.textContent).toMatch(/^your own /);
    chooseGate(buttons[1]!);
    await waitFor(() => expect(client.api.confirmGate).toHaveBeenCalled());
    expect(vi.mocked(client.api.confirmGate).mock.calls[0]![1]).toMatchObject({ approve: true, action: 'consent:operator', ord: 9 });
  });
});

// A consent gate without the install file lists (no `writeTargets`) still draws every answer it lists, and is never
// left with nothing to answer.
describe('a consent gate without install file lists', () => {
  const bare = (choices?: string[], frame?: Record<string, unknown>) => {
    const g: OpenGate = { runId: RUN, ord: 9, prompt: PROMPT, lifecycle: 'open', receivedAt: NOW, gateKind: 'consent', ...(choices !== undefined ? { choices } : {}) };
    const events = frame === undefined ? [] : [{ type: 'awaitingHuman', session: RUN, ord: 9, prompt: PROMPT, gateKind: 'consent', ...frame } as unknown as CoreEvent];
    return sessionGateChoices({ runId: RUN, gate: g, units: UNITS, events, pool: [], roster: null })!;
  };

  it('offering consent:worker and consent:operator: both are drawn, with the gate\'s labels, and send their action', () => {
    const m = bare(['consent:worker', 'consent:operator', 'reject'], { choices: ['consent:worker', 'consent:operator', 'reject'], choiceLabels: { 'consent:worker': 'Install for workers' } });
    expect(m.choices.map((c) => [c.label, c.decision])).toEqual([
      ['Install for workers', { approve: true, action: 'consent:worker' }],
      ['operator', { approve: true, action: 'consent:operator' }],
      ['Decline', { approve: false }],
    ]);
  });

  it('offering only approve / reject: Approve / Decline', () => {
    expect(bare(['approve', 'reject']).choices.map((c) => [c.label, c.decision])).toEqual([['Approve', { approve: true }], ['Decline', { approve: false }]]);
    expect(bare().choices.map((c) => c.label)).toEqual(['Approve', 'Decline']);
  });

  it('a reopened gate: its own list wins over an older frame at the same ord', () => {
    const m = bare(['consent:new', 'reject'], { choices: ['consent:old', 'reject'], choiceLabels: { 'consent:old': 'Old install', 'consent:new': 'New install' } });
    expect(m.choices.map((c) => [c.label, c.decision])).toEqual([
      ['New install', { approve: true, action: 'consent:new' }],
      ['Decline', { approve: false }],
    ]);
  });

  it('offering nothing that maps: still Approve / Decline, never zero choices', () => {
    expect(bare(['mystery']).choices.map((c) => c.label)).toEqual(['Approve', 'Decline']);
    expect(bare([]).choices.map((c) => c.label)).toEqual(['Approve', 'Decline']);
  });
});
