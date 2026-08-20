// "Executing" must look the same wherever it renders (operator UX directive, rule 5):
// board cards, the run chips on them, the run list's cards, and the run view's stepper
// active phase. These cases pin the treatment on each surface, and — the point of the
// whole change — that a gate-waiting element on the SAME board carries a DISTINCT
// treatment at the same time, so the one card that needs a human still wins the eye.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ProjectCard } from '../src/components/ProjectCard.js';
import { RunCard } from '../src/components/RunCard.js';
import type { BoardProject } from '../src/hooks/useBoardModel.js';
import type { Project, SessionStatus } from '../src/api/types.js';
import { useGateStore } from '../src/store/gates.js';
import { useRuntimeStore } from '../src/store/runtime.js';
import { makeUnit, makeView } from './factories.js';

beforeEach(() => {
  useGateStore.setState({ gates: {} });
  useRuntimeStore.setState({ outputs: {}, logs: {}, deltaSeq: {}, docActivity: {} });
});
afterEach(cleanup);

function project(id: string): Project {
  return {
    id, name: id, description: null, status: 'active', scope: `project:${id}`,
    created_at: 1, updated_at: 1,
  };
}

function card(id: string, statuses: SessionStatus[], attention: BoardProject['attention']): BoardProject {
  // The edge is derived from run STATUS, not from the score — the slice-1 fields
  // only need to typecheck here, so a neutral score/band/signal is enough.
  return {
    project: project(id),
    repo: null,
    runs: statuses.map((status, i) =>
      makeView({ id: `${id}-run-${i}`, status }, [makeUnit({ id: `${id}-u${i}`, stage: 'build' })]),
    ),
    docs: [],
    attention,
    score: attention === 'quiet' ? 0 : 100,
    band: attention === 'quiet' ? 'quiet' : 'needs-you',
    signal: null,
  };
}

/** The card's OWN edge — chips carry their own, so only the direct child counts. */
function cardEdge(el: HTMLElement): HTMLElement | null {
  return el.querySelector<HTMLElement>(':scope > [data-testid="live-edge"]');
}

describe('the live edge on the board', () => {
  it('marks an executing card with the breathing edge', () => {
    render(<ProjectCard item={card('busy', ['executing'], 'running')} navigate={() => {}} />);
    const edge = cardEdge(screen.getByTestId('project-card'));
    expect(edge).not.toBeNull();
    expect(edge).toHaveAttribute('data-edge-state', 'executing');
    expect(edge?.className).toContain('wk-live-edge');
    expect(edge?.className).not.toContain('wk-live-edge--gate');
  });

  it('marks a gate-waiting card DISTINCTLY, and both read at once on one board', () => {
    render(
      <>
        <ProjectCard item={card('busy', ['executing'], 'running')} navigate={() => {}} />
        <ProjectCard item={card('gated', ['awaiting_human'], 'gate')} navigate={() => {}} />
      </>,
    );
    const [busy, gated] = screen.getAllByTestId('project-card');
    const busyEdge = cardEdge(busy as HTMLElement);
    const gateEdge = cardEdge(gated as HTMLElement);
    expect(busyEdge).toHaveAttribute('data-edge-state', 'executing');
    expect(gateEdge).toHaveAttribute('data-edge-state', 'gate');
    expect(gateEdge?.className).not.toBe(busyEdge?.className);
  });

  it('lets a gate on the card out-rank the executing run beside it', () => {
    render(<ProjectCard item={card('mixed', ['executing', 'awaiting_human'], 'gate')} navigate={() => {}} />);
    expect(cardEdge(screen.getByTestId('project-card'))).toHaveAttribute('data-edge-state', 'gate');
  });

  it('leaves a quiet card unmarked — no edge, nothing to signal', () => {
    render(<ProjectCard item={card('quiet', ['completed'], 'quiet')} navigate={() => {}} />);
    expect(cardEdge(screen.getByTestId('project-card'))).toBeNull();
  });

  it('carries the edge on the individual run chips too, per run state', () => {
    render(<ProjectCard item={card('mixed', ['executing', 'awaiting_human'], 'gate')} navigate={() => {}} />);
    const chips = screen.getAllByTestId('run-chip');
    expect(within(chips[0] as HTMLElement).getByTestId('live-edge'))
      .toHaveAttribute('data-edge-state', 'executing');
    expect(within(chips[1] as HTMLElement).getByTestId('live-edge'))
      .toHaveAttribute('data-edge-state', 'gate');
  });
});

describe('the live edge on the run list and the run view', () => {
  it('marks an executing run card, and a parked one distinctly', () => {
    const { rerender } = render(
      <RunCard view={makeView({ status: 'executing' })} selected={false} onSelect={() => {}} />,
    );
    expect(screen.getByTestId('live-edge')).toHaveAttribute('data-edge-state', 'executing');
    rerender(<RunCard view={makeView({ status: 'awaiting_human' })} selected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('live-edge')).toHaveAttribute('data-edge-state', 'gate');
    rerender(<RunCard view={makeView({ status: 'completed' })} selected={false} onSelect={() => {}} />);
    expect(screen.queryByTestId('live-edge')).toBeNull();
  });
});
