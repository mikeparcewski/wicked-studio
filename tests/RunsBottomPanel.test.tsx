import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  observedSpend,
  RunsBottomPanel,
  RUNS_BAR_PX,
  runStats,
  waitingWord,
} from '../src/components/RunsBottomPanel.js';
import { useTriageCursor, type TriageItem } from '../src/hooks/useTriageCursor.js';
import { setShortcutsPaletteOpen } from '../src/hooks/useGlobalShortcuts.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { useMembershipStore } from '../src/store/membership.js';
import { useRunsPanelStore } from '../src/store/runsPanel.js';
import { useRuntimeStore, type LoggedEvent } from '../src/store/runtime.js';
import { makeView } from './factories.js';

/**
 * The runs bottom panel (DES-FEEDBACK-003 §5, slice N): the §5.3 stat
 * derivations against store fixtures, the three-state transitions
 * (bar → sheet → run page), EC27's immersive auto-collapse, the §5.7
 * Escape precedence (palette → sheet → triage) through the slice-G
 * registry, and the §5.1 zero-fetch rule.
 */

const W2 = [
  makeView({ id: 'r-q3', status: 'awaiting_human', problem: 'make the Q3 review deck' }),
  makeView({ id: 'r-api', status: 'awaiting_human', problem: 'migrate the auth tables' }),
  makeView({ id: 'r-upload', status: 'executing', problem: 'add rate-limiting' }),
  makeView({ id: 'r-auth', status: 'failed', problem: 'refactor the auth middleware' }),
  makeView({ id: 'r-smoke1', status: 'completed', problem: 'smoke: login flow' }),
  makeView({ id: 'r-smoke2', status: 'cancelled', problem: 'smoke: checkout flow' }),
];

const usage = (costUsd: number, ts = Date.now()): LoggedEvent => ({
  seq: 1, type: 'cliUsage', ts, costUsd, detail: `usage $${costUsd}`,
});

const runPath = (id: string): string => `/runs/${id}`;

function mount(over: { runs?: typeof W2; immersive?: boolean; scope?: string | null } = {}): {
  navigate: ReturnType<typeof vi.fn>;
  rerender: (ui: React.ReactElement) => void;
} {
  const navigate = vi.fn();
  const { rerender } = render(
    <RunsBottomPanel
      runs={over.runs ?? W2}
      runPath={runPath}
      navigate={navigate}
      immersive={over.immersive ?? false}
      scopeProjectId={over.scope ?? null}
    />,
  );
  return { navigate, rerender };
}

const press = (key: string): void => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
};

beforeEach(() => {
  cleanup();
  useRunsPanelStore.setState({ expanded: false });
  useGateStore.setState({ gates: {} });
  useRuntimeStore.setState({ logs: {} });
  useMembershipStore.setState({ projectNameByRun: {} });
  setShortcutsPaletteOpen(false);
  document.body.innerHTML = '';
});

describe('§5.3 stat derivations — client-derivable, spelled once', () => {
  it('counts working (non-terminal, non-gate), gates, failed from the runs array', () => {
    expect(runStats(W2)).toEqual({ working: 1, gates: 2, failed: 1 });
  });

  it('planning and distributing are working; completed/cancelled count nowhere', () => {
    const runs = [
      makeView({ id: 'a', status: 'planning' }),
      makeView({ id: 'b', status: 'distributing' }),
      makeView({ id: 'c', status: 'completed' }),
      makeView({ id: 'd', status: 'cancelled' }),
    ];
    expect(runStats(runs)).toEqual({ working: 2, gates: 0, failed: 0 });
  });

  it('observedSpend folds only numeric cliUsage costs — total, frame count, per-run', () => {
    const logs: Record<string, LoggedEvent[]> = {
      'r-upload': [usage(0.04), usage(0.18),
        { seq: 3, type: 'cliUsage', ts: Date.now(), detail: 'usage reported (no cost)' },
        { seq: 4, type: 'unitDone', ts: Date.now(), detail: 'unit done' }],
      'r-smoke1': [usage(0.11)],
    };
    const spend = observedSpend(logs);
    expect(spend.total).toBeCloseTo(0.33);
    expect(spend.frames).toBe(3);
    expect(spend.byRun['r-upload']).toBeCloseTo(0.22);
    expect(spend.byRun['r-smoke1']).toBeCloseTo(0.11);
  });

  it('waitingWord formats seconds, minutes, hours', () => {
    expect(waitingWord(12_000)).toBe('waiting 12s');
    expect(waitingWord(12 * 60_000)).toBe('waiting 12m');
    expect(waitingWord(3 * 3_600_000)).toBe('waiting 3h');
  });
});

