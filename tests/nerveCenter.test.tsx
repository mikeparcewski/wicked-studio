import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { PhaseStrip } from '../src/components/PhaseStrip.js';
import { ProjectCard } from '../src/components/ProjectCard.js';
import { useGateStore } from '../src/store/gates.js';
import { useRuntimeStore } from '../src/store/runtime.js';
import type { BoardProject } from '../src/hooks/useBoardModel.js';
import type { CoreEvent, Project, WorkUnit } from '../src/api/types.js';
import { makeUnit, makeView } from './factories.js';

/**
 * The slice-BA DOM contracts (DES-UX-002 §1.3/§1.5) that need no browser:
 * the phase strip's node grammar, the ACTIVE card's active-plan region
 * (strip + 60-char unit description, moving on a live `unitDispatched`),
 * and the gate-APPROACHING posture (EC47) — criterion preview, NO
 * Approve/Reject, retiring into the full chip when the gate posts.
 */

/** The §1.5 fixture plan: 5 ordered units — 2 done, 1 active, 2 pending. */
const PLAN: WorkUnit[] = [
  makeUnit({ id: 'r-live:u0', session_id: 'r-live', ord: 0, stage: 'recon', status: 'done', description: 'survey the surface' }),
  makeUnit({ id: 'r-live:u1', session_id: 'r-live', ord: 1, stage: 'build', status: 'done', description: 'wire the endpoint' }),
  makeUnit({ id: 'r-live:u2', session_id: 'r-live', ord: 2, stage: 'review', status: 'distributed', description: 'review the middleware refactor against the acceptance criteria list' }),
  makeUnit({ id: 'r-live:u3', session_id: 'r-live', ord: 3, stage: 'build', status: 'pending', description: 'apply the review fixes' }),
  makeUnit({ id: 'r-live:u4', session_id: 'r-live', ord: 4, stage: 'test', status: 'pending', description: 'run the acceptance suite' }),
];

const THREE_DAYS = 3 * 86_400_000;

function project(id: string): Project {
  return {
    id, name: id, description: null, status: 'active', scope: `project:${id}`,
    created_at: Date.now() - THREE_DAYS, updated_at: Date.now() - THREE_DAYS,
  };
}

function item(id: string, over: Partial<BoardProject> = {}): BoardProject {
  return {
    project: project(id), repo: null, runs: [], docs: [], attachedAt: {},
    attention: 'quiet', score: 0, band: 'quiet', signal: null,
    ...over,
  };
}

const activeItem = (units: WorkUnit[] = PLAN): BoardProject =>
  item('upload-endpoint', {
    runs: [makeView({ id: 'r-live', status: 'executing', unit_ix: 2 }, units)],
    attention: 'running', band: 'needs-you', score: 40,
    signal: { kind: 'running', at: Date.now(), runId: 'r-live' },
  });

const ingest = (event: CoreEvent): void => {
  act(() => {
    useGateStore.getState().ingest(event);
    useRuntimeStore.getState().ingest(event);
  });
};

beforeEach(() => {
  useGateStore.setState({ gates: {}, approaching: {} });
  useRuntimeStore.setState({ outputs: {}, logs: {}, deltaSeq: {}, docActivity: {}, seq: 0 });
});
afterEach(cleanup);

describe('PhaseStrip — the §1.3 node grammar', () => {
  it('renders one node per consecutive same-stage leg with the §1.5 data marks', () => {
    render(<PhaseStrip units={PLAN} currentOrd={2} />);
    const nodes = screen.getAllByTestId('phase-node');
    expect(nodes).toHaveLength(5);
    expect(nodes.map((n) => n.dataset.stage)).toEqual(['recon', 'build', 'review', 'build', 'test']);
    expect(nodes.filter((n) => n.dataset.complete === 'true')).toHaveLength(2);
    expect(nodes[2]).toHaveAttribute('data-active', 'true');
    // §1.4 tokens: done / active-dim / future ink, never literals.
    expect(nodes[0]?.style.background).toBe('var(--status-done)');
    expect(nodes[2]?.style.background).toBe('var(--status-run-dim)');
    expect(nodes[3]?.style.background).toBe('var(--ink-dim)');
  });

  it('collapses past 5 nodes into an honest remaining count, never a squeeze', () => {
    const long = Array.from({ length: 8 }, (_, i) =>
      makeUnit({
        id: `r:u${i}`, ord: i, status: 'pending',
        stage: (['recon', 'build', 'review', 'test'] as const)[i % 4] ?? 'build',
      }));
    render(<PhaseStrip units={long} currentOrd={0} />);
    expect(screen.getAllByTestId('phase-node')).toHaveLength(5);
    expect(screen.getByTestId('phase-strip-overflow')).toHaveTextContent('3 remaining');
    expect(screen.getByTestId('phase-strip')).toHaveAttribute('data-nodes', '8');
  });

  it('renders nothing for a planless run — no empty furniture', () => {
    render(<PhaseStrip units={[]} currentOrd={undefined} />);
    expect(screen.queryByTestId('phase-strip')).toBeNull();
  });
});

