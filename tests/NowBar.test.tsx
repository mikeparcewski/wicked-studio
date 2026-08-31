// DES-RUN-NARRATOR §2: the sticky now-bar — always-visible "what is happening
// RIGHT NOW": run state, active phase (unit K of N), the latest narration
// line, the collected-artifacts chip, and the jump-to-latest affordance.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from '../src/components/ChatPanel.js';
import * as client from '../src/api/client.js';
import { useRunEventStore } from '../src/store/events.js';
import type { CoreEvent } from '../src/api/types.js';
import { makeView, makeUnit } from './factories.js';

const rec = (bag: Record<string, unknown>, seq: number): CoreEvent =>
  ({ ...bag, ts: 1000 + seq, seq }) as unknown as CoreEvent;

beforeEach(() => {
  vi.restoreAllMocks();
  useRunEventStore.setState({ byRun: {} });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'out' });
});

const executingView = (): ReturnType<typeof makeView> =>
  makeView({ status: 'executing', unit_ix: 1 }, [
    makeUnit({ id: 'run-1:survey', ord: 1, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
    makeUnit({ id: 'run-1:design', ord: 2, stage: 'recon', status: 'distributed', assigned_cli: 'claude' }),
    makeUnit({ id: 'run-1:build', ord: 3, stage: 'build', status: 'distributed', assigned_cli: 'claude' }),
  ]);

function renderPanel(v = executingView()): void {
  render(<ChatPanel view={v} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />);
}

describe('NowBar — what is happening right now, always visible', () => {
  it('names the run state, the active phase as unit K of N, and the latest narration line', () => {
    act(() => {
      useRunEventStore.getState().hydrate('run-1', [
        rec({ type: 'sessionStarted', session: 'run-1', problem: 'p' }, 1),
        rec({ type: 'unitDispatched', session: 'run-1', ord: 2, attempt: 0 }, 2),
      ]);
    });
    renderPanel();
    expect(screen.getByTestId('now-bar-status')).toHaveTextContent('working');
    expect(screen.getByTestId('now-bar-phase')).toHaveTextContent('design — unit 2 of 3');
    expect(screen.getByTestId('now-bar-narration')).toHaveTextContent('Worker started design');
  });

  it('falls back to a unit-derived phrase when the trail is silent', () => {
    renderPanel();
    expect(screen.getByTestId('now-bar-narration')).toHaveTextContent(/Working on design/);
  });

  it('speaks the paused state on a gated run', () => {
    renderPanel(makeView({ status: 'awaiting_human', unit_ix: 1 }, [
      makeUnit({ id: 'run-1:survey', ord: 1, stage: 'recon', status: 'done' }),
      makeUnit({ id: 'run-1:design', ord: 2, stage: 'recon', status: 'distributed' }),
    ]));
    expect(screen.getByTestId('now-bar-status')).toHaveTextContent('waiting on you');
    expect(screen.getByTestId('now-bar-phase')).toHaveTextContent('paused at a gate');
  });

  it('counts collected artifacts in the chip and lists them in the popover', async () => {
    act(() => {
      useRunEventStore.getState().hydrate('run-1', [
        rec({ type: 'dataUsed', session: 'run-1', ord: 1, files: ['/w/a.ts', '/w/b.ts'] }, 1),
      ]);
    });
    renderPanel();
    const chip = screen.getByTestId('now-bar-artifacts');
    expect(chip).toHaveTextContent('2');
    await userEvent.click(chip);
    const pop = screen.getByTestId('now-bar-artifacts-pop');
    expect(pop).toHaveTextContent('a.ts');
    expect(pop).toHaveTextContent('b.ts');
  });

  it('offers the jump-to-latest affordance that scrolls the feed tail into view', async () => {
    renderPanel();
    const feed = screen.getByTestId('thread');
    const scrollTo = vi.fn();
    (feed as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
    await userEvent.click(screen.getByTestId('now-bar-jump'));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
  });

  it('summarizes a terminal run honestly (phases done, no pulse verbs)', () => {
    renderPanel(makeView({ status: 'completed' }, [
      makeUnit({ id: 'run-1:survey', ord: 1, stage: 'recon', status: 'done' }),
      makeUnit({ id: 'run-1:build', ord: 2, stage: 'build', status: 'done' }),
    ]));
    expect(screen.getByTestId('now-bar-status')).toHaveTextContent('completed');
    expect(screen.getByTestId('now-bar-phase')).toHaveTextContent('2 of 2 phases done');
  });
});
