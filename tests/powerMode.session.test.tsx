/**
 * Power mode on the session page (coordinator review of the fixture shots, 2026-10-29): while a power run is paused at
 * a checkpoint ("this grew"; the run stays executing, no engine gate), the header says Waiting, no "working" line runs
 * at the thread's foot, and the pause is the dock's decision.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeUnit, makeView } from './factories.js';
import { buildEvents, state } from './powerFixtures.js';

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useRunEventStore } = await import('../src/store/events.js');
const { useGateStore } = await import('../src/store/gates.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');

const RUN = 'r-pm';
const units = [makeUnit({ id: `${RUN}:intake`, session_id: RUN, ord: 0, status: 'done', assigned_cli: 'pi', stage: 'test_plan' } as never),
  makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 1, status: 'executing', assigned_cli: 'claude', stage: 'build' } as never)];
const pause = { at: 1, checkpoint: 3, reasons: ['grew'], recommended: 'split' as const };

beforeEach(() => {
  useCapabilities.setState({ loaded: true, runChatId: true, powerMode: true });
  useGateStore.setState({ gates: {}, approaching: {} });
  useRunEventStore.setState({ byRun: { [RUN]: buildEvents() as never } });
  setCachedRoster([{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true } as never]);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useCapabilities.setState({ powerMode: false }); });

const page = (p: ReturnType<typeof state>) => render(<SessionPage sessionId={`run:${RUN}`} runs={[makeView({ id: RUN, problem: 'Invoice PDFs', status: 'executing', unit_ix: 1, power: p } as never, units)]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);

describe('a paused power run', () => {
  it('reads Waiting in the header, runs no working line, and docks the pause', async () => {
    page(state({ pause }));
    await waitFor(() => expect(screen.getByTestId('session-status').textContent).toBe('Waiting'));
    expect(screen.queryByTestId('session-working')).toBeNull();
    expect(await screen.findByTestId('power-pause')).toBeTruthy();
    expect(screen.getByTestId('decision-dock-eyebrow').textContent).toMatch(/^Your decision · Claude Code is waiting/);
  });
  it('the same run, not paused, reads as working and shows its working line', async () => {
    page(state());
    await waitFor(() => expect(screen.getByTestId('session-working')).toBeTruthy());
    expect(screen.getByTestId('session-status').textContent).not.toBe('Waiting');
    expect(screen.queryByTestId('power-pause')).toBeNull();
  });
  it('the run record fold says whose record it opens in a power build', async () => {
    page(state());
    const fold = await screen.findByTestId('chat-run-details');
    expect(fold.querySelector('summary')!.textContent).toBe('The job’s record: steps, checks and helpers');
  });
});

describe('a pause holds the run everywhere its state is said (one mechanism: isHeldRun)', () => {
  it('statusWord says Waiting on you and the record says where it paused; an ended run is never held', async () => {
    const { statusWord } = await import('../src/board/statusWords.js');
    const { isHeldRun } = await import('../src/board/heldRuns.js');
    const paused = makeView({ id: RUN, status: 'executing', power: state({ pause }) } as never, units);
    expect(statusWord(paused)).toEqual({ word: 'Waiting on you', tone: 'gate' });
    expect(isHeldRun(makeView({ id: RUN, status: 'executing', power: state() } as never, units).session)).toBe(false);
    expect(isHeldRun(makeView({ id: RUN, status: 'completed', power: state({ pause }) } as never, units).session)).toBe(false);
    expect(isHeldRun(makeView({ id: RUN, status: 'executing' } as never, units).session)).toBe(false);
  });
});
