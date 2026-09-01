import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GateLatencyChart } from '../src/components/GateLatencyChart.js';
import { outcomeOf } from '../src/board/metrics.js';
import { ProjectSparkline } from '../src/components/ProjectSparkline.js';
import { useGateStore } from '../src/store/gates.js';
import { useRuntimeStore, type LoggedEvent } from '../src/store/runtime.js';
import { makeView } from './factories.js';

/**
 * The slice-E SVG-first tiles that SURVIVE the command-center rework
 * (DES-HOME-COMMAND-CENTER §1): each answers a §2.1 named operator question
 * off data the page ALREADY holds — no chart library, no new polling, no
 * invented wire fields. (RunOutcomeBar and TokenBurnSparkline retired with the
 * narrative band; the KPI band's windowed tiles carry their questions now.)
 */

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Every network path the tiles could take is a spy — zero requests allowed. */
const fetchSpy = vi.fn(() => Promise.reject(new Error('metrics tiles must not fetch')));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy);
  useGateStore.setState({ gates: {} });
  useRuntimeStore.setState({ logs: {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchSpy.mockClear();
});

function log(runId: string, entries: Array<Partial<LoggedEvent> & { type: string; ts: number }>): void {
  const logs = { ...useRuntimeStore.getState().logs };
  logs[runId] = entries.map((e, i) => ({ seq: i, detail: e.type, ...e }));
  useRuntimeStore.setState({ logs });
}

describe('outcomeOf — the one status → outcome partition', () => {
  it('maps statuses to outcome classes (cancelled is its OWN class — J5/A5)', () => {
    expect(outcomeOf('executing')).toBe('run');
    expect(outcomeOf('awaiting_human')).toBe('gate');
    expect(outcomeOf('failed')).toBe('fail');
    expect(outcomeOf('cancelled')).toBe('cancelled');
    expect(outcomeOf('completed')).toBe('done');
  });
});

describe('GateLatencyChart (§2.1 — "Am I answering gates quickly or letting things stall?")', () => {
  it('plots answered pairs from the arrival-stamped log and open gates from the gate store', () => {
    log('r-1', [
      { type: 'awaitingHuman', ts: NOW - 40 * MIN },
      { type: 'gateDecided', ts: NOW - 32 * MIN }, // answered in 8m
    ]);
    useGateStore.setState({
      gates: { 'r-2': { runId: 'r-2', ord: 0, prompt: 'ok?', lifecycle: 'open', receivedAt: NOW - 10 * MIN } },
    });
    render(<GateLatencyChart now={NOW} />);
    const tile = screen.getByTestId('gate-latency-chart');
    expect(tile.getAttribute('data-question')).toBe('Am I answering gates quickly or letting things stall?');
    expect(tile.getAttribute('data-count')).toBe('2');
    expect(tile.getAttribute('data-open')).toBe('1');
    const dots = [...tile.querySelectorAll('circle')];
    expect(dots).toHaveLength(2);
    expect(dots.every((d) => d.getAttribute('fill') === 'var(--status-gate)')).toBe(true);
    // The dashed 30-minute threshold rule.
    const line = tile.querySelector('line');
    expect(line?.getAttribute('stroke')).toBe('var(--status-gate-dim)');
    expect(line?.getAttribute('stroke-dasharray')).toBe('3 3');
    expect(tile.textContent).toContain('avg 8m');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('pairs an awaitingHuman with a resumed when no gateDecided was logged', () => {
    log('r-1', [
      { type: 'awaitingHuman', ts: NOW - 20 * MIN },
      { type: 'resumed', ts: NOW - 15 * MIN },
    ]);
    render(<GateLatencyChart now={NOW} />);
    expect(screen.getByTestId('gate-latency-chart').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('gate-latency-chart').getAttribute('data-open')).toBe('0');
  });

  it('renders the honest empty line when no gate has been observed', () => {
    render(<GateLatencyChart now={NOW} />);
    const tile = screen.getByTestId('gate-latency-chart');
    expect(tile.querySelectorAll('circle')).toHaveLength(0);
    expect(tile.textContent).toContain('No gates in the last 24h');
  });
});

describe('ProjectSparkline (§2.1 — quiet-row 7-day activity)', () => {
  const runs = [makeView({ id: 'r-1' }), makeView({ id: 'r-2' }), makeView({ id: 'r-old' })];

  it('buckets in-window runs per day off the attach clock, --ink-dim bars', () => {
    const { container } = render(
      <ProjectSparkline
        runs={runs}
        attachedAt={{ 'r-1': NOW - 2 * DAY, 'r-2': NOW - 2 * DAY, 'r-old': NOW - 10 * DAY }}
        now={NOW}
      />,
    );
    const spark = container.querySelector('[data-testid="project-sparkline"]');
    expect(spark?.getAttribute('data-total')).toBe('2');
    const rects = [...(spark?.querySelectorAll('rect') ?? [])];
    expect(rects).toHaveLength(1); // both runs share one day bucket
    expect(rects[0]?.getAttribute('fill')).toBe('var(--ink-dim)');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders NOTHING when the 7-day window is empty (absence stays absent)', () => {
    const { container } = render(
      <ProjectSparkline runs={runs} attachedAt={{ 'r-old': NOW - 10 * DAY }} now={NOW} />,
    );
    expect(container.querySelector('[data-testid="project-sparkline"]')).toBeNull();
  });
});
