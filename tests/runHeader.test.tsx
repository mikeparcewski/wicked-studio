// Operator 2026-10-18 — the run page's header, its "N needs you" banner (with the hover overview), the details panel's
// remembered default and the jump-to-latest button.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as client from '../src/api/client.js';
import type { SessionView } from '../src/api/types.js';
import type { NeedRow } from '../src/board/needsYou.js';
import {
  AT_END_PX, DETAILS_OPEN_KEY, atEnd, headerBadge, jumpLabel, needsWords, newEntries, readDetailsOpen, waitingItems, writeDetailsOpen,
  type WaitingItem,
} from '../src/board/runHeader.js';
import { NeedsBanner } from '../src/components/session/NeedsBanner.js';
import { SessionPage } from '../src/components/session/SessionView.js';
import { useHostPanel } from '../src/editors/hostApi.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { useSessionDrafts } from '../src/store/sessionDrafts.js';
import { useSheets } from '../src/store/sheets.js';
import { makeUnit, makeView } from './factories.js';

const NOW = 1_800_000_000_000;

function run(id: string, status: string): SessionView {
  return makeView({ id, status: status as never, unit_ix: 1 }, [
    makeUnit({ id: `${id}:understand`, session_id: id, ord: 0, status: 'done', stage: 'recon' }),
    makeUnit({ id: `${id}:build`, session_id: id, ord: 1, status: status === 'failed' ? 'rejected' : 'pending', stage: 'build' }),
  ]);
}

function row(key: string, kind: NeedRow['kind'], over: Partial<NeedRow> = {}): NeedRow {
  return { key, kind, severity: 1, stakes: 0, subject: 's', text: 'the engine’s words', tone: 'neutral', at: NOW - 5 * 60_000, subjectPath: '/', action: { kind: 'open', path: '/', label: 'Open' }, ...over } as NeedRow;
}

describe('headerBadge — the header’s one state word', () => {
  it('a failed, stopped or cancelled run reads in the danger tone', () => {
    expect(headerBadge([run('a', 'failed')], 'blocked')).toEqual({ word: 'Failed', tone: 'danger' });
    expect(headerBadge([run('a', 'cancelled')], 'quiet')).toEqual({ word: 'Cancelled', tone: 'danger' });
    expect(headerBadge([run('a', 'halted')], 'quiet')).toEqual({ word: 'Stopped', tone: 'danger' });
  });
  it('waiting says "Waiting" (the banner says what waits); working and finished keep their tone', () => {
    expect(headerBadge([run('a', 'awaiting_human')], 'waiting')).toEqual({ word: 'Waiting', tone: 'gate' });
    expect(headerBadge([run('a', 'executing')], 'working')).toEqual({ word: 'Working', tone: 'run' });
    expect(headerBadge([run('a', 'completed')], 'done')).toEqual({ word: 'Finished', tone: 'ok' });
  });
});

describe('waitingItems — what the banner’s overview lists', () => {
  const plan: OpenGate = { runId: 'a', ord: 1, prompt: 'Approve plan rev 1 (3 steps): understand → build → review', lifecycle: 'open', receivedAt: 1, gateKind: 'plan_approval' };
  it('each Needs-you row about THIS session’s runs: kind, step, one-line question, age', () => {
    const rows = [
      row('gate:a', 'gate', { question: 'Approve the plan (3 steps)' }),
      row('fail:b', 'failed-run', { text: 'Move the nightly report job stopped at Build\nmore words', at: null }),
      row('gate:elsewhere', 'gate', { question: 'Not this page’s' }),
    ];
    expect(waitingItems(rows, [run('a', 'awaiting_human'), run('b', 'failed')], { a: plan }, NOW)).toEqual([
      { key: 'gate:a', runId: 'a', kind: 'Plan approval', step: 'Build', question: 'Approve the plan (3 steps)', age: '5 minutes ago' },
      { key: 'fail:b', runId: 'b', kind: 'Failed run', step: 'Build', question: 'Move the nightly report job stopped at Build', age: null },
    ]);
  });
  it('a folded group counts its members; a hand-over gate says so; no rows, no items', () => {
    const group = row('group:approval', 'gate', { members: [row('gate:a', 'gate', { question: 'Approve the hand-over' })] });
    expect(waitingItems([group], [run('a', 'awaiting_human')], {}, NOW).map((i) => i.kind)).toEqual(['Hand-over']);
    expect(waitingItems([], [run('a', 'awaiting_human')], {}, NOW)).toEqual([]);
  });
  it('the yellow words', () => {
    expect(needsWords(1)).toBe('1 needs you');
    expect(needsWords(3)).toBe('3 need you');
  });
});

