// Live narration in the run thread (feat/live-thread): unitOutputDelta frames from the /ws
// CoreEvent stream (folded by the runtime store into `outputs`) render inside the ACTIVE
// unit's block — collapsible, autoscrolled, trailing ~4KB — replacing the empty "Working…" wait.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from '../src/components/ChatPanel.js';
import * as client from '../src/api/client.js';
import { useRuntimeStore } from '../src/store/runtime.js';
import type { CoreEvent } from '../src/api/types.js';
import { makeView, makeUnit } from './factories.js';

const relayDelta = (session: string, ord: number, chunk: string): CoreEvent =>
  ({ type: 'unitOutputDelta', session, ord, attempt: 0, text: chunk } as CoreEvent);

/** An executing run whose cursor (unit_ix 0) sits on a distributed unit at ord 0. */
function executingView(extraUnits: ReturnType<typeof makeUnit>[] = []): ReturnType<typeof makeView> {
  return makeView({ status: 'executing', unit_ix: 0 }, [
    makeUnit({ id: 'run-1:u0', ord: 0, status: 'distributed', assigned_cli: 'claude' }),
    ...extraUnits,
  ]);
}

beforeEach(() => {
  vi.restoreAllMocks();
  useRuntimeStore.setState({
    outputs: {}, councilStatus: {}, assumptions: {}, logs: {}, executorTypes: {}, terminalIds: {}, seq: 0,
  });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
});

