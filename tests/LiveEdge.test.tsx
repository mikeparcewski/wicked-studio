// The live edge — the primary EXECUTING signal that replaced the blinking status dot
// (operator UX directive). These cases pin the two things that make the treatment
// correct rather than merely present:
//
//   1. the state → class MAPPING, including the prefers-reduced-motion branch, where
//      the animation must be swapped for a *higher-contrast* static edge, not dropped;
//   2. the RANKING — a gate-waiting element never gets the executing treatment, and its
//      own treatment is distinct, because a card that needs a human must not be
//      out-shouted by a wall of cards that are merely busy.
//
// The mapping is asserted as classes rather than computed style on purpose: jsdom has no
// CSS engine, so `@media (prefers-reduced-motion)` is inert here. The component maps the
// preference to `--static` for exactly this reason (index.css carries both).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { SessionStatus } from '../src/api/types.js';
import { edgeStateOf, LiveEdge, liveEdgeClass } from '../src/components/LiveEdge.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Force the OS preference for the duration of one case. */
function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('edgeStateOf — status → edge state', () => {
  it('gives every under-its-own-power status the executing edge', () => {
    for (const s of ['planning', 'distributing', 'executing'] as SessionStatus[]) {
      expect(edgeStateOf([s])).toBe('executing');
    }
  });

  it('gives a parked run the gate edge', () => {
    expect(edgeStateOf(['awaiting_human'])).toBe('gate');
  });

  it('leaves terminal runs unmarked — they are not doing work', () => {
    for (const s of ['completed', 'cancelled', 'failed'] as SessionStatus[]) {
      expect(edgeStateOf([s])).toBe('none');
    }
    expect(edgeStateOf([])).toBe('none');
  });

  it('ranks a gate above any amount of executing (rule 2)', () => {
    expect(edgeStateOf(['executing', 'awaiting_human', 'executing'])).toBe('gate');
    expect(edgeStateOf(['completed', 'executing'])).toBe('executing');
  });
});

describe('liveEdgeClass — state → class', () => {
  it('breathes for executing when motion is allowed', () => {
    expect(liveEdgeClass('executing', false)).toBe('wk-live-edge');
  });

  it('swaps the breath for a static edge under prefers-reduced-motion (rule 4)', () => {
    expect(liveEdgeClass('executing', true)).toBe('wk-live-edge wk-live-edge--static');
  });

  it('keeps the gate edge identical either way — it never animated', () => {
    expect(liveEdgeClass('gate', false)).toBe('wk-live-edge wk-live-edge--gate');
    expect(liveEdgeClass('gate', true)).toBe('wk-live-edge wk-live-edge--gate');
  });

  it('renders nothing for a state with no treatment', () => {
    expect(liveEdgeClass('none', false)).toBeNull();
    expect(liveEdgeClass('none', true)).toBeNull();
  });

  it('adds the pill inset for fully-rounded containers, in every state', () => {
    expect(liveEdgeClass('executing', false, true)).toBe('wk-live-edge wk-live-edge--pill');
    expect(liveEdgeClass('executing', true, true)).toBe('wk-live-edge wk-live-edge--static wk-live-edge--pill');
    expect(liveEdgeClass('gate', false, true)).toBe('wk-live-edge wk-live-edge--gate wk-live-edge--pill');
    expect(liveEdgeClass('none', false, true)).toBeNull();
  });

  it('never marks the gate treatment as executing, or the reverse', () => {
    const gate = liveEdgeClass('gate', false) ?? '';
    const executing = liveEdgeClass('executing', false) ?? '';
    expect(gate).not.toBe(executing);
    expect(gate.split(' ')).toContain('wk-live-edge--gate');
    expect(executing.split(' ')).not.toContain('wk-live-edge--gate');
  });
});

describe('<LiveEdge>', () => {
  it('exposes the state on the element and hides it from assistive tech', () => {
    stubReducedMotion(false);
    render(<LiveEdge state="executing" />);
    const edge = screen.getByTestId('live-edge');
    expect(edge).toHaveAttribute('data-edge-state', 'executing');
    expect(edge).toHaveAttribute('aria-hidden', 'true');
    expect(edge.className).toBe('wk-live-edge');
  });

  it('reads the OS preference and takes the reduced-motion branch', () => {
    stubReducedMotion(true);
    render(<LiveEdge state="executing" />);
    expect(screen.getByTestId('live-edge').className).toBe('wk-live-edge wk-live-edge--static');
  });

  it('renders no element at all when there is nothing to signal', () => {
    stubReducedMotion(false);
    render(<LiveEdge state="none" />);
    expect(screen.queryByTestId('live-edge')).toBeNull();
  });

  it('survives an environment with no matchMedia (SSR / bare jsdom)', () => {
    vi.stubGlobal('matchMedia', undefined);
    render(<LiveEdge state="executing" />);
    expect(screen.getByTestId('live-edge').className).toBe('wk-live-edge');
  });
});
