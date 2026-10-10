/**
 * core#820 (studio half): the consent gate offers the engine's install choices — Install for
 * workers (default, marked, never preselected) / Also install into my CLIs / Decline — and each
 * shows the files it writes, `~/` form, the operator's own files said so.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent } from '../src/api/types.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { consentChoicesOf, sessionGateChoices } from '../src/board/gateRowModel.js';
import { setUndoWindowForTest } from '../src/board/undoQueue.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
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
    expect(consentChoicesOf({ ...gate(), choices: undefined }, [missing])).toBeNull();
    const m = sessionGateChoices({ runId: RUN, gate: { ...gate(), choices: undefined }, units: UNITS, events: [missing], pool: [], roster: null })!;
    expect(m.choices.map((c) => c.key)).toEqual(['approve', 'decline']);
    expect(consentChoicesOf(gate(), [])).toBeNull();
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

  it('renders each choice\'s files and sends the chosen token', async () => {
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS)} gate={gate()} />);
    const buttons = await screen.findAllByTestId('session-gate-choice');
    expect(buttons.map((b) => b.dataset['choiceKey'])).toEqual(['consent:worker', 'consent:operator', 'decline']);
    expect(buttons.every((b) => b.dataset['recommended'] === 'false')).toBe(true);
    expect(screen.getAllByTestId('session-gate-choice-default')).toHaveLength(1);
    const lists = screen.getAllByTestId('session-gate-consent-writes');
    expect(lists.map((l) => l.dataset['choiceKey'])).toEqual(['consent:worker', 'consent:operator']);
    const own = screen.getAllByTestId('session-gate-consent-write').filter((li) => li.dataset['own'] === 'true');
    expect(own).toHaveLength(1);
    expect(own[0]!.textContent).toMatch(/^your own /);
    fireEvent.click(buttons[1]!);
    await waitFor(() => expect(client.api.confirmGate).toHaveBeenCalled());
    expect(vi.mocked(client.api.confirmGate).mock.calls[0]![1]).toMatchObject({ approve: true, action: 'consent:operator', ord: 9 });
  });
});