describe('the collapsed bar (§5.3)', () => {
  it('renders the fixture counts as data attributes and segment text', () => {
    mount();
    const bar = screen.getByTestId('runs-bottom-bar');
    expect(bar.getAttribute('data-working')).toBe('1');
    expect(bar.getAttribute('data-gates')).toBe('2');
    expect(bar.getAttribute('data-failed')).toBe('1');
    expect(bar.textContent).toContain('1 working');
    expect(bar.textContent).toContain('2 gates');
    expect(bar.textContent).toContain('1 failed');
    expect(bar.textContent).toContain('All runs ›');
  });

  it('shows the observed spend segment only once a cliUsage frame exists', () => {
    mount();
    expect(screen.getByTestId('runs-bottom-bar').textContent).not.toContain('observed');
    act(() => {
      useRuntimeStore.setState({ logs: { 'r-upload': [usage(0.42)] } });
    });
    expect(screen.getByTestId('runs-bottom-bar').textContent).toContain('$0.42 observed');
  });

  it('an all-terminal listing compresses to the quiet phrase', () => {
    mount({ runs: [makeView({ id: 'a', status: 'completed' }), makeView({ id: 'b', status: 'cancelled' })] });
    const bar = screen.getByTestId('runs-bottom-bar');
    expect(bar.textContent).toContain('nothing running');
    expect(bar.textContent).not.toContain('working');
  });

  it('the All runs link is a real /runs link that never expands the sheet', () => {
    const { navigate } = mount();
    const link = screen.getByTestId('runs-bar-all');
    expect(link.getAttribute('href')).toBe('/runs');
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/runs');
    expect(screen.queryByTestId('runs-bottom-sheet')).toBeNull();
  });
});

