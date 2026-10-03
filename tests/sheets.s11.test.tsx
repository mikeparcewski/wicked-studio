import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clicksTo, OBJECT_ACTIONS, objectAttr, parseObject, primaryAction, RAW_CONTROLS, RUN_SECTION_TABS, SHEET_TABS, type ObjectRef,
} from '../src/board/objectActions.js';
import { flushDecisionsForTest, resetDecisionsForTest, undoDecision, useUndoQueue } from '../src/board/undoQueue.js';
import { ACCORDIONS } from '../src/components/RightPanel.js';
import { ObjectSheet } from '../src/components/sheets/ObjectSheet.js';
import { objectCommands } from '../src/components/sheets/objectCommands.js';
import { peekFact } from '../src/components/sheets/AltPeek.js';
import { closeSheet, openSheet, stopRun, useSheets } from '../src/store/sheets.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { makeUnit, makeView } from './factories.js';

/** S11 (DES-STUDIO-REBUILD-001 §11): look underneath — sheets, ⌘K for the pointed object, ⌥ peek. */

const INVENTORY = JSON.parse(readFileSync(`${process.cwd()}/testid-inventory.json`, 'utf8')) as { static: Array<{ testId: string }> };
const IDS = new Set(INVENTORY.static.map((e) => e.testId));

const RUN = makeView({ id: 'r1', status: 'executing', problem: 'fix the double charge', unit_ix: 1 }, [
  makeUnit({ id: 'r1:u0', session_id: 'r1', ord: 0, status: 'done', assigned_cli: 'claude', description: 'understand — fix it' }),
  makeUnit({ id: 'r1:u1', session_id: 'r1', ord: 1, status: 'distributed', assigned_cli: 'codex', description: 'build — fix it' }),
]);

let posts: string[] = [];
beforeEach(() => {
  posts = [];
  resetDecisionsForTest();
  useSheets.setState({ open: null, pointed: null, stopping: {} });
  setCachedRoster([{ key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true } as never]);
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST') posts.push(path);
    const body = path.endsWith('/events') ? { events: [] } : path.includes('/output') ? { output: 'it read the code' } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetDecisionsForTest(); });

describe('every raw control of the dense mode is reachable (DESIGN-simple §5, enumerated)', () => {
  it('each sheet home is a real tab or action of its object, at most two clicks from it', () => {
    for (const { control, homes } of RAW_CONTROLS) {
      expect(homes.length, control).toBeGreaterThan(0);
      for (const h of homes) {
        if ('surface' in h) {
          expect(IDS.has(h.testid), `${control} → ${h.surface} (${h.testid})`).toBe(true);
          continue;
        }
        const ok = 'tab' in h ? SHEET_TABS[h.on].some((t) => t.id === h.tab) : OBJECT_ACTIONS[h.on].some((a) => a.id === h.action);
        expect(ok, `${control} → ${h.on} ${'tab' in h ? h.tab : h.action}`).toBe(true);
        expect(clicksTo(h), control).toBeLessThanOrEqual(2);
      }
    }
  });

  it('the run panel’s sections are all session tabs (RightPanel reachable as sheet tabs)', () => {
    expect(RUN_SECTION_TABS.map((t) => t.id)).toStrictEqual(ACCORDIONS.map((a) => a.id));
    for (const t of RUN_SECTION_TABS) expect(SHEET_TABS.session.some((s) => s.id === t.id)).toBe(true);
  });

  it('each object has exactly one primary action; references round-trip', () => {
    for (const k of ['step', 'helper', 'session', 'desk'] as const) {
      expect(OBJECT_ACTIONS[k].filter((a) => a.primary === true)).toHaveLength(1);
      expect(primaryAction(k).id).toBeTruthy();
    }
    const refs: ObjectRef[] = [{ kind: 'desk' }, { kind: 'session', sessionId: 'run:r1' }, { kind: 'step', runId: 'r1', ord: 2 }, { kind: 'helper', runId: 'r:1', cli: 'codex' }];
    for (const r of refs) expect(parseObject(objectAttr(r))).toStrictEqual(r);
    expect(parseObject('step:r1:x')).toBeNull();
  });
});

describe('Stop waits 10 s with Undo', () => {
  it('Undo inside the window sends nothing; after it, one cancel', async () => {
    const id = stopRun(['r1'], '“fix the double charge”')!;
    expect(useUndoQueue.getState().pending[0]?.verb).toBe('stop');
    act(() => undoDecision(id));
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts).toStrictEqual([]);
    stopRun(['r1'], '“fix the double charge”');
    expect(useSheets.getState().stopping['r1']).toBeDefined();
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts).toStrictEqual(['/runs/r1/cancel']);
  });

  it('⌘K on a step lists its actions; Stop goes through the undo window', async () => {
    const cmds = objectCommands({ kind: 'step', runId: 'r1', ord: 1 }, { runs: [RUN], navigate: () => {}, runChatId: false });
    expect(cmds.rows.map((r) => r.id)).toStrictEqual(['look', ...OBJECT_ACTIONS.step.map((a) => a.id)]);
    act(() => cmds.rows.find((r) => r.id === 'stop')!.run());
    expect(posts).toStrictEqual([]);
    expect(useUndoQueue.getState().pending).toHaveLength(1);
    const ended = objectCommands({ kind: 'step', runId: 'r1', ord: 1 }, { runs: [makeView({ id: 'r1', status: 'completed' })], navigate: () => {}, runChatId: false });
    expect(ended.rows.find((r) => r.id === 'stop')!.disabled).toBe('It has already ended.');
  });
});

