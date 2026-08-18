// Process-stepper layout for the run thread (fix/run-thread-ux, operator UX directive):
// a compact stepper at the top of the thread maps EVERY workflow phase (done checked,
// current highlighted, future dimmed), and the conversational timeline below carries ONLY
// phases that have run or are running. Queued units no longer render tall empty
// "Not started" blocks, and council/routing chatter for not-yet-started units folds into
// the stepper tooltip instead of standalone thread blocks.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { ChatPanel } from '../src/components/ChatPanel.js';
import * as client from '../src/api/client.js';
import { useRuntimeStore } from '../src/store/runtime.js';
import { useGateStore } from '../src/store/gates.js';
import type { CoreEvent } from '../src/api/types.js';
import { makeView, makeUnit } from './factories.js';

beforeEach(() => {
  vi.restoreAllMocks();
  useRuntimeStore.setState({
    outputs: {}, councilStatus: {}, assumptions: {}, logs: {}, executorTypes: {}, terminalIds: {}, seq: 0,
  });
  useGateStore.setState({ gates: {} });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
});

/** The live governed-run shape: 1-based ords, unit_ix 1 → ord 2 executing. */
function workflowView(status: 'executing' | 'awaiting_human' = 'executing'): ReturnType<typeof makeView> {
  return makeView({ status, unit_ix: 1 }, [
    makeUnit({ id: 'run-1:clarify', ord: 1, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
    makeUnit({ id: 'run-1:design', ord: 2, stage: 'recon', status: 'distributed', assigned_cli: 'claude' }),
    makeUnit({ id: 'run-1:build', ord: 3, stage: 'build', status: 'distributed', assigned_cli: 'claude' }),
    makeUnit({ id: 'run-1:review', ord: 4, stage: 'review', status: 'distributed', assigned_cli: 'codex' }),
  ]);
}

describe('ChatPanel process stepper (workflow map at the top of the thread)', () => {
  it('renders every phase in ord order: done checked, current highlighted, future dimmed', async () => {
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'clarify output' });
    render(<ChatPanel view={workflowView()} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />);

    const stepper = screen.getByTestId('process-stepper');
    expect(within(stepper).getByTestId('stepper-phase-1')).toHaveAttribute('data-state', 'done');
    expect(within(stepper).getByTestId('stepper-phase-2')).toHaveAttribute('data-state', 'active');
    expect(within(stepper).getByTestId('stepper-phase-3')).toHaveAttribute('data-state', 'queued');
    expect(within(stepper).getByTestId('stepper-phase-4')).toHaveAttribute('data-state', 'queued');

    // Phase NAMES, not status words: the workflow's own vocabulary.
    expect(within(stepper).getByTestId('stepper-phase-1')).toHaveTextContent('clarify');
    expect(within(stepper).getByTestId('stepper-phase-2')).toHaveTextContent('design');
    expect(within(stepper).getByTestId('stepper-phase-3')).toHaveTextContent('build');
    expect(within(stepper).getByTestId('stepper-phase-4')).toHaveTextContent('review');

    // Done phases carry the check mark.
    expect(within(stepper).getByTestId('stepper-phase-1')).toHaveTextContent('✓');

    // DOM order follows ord order.
    const done = within(stepper).getByTestId('stepper-phase-1');
    const active = within(stepper).getByTestId('stepper-phase-2');
    expect(done.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Output test's concern, but pin the pairing here too: the done phase still shows output.
    expect(await screen.findByText('clarify output')).toBeInTheDocument();
  });

  // Rule 5 of the live-edge directive: the stepper's active phase gets the same
  // treatment the board does, and only it — a queued or done phase is not doing work.
  it('gives the active phase the live edge, and no other phase one', async () => {
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'clarify output' });
    render(<ChatPanel view={workflowView()} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />);
    // Let the done phase's transcript land, so no fetch settles after teardown.
    expect(await screen.findByText('clarify output')).toBeInTheDocument();

    const stepper = screen.getByTestId('process-stepper');
    const edge = within(within(stepper).getByTestId('stepper-phase-2')).getByTestId('live-edge');
    expect(edge).toHaveAttribute('data-edge-state', 'executing');
    // Inset variant: an edge at left:0 would land on a fully-rounded pill's cap curve.
    expect(edge.className).toContain('wk-live-edge--pill');
    expect(within(stepper).getAllByTestId('live-edge')).toHaveLength(1);

    // The dot stays for colour continuity but no longer competes: it does not pulse.
    expect(within(stepper).getByTestId('stepper-phase-2').querySelector('.animate-pulse')).toBeNull();
  });

  it('keeps queued phases OUT of the timeline: no empty blocks, no per-unit meta rows', async () => {
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'clarify output' });
    render(<ChatPanel view={workflowView()} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />);

    // Timeline entries: done clarify (output block) + active design (live narration). Nothing else.
    expect(await screen.findByTestId('unit-output-1')).toBeInTheDocument();
    expect(screen.getByTestId('live-narration-2')).toBeInTheDocument();
    expect(screen.queryByText('Not started')).not.toBeInTheDocument();
    expect(screen.queryByTestId('live-narration-3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unit-output-3')).not.toBeInTheDocument();
    // The queued review unit's codex avatar row must not render as a thread entry.
    expect(screen.queryByRole('button', { name: /send message to codex only/i })).not.toBeInTheDocument();
  });

  it('folds live council deliberation for a pending unit into the stepper tooltip, not a thread block', () => {
    const view = makeView({ status: 'executing', unit_ix: 0 }, [
      makeUnit({ id: 'run-1:u0', ord: 0, status: 'distributed', assigned_cli: 'claude' }),
      makeUnit({ id: 'run-1:u1', ord: 1, status: 'pending' }),
    ]);
    render(<ChatPanel view={view} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />);
    act(() => {
      useRuntimeStore.getState().ingest({
        type: 'councilConvened', session: 'run-1', ord: 1, clis: ['claude', 'codex', 'antigravity'],
      } as CoreEvent);
    });
    // No standalone council block in the conversation…
    expect(screen.queryByText(/Council convened/)).not.toBeInTheDocument();
    // …the stepper phase carries it as its tooltip instead.
    expect(screen.getByTestId('stepper-phase-1').getAttribute('title')).toContain(
      'Council convened — polling 3 CLIs',
    );
  });

  it('folds a routed-but-queued unit\'s council provenance into the tooltip, not a routing pill', () => {
    const view = makeView({ status: 'executing', unit_ix: 0 }, [
      makeUnit({ id: 'run-1:u0', ord: 0, status: 'distributed', assigned_cli: 'claude' }),
      makeUnit({
        id: 'run-1:u1', ord: 1, status: 'distributed', assigned_cli: 'codex',
        routing: { method: 'council', winner: 'codex', agreement_pct: 67, returned: 3, seated: 3, dissent: 1 },
      }),
    ]);
    render(<ChatPanel view={view} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />);
    // The council pill used to render as its own block for every routed unit.
    expect(screen.queryByText(/Council → codex/)).not.toBeInTheDocument();
    expect(screen.getByTestId('stepper-phase-1').getAttribute('title')).toContain('Council → codex');
    expect(screen.getByTestId('stepper-phase-1').getAttribute('title')).toContain('67% agree');
  });

  it('still shows the steering gate card when the run pauses before a queued phase', () => {
    act(() => {
      useGateStore.setState({
        gates: { 'run-1': { runId: 'run-1', ord: 2, prompt: 'Approve the design phase?', lifecycle: 'open', receivedAt: 0 } },
      });
    });
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'clarify output' });
    // awaiting_human = paused BEFORE the not-yet-started unit: no unit is executing, the
    // gated unit has no timeline entry, and the gate card must still render (fallback slot).
    render(<ChatPanel view={workflowView('awaiting_human')} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByTestId('steering-gate')).toBeInTheDocument();
    expect(screen.getByTestId('steering-prompt')).toHaveTextContent('Approve the design phase?');
    // Paused: nothing is "working", and the paused phase sits queued in the stepper.
    expect(screen.queryByTestId('live-narration-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('stepper-phase-2')).toHaveAttribute('data-state', 'queued');
  });

  it('renders no stepper for a legacy chat run (LegacyChatHistory keeps its own layout)', () => {
    const view = makeView({ workflow_id: 'chat', status: 'completed' }, [
      makeUnit({ id: 'run-1:u0', ord: 0, status: 'done' }),
    ]);
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'chat answer' });
    render(<ChatPanel view={view} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.queryByTestId('process-stepper')).not.toBeInTheDocument();
  });
});