describe('jump to latest — pure', () => {
  it('at the end within the follow threshold', () => {
    expect(atEnd({ scrollHeight: 2000, clientHeight: 500, scrollTop: 1500 })).toBe(true);
    expect(atEnd({ scrollHeight: 2000, clientHeight: 500, scrollTop: 1500 - AT_END_PX + 1 })).toBe(true);
    expect(atEnd({ scrollHeight: 2000, clientHeight: 500, scrollTop: 1000 })).toBe(false);
  });
  it('counts the entries that arrived, and says so', () => {
    expect(newEntries(new Set(['a', 'b']), ['a', 'b', 'c', 'd'])).toBe(2);
    expect(newEntries(new Set(['a']), ['a'])).toBe(0);
    expect(jumpLabel(0)).toBe('Jump to the latest');
    expect(jumpLabel(1)).toBe('1 new message — jump to the latest');
    expect(jumpLabel(4)).toBe('4 new messages — jump to the latest');
  });
});

describe('the details panel, remembered per browser', () => {
  afterEach(() => { localStorage.removeItem(DETAILS_OPEN_KEY); vi.restoreAllMocks(); });
  it('open by default; a remembered close stays closed', () => {
    expect(readDetailsOpen()).toBe(true);
    writeDetailsOpen(false);
    expect(readDetailsOpen()).toBe(false);
    writeDetailsOpen(true);
    expect(readDetailsOpen()).toBe(true);
  });
  it('storage that throws reads as the default and writes nothing, never an error', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readDetailsOpen()).toBe(true);
    expect(() => writeDetailsOpen(false)).not.toThrow();
  });
});

describe('NeedsBanner — shown only while something waits; hover or focus gives the overview', () => {
  afterEach(cleanup);
  const items: WaitingItem[] = [
    { key: 'gate:a', runId: 'a', kind: 'Plan approval', step: 'Research', question: 'Approve the plan (5 steps)', age: '4 minutes ago' },
    { key: 'fail:b', runId: 'b', kind: 'Failed run', step: null, question: 'The build step failed.', age: null },
  ];
  it('nothing waits: no banner', () => {
    render(<NeedsBanner items={[]} onJump={() => {}} />);
    expect(screen.queryByTestId('session-needs-banner')).toBeNull();
  });
  it('the yellow words and the first question; the overview opens on hover and lists each item', () => {
    const onJump = vi.fn();
    render(<NeedsBanner items={items} onJump={onJump} />);
    const trigger = screen.getByTestId('session-needs-trigger');
    expect(trigger).toHaveTextContent('2 need you');
    expect(screen.getByTestId('session-needs-first')).toHaveTextContent('Approve the plan (5 steps) · and 1 more');
    const overview = screen.getByTestId('session-needs-overview');
    expect(overview).not.toBeVisible();
    fireEvent.mouseEnter(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(overview).toBeVisible();
    const rows = within(overview).getAllByTestId('session-needs-item');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Plan approval · Research · 4 minutes agoApprove the plan (5 steps)Go to it',
      'Failed runThe build step failed.Go to it',
    ]);
    fireEvent.click(within(rows[1]!).getByTestId('session-needs-jump'));
    expect(onJump).toHaveBeenCalledWith(items[1]);
    expect(overview).not.toBeVisible();
  });
  it('keyboard: focus opens it, Esc closes it and keeps the focus on the yellow words', () => {
    render(<NeedsBanner items={items} onJump={() => {}} />);
    const trigger = screen.getByTestId('session-needs-trigger');
    act(() => { trigger.focus(); });
    expect(screen.getByTestId('session-needs-overview')).toBeVisible();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.getByTestId('session-needs-overview')).not.toBeVisible();
    expect(document.activeElement).toBe(trigger);
  });
  it('the pointer leaving closes it after a beat (time to travel into the list)', () => {
    vi.useFakeTimers();
    render(<NeedsBanner items={items} onJump={() => {}} />);
    const trigger = screen.getByTestId('session-needs-trigger');
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(screen.getByTestId('session-needs-banner'));
    expect(screen.getByTestId('session-needs-overview')).toBeVisible();
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByTestId('session-needs-overview')).not.toBeVisible();
    vi.useRealTimers();
  });
});