describe('the ACTIVE card active-plan region (§1.3, §1.5)', () => {
  it('renders the strip and the current unit description, capped at 60 chars', () => {
    render(<ProjectCard item={activeItem()} navigate={() => {}} />);
    const plan = screen.getByTestId('active-plan');
    expect(plan).toHaveAttribute('data-run-id', 'r-live');
    expect(within(plan).getByTestId('phase-strip')).toBeInTheDocument();
    const desc = within(plan).getByTestId('active-unit-description');
    expect(desc.textContent?.length).toBeLessThanOrEqual(60);
    expect(desc.textContent?.startsWith('review the middleware refactor')).toBe(true);
    expect(desc.textContent?.endsWith('…')).toBe(true);
    // The full description survives on the tooltip.
    expect(desc).toHaveAttribute('title', PLAN[2]?.description);
    // Mono, muted — §1.3's spelling.
    expect(desc.style.fontFamily).toBe('var(--font-mono)');
    expect(desc.style.color).toBe('var(--ink-muted)');
  });

  it('a unitDispatched frame moves the description to the dispatched unit', () => {
    render(<ProjectCard item={activeItem()} navigate={() => {}} />);
    ingest({ type: 'unitDispatched', session: 'r-live', ord: 3, attempt: 0 } as CoreEvent);
    expect(screen.getByTestId('active-unit-description')).toHaveTextContent('apply the review fixes');
    const nodes = screen.getAllByTestId('phase-node');
    expect(nodes[3]).toHaveAttribute('data-active', 'true');
    expect(nodes[2]).not.toHaveAttribute('data-active');
  });

  it('the generic narration fallback does NOT render beside the plan region — one duty, one line', () => {
    render(<ProjectCard item={activeItem()} navigate={() => {}} />);
    // Nothing streamed: the description line carries the subject; no live-line.
    expect(screen.queryByTestId('live-line')).toBeNull();
    // Something genuinely streams for the CURRENT unit: the live line returns.
    ingest({ type: 'unitOutputDelta', session: 'r-live', ord: 2, text: 'Checking the token-refresh path\n' } as CoreEvent);
    expect(screen.getByTestId('live-line')).toHaveTextContent('Checking the token-refresh path');
  });

  it('a card with no moving run keeps the pre-BA model — no strip, no description', () => {
    render(
      <ProjectCard
        item={item('q3-review-deck', {
          runs: [makeView({ id: 'r-gate', status: 'awaiting_human' }, [makeUnit({ id: 'r-gate:u0', session_id: 'r-gate' })])],
          attention: 'gate', band: 'needs-you', score: 100,
          signal: { kind: 'gate', at: Date.now(), runId: 'r-gate' },
        })}
        navigate={() => {}}
      />,
    );
    expect(screen.queryByTestId('active-plan')).toBeNull();
  });
});

describe('the gate-APPROACHING posture (§1.3, EC47)', () => {
  const CRITERION = 'All acceptance criteria demonstrably verified with evidence';

  it('gateEscalated renders the preview chip — criterion named, NO Approve/Reject', () => {
    render(<ProjectCard item={activeItem()} navigate={() => {}} />);
    ingest({ type: 'gateEscalated', session: 'r-live', ord: 2, condition: CRITERION } as CoreEvent);
    const chip = screen.getByTestId('gate-approaching');
    expect(chip).toHaveAttribute('data-criterion', CRITERION);
    expect(chip).toHaveAttribute('data-run-id', 'r-live');
    expect(chip).toHaveTextContent('gate approaching');
    // This is a signal to compose guidance, not an action surface.
    expect(screen.queryByTestId('gate-approve-r-live')).toBeNull();
    expect(screen.queryByTestId('gate-reject-r-live')).toBeNull();
    // §1.4: the gate chip vocabulary — amber on the dim gate surface.
    expect(chip.style.background).toBe('var(--status-gate-dim)');
  });

  it('the preview retires into the FULL chip when the gate posts (awaitingHuman)', () => {
    render(<ProjectCard item={activeItem()} navigate={() => {}} />);
    ingest({ type: 'gateEscalated', session: 'r-live', ord: 2, condition: CRITERION } as CoreEvent);
    ingest({ type: 'awaitingHuman', session: 'r-live', ord: 2, prompt: 'Approve the review?' } as CoreEvent);
    expect(screen.queryByTestId('gate-approaching')).toBeNull();
  });
});