describe('three-state transitions (§5.2/§5.4)', () => {
  it('clicking the bar expands the sheet; the toggle collapses it again', () => {
    mount();
    fireEvent.click(screen.getByTestId('runs-bar-toggle'));
    expect(screen.getByTestId('runs-bottom-sheet')).toBeTruthy();
    fireEvent.click(screen.getByTestId('runs-bar-toggle'));
    expect(screen.queryByTestId('runs-bottom-sheet')).toBeNull();
  });

  it('sheet rows: active before terminal, real hrefs per runPath, gate rows deep-link #gate', () => {
    act(() => {
      useGateStore.getState().setGate({
        runId: 'r-q3', ord: 0, prompt: 'Approve?', lifecycle: 'open',
        receivedAt: Date.now() - 12 * 60_000,
      } satisfies OpenGate);
      useMembershipStore.setState({ projectNameByRun: { 'r-upload': 'upload-endpoint' } });
      useRuntimeStore.setState({ logs: { 'r-upload': [usage(0.18)] } });
    });
    mount();
    fireEvent.click(screen.getByTestId('runs-bar-toggle'));
    const rows = screen.getAllByTestId('runs-sheet-row');
    const statuses = rows.map((r) => r.getAttribute('data-status'));
    // Active (gates + executing) precede terminal (failed/completed/cancelled).
    expect(statuses.slice(0, 3)).toEqual(['awaiting_human', 'awaiting_human', 'executing']);
    expect(new Set(statuses.slice(3))).toEqual(new Set(['failed', 'completed', 'cancelled']));
    const byId = Object.fromEntries(rows.map((r) => [r.getAttribute('data-run-id'), r]));
    expect(byId['r-q3']?.getAttribute('href')).toBe('/runs/r-q3#gate');
    expect(byId['r-upload']?.getAttribute('href')).toBe('/runs/r-upload');
    // Per-run stats from data in hand: project name, gate wait age, observed spend.
    expect(byId['r-upload']?.textContent).toContain('upload-endpoint');
    expect(byId['r-upload']?.textContent).toContain('$0.18');
    expect(byId['r-q3']?.textContent).toContain('waiting 12m');
  });

  it('the sheet lists at most 20 rows', () => {
    const many = Array.from({ length: 30 }, (_, i) => makeView({ id: `r-${i}`, status: 'executing' }));
    mount({ runs: many });
    fireEvent.click(screen.getByTestId('runs-bar-toggle'));
    expect(screen.getAllByTestId('runs-sheet-row').length).toBe(20);
  });

  it('row click navigates to the run page and the sheet unmounts', () => {
    const { navigate } = mount();
    fireEvent.click(screen.getByTestId('runs-bar-toggle'));
    const row = screen.getAllByTestId('runs-sheet-row')
      .find((r) => r.getAttribute('data-run-id') === 'r-upload');
    fireEvent.click(row as HTMLElement);
    expect(navigate).toHaveBeenCalledWith('/runs/r-upload');
    expect(screen.queryByTestId('runs-bottom-sheet')).toBeNull();
  });

  it('a mousedown outside the panel collapses the sheet', () => {
    mount();
    fireEvent.click(screen.getByTestId('runs-bar-toggle'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('runs-bottom-sheet')).toBeNull();
  });
});

describe('EC27 — immersive routes auto-collapse the sheet', () => {
  it('entering Document/Video collapses an open sheet; a manual re-expand stands', () => {
    const navigate = vi.fn();
    const ui = (immersive: boolean): React.ReactElement => (
      <RunsBottomPanel runs={W2} runPath={runPath} navigate={navigate} immersive={immersive} scopeProjectId={null} />
    );
    const { rerender } = render(ui(false));
    fireEvent.click(screen.getByTestId('runs-bar-toggle'));
    expect(screen.getByTestId('runs-bottom-sheet')).toBeTruthy();
    rerender(ui(true));
    expect(screen.queryByTestId('runs-bottom-sheet')).toBeNull();
    // The explicit gesture wins (§5.5): the operator can still expand in-mode.
    fireEvent.click(screen.getByTestId('runs-bar-toggle'));
    expect(screen.getByTestId('runs-bottom-sheet')).toBeTruthy();
  });
});

describe('§5.7 Escape precedence — palette → sheet → triage, one registry (EC21)', () => {
  it('Escape collapses the sheet through the registry', () => {
    mount();
    fireEvent.click(screen.getByTestId('runs-bar-toggle'));
    press('Escape');
    expect(screen.queryByTestId('runs-bottom-sheet')).toBeNull();
  });

  it('with the palette open, Escape does NOT touch the sheet (the registry yields)', () => {
    mount();
    fireEvent.click(screen.getByTestId('runs-bar-toggle'));
    setShortcutsPaletteOpen(true);
    press('Escape');
    expect(screen.getByTestId('runs-bottom-sheet')).toBeTruthy();
  });

  it('with a triage selection active, Escape closes the SHEET first, the selection after', () => {
    // A minimal triage surface (the slice-H harness shape) mounted next to the panel.
    function Triage({ items }: { items: TriageItem[] }): React.ReactElement {
      const cursor = useTriageCursor(items, vi.fn());
      return (
        <div>
          {items.map((it) => (
            <div key={it.key} tabIndex={-1} data-kbd-item={it.key}
              {...(cursor.selectedKey === it.key ? { 'data-kbd-selected': 'true' } : {})} />
          ))}
        </div>
      );
    }
    const items: TriageItem[] = [
      { key: 'card-1', runId: null, gate: undefined, openPath: '/p/x', projectId: 'x' },
    ];
    render(
      <>
        <Triage items={items} />
        <RunsBottomPanel runs={W2} runPath={runPath} navigate={vi.fn()} immersive={false} scopeProjectId={null} />
      </>,
    );
    press('j'); // select the first triage row
    expect(document.querySelector('[data-kbd-selected="true"]')).toBeTruthy();
    fireEvent.click(screen.getByTestId('runs-bar-toggle'));
    press('Escape'); // sheet first — the selection survives
    expect(screen.queryByTestId('runs-bottom-sheet')).toBeNull();
    expect(document.querySelector('[data-kbd-selected="true"]')).toBeTruthy();
    press('Escape'); // triage next
    expect(document.querySelector('[data-kbd-selected="true"]')).toBeNull();
  });
});

describe('§5.1 zero new requests — ever', () => {
  it('mount, expand, row hover, collapse fire no fetch', () => {
    const spy = vi.fn(() => Promise.reject(new Error('the panel must never fetch')));
    vi.stubGlobal('fetch', spy);
    try {
      mount();
      fireEvent.click(screen.getByTestId('runs-bar-toggle'));
      fireEvent.click(screen.getByTestId('runs-sheet-collapse'));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the reserved row constant matches the §5.2 geometry', () => {
    expect(RUNS_BAR_PX).toBe(28);
  });
});