describe('the run page: banner below the header, jump to latest', () => {
  beforeEach(() => {
    localStorage.removeItem(DETAILS_OPEN_KEY);
    useSheets.setState({ open: null, stopping: {} } as never);
    useRunEventStore.setState({ byRun: { a: [] } });
    useCapabilities.setState({ loaded: true, runChatId: true } as never);
    useGateStore.setState({ gates: {} } as never);
    useHostPanel.setState({ group: null, folded: false } as never);
    useSessionDrafts.setState({ drafts: {}, scroll: {} });
    vi.spyOn(client.api, 'getWatch').mockRejectedValue(new Error('404'));
    vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] } as never);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  const page = (needRows: NeedRow[], status = 'awaiting_human'): void => {
    render(<SessionPage sessionId="run:a" runs={[run('a', status)]} runsLoaded needRows={needRows} navigate={() => {}} onAsk={() => {}} />);
  };

  it('a waiting run: the banner sits between the header and the thread; the header has no "needs you" words', () => {
    page([row('gate:a', 'gate', { question: 'Approve the plan (2 steps)' })]);
    const banner = screen.getByTestId('session-needs-banner');
    const head = document.querySelector('.wk-session-head')!;
    expect(head.textContent).not.toMatch(/needs you|Waiting on you/);
    expect(screen.getByTestId('session-status')).toHaveTextContent('Waiting');
    // In the page's flow, after the header and before the thread's frame (nothing absolute over the thread).
    const session = screen.getByTestId('session');
    const order = [...session.children].map((c) => (c === head ? 'head' : c.contains(banner) ? 'banner' : c.classList.contains('wk-session-body') ? 'body' : 'other'));
    expect(order.indexOf('head')).toBeLessThan(order.indexOf('banner'));
    expect(order.indexOf('banner')).toBeLessThan(order.indexOf('body'));
  });

  it('nothing waits: no banner', () => {
    page([], 'executing');
    expect(screen.queryByTestId('session-needs-banner')).toBeNull();
  });

  it('the jump button shows only away from the newest message, and a click goes back and follows again', () => {
    page([], 'executing');
    const thread = screen.getByTestId('session-thread');
    Object.defineProperty(thread, 'scrollHeight', { configurable: true, value: 3000 });
    Object.defineProperty(thread, 'clientHeight', { configurable: true, value: 600 });
    expect(screen.queryByTestId('session-jump-latest')).toBeNull();
    // The operator scrolls up to read.
    fireEvent.wheel(thread);
    act(() => { thread.scrollTop = 800; fireEvent.scroll(thread); });
    const jump = screen.getByTestId('session-jump-latest');
    expect(jump).toHaveAccessibleName('Jump to the latest');
    expect(useSessionDrafts.getState().scroll['run:a']).toBe(800);
    act(() => { fireEvent.click(jump); });
    expect(thread.scrollTop).toBe(3000);
    // Their saved place is gone: back at the newest message, a later visit opens there.
    expect(useSessionDrafts.getState().scroll['run:a']).toBeUndefined();
    act(() => { thread.scrollTop = 2400; fireEvent.scroll(thread); });
    expect(screen.queryByTestId('session-jump-latest')).toBeNull();
  });
});
