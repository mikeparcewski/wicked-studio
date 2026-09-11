// DES-RUN-NARRATOR §2: the pinned approval dock — anything awaiting the human
// renders OUTSIDE the scrolling feed, as its sibling, so it can never scroll
// away. Structure-level pinning: the dock is not a descendant of the scroll
// region; the feed remains the only scrolling region.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ChatPanel } from '../src/components/ChatPanel.js';
import * as client from '../src/api/client.js';
import { useGateStore } from '../src/store/gates.js';
import { useElicitationStore } from '../src/store/elicitations.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeView, makeUnit } from './factories.js';

beforeEach(() => {
  vi.restoreAllMocks();
  useGateStore.setState({ gates: {}, approaching: {} });
  useElicitationStore.setState({ elicitations: {}, generations: {} });
  useRunEventStore.setState({ byRun: {} });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'out' });
});

const gatedView = (): ReturnType<typeof makeView> =>
  makeView({ status: 'awaiting_human', unit_ix: 1 }, [
    makeUnit({ id: 'run-1:survey', ord: 1, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
    makeUnit({ id: 'run-1:build', ord: 2, stage: 'build', status: 'distributed', assigned_cli: 'claude' }),
  ]);

function renderPanel(v = gatedView()): void {
  render(<ChatPanel view={v} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />);
}

describe('ApprovalDock — pinned, never scrolls away', () => {
  it('renders the gate card in the dock, as a SIBLING of the scroll region (never inside it)', () => {
    act(() => {
      useGateStore.setState({
        gates: { 'run-1': { runId: 'run-1', ord: 2, prompt: 'Approve the build phase?', lifecycle: 'open', receivedAt: 0 } },
        approaching: {},
      });
    });
    renderPanel();
    const dock = screen.getByTestId('approval-dock');
    const gate = screen.getByTestId('steering-gate');
    const feed = screen.getByTestId('thread');
    // The action lives in the dock…
    expect(dock.contains(gate)).toBe(true);
    // …and the dock is structurally OUTSIDE the one scrolling region, so no
    // amount of feed growth can push the approval offscreen.
    expect(feed.contains(dock)).toBe(false);
    expect(dock.contains(feed)).toBe(false);
    // The feed stays the only scroll container of the pair.
    expect(feed.className).toContain('overflow-y-auto');
    expect(dock.className).not.toContain('overflow-y-auto');
  });

  it('renders the dock even when the daemon restarted and only the status survives (no cached gate)', () => {
    renderPanel(); // status awaiting_human, gate store empty
    expect(screen.getByTestId('approval-dock')).toBeInTheDocument();
    expect(screen.getByTestId('steering-gate')).toBeInTheDocument();
    // SteeringGate's own id-only fallback copy renders (§3.3).
    expect(screen.getByTestId('steering-prompt')).toHaveTextContent(/prompt unavailable/i);
    // The gate's ord is derived from the run's own cursor (`units[unit_ix].ord`, the same
    // resolution `useRunModel.pendingGate` makes), so the card is still bound to a unit.
    expect(screen.getByTestId('steering-gate')).toHaveTextContent('before unit #2');
  });

  it('daemon-restart fallback: the verdict lookup stays BOUNDED on the derived ord (Copilot on #252)', () => {
    // The run paused before unit #2 (unit_ix 1 → units[1].ord = 2). Its log holds the survey
    // phase's evaluation (ord 1) — the verdict this gate is about — and, appended later, a stray
    // ord-9 frame that an UNBOUNDED "last evaluation" lookup would have shown instead.
    act(() => {
      useRunEventStore.setState({
        byRun: {
          'run-1': [
            {
              type: 'gateEvaluated', session: 'run-1', ord: 1,
              criterion: 'the survey names every service', hasDeterministicFloor: true, deterministicPass: true,
              agentVerdict: 'pass', agentReasoning: 'PASS — every service is named.', evaluatorPass: true,
              evaluatorPolicies: [], denialReason: null, denial: null, combined: true,
            },
            {
              type: 'gateEvaluated', session: 'run-1', ord: 9,
              criterion: 'stray', hasDeterministicFloor: true, deterministicPass: false,
              agentVerdict: 'deny', agentReasoning: null, evaluatorPass: true,
              evaluatorPolicies: [], denialReason: 'stray denial', denial: null, combined: false,
            },
          ],
        },
      });
    });
    renderPanel(); // status awaiting_human, gate store empty → ord derived, prompt unavailable
    const card = screen.getByTestId('gate-verdict');
    expect(card).toHaveAttribute('data-verdict', 'pass');
    expect(card).toHaveAttribute('data-phase-ord', '1');
    expect(card).toHaveTextContent('Evaluator verdict — survey · PASS');
    expect(card).not.toHaveTextContent('stray');
  });

  it('daemon-restart fallback: the cursor indexes units in ORD order, whatever order the DTO arrived in (Copilot on #252)', () => {
    // The same paused run, its units array UNSORTED (build first): `unit_ix` 1 must still resolve
    // to the unit with ord 2, not to whichever unit happens to sit at index 1.
    renderPanel(
      makeView({ status: 'awaiting_human', unit_ix: 1 }, [
        makeUnit({ id: 'run-1:build', ord: 2, stage: 'build', status: 'distributed', assigned_cli: 'claude' }),
        makeUnit({ id: 'run-1:survey', ord: 1, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
      ]),
    );
    expect(screen.getByTestId('steering-gate')).toHaveTextContent('before unit #2');
  });

  it('docks an open MCP elicitation the same way', () => {
    act(() => {
      useElicitationStore.getState().setElicitation({
        runId: 'run-1',
        elicitationId: 'e1',
        message: 'Which database?',
        options: ['postgres', 'sqlite'],
        receivedAt: new Date().toISOString(),
      });
    });
    renderPanel(makeView({ status: 'executing', unit_ix: 1 }, [
      makeUnit({ id: 'run-1:survey', ord: 1, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
      makeUnit({ id: 'run-1:build', ord: 2, stage: 'build', status: 'distributed', assigned_cli: 'claude' }),
    ]));
    const dock = screen.getByTestId('approval-dock');
    expect(dock).toHaveTextContent('Which database?');
    expect(screen.getByTestId('thread').contains(dock)).toBe(false);
  });

  it('renders no dock when nothing awaits the human', () => {
    renderPanel(makeView({ status: 'executing', unit_ix: 0 }, [
      makeUnit({ id: 'run-1:survey', ord: 1, stage: 'recon', status: 'distributed', assigned_cli: 'claude' }),
    ]));
    expect(screen.queryByTestId('approval-dock')).not.toBeInTheDocument();
  });

  it('renders no dock on a terminal run — a stale gate cannot invite a dead decision', () => {
    act(() => {
      useGateStore.setState({
        gates: { 'run-1': { runId: 'run-1', ord: 2, prompt: 'stale', lifecycle: 'open', receivedAt: 0 } },
        approaching: {},
      });
    });
    renderPanel(makeView({ status: 'completed' }, [
      makeUnit({ id: 'run-1:survey', ord: 1, stage: 'recon', status: 'done' }),
    ]));
    expect(screen.queryByTestId('approval-dock')).not.toBeInTheDocument();
  });
});
