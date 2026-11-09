import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

/**
 * studio 0.16.4 (operator: "Still seeing the extra modal for undo"): the floating Undo toast is gone. Every
 * queued decision's countdown, what-will-happen line, page-close note, Undo and result render INLINE, in the
 * block where it was taken; of several blocks showing one decision, ONE shows it in full (the one it was taken
 * in, else the first in document order) and the rest a quiet "Waiting to send" line; a decision taken where no
 * block shows it goes to its run's gate card. Each of these fails on main (no inline block, a toast instead).
 */

vi.mock('../src/api/client.js', () => ({
  api: { confirmGate: vi.fn(), cancelRun: vi.fn() },
}));

const { api } = await import('../src/api/client.js');
const { decideGate, gateKeyOf, hostlessPathOf, useGateActionStore } = await import('../src/board/gateActions.js');
const { BATCH_KEY, runBatchDecision, useBatchGateStore } = await import('../src/board/batchGates.js');
const {
  NOT_SHOWN, RESULT_CAP, RESULT_TTL_MS, SHOW_GRACE_MS, UNDO_WINDOW_MS, markResultShown, reportDecision, resetDecisionsForTest,
  setHostlessHandler, setUndoWindowForTest, useUndoQueue,
} = await import('../src/board/undoQueue.js');
const { stopRun } = await import('../src/store/sheets.js');
const { InlineUndo, QUIET_FAILED } = await import('../src/components/InlineUndo.js');
const { batchFailedResult } = await import('../src/components/desk/BatchFailures.js');
const { ApiError } = await import('../src/api/errors.js');
const { useGateStore } = await import('../src/store/gates.js');
const { ApprovalGroupActions } = await import('../src/components/desk/ApprovalGroupActions.js');

const confirmGate = vi.mocked(api.confirmGate);
const cancelRun = vi.mocked(api.cancelRun);

/** A block that hosts a run's gate decisions, with its own Approve (as GateRow / ProposalCard / a Desk row do). */
function GateHost({ host, runId = 'r1' }: { host: string; runId?: string }): React.ReactElement {
  return (
    <section data-undo-host={host} data-testid={`host-${host}`}>
      <button type="button" data-testid={`approve-${host}`} onClick={() => { void decideGate(runId, { approve: true }); }}>Approve</button>
      <InlineUndo host={host} keys={[gateKeyOf(runId)]} />
    </section>
  );
}

const noToast = (): void => { expect(document.querySelector('[data-testid="undo-toast"]')).toBeNull(); };

beforeEach(() => {
  setUndoWindowForTest(null);
  vi.useFakeTimers();
  confirmGate.mockReset().mockResolvedValue({ status: 'resumed' } as never);
  cancelRun.mockReset().mockResolvedValue({} as never);
  resetDecisionsForTest();
  useBatchGateStore.setState({ selected: [], running: false, queued: false, done: 0, total: 0, failures: [], lastDecision: null });
});

afterEach(() => {
  resetDecisionsForTest();
  setHostlessHandler(null);
  vi.useRealTimers();
});

