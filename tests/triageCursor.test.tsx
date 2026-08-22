import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { GateRejectNote } from '../src/components/GateRejectNote.js';
import { useTriageCursor, type TriageItem } from '../src/hooks/useTriageCursor.js';
import { setShortcutsPaletteOpen } from '../src/hooks/useGlobalShortcuts.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import * as client from '../src/api/client.js';
import type { Navigate } from '../src/hooks/useRoute.js';

/**
 * The slice-H triage cursor (DES-FEEDBACK-002 §2): traversal order and the
 * clamped ends, first-press behavior, Escape, focus + scroll-into-view (EC22),
 * the `a`/`r` action semantics through the ONE shared `decideGate` (§2.3), the
 * complex-gate boundary, the no-gate no-op, and the §2.4 composition guards
 * (typing context, palette open) — all through the slice-G registry, exactly
 * as the surfaces mount it.
 */

const gate = (runId: string, over: Partial<OpenGate> = {}): OpenGate => ({
  runId, ord: 0, prompt: `gate for ${runId}`, lifecycle: 'open', receivedAt: Date.now(), ...over,
});

/** The harness renders what the surfaces render: a `data-kbd-item` row per
 *  item, the selection attribute, and the reject note when it is open. */
function Harness({ items, navigate }: { items: TriageItem[]; navigate: Navigate }): React.ReactElement {
  const cursor = useTriageCursor(items, navigate);
  return (
    <div>
      {items.map((it) => (
        <div
          key={it.key}
          tabIndex={-1}
          data-kbd-item={it.key}
          data-testid={`row-${it.key}`}
          {...(cursor.selectedKey === it.key ? { 'data-kbd-selected': 'true' } : {})}
        >
          {it.runId !== null && cursor.noteFor === it.runId ? (
            <GateRejectNote runId={it.runId} onClose={cursor.closeNote} />
          ) : (
            <span>{it.key}</span>
          )}
        </div>
      ))}
    </div>
  );
}

const press = (key: string, target: HTMLElement | Window = window): void => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    if (target === window) window.dispatchEvent(e);
    else (target as HTMLElement).dispatchEvent(e);
  });
};

const selectedKeys = (): string[] =>
  Array.from(document.querySelectorAll('[data-kbd-selected="true"]'))
    .map((el) => el.getAttribute('data-kbd-item') ?? '');

function items3(): TriageItem[] {
  return [
    { key: 'p1', runId: 'r1', gate: gate('r1'), openPath: '/p/p1', projectId: 'p1' },
    { key: 'p2', runId: null, gate: undefined, openPath: '/p/p2', projectId: 'p2' },
    { key: 'p3', runId: 'r3', gate: gate('r3'), openPath: '/p/p3', projectId: 'p3' },
  ];
}

