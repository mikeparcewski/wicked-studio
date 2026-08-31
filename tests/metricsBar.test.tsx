import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GateLatencyChart } from '../src/components/GateLatencyChart.js';
import { RunOutcomeBar, outcomeOf } from '../src/components/RunOutcomeBar.js';
import { TokenBurnSparkline } from '../src/components/TokenBurnSparkline.js';
import { ProjectSparkline } from '../src/components/ProjectSparkline.js';
import { useGateStore } from '../src/store/gates.js';
import { useRuntimeStore, type LoggedEvent } from '../src/store/runtime.js';
import { makeView } from './factories.js';

/**
 * The home metrics bar (DES-FEEDBACK-001 §2, slice E): three SVG-first tiles,
 * each answering a §2.1 named operator question off data the page ALREADY
 * holds — no chart library, no new polling, no invented wire fields.
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

describe('RunOutcomeBar (§2.1 — "Is the system healthy right now?")', () => {
  const runs = [
    makeView({ id: 'r-a', status: 'executing' }),
    makeView({ id: 'r-b', status: 'awaiting_human' }),
    makeView({ id: 'r-c', status: 'failed' }),
    makeView({ id: 'r-d', status: 'completed' }),
    makeView({ id: 'r-old', status: 'completed' }), // outside the 24h window
    makeView({ id: 'r-orphan', status: 'executing' }), // no attach clock at all
  ];
  const attachedAt = {
    'r-a': NOW - 30 * MIN,
    'r-b': NOW - 3 * HOUR,
    'r-c': NOW - 5 * HOUR,
    'r-d': NOW - 23 * HOUR,
    'r-old': NOW - 3 * DAY,
  };

  it('buckets by the attach clock into token-filled stacked rects — zero fetches', () => {
    render(<RunOutcomeBar runs={runs} attachedAt={attachedAt} now={NOW} />);
    const tile = screen.getByTestId('run-outcome-bar');
    expect(tile.getAttribute('data-question')).toBe('Is the system healthy right now?');
    // 4 in-window (one per outcome class); r-old and the clockless orphan excluded.
    expect(tile.getAttribute('data-total')).toBe('4');
    expect(tile.getAttribute('data-unplaced')).toBe('2');
    const fills = [...tile.querySelectorAll('rect')].map((r) => r.getAttribute('fill'));
    expect(fills).toHaveLength(4);
    expect(new Set(fills)).toEqual(new Set([
      'var(--status-run)', 'var(--status-gate)', 'var(--status-fail)', 'var(--status-done)',
    ]));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders the honest empty line — never zero-height rects — when nothing is in-window', () => {
    render(<RunOutcomeBar runs={[makeView({ id: 'r-x', status: 'executing' })]} attachedAt={{}} now={NOW} />);
    const tile = screen.getByTestId('run-outcome-bar');
    expect(tile.getAttribute('data-total')).toBe('0');
    expect(tile.querySelectorAll('rect')).toHaveLength(0);
    expect(tile.textContent).toContain('No runs attached in the last 24h');
  });

  it('maps statuses to outcome classes (cancelled is its OWN class — J5/A5)', () => {
    expect(outcomeOf('executing')).toBe('run');
    expect(outcomeOf('awaiting_human')).toBe('gate');
    expect(outcomeOf('failed')).toBe('fail');
    expect(outcomeOf('cancelled')).toBe('cancelled');
    expect(outcomeOf('completed')).toBe('done');
  });

  it('a cancelled run wears its own neutral segment, never the fail token', () => {
    const withCancelled = [
      makeView({ id: 'r-x', status: 'failed' }),
      makeView({ id: 'r-y', status: 'cancelled' }),
    ];
    render(
      <RunOutcomeBar
        runs={withCancelled}
        attachedAt={{ 'r-x': NOW - HOUR, 'r-y': NOW - 2 * HOUR }}
        now={NOW}
      />,
    );
    const tile = screen.getByTestId('run-outcome-bar');
    expect(tile.getAttribute('data-total')).toBe('2');
    const fills = [...tile.querySelectorAll('rect')].map((r) => r.getAttribute('fill'));
    expect(fills).toContain('var(--status-fail)');
    expect(fills).toContain('var(--ink-dim)');
    expect(tile.textContent).toContain('1 failed');
    expect(tile.textContent).toContain('1 cancelled');
  });

  it('states its exclusions as an ⓘ note whose tooltip names the count (EC39 + quick win #1)', () => {
    render(
      <RunOutcomeBar
        runs={[
          makeView({ id: 'r-in', status: 'failed' }),
          makeView({ id: 'r-noclock', status: 'failed' }),
        ]}
        attachedAt={{ 'r-in': NOW - HOUR }}
        now={NOW}
      />,
    );
    const note = screen.getByTestId('outcome-unplaced-note');
    // The exclusion is still STATED (machine-readable count + hover words),
    // but no longer runs as headline copy under the tile.
    expect(note).toHaveAttribute('data-unplaced', '1');
    expect(note.textContent).toContain('1 not shown');
    expect(note.getAttribute('title')).toContain('excludes 1 run with no clock in this window');
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

describe('TokenBurnSparkline (§2.1 — "What am I spending, is it accelerating?")', () => {
  it('folds cliUsage costs into a cumulative accent area; null costs never become $0', () => {
    log('r-1', [
      { type: 'cliUsage', ts: NOW - 50 * MIN, costUsd: 0.1 },
      { type: 'cliUsage', ts: NOW - 20 * MIN }, // costUsd null on the wire → NOT preserved, NOT counted
      { type: 'cliUsage', ts: NOW - 5 * MIN, costUsd: 0.32 },
    ]);
    render(<TokenBurnSparkline now={NOW} />);
    const tile = screen.getByTestId('token-burn-sparkline');
    expect(tile.getAttribute('data-question')).toBe('What am I spending, is it accelerating?');
    expect(tile.getAttribute('data-points')).toBe('2');
    expect(tile.textContent).toContain('$0.42');
    const line = tile.querySelector('polyline');
    expect(line?.getAttribute('stroke')).toBe('var(--accent)');
    const area = tile.querySelector('polygon');
    expect(area?.getAttribute('fill')).toMatch(/^url\(#/);
    const stops = [...tile.querySelectorAll('stop')].map((s) => s.getAttribute('stop-color'));
    expect(stops).toEqual(['var(--accent)', 'var(--accent)']);
    // No NaN anywhere in the geometry.
    expect(line?.getAttribute('points')).not.toContain('NaN');
    expect(area?.getAttribute('points')).not.toContain('NaN');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders the honest empty line — never a fabricated $0.00 curve — with no usage', () => {
    render(<TokenBurnSparkline now={NOW} />);
    const tile = screen.getByTestId('token-burn-sparkline');
    expect(tile.querySelectorAll('polyline')).toHaveLength(0);
    expect(tile.textContent).toContain('No usage reported yet');
    expect(tile.textContent).not.toContain('$0.00');
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
