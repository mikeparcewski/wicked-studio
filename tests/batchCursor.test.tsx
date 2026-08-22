import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useBatchGateStore } from '../src/board/batchGates.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { useTriageCursor, type TriageItem } from '../src/hooks/useTriageCursor.js';
import { setShortcutsPaletteOpen } from '../src/hooks/useGlobalShortcuts.js';
import type { OpenGate } from '../src/store/gates.js';
import type { Navigate } from '../src/hooks/useRoute.js';

/**
 * Slice L's selection keys on the slice-H cursor (DES-FEEDBACK-002 §9.2):
 * `x`/Space toggle the cursor row's gate into the batch selection; a COMPLEX
 * gate cannot enter (§9.5 — the same §7.11 boundary as its chip); Escape
 * clears the selection with the cursor, firing nothing; the selection dies
 * with the surface (unmount = route change).
 */

vi.mock('../src/api/client.js', () => ({
  api: { confirmGate: vi.fn() },
}));

const gate = (runId: string, over: Partial<OpenGate> = {}): OpenGate => ({
  runId, ord: 0, prompt: `gate for ${runId}`, lifecycle: 'open', receivedAt: Date.now(), ...over,
});

function Harness({ items, navigate }: { items: TriageItem[]; navigate: Navigate }): React.ReactElement {
  const cursor = useTriageCursor(items, navigate);
  return (
    <div>
      {items.map((it) => (
        <div key={it.key} tabIndex={-1} data-kbd-item={it.key}
          {...(cursor.selectedKey === it.key ? { 'data-kbd-selected': 'true' } : {})} />
      ))}
    </div>
  );
}

const press = (key: string): void => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
};

const item = (key: string, runId: string | null, g?: OpenGate): TriageItem => ({
  key, runId, gate: g, openPath: `/p/${key}`, projectId: key,
});

const ITEMS: TriageItem[] = [
  item('p-simple', 'r-simple', gate('r-simple')),               // ≤2 choices ⇒ simple
  item('p-complex', 'r-complex', gate('r-complex', { choices: null })), // free text ⇒ complex
  item('p-cached', 'r-cached', undefined),                      // daemon restarted ⇒ still simple
  item('p-idle', null, undefined),                              // nothing gates here
];

const selected = (): string[] => useBatchGateStore.getState().selected;

beforeEach(() => {
  setShortcutsPaletteOpen(false);
  useGateActionStore.setState({ byGate: {} });
  useBatchGateStore.setState({
    selected: [], running: false, done: 0, total: 0, failures: [], lastDecision: null,
  });
});

describe('x / Space on the cursor (§9.2)', () => {
  it('toggles the SIMPLE gate under the cursor — x on, x off; Space too', () => {
    render(<Harness items={ITEMS} navigate={vi.fn()} />);
    press('j'); // cursor → p-simple
    press('x');
    expect(selected()).toEqual(['r-simple']);
    press('x');
    expect(selected()).toEqual([]);
    press(' ');
    expect(selected()).toEqual(['r-simple']);
  });

  it('a cached-gate-less run is still simple (§7.11) and selectable', () => {
    render(<Harness items={ITEMS} navigate={vi.fn()} />);
    press('j'); press('j'); press('j'); // → p-cached
    press('x');
    expect(selected()).toEqual(['r-cached']);
  });

  it('a COMPLEX gate cannot enter the selection via x (§9.5)', () => {
    render(<Harness items={ITEMS} navigate={vi.fn()} />);
    press('j'); press('j'); // → p-complex
    press('x');
    press(' ');
    expect(selected()).toEqual([]);
  });

  it('a gateless row yields silently', () => {
    render(<Harness items={ITEMS} navigate={vi.fn()} />);
    press('j'); press('j'); press('j'); press('j'); // → p-idle
    press('x');
    expect(selected()).toEqual([]);
  });
});

describe('clearing (§9.5)', () => {
  it('Escape clears the selection with the cursor and fires nothing', async () => {
    const { api } = await import('../src/api/client.js');
    render(<Harness items={ITEMS} navigate={vi.fn()} />);
    press('j'); press('x');
    expect(selected()).toEqual(['r-simple']);
    press('Escape');
    expect(selected()).toEqual([]);
    expect(document.querySelector('[data-kbd-selected="true"]')).toBeNull();
    expect(vi.mocked(api.confirmGate)).not.toHaveBeenCalled();
  });

  it('Escape works for a mouse-made selection even with no cursor active', () => {
    render(<Harness items={ITEMS} navigate={vi.fn()} />);
    act(() => useBatchGateStore.setState({ selected: ['r-simple'] })); // checkbox path
    press('Escape');
    expect(selected()).toEqual([]);
  });

  it('the selection dies with the surface (unmount = route change)', () => {
    const { unmount } = render(<Harness items={ITEMS} navigate={vi.fn()} />);
    press('j'); press('x');
    expect(selected()).toEqual(['r-simple']);
    unmount();
    expect(selected()).toEqual([]);
  });

  it('while the palette is open, x belongs to the palette — no toggle', () => {
    render(<Harness items={ITEMS} navigate={vi.fn()} />);
    press('j');
    setShortcutsPaletteOpen(true);
    press('x');
    expect(selected()).toEqual([]);
    setShortcutsPaletteOpen(false);
  });
});
