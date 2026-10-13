import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { InsightState } from '../src/hooks/useDeskInsights.js';
import { DeskUnderstand } from '../src/components/desk/DeskUnderstand.js';
import { agentRows, workflowRows } from '../src/board/deskInsights.js';
import { NOW, deskRun, names } from './fixtures/deskV2.js';

const mocks = vi.hoisted(() => ({
  state: { phase: 'idle' } as InsightState,
  generate: vi.fn(async () => undefined),
  events: vi.fn(async () => ({ events: [] })),
  launch: vi.fn(),
  fetch: vi.fn(() => { throw new Error('Unexpected network call'); }),
}));
vi.mock('../src/hooks/useDeskInsights.js', () => ({
  generateInsights: mocks.generate,
  useDeskInsights: () => mocks.state,
}));
vi.mock('../src/api/client.js', () => ({
  api: { getRunEvents: mocks.events, launchRun: mocks.launch },
  apiBase: () => '/api/v1',
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { phase: 'idle' };
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function props(): ComponentProps<typeof DeskUnderstand> {
  const kept = [
    deskRun('finished'), deskRun('failed', { status: 'failed' }),
    deskRun('working', { status: 'executing' }),
  ];
  return {
    agents: agentRows(null, kept, names, ['claude', 'codex', 'pi', 'gemini']),
    workflows: workflowRows(kept), kept, allRuns: kept, days: 30, onDays: vi.fn(),
    project: null, projectLabel: null, projectName: names.project, agentName: names.agent,
    governance: () => ({ word: 'Every action checked', tone: 'ok', unchecked: 0 }),
    navigate: vi.fn(), pathOf: (id) => `/sessions/run:${id}`, now: NOW,
  };
}
function suggest(kind: string): void {
  const button = screen.getAllByTestId('desk-und-suggest').find((b) => b.dataset.id === kind);
  expect(button).toBeDefined();
  fireEvent.click(button!);
}
function expectNoRequests(): void {
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.events).not.toHaveBeenCalled();
  expect(mocks.launch).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
}

describe('Understand empty state and insights', () => {
  it('starts with an intro and nothing picked, without requesting anything', () => {
    render(<DeskUnderstand {...props()} />);
    expect(screen.getByTestId('desk-und-empty')).toHaveTextContent('Nothing picked yet');
    expect(screen.getByTestId('desk-und-intro')).toHaveTextContent('Set things side by side');
    expect(screen.queryByTestId('desk-compare-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desk-insights-generate')).not.toBeInTheDocument();
    expectNoRequests();
  });

  it.each([2, 4])('suggests up to three agents from %i available, with insights idle until clicked', (count) => {
    const p = props();
    p.agents = p.agents.slice(0, count);
    render(<DeskUnderstand {...p} />);
    suggest('agents');
    const selected = p.agents.slice(0, 3).map((a) => a.cli);
    expect(screen.getAllByTestId('desk-compare-card').map((c) => c.dataset.id)).toEqual(selected);
    expect(screen.queryByTestId('desk-und-empty')).not.toBeInTheDocument();
    expectNoRequests();
    fireEvent.click(screen.getByTestId('desk-insights-generate'));
    // The key is kind|days|scope|selection|<the numbers on the cards>.
    expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(new RegExp(`^agents\\|30\\|\\|${selected.join(',')}\\|`)), expect.stringContaining('Compare these agents'));
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it('suggests one failed and one finished job, excluding a working job', async () => {
    render(<DeskUnderstand {...props()} />);
    await act(async () => { suggest('jobs'); });
    const cards = screen.getAllByTestId('desk-compare-card');
    expect(cards.map((c) => c.dataset.id)).toEqual(['failed', 'finished']);
    expect(cards[0]).toHaveTextContent('Failed');
    expect(cards[1]).toHaveTextContent('Finished');
    expect(screen.getByTestId('desk-insights-generate')).toBeInTheDocument();
    // Job cards read their own spend records; insight generation is still click-only.
    expect(mocks.events).toHaveBeenCalledWith('failed', ['cliUsage']);
    expect(mocks.events).toHaveBeenCalledWith('finished', ['cliUsage']);
    expect(mocks.generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('desk-insights-generate'));
    expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^jobs\|30\|\|failed,finished\|/), expect.any(String));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('shows a completed insight with a Generated stamp and regeneration', () => {
    const p = props();
    const { rerender } = render(<DeskUnderstand {...p} />);
    suggest('agents');
    fireEvent.click(screen.getByTestId('desk-insights-generate'));
    mocks.state = { phase: 'done', text: 'Claude passes more checks on the first attempt.', at: NOW };
    rerender(<DeskUnderstand {...p} />);
    const done = screen.getByTestId('desk-insights-done');
    expect(done).toHaveTextContent('Claude passes more checks on the first attempt.');
    expect(done).toHaveTextContent(/Generated .+ by an agent/);
    expect(screen.queryByTestId('desk-insights-generate')).not.toBeInTheDocument();
    fireEvent.click(within(done).getByTestId('desk-insights-regenerate'));
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(mocks.generate.mock.calls[1]).toEqual(mocks.generate.mock.calls[0]);
  });

  it('shows an insight error and retries the same selection on Try again', () => {
    const p = props();
    const { rerender } = render(<DeskUnderstand {...p} />);
    suggest('agents');
    fireEvent.click(screen.getByTestId('desk-insights-generate'));
    mocks.state = { phase: 'error', error: 'No answer after 3 minutes.' };
    rerender(<DeskUnderstand {...p} />);
    const error = screen.getByTestId('desk-insights-error');
    expect(within(error).getByRole('alert')).toHaveTextContent('No answer after 3 minutes.');
    fireEvent.click(within(error).getByRole('button', { name: 'Try again' }));
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(mocks.generate.mock.calls[1]).toEqual(mocks.generate.mock.calls[0]);
  });
});