describe('a gate approve shows inline, in its block', () => {
  it('the countdown, what happens, the page-close note and Undo; Undo sends nothing; no toast', async () => {
    render(<GateHost host="gate-card" />);
    act(() => { fireEvent.click(screen.getByTestId('approve-gate-card')); });
    noToast();
    const block = within(screen.getByTestId('host-gate-card')).getByTestId('inline-undo');
    expect(within(block).getByTestId('inline-undo-headline').textContent).toMatch(/^Approving .* in 10 s$/);
    expect(within(block).getByTestId('inline-undo-preview').textContent).toBe('The run resumes past this gate.');
    expect(within(block).getByTestId('inline-undo-close-note').textContent).toMatch(/nothing is sent/);
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(within(block).getByTestId('inline-undo-headline').textContent).toMatch(/in 7 s$/);
    act(() => { fireEvent.click(within(block).getByTestId('inline-undo-button')); });
    expect(screen.queryByTestId('inline-undo')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2); });
    expect(confirmGate).not.toHaveBeenCalled();
    noToast();
  });

  it('the sent result lands inline on the same block, and goes 8 s after it was shown', async () => {
    render(<GateHost host="gate-card" />);
    act(() => { fireEvent.click(screen.getByTestId('approve-gate-card')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS); });
    expect(confirmGate).toHaveBeenCalledTimes(1);
    const result = screen.getByTestId('inline-undo-result');
    expect(result.dataset['kind']).toBe('sent');
    expect(result.textContent).toMatch(/^Approved /);
    noToast();
    await act(async () => { await vi.advanceTimersByTimeAsync(RESULT_TTL_MS + 50); });
    expect(screen.queryByTestId('inline-undo-result')).toBeNull();
  });

  it('a failed send stays inline until it is dismissed', async () => {
    confirmGate.mockRejectedValue(new Error('the daemon refused it'));
    render(<GateHost host="gate-card" />);
    act(() => { fireEvent.click(screen.getByTestId('approve-gate-card')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS); });
    const result = screen.getByTestId('inline-undo-result');
    expect(result.dataset['kind']).toBe('failed');
    await act(async () => { await vi.advanceTimersByTimeAsync(RESULT_TTL_MS * 5); });
    expect(screen.getByTestId('inline-undo-result')).toBe(result);
    act(() => { fireEvent.click(screen.getByTestId('inline-undo-dismiss')); });
    expect(screen.queryByTestId('inline-undo-result')).toBeNull();
  });

  it('a result raised while no block for it is on screen waits, and shows when one mounts', () => {
    act(() => { reportDecision('failed', 'Not sent: the plan — the daemon did not answer', { keys: [gateKeyOf('r1')] }); });
    render(<GateHost host="gate-card" />);
    expect(screen.getByTestId('inline-undo-result').firstElementChild?.textContent).toBe('Not sent: the plan — the daemon did not answer');
  });
});

describe('one Undo per decision per page', () => {
  it('approving from the proposal card in a thread that also shows the gate card: exactly one Undo, on the proposal card', () => {
    render(<><GateHost host="gate-card" /><GateHost host="proposal-card" /></>);
    const press = screen.getByTestId('approve-proposal-card');
    act(() => { fireEvent.pointerDown(press); fireEvent.click(press); });
    expect(screen.getAllByTestId('inline-undo-button')).toHaveLength(1);
    expect(within(screen.getByTestId('host-proposal-card')).getByTestId('inline-undo-button')).toBeInTheDocument();
    expect(within(screen.getByTestId('host-gate-card')).getByTestId('inline-undo-quiet').textContent).toMatch(/^Waiting to send · \d+ s$/);
    noToast();
  });

  it('a decision taken in no block (the palette, a shortcut) shows in full on the first block in document order', () => {
    render(<><GateHost host="gate-card" /><GateHost host="proposal-card" /></>);
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => { void decideGate('r1', { approve: true }); });
    expect(screen.getAllByTestId('inline-undo-button')).toHaveLength(1);
    expect(within(screen.getByTestId('host-gate-card')).getByTestId('inline-undo-button')).toBeInTheDocument();
  });

  it('the block it was taken in owns it even when it is later in the page', () => {
    render(<><GateHost host="desk-row" /><GateHost host="desk-row" runId="r2" /><GateHost host="gate-card" runId="r2" /></>);
    const rows = screen.getAllByTestId('host-desk-row');
    const press = within(rows[1]!).getByTestId('approve-desk-row');
    act(() => { fireEvent.pointerDown(press); fireEvent.click(press); });
    expect(screen.getAllByTestId('inline-undo-button')).toHaveLength(1);
    expect(within(rows[1]!).getByTestId('inline-undo-button')).toBeInTheDocument();
  });
});

describe('where a row WAS (a fallback block)', () => {
  it('shows a result only when no row or card for it is on screen, and never a quiet line beside one', () => {
    const list = (
      <div data-testid="list"><InlineUndo host="needs-queue" fallback keys={[gateKeyOf('r1')]} /></div>
    );
    const { rerender } = render(<>{list}<GateHost host="desk-row" /></>);
    const press = screen.getByTestId('approve-desk-row');
    act(() => { fireEvent.pointerDown(press); fireEvent.click(press); });
    expect(within(screen.getByTestId('list')).queryByTestId('inline-undo-quiet')).toBeNull();
    expect(within(screen.getByTestId('host-desk-row')).getByTestId('inline-undo-button')).toBeInTheDocument();
    // The gate is answered elsewhere: the row leaves the list; its "not sent" lands where it was.
    rerender(<>{list}</>);
    act(() => { reportDecision('not-sent', 'Not sent: the gate was answered elsewhere.', { keys: [gateKeyOf('r1')] }); });
    expect(within(screen.getByTestId('list')).getByTestId('inline-undo-result').firstElementChild?.textContent).toBe('Not sent: the gate was answered elsewhere.');
  });
});

