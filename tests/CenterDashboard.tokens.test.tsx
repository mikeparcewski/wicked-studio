/**
 * CenterDashboard — the Build surface under the token contract
 * (DES-VISION-001 §5.4, vision slice 4).
 *
 * Pins the slice-4 composition at unit level (the e2e rig re-proves the
 * computed values in a real browser):
 *   - run rows carry a 2px LEFT border whose color is the run's status token —
 *     amber at a gate, emerald working, red failed, dim ink done (§5.4: "the
 *     eye can scan the left margin for color without reading labels");
 *   - the purpose statement reads as prose: `--ink-body`, the sans (§5.4 +
 *     §2.8's two-face rule — this is the slice's own DOM AC);
 *   - the gate inbox headline is the §5.4 pill: `--status-gate-dim` background,
 *     `--status-gate` text;
 *   - the cost footer is mono + dim (a data point, not a hero) and shares the
 *     footer row with the one accent-colored primary action;
 *   - status words stay mono while intent labels read sans (EC13).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CenterDashboard, runRowModel } from '../src/components/CenterDashboard.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeUnit, makeView } from './factories.js';
import type { SessionView } from '../src/api/types.js';

vi.mock('../src/api/client.js', () => ({
  api: {
    confirmGate: vi.fn(async () => ({})),
    injectMessage: vi.fn(async () => ({})),
  },
}));

function dash(runs: SessionView[] = []): void {
  render(
    <CenterDashboard
      runs={runs}
      onSelectRun={vi.fn()}
      onApproveGate={vi.fn()}
      onRejectGate={vi.fn()}
      navigate={vi.fn()}
    />,
  );
}

function units(done: number, total: number, sid = 'run-1') {
  return Array.from({ length: total }, (_, i) =>
    makeUnit({ id: `${sid}:u${i}`, ord: i, status: i < done ? 'done' : 'pending' }),
  );
}

beforeEach(() => {
  useGateStore.setState({ gates: {} });
  useRunEventStore.setState({ byRun: {} });
});

describe('run rows encode status at the list edge (§5.4)', () => {
  it('border-left is 2px of the status token, per state', () => {
    dash([
      makeView({ id: 'r-gate', problem: 'migrate the tables', status: 'awaiting_human' }, units(0, 2, 'r-gate')),
      makeView({ id: 'r-work', problem: 'add rate limiting', status: 'executing' }, units(1, 4, 'r-work')),
      makeView({ id: 'r-fail', problem: 'spike the importer', status: 'failed' }),
      makeView({ id: 'r-done', problem: 'fix the flaky test', status: 'completed' }),
    ]);
    const rows = screen.getAllByTestId('build-run-row');
    const byStatus = Object.fromEntries(rows.map((r) => [r.getAttribute('data-status'), r]));
    expect(byStatus['gate']!.style.borderLeft).toBe('2px solid var(--status-gate)');
    expect(byStatus['working']!.style.borderLeft).toBe('2px solid var(--status-run)');
    expect(byStatus['failed']!.style.borderLeft).toBe('2px solid var(--status-fail)');
    expect(byStatus['done']!.style.borderLeft).toBe('2px solid var(--status-done)');
    // The recolor on a state transition animates (§5.4 motion), and a new row
    // fades in once — no loops (§1.6).
    for (const r of rows) {
      expect(r.style.transition).toContain('border-color var(--dur-base)');
      expect(r.className).toContain('wk-fade-in');
      expect(r.style.background).toBe('var(--surface-card)');
    }
  });

  it('EC13 on the row: intent label reads sans/high ink, the status word mono', () => {
    dash([makeView({ id: 'r-work', problem: 'add rate limiting', status: 'executing' }, units(1, 4, 'r-work'))]);
    const row = screen.getByTestId('build-run-row');
    const spans = Array.from(row.querySelectorAll('span'));
    const intent = spans.find((s) => s.textContent === 'add rate limiting') as HTMLElement;
    const status = spans.find((s) => s.textContent?.startsWith('working')) as HTMLElement;
    expect(intent.style.fontFamily).toBe('var(--font-sans)');
    expect(intent.style.color).toBe('var(--ink-high)');
    expect(intent.style.fontSize).toBe('var(--text-sm)');
    expect(status.style.fontFamily).toBe('var(--font-mono)');
  });
});

describe('the purpose statement (the slice DOM AC) and the surface faces', () => {
  it('build-purpose is --ink-body --text-sm in the sans', () => {
    dash([]);
    const purpose = screen.getByTestId('build-purpose');
    expect(purpose.style.color).toBe('var(--ink-body)');
    expect(purpose.style.fontSize).toBe('var(--text-sm)');
    expect(purpose.style.fontFamily).toBe('var(--font-sans)');
  });

  it('the surface root defaults to the sans (labels/prose); data opts into mono', () => {
    dash([]);
    expect(screen.getByTestId('build-dashboard').style.fontFamily).toBe('var(--font-sans)');
  });
});

describe('the gate inbox pill (§5.4 token usage)', () => {
  it('is --status-gate-dim background with --status-gate text', () => {
    useGateStore.setState({
      gates: {
        'r-gate': {
          runId: 'r-gate', ord: 0, prompt: 'Approve the plan?', lifecycle: 'open', receivedAt: 1,
        },
      },
    });
    dash([makeView({ id: 'r-gate', problem: 'migrate the tables', status: 'awaiting_human' })]);
    const pill = screen.getByTestId('gate-inbox-pill');
    expect(pill.textContent).toContain('1 gate needs you');
    expect(pill.style.background).toBe('var(--status-gate-dim)');
    expect(pill.style.color).toBe('var(--status-gate)');
    expect(pill.style.borderRadius).toBe('var(--radius-full)');
  });
});

describe('the footer row: one accent action + the mono/dim cost stat (§5.4)', () => {
  it('cost footer is mono + --ink-dim and shares a row with + Build something', () => {
    useRunEventStore.setState({
      byRun: {
        'r-1': [
          { type: 'cliUsage', session: 'r-1', inputTokens: 84_000, outputTokens: 14_000, costUsd: 0.42 },
        ],
      },
    });
    dash([makeView({ id: 'r-1', problem: 'billed work', status: 'executing' }, units(0, 2, 'r-1'))]);
    const footer = screen.getByTestId('build-stats-footer');
    expect(footer.style.fontFamily).toBe('var(--font-mono)');
    expect(footer.style.color).toBe('var(--ink-dim)');
    expect(footer.style.fontSize).toBe('var(--text-xs)');
    const action = screen.getByTestId('build-something');
    expect(action.style.background).toBe('var(--accent)');
    expect(action.style.color).toBe('var(--accent-fg)');
    // One row: the action and the stat share a parent (the §5.4 wireframe's
    // `[ + Build something ]            cost: $0.24` line).
    expect(footer.parentElement).toBe(action.parentElement);
  });

  it('runRowModel speaks tokens, never raw colors (§2.11)', () => {
    for (const status of ['awaiting_human', 'planning', 'executing', 'completed', 'failed', 'cancelled'] as const) {
      const { color } = runRowModel(makeView({ status }));
      expect(color).toMatch(/^var\(--(status|ink)-/);
    }
  });
});
