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
  ({ type: 'unitOutputDelta', session, ord, chunk } as CoreEvent);

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

  it('shows narration only on the ACTIVE unit — queued distributed units stay "Not started"', () => {
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
    expect(screen.getByText('Not started')).toBeInTheDocument();
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
