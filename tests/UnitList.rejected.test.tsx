// Guard: the transcript pane of a REJECTED unit shows the daemon's reason, not an invented one
// (FINDING-006, studio half).
//
// Rendered through <UnitList>, the component an operator actually reads — not through a helper.
// Two independent defects lived here, and each needs its own falsifiable assertion:
//
//   1. the pane only auto-opened for `done`, so the failed unit stayed shut; and
//   2. on a `null` output it printed "(no transcript captured)", which is FALSE for a denied
//      unit — its output WAS captured, and deny-dominates then declined to store it.
//
// Together they meant the unit an operator opens the run to triage was the one that told them
// nothing, and what little it said was wrong.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnitList } from '../src/components/UnitList.js';
import * as client from '../src/api/client.js';
import { useGateStore } from '../src/store/gates.js';
import { makeUnit } from './factories.js';

// Concatenated so the assertion cannot match the literal it is searching for.
const CAPTURED_LIE = '(no transcript ' + 'captured)';

const DAEMON_REASON =
  'Unit 3 was ' +
  'REJECTED' +
  ', so wicked-core stored no transcript for it. Why it was rejected: gate denied on path-policy.';

describe('UnitList — a rejected unit reports WHY its transcript is absent (FINDING-006)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  });

  it('auto-opens the pane for a rejected unit and renders the daemon reason', async () => {
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({
      output: null,
      outputUnavailable: DAEMON_REASON,
    });
    render(
      <UnitList
        runId="run-1"
        units={[makeUnit({ id: 'run-1:domain', ord: 3, status: 'rejected', denial_reason: 'gate denied on path-policy' })]}
      />,
    );
    // Reached the endpoint at all — the pane used to skip any unit that was not `done`.
    expect(client.api.getUnitOutput).toHaveBeenCalledWith('run-1', 'domain');
    const pane = await screen.findByTestId('unit-transcript');
    expect(pane).toHaveTextContent('gate denied on path-policy');
    expect(pane).not.toHaveTextContent(CAPTURED_LIE);
  });

  it('still falls back for a daemon too old to send a reason', async () => {
    // Forward-compat, and the reason the fallback string survives at all: a pre-0.4.1 daemon
    // sends `{output: null}` with no explanation, and an empty pane would be worse than a
    // hedged one. The guard is that the hedge is the LAST resort, not the first.
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: null });
    render(
      <UnitList runId="run-1" units={[makeUnit({ id: 'run-1:domain', ord: 3, status: 'rejected' })]} />,
    );
    expect(await screen.findByTestId('unit-transcript')).toHaveTextContent(CAPTURED_LIE);
  });

  it('prefers a real transcript over the reason when the daemon has one', async () => {
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({
      output: 'the actual transcript',
      outputUnavailable: 'should never be rendered when output is present',
    });
    render(
      <UnitList runId="run-1" units={[makeUnit({ id: 'run-1:build', ord: 2, status: 'done' })]} />,
    );
    const pane = await screen.findByTestId('unit-transcript');
    expect(pane).toHaveTextContent('the actual transcript');
    expect(pane).not.toHaveTextContent('should never be rendered');
  });
});
