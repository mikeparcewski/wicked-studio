// DES-RUN-NARRATOR §2/§4/§5: the narrated feed — one chronological stream of
// deterministic status lines, verbose output behind expanders, artifacts
// inline, the raw wire view behind a toggle.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from '../src/components/ChatPanel.js';
import * as client from '../src/api/client.js';
import { useRunEventStore } from '../src/store/events.js';
import { useRuntimeStore } from '../src/store/runtime.js';
import type { CoreEvent } from '../src/api/types.js';
import { makeView, makeUnit } from './factories.js';

const rec = (bag: Record<string, unknown>, seq: number): CoreEvent =>
  ({ ...bag, ts: 1000 + seq, seq }) as unknown as CoreEvent;

beforeEach(() => {
  vi.restoreAllMocks();
  useRunEventStore.setState({ byRun: {} });
  useRuntimeStore.setState({
    outputs: {}, deltaSeq: {}, docActivity: {}, councilStatus: {}, assumptions: {}, logs: {}, executorTypes: {}, terminalIds: {}, seq: 0,
  });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'unit output' });
});

const view = (): ReturnType<typeof makeView> =>
  makeView({ status: 'executing', unit_ix: 1 }, [
    makeUnit({ id: 'run-1:survey', ord: 1, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
    makeUnit({ id: 'run-1:build', ord: 2, stage: 'build', status: 'distributed', assigned_cli: 'claude' }),
  ]);

function renderPanel(v = view()): void {
  render(<ChatPanel view={v} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />);
}

describe('NarratorFeed — the one chronological narrated stream', () => {
  it('renders narration lines for the trail, sorted even on out-of-order arrival', () => {
    act(() => {
      // Deliberately hydrated out of seq order — the feed must render sorted.
      useRunEventStore.getState().hydrate('run-1', [
        rec({ type: 'unitDispatched', session: 'run-1', ord: 2, attempt: 0 }, 5),
        rec({ type: 'sessionStarted', session: 'run-1', problem: 'p' }, 1),
        rec({ type: 'unitOutputCaptured', session: 'run-1', ord: 1, outputBytes: 2048, stepStatus: 'ok' }, 3),
        rec({ type: 'unitDispatched', session: 'run-1', ord: 1, attempt: 0 }, 2),
      ]);
    });
    renderPanel();
    const lines = screen.getAllByTestId('narration-line').map((el) => el.textContent ?? '');
    expect(lines[0]).toContain('Run started');
    expect(lines[1]).toContain('Worker started survey');
    expect(lines[2]).toContain('survey finished — output captured (2 KB)');
    expect(lines[3]).toContain('Worker started build');
  });

  it('collapses verbose output behind the unit expander INSIDE the narration group', async () => {
    act(() => {
      useRunEventStore.getState().hydrate('run-1', [
        rec({ type: 'unitDispatched', session: 'run-1', ord: 1, attempt: 0 }, 1),
      ]);
    });
    renderPanel();
    // The done unit's transcript auto-loads, expanded, behind its toggle…
    expect(await screen.findByText('unit output')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('unit-output-toggle-1'));
    expect(screen.queryByText('unit output')).not.toBeInTheDocument();
    // …and the unit group sits AFTER its dispatch line in the DOM.
    const line = screen.getAllByTestId('narration-line')[0]!;
    const unit = screen.getByTestId('unit-output-1');
    expect(line.compareDocumentPosition(unit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders inline artifact cards behind the dataUsed line, wired to the FileViewer', () => {
    act(() => {
      useRunEventStore.getState().hydrate('run-1', [
        rec({ type: 'dataUsed', session: 'run-1', ord: 1, files: ['/w/src/retry.ts'] }, 1),
      ]);
    });
    renderPanel();
    const card = screen.getByTestId('artifact-card');
    expect(card).toHaveTextContent('retry.ts');
    expect(card).toHaveAttribute('data-artifact-kind', 'file');
    expect(screen.getByTestId('artifact-open')).toBeInTheDocument();
  });

  it('keeps the raw wire view one toggle away, and switches back', async () => {
    act(() => {
      useRunEventStore.getState().hydrate('run-1', [
        rec({ type: 'sessionStarted', session: 'run-1', problem: 'p' }, 1),
        rec({ type: 'unitDispatched', session: 'run-1', ord: 1, attempt: 0 }, 2),
      ]);
    });
    renderPanel();
    expect(screen.getAllByTestId('narration-line').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByTestId('feed-view-raw'));
    const raws = screen.getAllByTestId('raw-event');
    expect(raws).toHaveLength(2);
    expect(raws[0]).toHaveTextContent('sessionStarted');
    expect(raws[1]).toHaveTextContent('unitDispatched');
    expect(screen.queryAllByTestId('narration-line')).toHaveLength(0);

    await userEvent.click(screen.getByTestId('feed-view-narrated'));
    expect(screen.getAllByTestId('narration-line').length).toBeGreaterThan(0);
  });

  it('shows the gate moment inline in the feed (history) while the dock holds the action', () => {
    act(() => {
      useRunEventStore.getState().hydrate('run-1', [
        rec({ type: 'awaitingHuman', session: 'run-1', ord: 2, prompt: 'Approve the build phase?' }, 1),
      ]);
    });
    renderPanel(makeView({ status: 'awaiting_human', unit_ix: 1 }, [
      makeUnit({ id: 'run-1:survey', ord: 1, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
      makeUnit({ id: 'run-1:build', ord: 2, stage: 'build', status: 'distributed', assigned_cli: 'claude' }),
    ]));
    const gateLine = screen
      .getAllByTestId('narration-line')
      .find((el) => (el.textContent ?? '').includes('Gate: waiting on you'));
    expect(gateLine).toBeDefined();
    expect(gateLine).toHaveAttribute('data-tone', 'gate');
  });
});