describe('leaving mid-countdown (DESIGN D4, approved): navigating inside studio does not cancel', () => {
  it('a decision whose countdown was on screen still sends when its block leaves before the window ends', async () => {
    setHostlessHandler(() => {});
    const { unmount } = render(<GateHost host="gate-card" />);
    act(() => { fireEvent.click(screen.getByTestId('approve-gate-card')); });
    act(() => { vi.advanceTimersByTime(0); }); // shown: its countdown and Undo were on screen
    unmount(); // the person goes to another page
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS); });
    expect(confirmGate).toHaveBeenCalledTimes(1);
  });
  it('one never shown at all is not sent when its window ends, even if the earlier look never ran', async () => {
    setHostlessHandler(() => {});
    act(() => { void decideGate('r6', { approve: true }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + SHOW_GRACE_MS); });
    expect(confirmGate).not.toHaveBeenCalled();
  });
});

describe('no invisible decisions', () => {
  it('a decision with no block for it on screen asks the shell to go to the run’s gate card', () => {
    const went: string[] = [];
    setHostlessHandler((keys) => { const p = hostlessPathOf(keys); if (p !== null) went.push(p); });
    act(() => { void decideGate('r9', { approve: true }); });
    expect(went).toEqual([]); // decided after the commit that queued it, never during it
    act(() => { vi.advanceTimersByTime(0); });
    expect(went).toEqual(['/s/run%3Ar9#gate']);
  });

  it('a block the same action mounts counts: no navigation', () => {
    const went: string[] = [];
    setHostlessHandler((keys) => { went.push(keys.join(' ')); });
    function Reveal(): React.ReactElement {
      const [on, setOn] = React.useState(false);
      return (
        <>
          <button type="button" data-testid="go" onClick={() => { setOn(true); void decideGate('r8', { approve: true }); }}>go</button>
          {on && <GateHost host="gate-card" runId="r8" />}
        </>
      );
    }
    render(<Reveal />);
    act(() => { fireEvent.click(screen.getByTestId('go')); });
    act(() => { vi.advanceTimersByTime(SHOW_GRACE_MS + 10); });
    expect(went).toEqual([]);
    expect(screen.getByTestId('inline-undo-button')).toBeInTheDocument();
  });

  it('one still shown nowhere after the shell was asked is not sent at all, and says so', async () => {
    setHostlessHandler(() => {}); // the shell navigates, but nothing for it mounts
    act(() => { void decideGate('r7', { approve: true }); });
    act(() => { vi.advanceTimersByTime(SHOW_GRACE_MS + 10); });
    expect(useUndoQueue.getState().pending).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2); });
    expect(confirmGate).not.toHaveBeenCalled();
    expect(useUndoQueue.getState().results.map((r) => r.kind + ': ' + r.text)).toEqual([`not-sent: ${NOT_SHOWN}`]);
    // …and the person learns it: the next block for that run that mounts (its gate card, once the page has it) says so.
    render(<GateHost host="gate-card" runId="r7" />);
    const said = screen.getByTestId('inline-undo-result');
    expect(said.dataset['kind']).toBe('not-sent');
    expect(said.firstElementChild?.textContent).toBe(NOT_SHOWN);
    expect(screen.getByTestId('inline-undo-live').textContent).toBe(NOT_SHOWN);
  });
  it('a decision a block on screen shows stays where it is', () => {
    const went: string[] = [];
    setHostlessHandler((keys) => { const p = hostlessPathOf(keys); if (p !== null) went.push(p); });
    render(<GateHost host="gate-card" runId="r9" />);
    act(() => { void decideGate('r9', { approve: true }); });
    act(() => { vi.advanceTimersByTime(SHOW_GRACE_MS + 10); });
    expect(went).toEqual([]);
    expect(useUndoQueue.getState().pending).toHaveLength(1);
    expect(screen.getByTestId('inline-undo-button')).toBeInTheDocument();
  });
  it('a Stop goes to the run’s page; a batch never navigates', () => {
    expect(hostlessPathOf(['stop:r3'])).toBe('/s/run%3Ar3');
    expect(hostlessPathOf([BATCH_KEY, 'gate:r1', 'gate:r2'])).toBeNull(); // a batch's real keys
  });
});