describe('ChatPanel live narration (unitOutputDelta → active unit block)', () => {
  it('shows the working state (no text pane) before any delta arrives', () => {
    render(
      <ChatPanel view={executingView()} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />,
    );
    const block = screen.getByTestId('live-narration-0');
    expect(block).toHaveTextContent('Working…');
    expect(screen.queryByTestId('live-narration-text-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('live-narration-toggle-0')).not.toBeInTheDocument();
  });

  it('streams unitOutputDelta text into the active unit block live, appending across frames', () => {
    render(
      <ChatPanel view={executingView()} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />,
    );
    act(() => {
      useRuntimeStore.getState().ingest(relayDelta('run-1', 0, 'Reading the failing test'));
    });
    expect(screen.getByTestId('live-narration-text-0')).toHaveTextContent('Reading the failing test');

    act(() => {
      useRuntimeStore.getState().ingest(relayDelta('run-1', 0, ' — found the fixture'));
    });
    expect(screen.getByTestId('live-narration-text-0')).toHaveTextContent(
      'Reading the failing test — found the fixture',
    );
    // Once text streams, the header names it as live output.
    expect(screen.getByTestId('live-narration-0')).toHaveTextContent('Working — live output');
  });

  it('is collapsible: the toggle hides and re-shows the streamed text', async () => {
    const user = userEvent.setup();
    render(
      <ChatPanel view={executingView()} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />,
    );
    act(() => {
      useRuntimeStore.getState().ingest(relayDelta('run-1', 0, 'streamed body'));
    });
    expect(screen.getByTestId('live-narration-text-0')).toBeInTheDocument();

    await user.click(screen.getByTestId('live-narration-toggle-0'));
    expect(screen.queryByTestId('live-narration-text-0')).not.toBeInTheDocument();
    // Header stays while collapsed.
    expect(screen.getByTestId('live-narration-0')).toHaveTextContent('Working — live output');

    await user.click(screen.getByTestId('live-narration-toggle-0'));
    expect(screen.getByTestId('live-narration-text-0')).toHaveTextContent('streamed body');
  });

  it('renders only the trailing ~4KB of a long stream, marked as truncated', () => {
    render(
      <ChatPanel view={executingView()} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />,
    );
    act(() => {
      useRuntimeStore.getState().ingest(relayDelta('run-1', 0, 'HEAD-' + 'x'.repeat(5000) + '-TAIL'));
    });
    const text = screen.getByTestId('live-narration-text-0').textContent ?? '';
    // Truncation ellipsis + exactly the trailing 4096 chars.
    expect(text.startsWith('…')).toBe(true);
    expect(text).toHaveLength(4097);
    expect(text.endsWith('-TAIL')).toBe(true);
    expect(text).not.toContain('HEAD-');
  });

  it('shows narration only on the ACTIVE unit — queued units get no thread block at all', () => {
    const view = makeView({ status: 'executing', unit_ix: 0 }, [
      makeUnit({ id: 'run-1:u0', ord: 0, status: 'distributed', assigned_cli: 'claude' }),
      makeUnit({ id: 'run-1:u1', ord: 1, status: 'distributed', assigned_cli: 'codex' }),
    ]);
    render(<ChatPanel view={view} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />);
    act(() => {
      useRuntimeStore.getState().ingest(relayDelta('run-1', 0, 'active text'));
      useRuntimeStore.getState().ingest(relayDelta('run-1', 1, 'should not render'));
    });
    expect(screen.getByTestId('live-narration-0')).toBeInTheDocument();
    expect(screen.queryByTestId('live-narration-1')).not.toBeInTheDocument();
    expect(screen.queryByText('should not render')).not.toBeInTheDocument();
    // The queued phase is the stepper's job now — no tall empty block in the timeline.
    expect(screen.queryByText('Not started')).not.toBeInTheDocument();
    expect(screen.getByTestId('stepper-phase-1')).toHaveAttribute('data-state', 'queued');
  });

  it('streams live text for the real daemon shape: 1-based ords, cursor unit_ix into the ord order', () => {
    // Mirrors the live governed run: unit 1 done, unit 2 distributed + executing under
    // unit_ix=1 (a 0-based index into the ord-ordered plan, NOT an ord).
    const view = makeView({ status: 'executing', unit_ix: 1 }, [
      makeUnit({ id: 'run-1:clarify', ord: 1, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
      makeUnit({ id: 'run-1:design', ord: 2, stage: 'recon', status: 'distributed', assigned_cli: 'claude' }),
      makeUnit({ id: 'run-1:build', ord: 3, stage: 'build', status: 'distributed', assigned_cli: 'claude' }),
    ]);
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'clarify output' });
    render(<ChatPanel view={view} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />);
    act(() => {
      useRuntimeStore.getState().ingest(relayDelta('run-1', 2, 'Studying both repos'));
    });
    expect(screen.getByTestId('live-narration-text-2')).toHaveTextContent('Studying both repos');
    // The entry names its phase (the unit-id suffix), not just a status word.
    expect(screen.getByTestId('live-narration-2')).toHaveTextContent('design');
    // The queued build phase has no block; the done clarify phase keeps its output entry.
    expect(screen.queryByTestId('live-narration-3')).not.toBeInTheDocument();
  });

  it('renders text already hydrated from the persisted trail (late-join reload, no live frame yet)', () => {
    // The render-gap root cause: /ws has no replay, so a page opened after the unit began
    // showed a bare "Working…" until the NEXT live delta. hydrateOutputs backfills the buffer
    // from GET /runs/:id/events; the block must render that text with zero live frames.
    act(() => {
      useRuntimeStore.getState().hydrateOutputs('run-1', [
        relayDelta('run-1', 0, 'recorded before '),
        relayDelta('run-1', 0, 'the page opened'),
      ]);
    });
    render(
      <ChatPanel view={executingView()} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />,
    );
    expect(screen.getByTestId('live-narration-text-0')).toHaveTextContent(
      'recorded before the page opened',
    );
  });

  it('legacy cliOutputDelta frames feed the same narration block', () => {
    render(
      <ChatPanel view={executingView()} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />,
    );
    act(() => {
      useRuntimeStore.getState().ingest({ type: 'cliOutputDelta', session: 'run-1', ord: 0, chunk: 'acp text' } as CoreEvent);
    });
    expect(screen.getByTestId('live-narration-text-0')).toHaveTextContent('acp text');
  });
});