describe('the sheets', () => {
  it('a helper’s terminal is read-only until you turn typing on', () => {
    render(<ObjectSheet runs={[RUN]} navigate={() => {}} needCount={0} />);
    act(() => openSheet({ kind: 'helper', runId: 'r1', cli: 'codex' }, 'terminal'));
    expect(screen.getByTestId('sheet-terminal').getAttribute('data-typing')).toBe('off');
    expect(screen.queryByTestId('sheet-message-input')).toBeNull();
    fireEvent.click(screen.getByTestId('sheet-terminal-typing'));
    expect(screen.getByTestId('sheet-terminal').getAttribute('data-typing')).toBe('on');
    expect(screen.getByTestId('sheet-message-input')).toBeTruthy();
  });

  it('a step sheet opens on what is happening, tabs switch, Esc closes it', () => {
    render(<ObjectSheet runs={[RUN]} navigate={() => {}} needCount={0} />);
    act(() => openSheet({ kind: 'step', runId: 'r1', ord: 0 }));
    expect(screen.getByTestId('sheet-title').textContent).toBe('Research');
    expect(screen.getAllByTestId('sheet-tab').map((t) => t.getAttribute('data-tab'))).toStrictEqual(SHEET_TABS.step.map((t) => t.id));
    expect(screen.getByTestId('sheet-primary').textContent).toBe('Message it');
    fireEvent.click(screen.getAllByTestId('sheet-tab').find((t) => t.getAttribute('data-tab') === 'did')!);
    expect(screen.getByTestId('sheet-body').getAttribute('data-tab')).toBe('did');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useSheets.getState().open).toBeNull();
  });

  it('the session sheet carries the run’s sections as tabs', () => {
    render(<ObjectSheet runs={[RUN]} navigate={() => {}} needCount={0} />);
    act(() => openSheet({ kind: 'session', sessionId: 'run:r1' }));
    const tabs = screen.getAllByTestId('sheet-tab').map((t) => t.getAttribute('data-tab'));
    for (const id of ['goal', 'helpers', 'activity', 'signins', 'whatwhere', 'governance', 'steering']) expect(tabs).toContain(id);
    act(() => closeSheet());
  });
});

describe('⌥ peek says one telling fact', () => {
  it('per object', () => {
    const ctx = { runs: [RUN], needCount: 2, runChatId: false, standing: () => 'signed in' };
    expect(peekFact({ kind: 'desk' }, ctx)).toBe('2 things need you · 1 running');
    expect(peekFact({ kind: 'helper', runId: 'r1', cli: 'claude' }, ctx)).toBe('claude · not working right now · signed in');
    expect(peekFact({ kind: 'step', runId: 'r1', ord: 0 }, ctx)).toBe('Done · claude');
    expect(peekFact({ kind: 'session', sessionId: 'run:r1' }, ctx)).toBe('fix the double charge · being worked on');
  });
});

describe('codex on S11', () => {
  it('a second Stop on a run already stopping queues nothing more (one cancel at most)', async () => {
    stopRun(['r1'], '“a”');
    stopRun(['r1'], '“a”');
    expect(useUndoQueue.getState().pending).toHaveLength(1);
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts).toStrictEqual(['/runs/r1/cancel']);
  });

  it('pointing leaves with the pointer and with focus', async () => {
    const { trackPointedObject } = await import('../src/store/sheets.js');
    const stop = trackPointedObject();
    document.body.innerHTML = '<div data-object="desk"><button id="b">x</button></div><p id="out">y</p>';
    const b = document.getElementById('b')!;
    b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(useSheets.getState().pointed).toStrictEqual({ kind: 'desk' });
    document.dispatchEvent(new MouseEvent('mouseleave'));
    expect(useSheets.getState().pointed).toBeNull();
    b.focus();
    expect(useSheets.getState().pointed).toStrictEqual({ kind: 'desk' });
    b.blur();
    expect(useSheets.getState().pointed).toBeNull();
    stop();
  });

  it('⌥ held inside a text field shows no peek', () => {
    useSheets.setState({ pointed: { kind: 'desk' } });
    render(<><input data-testid="field" /><AltPeekHost /></>);
    const field = screen.getByTestId('field');
    field.focus();
    fireEvent.keyDown(field, { key: 'Alt' });
    expect(screen.queryByTestId('alt-peek')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'Alt' });
    expect(screen.getByTestId('alt-peek')).toBeTruthy();
  });
});

import { AltPeek } from '../src/components/sheets/AltPeek.js';
function AltPeekHost(): React.ReactElement { return <AltPeek runs={[RUN]} needCount={1} />; }
