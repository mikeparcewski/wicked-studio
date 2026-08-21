import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { phaseWord, recentRuns, RUN_DOT, RunsSection } from '../src/components/RunsSection.js';
import { makeUnit, makeView } from './factories.js';

/**
 * The rail's inline runs section (DES-FEEDBACK-001 §1.4, slice A): recent 5
 * from the SAME runs prop (no fetch), active before terminal, board-card
 * status tokens on the dot, runPath navigation, "All runs ›" at the bottom.
 */

afterEach(cleanup);

const flat = (id: string): string => `/runs/${id}`;

describe('recentRuns (§1.4 ordering)', () => {
  it('puts active runs before terminal ones regardless of incoming recency', () => {
    const runs = [
      makeView({ id: 'r-done', status: 'completed' }),
      makeView({ id: 'r-live', status: 'executing' }),
      makeView({ id: 'r-fail', status: 'failed' }),
      makeView({ id: 'r-gate', status: 'awaiting_human' }),
    ];
    expect(recentRuns(runs).map((v) => v.session.id)).toEqual([
      'r-live', 'r-gate', 'r-done', 'r-fail',
    ]);
  });

  it('caps at five', () => {
    const runs = Array.from({ length: 8 }, (_, i) => makeView({ id: `r-${i}`, status: 'executing' }));
    expect(recentRuns(runs)).toHaveLength(5);
  });

  it('preserves incoming (recency) order within each group', () => {
    const runs = [
      makeView({ id: 'r-a', status: 'executing' }),
      makeView({ id: 'r-b', status: 'planning' }),
      makeView({ id: 'r-c', status: 'completed' }),
      makeView({ id: 'r-d', status: 'cancelled' }),
    ];
    expect(recentRuns(runs).map((v) => v.session.id)).toEqual(['r-a', 'r-b', 'r-c', 'r-d']);
  });
});

describe('phaseWord', () => {
  it('speaks gate/done/failed/cancelled for the settled states', () => {
    expect(phaseWord(makeView({ status: 'awaiting_human' }))).toBe('gate');
    expect(phaseWord(makeView({ status: 'completed' }))).toBe('done');
    expect(phaseWord(makeView({ status: 'failed' }))).toBe('failed');
    expect(phaseWord(makeView({ status: 'cancelled' }))).toBe('cancelled');
  });

  it('reads "working i/n" off unit_ix while live', () => {
    const view = makeView({ status: 'executing', unit_ix: 1 }, [
      makeUnit({ id: 'u0', ord: 0 }), makeUnit({ id: 'u1', ord: 1 }), makeUnit({ id: 'u2', ord: 2 }),
    ]);
    expect(phaseWord(view)).toBe('working 2/3');
    expect(phaseWord(makeView({ status: 'executing' }))).toBe('working');
  });
});

describe('RunsSection (§1.4 DOM)', () => {
  it('renders the rows with the board-card status tokens on the dot', () => {
    const runs = [
      makeView({ id: 'r-live', status: 'executing', problem: 'add rate-limiting' }),
      makeView({ id: 'r-gate', status: 'awaiting_human', problem: 'make the deck' }),
      makeView({ id: 'r-done', status: 'completed', problem: 'smoke: login' }),
      makeView({ id: 'r-fail', status: 'failed', problem: 'refactor auth' }),
    ];
    render(<RunsSection runs={runs} runPath={flat} navigate={() => {}} />);

    const rows = screen.getAllByTestId('rail-run');
    expect(rows.map((r) => r.dataset.runId)).toEqual(['r-live', 'r-gate', 'r-done', 'r-fail']);
    // The dot speaks the SAME status layer as the board cards (§2.6).
    expect(RUN_DOT.executing).toBe('var(--status-run)');
    expect(RUN_DOT.awaiting_human).toBe('var(--status-gate)');
    expect(RUN_DOT.completed).toBe('var(--status-done)');
    expect(RUN_DOT.failed).toBe('var(--status-fail)');
    for (const [id, token] of [
      ['r-live', RUN_DOT.executing], ['r-gate', RUN_DOT.awaiting_human],
      ['r-done', RUN_DOT.completed], ['r-fail', RUN_DOT.failed],
    ] as const) {
      const row = rows.find((r) => r.dataset.runId === id)!;
      const dot = row.querySelector('span[aria-hidden]') as HTMLElement;
      expect(dot.style.background).toBe(token);
    }
  });

  it('labels the intent in the body ramp and the phase in quiet mono (§1.4)', () => {
    render(
      <RunsSection
        runs={[makeView({ id: 'r-1', status: 'executing', problem: 'add rate-limiting' })]}
        runPath={flat}
        navigate={() => {}}
      />,
    );
    const intent = screen.getByTestId('rail-run-intent');
    expect(intent.textContent).toBe('add rate-limiting');
    expect(intent.style.maxWidth).toBe('28ch');
    expect(intent.style.fontSize).toBe('var(--text-xs)');
    expect(intent.style.color).toBe('var(--ink-body)');
    const phase = screen.getByTestId('rail-run-phase');
    expect(phase.style.fontSize).toBe('var(--text-2xs)');
    expect(phase.style.color).toBe('var(--ink-dim)');
    expect(phase.style.fontFamily).toBe('var(--font-mono)');
  });

  it('a row navigates runPath(id) — the caller routing, same as selectRun', () => {
    const navigate = vi.fn();
    render(
      <RunsSection
        runs={[makeView({ id: 'r-42', status: 'executing' })]}
        runPath={(id) => `/p/proj/build/${id}`}
        navigate={navigate}
      />,
    );
    fireEvent.click(screen.getByTestId('rail-run'));
    expect(navigate).toHaveBeenCalledWith('/p/proj/build/r-42');
  });

  it('keeps "All runs ›" at the bottom of the section as a real /runs link', () => {
    const navigate = vi.fn();
    render(<RunsSection runs={[]} runPath={flat} navigate={navigate} />);
    const hatch = screen.getByTestId('rail-all-runs');
    expect(hatch).toHaveAttribute('href', '/runs');
    fireEvent.click(hatch);
    expect(navigate).toHaveBeenCalledWith('/runs');
  });
});