describe('the triage cursor (slice H, §2.2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setShortcutsPaletteOpen(false);
    useGateStore.setState({ gates: {} });
    useGateActionStore.setState({ byGate: {} });
    // setup.ts stubs scrollIntoView on HTMLElement.prototype — spy THERE, or
    // the stub shadows a spy placed on Element.prototype.
    vi.spyOn(window.HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  });

  it('first j selects the first row; j advances in render order; k returns', () => {
    render(<Harness items={items3()} navigate={vi.fn()} />);
    expect(selectedKeys()).toEqual([]);
    press('j');
    expect(selectedKeys()).toEqual(['p1']);
    press('j');
    expect(selectedKeys()).toEqual(['p2']);
    press('k');
    expect(selectedKeys()).toEqual(['p1']);
  });

  it('the arrows pair with j/k; the cursor CLAMPS at both ends, never wraps', () => {
    render(<Harness items={items3()} navigate={vi.fn()} />);
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown'); // past the end — clamps on p3
    expect(selectedKeys()).toEqual(['p3']);
    press('ArrowUp');
    press('ArrowUp');
    press('k'); // past the start — clamps on p1
    expect(selectedKeys()).toEqual(['p1']);
  });

  it('the selected row takes real DOM focus and scrolls into view (EC22)', () => {
    render(<Harness items={items3()} navigate={vi.fn()} />);
    press('j');
    const row = screen.getByTestId('row-p1');
    expect(document.activeElement).toBe(row);
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('Escape clears the cursor; selection is keyboard-only state', () => {
    render(<Harness items={items3()} navigate={vi.fn()} />);
    press('j');
    press('Escape');
    expect(selectedKeys()).toEqual([]);
  });

  it('a on a simple-gate row fires the exact POST once — a second a is dropped', () => {
    render(<Harness items={items3()} navigate={vi.fn()} />);
    press('j');
    press('a');
    press('a'); // in-flight/answered — the shared double-submit guard drops it
    expect(client.api.confirmGate).toHaveBeenCalledTimes(1);
    expect(client.api.confirmGate).toHaveBeenCalledWith('r1', { approve: true });
  });

  it('a on a row with NO gate is a silent no-op (guard yields)', () => {
    render(<Harness items={items3()} navigate={vi.fn()} />);
    press('j');
    press('j'); // p2 — needs you for something that is not a gate
    press('a');
    press('r');
    expect(client.api.confirmGate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('gate-reject-note')).toBeNull();
  });

  it('a on a COMPLEX gate opens the thread at #gate and posts nothing (§2.3)', () => {
    const navigate = vi.fn();
    const items = items3();
    items[0] = { ...items[0]!, gate: gate('r1', { choices: null }) };
    render(<Harness items={items} navigate={navigate} />);
    press('j');
    press('a');
    expect(navigate).toHaveBeenCalledWith('/p/p1/build/r1#gate');
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });

  it('r opens the inline note focused; Enter sends {approve:false, amend} (§2.3)', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<Harness items={items3()} navigate={vi.fn()} />);
    press('j');
    press('r');
    const note = screen.getByTestId('gate-reject-note');
    expect(document.activeElement).toBe(note);
    await user.keyboard('needs the Q3 numbers first');
    await user.keyboard('{Enter}');
    expect(client.api.confirmGate).toHaveBeenCalledTimes(1);
    expect(client.api.confirmGate).toHaveBeenCalledWith('r1', {
      approve: false, amend: 'needs the Q3 numbers first',
    });
    expect(screen.queryByTestId('gate-reject-note')).toBeNull();
  });

  it('an empty note rejects WITHOUT an amend field (the note is optional)', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<Harness items={items3()} navigate={vi.fn()} />);
    press('j');
    press('r');
    await user.keyboard('{Enter}');
    expect(client.api.confirmGate).toHaveBeenCalledWith('r1', { approve: false });
  });

  it('Escape in the note closes it, restores the row, and fires NOTHING', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<Harness items={items3()} navigate={vi.fn()} />);
    press('j');
    press('r');
    await user.keyboard('half a reason');
    await user.keyboard('{Escape}');
    expect(client.api.confirmGate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('gate-reject-note')).toBeNull();
    // Selection survives the cancel — focus returns to the row (§2.3).
    expect(selectedKeys()).toEqual(['p1']);
    expect(document.activeElement).toBe(screen.getByTestId('row-p1'));
  });

  it('while the note is open, j/a are typing-context keys — inert (§2.3/§2.4)', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<Harness items={items3()} navigate={vi.fn()} />);
    press('j');
    press('r');
    await user.keyboard('ja'); // land in the input as text, move no cursor
    expect(screen.getByTestId('gate-reject-note')).toHaveValue('ja');
    expect(selectedKeys()).toEqual(['p1']);
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });

  it('any input focus is a typing context: keys pass through untouched (EC21)', () => {
    render(
      <div>
        <input data-testid="outside-input" />
        <Harness items={items3()} navigate={vi.fn()} />
      </div>,
    );
    const input = screen.getByTestId('outside-input');
    input.focus();
    press('j', input);
    press('a', input);
    expect(selectedKeys()).toEqual([]);
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });

  it('while the palette is open the table yields — j/k move nothing here (§2.4)', () => {
    render(<Harness items={items3()} navigate={vi.fn()} />);
    setShortcutsPaletteOpen(true);
    press('j');
    press('a');
    expect(selectedKeys()).toEqual([]);
    expect(client.api.confirmGate).not.toHaveBeenCalled();
    setShortcutsPaletteOpen(false);
    press('j');
    expect(selectedKeys()).toEqual(['p1']);
  });

  it('Enter opens the selected row (the same target as clicking it)', () => {
    const navigate = vi.fn();
    render(<Harness items={items3()} navigate={navigate} />);
    press('j');
    press('Enter');
    expect(navigate).toHaveBeenCalledWith('/p/p1');
  });

  it('with no selection, Enter and Escape yield — other handlers keep them', () => {
    const navigate = vi.fn();
    render(<Harness items={items3()} navigate={navigate} />);
    press('Enter');
    press('Escape');
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('the shared decision state (gateActions.ts, §2.3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    useGateActionStore.setState({ byGate: {} });
  });

  it('a NEW gate arriving for a run resets its stale decision state', async () => {
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
    const { decideGate } = await import('../src/board/gateActions.js');
    useGateStore.setState({ gates: { r9: gate('r9') } });
    await decideGate('r9', { approve: true });
    expect(useGateActionStore.getState().byGate['r9']?.answered).toBe('approved');
    // The answered line survives its own clearGate prune…
    expect(useGateStore.getState().gates['r9']).toBeUndefined();
    // …but a LATER gate (new ord) is a fresh question with fresh state.
    act(() => useGateStore.getState().setGate(gate('r9', { ord: 1 })));
    expect(useGateActionStore.getState().byGate['r9']).toBeUndefined();
    await decideGate('r9', { approve: false });
    expect(client.api.confirmGate).toHaveBeenCalledTimes(2);
  });
});