describe('a batch decision and an object action (Stop) show inline too', () => {
  it('the approvals bar: countdown and Undo under it; Undo sends nothing', async () => {
    render(
      <div data-undo-host="batch-bar" data-testid="bar">
        <ApprovalGroupActions runIds={['r1', 'r2']} label="Approve all 2" />
        <InlineUndo host="batch-bar" keys={[BATCH_KEY]} />
      </div>,
    );
    act(() => { fireEvent.click(screen.getByTestId('need-group-approve-all')); });
    noToast();
    expect(within(screen.getByTestId('bar')).getByTestId('inline-undo-headline').textContent).toBe('Approving 2 gates in 10 s');
    act(() => { fireEvent.click(screen.getByTestId('inline-undo-button')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2); });
    expect(confirmGate).not.toHaveBeenCalled();
    void runBatchDecision; // the same path the bar calls
  });

  it('Stop (⌘K, DESIGN-interaction rule 4): inline under its block; Undo sends no cancel', async () => {
    render(<div data-undo-host="session-header" data-testid="head"><InlineUndo host="session-header" keys={['stop:r1']} /></div>);
    act(() => { stopRun(['r1'], '“Fix it”'); });
    noToast();
    expect(within(screen.getByTestId('head')).getByTestId('inline-undo-headline').textContent).toBe('Stopping “Fix it” in 10 s');
    expect(screen.getByTestId('inline-undo-close-note').textContent).toBe('Close this tab before then and nothing is stopped.');
    act(() => { fireEvent.click(screen.getByTestId('inline-undo-button')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2); });
    expect(cancelRun).not.toHaveBeenCalled();
  });
});

describe('a block inside a display: contents scope (the session header) is on screen', () => {
  // jsdom has no layout: stand in for the browser's checkVisibility (a box-less or display:none element is not shown).
  const proto = Element.prototype as Element & { checkVisibility?: () => boolean };
  beforeEach(() => {
    proto.checkVisibility = function (this: Element): boolean {
      for (let e: Element | null = this; e !== null; e = e.parentElement) {
        const d = getComputedStyle(e).display;
        if (d === 'none' || (e === this && d === 'contents')) return false;
      }
      return true;
    };
  });
  afterEach(() => { Reflect.deleteProperty(proto, 'checkVisibility'); });
  it('a Stop under the header is shown there and is not cancelled as unseen', async () => {
    const went: string[] = [];
    setHostlessHandler((keys) => { went.push(keys.join(' ')); });
    render(
      <div data-undo-host="session-header" style={{ display: 'contents' }} data-testid="scope">
        <header>h</header>
        <InlineUndo host="session-header" keys={['stop:r1']} />
      </div>,
    );
    act(() => { stopRun(['r1'], '“Fix it”'); });
    act(() => { vi.advanceTimersByTime(SHOW_GRACE_MS + 10); });
    expect(went).toEqual([]);
    expect(within(screen.getByTestId('scope')).getByTestId('inline-undo-headline').textContent).toMatch(/^Stopping/);
  });
  it('a block that is on the page but hidden (a closed fold) does not count: the shell is asked to show it', () => {
    const went: string[] = [];
    setHostlessHandler((keys) => { went.push(keys.join(' ')); });
    render(<div style={{ display: 'none' }}><GateHost host="gate-card" runId="r5" /></div>);
    act(() => { void decideGate('r5', { approve: true }); });
    act(() => { vi.advanceTimersByTime(0); });
    expect(went).toEqual(['gate:r5']);
  });
});

