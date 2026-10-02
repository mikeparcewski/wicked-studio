// DES-studio-rebuild S3 — "Show technical details" on three surfaces. Off (the default) the
// surfaces render exactly as before: no handle element at all. On, each adds its engineer's
// handles in small grey type: the run header (run id, base sha, seat names), a run row on the
// Runs list and the gate card, each with the run id, base sha and seat names.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ChatPanel } from '../src/components/ChatPanel.js';
import { RunLink } from '../src/components/RunLink.js';
import { SteeringGate } from '../src/components/SteeringGate.js';
import { Tech, runTechParts } from '../src/components/Tech.js';
import * as client from '../src/api/client.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { DEFAULT_VIEW_PREFS, useViewPrefsStore } from '../src/store/viewPrefs.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'run-7f3a9c21-4d';
const SHA = 'a41c9e2b7d0f5e6a';

function view() {
  return makeView(
    { id: RUN, status: 'completed', unit_ix: 0, clis: ['claude', 'codex'], base_commit: SHA },
    [makeUnit({ id: `${RUN}:u0`, session_id: RUN, ord: 0, stage: 'build', status: 'done', assigned_cli: 'claude' })],
  );
}

function setTech(on: boolean): void {
  act(() => { useViewPrefsStore.setState({ prefs: { technical_details: on } }); });
}

beforeEach(() => {
  clearCachedWorkflows();
  useGateStore.setState({ gates: {}, approaching: {} });
  useRunEventStore.setState({ byRun: {} });
  useViewPrefsStore.setState({ prefs: DEFAULT_VIEW_PREFS, loaded: true, persist: 'unknown' });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'out' });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('runTechParts', () => {
  it('names the run, the 7-char base sha and the seats, and skips what the wire did not send', () => {
    expect(runTechParts({ id: RUN, base_commit: SHA, clis: ['claude', 'codex'] }))
      .toEqual([`run ${RUN}`, 'base a41c9e2', 'seats claude, codex']);
    expect(runTechParts({ id: RUN, clis: [] })).toEqual([`run ${RUN}`]);
    expect(runTechParts({ id: RUN, base_commit: '', clis: ['pi'] })).toEqual([`run ${RUN}`, 'seat pi']);
  });
});

describe('Tech', () => {
  it('renders nothing while the preference is off (the default)', () => {
    render(<Tech data-testid="tech-x" parts={['run r-1']} />);
    expect(screen.queryByTestId('tech-x')).toBeNull();
  });

  it('renders the parts joined in small grey type when on, and nothing for an empty list', () => {
    setTech(true);
    const { rerender } = render(<Tech data-testid="tech-x" parts={['run r-1', null, 'seat pi']} />);
    const el = screen.getByTestId('tech-x');
    expect(el).toHaveTextContent('run r-1 · seat pi');
    expect(el).toHaveAttribute('data-tech', 'on');
    rerender(<Tech data-testid="tech-x" parts={[null, undefined]} />);
    expect(screen.queryByTestId('tech-x')).toBeNull();
  });
});

describe('the three surfaces', () => {
  it('run header: hidden by default, shown when on, hidden again when turned off', () => {
    render(<ChatPanel view={view()} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.queryByTestId('tech-run-header')).toBeNull();
    setTech(true);
    const h = screen.getByTestId('tech-run-header');
    expect(screen.getByTestId('run-header').contains(h)).toBe(true);
    expect(h).toHaveTextContent(`run ${RUN} · base a41c9e2 · seats claude, codex`);
    setTech(false);
    expect(screen.queryByTestId('tech-run-header')).toBeNull();
  });

  it('run row: hidden by default, shown when on', () => {
    render(<RunLink view={view()} selectedRunId={null} onSelect={vi.fn()} />);
    expect(screen.queryByTestId('tech-run-row')).toBeNull();
    setTech(true);
    const h = screen.getByTestId('tech-run-row');
    expect(screen.getByTestId('run-link').contains(h)).toBe(true);
    expect(h).toHaveTextContent(`run ${RUN} · base a41c9e2 · seats claude, codex`);
  });

  it('gate card: hidden by default, shown when on', () => {
    render(<SteeringGate runId={RUN} ord={1} prompt="Approve the plan?" clis={['claude', 'pi']} baseCommit={SHA} />);
    expect(screen.queryByTestId('tech-gate')).toBeNull();
    setTech(true);
    const h = screen.getByTestId('tech-gate');
    expect(screen.getByTestId('steering-gate').contains(h)).toBe(true);
    expect(h).toHaveTextContent(`run ${RUN} · base a41c9e2 · seats claude, pi`);
  });
});
