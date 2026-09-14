// F-E2E-014 — seatless-run failure card: full headline, no seat remedy, long cause wraps.
//
// The phase7-r2 rig's escalation card truncated the cause at `(Failed):` (cleanPrompt split on the
// first `[`, which was the cause bracket) and showed the ReassignControl lever even when no seat
// ran the unit. These three acceptance cases pin the fixed behaviour.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent } from '../src/api/types.js';
import { SteeringGate } from '../src/components/SteeringGate.js';
import { useAnnotationStore } from '../src/store/annotations.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { useSteeringStore } from '../src/store/steering.js';
import { makeUnit } from './factories.js';
import type { RosterSeat } from '../src/api/types.js';

const RUN = 'seatless-run-e2e014';
const CAUSE = 'worktree missing: /repos/does-not-exist not found — nothing to plan against';
const ESCALATION_PROMPT = `Unit 3 failed and triage escalated: recon passed, build faltered: triage judge failed (Failed): [${CAUSE}]`;
const POOL = ['claude', 'codex'];
const ROSTER: RosterSeat[] = [
  { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true },
  { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: false },
];

const SEATLESS_UNITS = [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
  makeUnit({ id: `${RUN}:u2`, session_id: RUN, ord: 2, stage: 'build', status: 'done', assigned_cli: 'claude' }),
  makeUnit({ id: `${RUN}:u3`, session_id: RUN, ord: 3, stage: 'build', status: 'pending', assigned_cli: null }),
];

const EVENTS: CoreEvent[] = [
  { type: 'awaitingHuman', session: RUN, ord: 3, prompt: ESCALATION_PROMPT, reviewingOrd: null },
] as unknown as CoreEvent[];

beforeEach(() => {
  vi.restoreAllMocks();
  useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 3, prompt: ESCALATION_PROMPT, lifecycle: 'open', receivedAt: 1 } } });
  useAnnotationStore.setState({ drafts: {} });
  useSteeringStore.setState({ entries: [], seq: 0 });
  useRunEventStore.setState({ byRun: { [RUN]: EVENTS } });
  vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  vi.spyOn(client.api, 'getRun').mockRejectedValue(new Error('not needed'));
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: ROSTER });
  clearCachedRoster();
  setCachedRoster(ROSTER);
});
afterEach(cleanup);

describe('F-E2E-014: seatless-run failure card', () => {
  it('(a) the cause after (Failed): appears in the headline — not demoted to the footnote disclosure', () => {
    render(<SteeringGate runId={RUN} ord={3} prompt={ESCALATION_PROMPT} units={SEATLESS_UNITS} clis={POOL} />);
    expect(screen.getByTestId('steering-prompt')).toHaveTextContent(CAUSE);
    expect(screen.queryByText('why this gate fired')).toBeNull();
  });

  it('(a) seatless failure — no ReassignControl lever; Approve reads plain "Approve"', () => {
    render(<SteeringGate runId={RUN} ord={3} prompt={ESCALATION_PROMPT} units={SEATLESS_UNITS} clis={POOL} />);
    expect(screen.queryByTestId('steering-reassign-row')).toBeNull();
    expect(screen.queryByTestId('steering-reassign-none')).toBeNull();
    expect(screen.getByTestId('steering-approve')).toHaveTextContent('Approve');
    expect(screen.getByTestId('steering-approve').textContent).not.toMatch(/retry on/);
  });

  it('(b) seat failure — existing ReassignControl lever and Approve label preserved', () => {
    const SEATED_UNITS = SEATLESS_UNITS.map((u) =>
      u.ord === 3 ? { ...u, assigned_cli: 'codex' } : u,
    );
    render(<SteeringGate runId={RUN} ord={3} prompt={ESCALATION_PROMPT} units={SEATED_UNITS} clis={POOL} />);
    expect(screen.getByTestId('steering-reassign-row')).toBeInTheDocument();
    expect(screen.getByTestId('steering-approve')).toHaveTextContent('Approve (retry on codex)');
  });

  it('(c) a long cause renders in full in the headline — not truncated or demoted', () => {
    const LONG_CAUSE = 'X'.repeat(120) + ' — very long cause that must not be truncated or collapsed';
    const LONG_PROMPT = `Unit 3 failed and triage escalated: triage judge failed (Failed): [${LONG_CAUSE}]`;
    useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 3, prompt: LONG_PROMPT, lifecycle: 'open', receivedAt: 1 } } });
    render(<SteeringGate runId={RUN} ord={3} prompt={LONG_PROMPT} units={SEATLESS_UNITS} clis={POOL} />);
    expect(screen.getByTestId('steering-prompt').textContent).toContain(LONG_CAUSE);
    expect(screen.queryByText('why this gate fired')).toBeNull();
  });

  // #274 — the regression the independent review of the first cut reproduced: a host that passes
  // NO `units` (the steering-author panel; the testing-launch panel before its snapshot) cannot
  // resolve the failed unit's seat. "Unknown" is not "seatless": the lever must stay, exactly as it
  // did before this fix, and Approve reads plain "Approve" (no seat to name).
  it('(c) #274 — a host that passes no units keeps the reassign lever: unknown is not seatless', () => {
    render(<SteeringGate runId={RUN} ord={3} prompt={ESCALATION_PROMPT} clis={POOL} />);
    expect(screen.getByTestId('steering-prompt')).toHaveTextContent(CAUSE);
    expect(screen.getByTestId('steering-reassign-row')).toBeInTheDocument();
    expect(screen.getByTestId('steering-approve')).toHaveTextContent('Approve');
    expect(screen.getByTestId('steering-approve').textContent).not.toMatch(/retry on/);
  });

  it('(c) #274 — units known but the failed ord not among them is unknown too: the lever stays', () => {
    render(<SteeringGate runId={RUN} ord={3} prompt={ESCALATION_PROMPT} units={SEATLESS_UNITS.filter((u) => u.ord !== 3)} clis={POOL} />);
    expect(screen.getByTestId('steering-reassign-row')).toBeInTheDocument();
    expect(screen.getByTestId('steering-approve').textContent).not.toMatch(/retry on/);
  });

  it('a genuine trailing footnote keeps its leading bracket (cleanPrompt hardening)', () => {
    const ARCHITECTURAL = 'Approve unit 3 before it runs: build — the plan [auto-routed to codex by the governance gate]';
    useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 3, prompt: ARCHITECTURAL, lifecycle: 'open', receivedAt: 1 } } });
    render(<SteeringGate runId={RUN} ord={3} prompt={ARCHITECTURAL} units={SEATLESS_UNITS} clis={POOL} />);
    expect(screen.getByTestId('steering-prompt')).toHaveTextContent('Approve unit 3 before it runs: build — the plan');
    const summary = screen.getByText('why this gate fired');
    expect(summary).toBeInTheDocument();
    expect(summary.closest('details')!.textContent).toContain('[auto-routed to codex by the governance gate]');
  });
});