describe('who acts where (codex r1)', () => {
  it('a key pressed after a click means the keyboard decides where it was taken, not the earlier press', () => {
    render(<><GateHost host="proposal-card" /><GateHost host="gate-card" /></>);
    fireEvent.pointerDown(screen.getByTestId('approve-proposal-card'));
    const keyed = screen.getByTestId('approve-gate-card');
    act(() => { keyed.focus(); fireEvent.keyDown(keyed, { key: 'Enter' }); fireEvent.click(keyed); });
    expect(within(screen.getByTestId('host-gate-card')).getByTestId('inline-undo-button')).toBeInTheDocument();
    expect(screen.getAllByTestId('inline-undo-button')).toHaveLength(1);
  });
});

describe('results live until seen (codex r1)', () => {
  it('a shown failure is never pushed out by later results; only unseen ones are capped', () => {
    act(() => { reportDecision('failed', 'Not sent: first', { keys: ['gate:f'] }); });
    const first = useUndoQueue.getState().results[0]!.id;
    act(() => { markResultShown(first); });
    act(() => { for (let i = 0; i < RESULT_CAP + 5; i++) reportDecision('not-sent', `n${i}`, { keys: ['gate:x'] }); });
    const rs = useUndoQueue.getState().results;
    expect(rs.some((r) => r.id === first)).toBe(true);
    expect(rs.filter((r) => r.shownAt === undefined)).toHaveLength(RESULT_CAP);
  });
  it('a failure stays when a later decision on it is undone, and goes once a decision on that run is sent', async () => {
    render(<GateHost host="gate-card" />);
    act(() => { reportDecision('failed', 'Not sent: the plan — refused', { keys: [gateKeyOf('r1')] }); });
    act(() => { fireEvent.click(screen.getByTestId('approve-gate-card')); });
    act(() => { fireEvent.click(screen.getByTestId('inline-undo-button')); });
    expect(screen.getAllByTestId('inline-undo-result').map((r) => r.dataset['kind'])).toEqual(['failed']);
    act(() => { fireEvent.click(screen.getByTestId('approve-gate-card')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS); });
    expect(screen.getAllByTestId('inline-undo-result').map((r) => r.dataset['kind'])).toEqual(['sent']);
  });
  it('a batch summary over several runs is never taken as a card’s own failure', () => {
    render(<div data-undo-host="proposal-card"><InlineUndo host="proposal-card" keys={[gateKeyOf('r1')]} ownFailure /></div>);
    act(() => { reportDecision('failed', '1 of 2 gates answered — 1 failed', { keys: [BATCH_KEY, gateKeyOf('r1'), gateKeyOf('r2')] }); });
    expect(screen.getByTestId('inline-undo-result').dataset['kind']).toBe('failed');
    act(() => { reportDecision('sent', 'Approved the plan.', { keys: [gateKeyOf('r1')] }); });
    // r1 going out does not settle a failure that was also about r2.
    expect(screen.getAllByTestId('inline-undo-result').map((r) => r.dataset['kind'])).toEqual(['failed', 'sent']);
  });
  it('a block that says a failure itself (ownFailure) does not say it twice, and takes it off the queue', () => {
    render(<div data-undo-host="proposal-card"><InlineUndo host="proposal-card" keys={[gateKeyOf('r1')]} ownFailure /></div>);
    act(() => { reportDecision('failed', 'Not sent: refused', { keys: [gateKeyOf('r1')] }); });
    expect(screen.queryByTestId('inline-undo-result')).toBeNull();
    expect(useUndoQueue.getState().results).toEqual([]);
  });
  it('a batch carries its members’ gates: the result has a place when the group row has gone', async () => {
    const list = <div data-testid="list"><InlineUndo host="needs-queue" fallback keys={[BATCH_KEY, gateKeyOf('r1'), gateKeyOf('r2')]} /></div>;
    const { rerender } = render(
      <>{list}<div data-undo-host="batch-bar" data-testid="bar"><ApprovalGroupActions runIds={['r1', 'r2']} label="Approve all 2" /><InlineUndo host="batch-bar" keys={[BATCH_KEY]} /></div></>,
    );
    act(() => { fireEvent.click(screen.getByTestId('need-group-approve-all')); });
    expect(useUndoQueue.getState().pending[0]!.keys).toEqual([BATCH_KEY, 'gate:r1', 'gate:r2']);
    rerender(<>{list}</>);
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS); });
    expect(within(screen.getByTestId('list')).getByTestId('inline-undo-result').dataset['kind']).toBe('sent');
  });
});

