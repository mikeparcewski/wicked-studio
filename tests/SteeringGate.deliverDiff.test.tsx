// Issue #300 — Deliver gate card: diffstat summary + full-diff expander fetched from
// GET /runs/:id/diff?base=merge-base.
//
// The diffstat (files changed, +additions, −deletions) appears in a <details> summary
// tagged deliver-gate-diffstat; the raw unified diff is in deliver-gate-full-diff.
// The fetch fires only when `lift !== null` (i.e. the gate is on the deliver unit).
// When the diff is unavailable (network error), the block is silently absent.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SteeringGate } from '../src/components/SteeringGate.js';
import * as client from '../src/api/client.js';
import { useAnnotationStore } from '../src/store/annotations.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { useSteeringStore } from '../src/store/steering.js';
import { makeUnit } from './factories.js';
import { G6_EVENTS, GATE_RUN } from './fixtures/gateEvidence.js';
import { DELIVER_LIFTED_TAIL } from './fixtures/wire433.js';
import type { CoreEvent } from '../src/api/types.js';

// A minimal unified diff with 2 files, 3 insertions, 1 deletion.
const SAMPLE_DIFF = [
  'diff --git a/src/foo.ts b/src/foo.ts',
  'index 000..111 100644',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -1,4 +1,5 @@',
  ' unchanged',
  '+added line 1',
  '+added line 2',
  '-removed line',
  ' other unchanged',
  'diff --git a/src/bar.ts b/src/bar.ts',
  'index 222..333 100644',
  '--- a/src/bar.ts',
  '+++ b/src/bar.ts',
  '@@ -1,2 +1,3 @@',
  ' keep',
  '+new line',
].join('\n');

// A gate on the deliver unit (ord 5). Seeding G6_EVENTS + DELIVER_LIFTED_TAIL
// makes deliverLift() produce a non-null result for ord 5.
const DELIVER_PROMPT = 'Unit 5 failed and triage escalated: deliver: LIFT-CONFLICT (Failed): [rebase conflict on src/foo.ts]';
const NORMAL_ORD_PROMPT = 'Approve unit 3 before it runs: build — the acceptance suite';

const DELIVER_UNITS = [
  makeUnit({ id: `${GATE_RUN}:fix`, session_id: GATE_RUN, ord: 3, status: 'done' }),
  makeUnit({ id: `${GATE_RUN}:verify`, session_id: GATE_RUN, ord: 4, status: 'done' }),
  makeUnit({ id: `${GATE_RUN}:deliver`, session_id: GATE_RUN, ord: 5, status: 'pending' }),
];

function seedDeliverEvents(): void {
  useRunEventStore.setState({
    byRun: { [GATE_RUN]: [...G6_EVENTS, ...DELIVER_LIFTED_TAIL] as CoreEvent[] },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  useGateStore.setState({ gates: {} });
  useAnnotationStore.setState({ drafts: {} });
  useSteeringStore.setState({ entries: [], seq: 0 });
  useRunEventStore.setState({ byRun: {} });
  vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  vi.spyOn(client.api, 'cancelRun').mockResolvedValue({ status: 'cancelled' });
});
afterEach(cleanup);

describe('SteeringGate — deliver gate diffstat (#300)', () => {
  it('fetches GET /runs/:id/diff?base=merge-base when the gate is on the deliver unit (lift present)', async () => {
    const getRunDiff = vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({
      diff: SAMPLE_DIFF,
      truncated: false,
    });
    seedDeliverEvents();
    render(<SteeringGate runId={GATE_RUN} ord={5} prompt={DELIVER_PROMPT} units={DELIVER_UNITS} />);
    await screen.findByTestId('deliver-gate-diffstat');
    expect(getRunDiff).toHaveBeenCalledWith(GATE_RUN, undefined, 'merge-base');
    expect(getRunDiff).toHaveBeenCalledTimes(1);
    // Deliver-unit escalation (#299): Retry / Reject / Cancel run — no Request changes.
    expect(screen.getByTestId('steering-retry')).toBeInTheDocument();
    expect(screen.queryByTestId('steering-request-changes')).toBeNull();
  });

  it('diffstat summary line shows correct file count, additions and deletions', async () => {
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: SAMPLE_DIFF, truncated: false });
    seedDeliverEvents();
    render(<SteeringGate runId={GATE_RUN} ord={5} prompt={DELIVER_PROMPT} units={DELIVER_UNITS} />);
    const summary = await screen.findByTestId('deliver-gate-diffstat');
    // 2 files, 3 additions (+added line 1, +added line 2, +new line), 1 deletion
    expect(summary.textContent).toMatch(/2 files? changed/);
    expect(summary.textContent).toMatch(/\+3/);
    expect(summary.textContent).toMatch(/−1/);
  });

  it('full diff is rendered inside the expander', async () => {
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: SAMPLE_DIFF, truncated: false });
    seedDeliverEvents();
    render(<SteeringGate runId={GATE_RUN} ord={5} prompt={DELIVER_PROMPT} units={DELIVER_UNITS} />);
    await screen.findByTestId('deliver-gate-diffstat');
    const pre = screen.getByTestId('deliver-gate-full-diff');
    expect(pre.textContent).toContain('diff --git a/src/foo.ts');
    expect(pre.textContent).toContain('+added line 1');
  });

  it('notes "diff truncated" in the summary when truncated is true', async () => {
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: SAMPLE_DIFF, truncated: true });
    seedDeliverEvents();
    render(<SteeringGate runId={GATE_RUN} ord={5} prompt={DELIVER_PROMPT} units={DELIVER_UNITS} />);
    const summary = await screen.findByTestId('deliver-gate-diffstat');
    expect(summary.textContent).toMatch(/diff truncated at 1/);
  });

  it('shows "(empty diff)" in the expander when the diff string is empty', async () => {
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
    seedDeliverEvents();
    render(<SteeringGate runId={GATE_RUN} ord={5} prompt={DELIVER_PROMPT} units={DELIVER_UNITS} />);
    await screen.findByTestId('deliver-gate-diffstat');
    const pre = screen.getByTestId('deliver-gate-full-diff');
    expect(pre.textContent).toBe('(empty diff)');
    // Summary for an empty diff should say "no changes"
    const summary = screen.getByTestId('deliver-gate-diffstat');
    expect(summary.textContent).toMatch(/no changes/);
  });

  it('does NOT show the diffstat block when getRunDiff rejects (diff unavailable)', async () => {
    vi.spyOn(client.api, 'getRunDiff').mockRejectedValue(new Error('offline'));
    seedDeliverEvents();
    render(<SteeringGate runId={GATE_RUN} ord={5} prompt={DELIVER_PROMPT} units={DELIVER_UNITS} />);
    // Wait a tick for the rejected promise to settle.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('deliver-gate-diffstat')).toBeNull();
    expect(screen.queryByTestId('deliver-gate-full-diff')).toBeNull();
  });

  it('does NOT fetch when the gate is NOT on the deliver unit (lift absent)', async () => {
    const getRunDiff = vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: SAMPLE_DIFF, truncated: false });
    // No deliver events seeded — deliverLift() returns null for ord 3.
    render(<SteeringGate runId={GATE_RUN} ord={3} prompt={NORMAL_ORD_PROMPT} units={DELIVER_UNITS} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(getRunDiff).not.toHaveBeenCalled();
    expect(screen.queryByTestId('deliver-gate-diffstat')).toBeNull();
  });
});