describe('a batch failure is said once per page, in studio’s words (coord, shots r1)', () => {
  it('the block it was taken in lists the member with Retry and Open; the other copy of the group reads a quiet line', async () => {
    confirmGate.mockImplementation((runId: string) => (runId === 'g2'
      ? Promise.reject(new ApiError(409, 'not awaiting a human gate'))
      : Promise.resolve({ status: 'resumed' })) as never);
    const group = (id: string): React.ReactElement => (
      <div data-undo-host="batch-bar" data-testid={id}>
        <ApprovalGroupActions runIds={['g1', 'g2']} label="Approve all 2" />
        <InlineUndo host="batch-bar" keys={[gateKeyOf('g1'), gateKeyOf('g2')]} renderFailed={batchFailedResult()} />
      </div>
    );
    for (const id of ['g1', 'g2']) useGateStore.getState().setGate({ runId: id, ord: 0, prompt: `gate ${id}`, lifecycle: 'open', receivedAt: Date.now() } as never);
    render(<>{group('row')}{group('pane')}</>);
    const press = within(screen.getByTestId('pane')).getByTestId('need-group-approve-all');
    act(() => { fireEvent.pointerDown(press); fireEvent.click(press); });
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 10); });
    const pane = screen.getByTestId('pane');
    const row = screen.getByTestId('row');
    expect(within(pane).getByTestId('inline-undo-result').dataset['kind']).toBe('failed');
    expect(within(pane).getAllByTestId('need-group-failure')).toHaveLength(1);
    const line = within(pane).getByTestId('need-group-failure').textContent ?? '';
    expect(line).toContain('this job is no longer waiting for that answer. Open it to see where it is.');
    expect(line).not.toContain('g2 (');                // the job, never the raw gate id
    expect(line).not.toMatch(/^.*the daemon refused this — not awaiting/); // never the wire sentence on the face
    expect(within(pane).getByTestId('need-group-retry').textContent).toBe('Retry');
    expect(within(pane).getByTestId('need-group-failure-open')).toBeInTheDocument();
    expect(within(row).queryByTestId('need-group-failure')).toBeNull();
    expect(within(row).getByTestId('inline-undo-result-quiet').textContent).toBe(QUIET_FAILED);
    expect(screen.getAllByTestId('need-group-failure')).toHaveLength(1);
  });
});

describe('accessibility', () => {
  it('one polite live region says the decision once: its words do not change on the tick, and the countdown is outside it', () => {
    render(<GateHost host="gate-card" />);
    act(() => { fireEvent.click(screen.getByTestId('approve-gate-card')); });
    const live = screen.getByTestId('inline-undo-live');
    expect(live.getAttribute('aria-live')).toBe('polite');
    const said = live.textContent;
    expect(said).toMatch(/You can undo it until it sends\.$/);
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(live.textContent).toBe(said);
    // Inside a host that is itself a live region (the inbox's reading pane, the voice transcript), the countdown's
    // nearest live setting is "off": only this block's own static sentence is announced.
    const headline = screen.getByTestId('inline-undo-headline');
    expect(headline.closest('[aria-live]')?.getAttribute('aria-live')).toBe('off');
    expect(headline.closest('[role="status"], [role="alert"]')).toBeNull();
  });

  it('Undo is a keyboard button; when the block collapses, focus goes to the block’s first action, never the body', () => {
    render(<GateHost host="gate-card" />);
    act(() => { fireEvent.click(screen.getByTestId('approve-gate-card')); });
    const undo = screen.getByTestId('inline-undo-button');
    expect(undo.tagName).toBe('BUTTON');
    act(() => { undo.focus(); });
    act(() => { fireEvent.click(undo); });
    expect(useUndoQueue.getState().pending).toEqual([]);
    expect(document.activeElement).toBe(screen.getByTestId('approve-gate-card'));
    expect(useGateActionStore.getState().byGate['r1']?.queued).toBe(false);
  });
});
