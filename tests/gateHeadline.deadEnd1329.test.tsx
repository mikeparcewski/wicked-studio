/**
 * studio#1329: an escalation card never names a seat of the job as the one that "can review this instead" when the
 * engine's denial says no helper of this job can review the work (core#1719, the core#1677 seat rule). The headline then
 * comes from the denial: the helper outside the job the engine named, or that none of the job's helpers can.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { CoreEvent, SessionView } from '../src/api/types.js';
import { noDistinctReviewer } from '../src/board/assuranceModel.js';
import { gateCause } from '../src/board/gateHeadline.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { makeUnit, makeView } from './factories.js';

const RUN = '4b7303fb-5d77-5f5d-aa4f-230b0a78c721';
const ROSTER = [
  { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true, signed_in: true },
  { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, signed_in: true },
  { key: 'pi', display_name: 'Pi CLI', binary: 'pi', enabled_for_council: true, signed_in: true },
  { key: 'copilot', display_name: 'GitHub Copilot CLI', binary: 'copilot', enabled_for_council: true, signed_in: true },
];
/** The engine's denial as core writes it: `EvaluatorRelation::denial` (core src/pipeline.rs, "unit {ord} ran on `{seat}`,
 *  {conflict}; the run requires a distinct evaluator (distinct_evaluator) — {next}") with core#1719's dead end as
 *  `next` (`no_distinct_reviewer`: "no distinct reviewer remains among this run's helpers (…), so a retry would run on
 *  `{seat}` again and be denied the same way: {outside}"). The run in the issue: unit 3 on pi, authors claude and codex. */
const deadEnd = (outside: string | null): string =>
  'unit 3 ran on `pi`, observed calling `api.anthropic.com:443`, the provider the work\'s author `claude`, `codex` called; '
  + 'the run requires a distinct evaluator (distinct_evaluator) — no distinct reviewer remains among this run\'s helpers '
  + '(`pi` calls a provider of the work\'s authors; seat `claude` authored the work; seat `codex` authored the work), so a retry '
  + 'would run on `pi` again and be denied the same way: '
  + (outside !== null
    ? `\`${outside}\` could review it, but it is not one of this run's helpers: start the job again with \`${outside}\` among its helpers, or relaunch with reduced assurance`
    : 'start the job again with a helper that calls another provider, or relaunch with reduced assurance');
/** The gate prompt as core writes it for a same-seat denial (core src/actor.rs, the `dead_seat` arm): the reason's first
 *  line cut at 240 characters (`reason_head`). The escalation's `verdictSummary` carries the whole reason. */
const head = (reason: string): string => (reason.length <= 240 ? reason : `${reason.slice(0, 240)}…`);
const prompt = (reason: string): string => `Unit 3 (pi) reviewed work built on its own seat: ${head(reason)}. Reassign the unit to a distinct seat (sign one in first if needed) and approve to retry, or reject to stop the run`;
/** Without the dead end (core: another seat could review it): the reassign words. */
const REASSIGN = 'unit 3 ran on `pi`, observed calling `api.anthropic.com:443`, the provider the work\'s author `claude` called; '
  + 'the run requires a distinct evaluator (distinct_evaluator) — reassign it to a distinct signed-in seat and approve to re-run, or relaunch with reduced assurance';

function view(): SessionView {
  return makeView({ id: RUN, status: 'awaiting_human', workflow_id: 'review-change', unit_ix: 3, clis: ['claude', 'codex', 'pi'] } as never, [
    // claude's part of the work is not a `creator` step studio counts (a scope step): only the engine knows it authored.
    makeUnit({ id: `${RUN}:scope`, session_id: RUN, ord: 1, assigned_cli: 'claude', role: 'neutral', status: 'done', stage: 'build' }),
    makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 2, assigned_cli: 'codex', role: 'creator', status: 'done', stage: 'build' }),
    makeUnit({ id: `${RUN}:semantic`, session_id: RUN, ord: 3, assigned_cli: 'pi', role: 'evaluator', status: 'rejected', stage: 'review' }),
  ]);
}
const events = (reason: string): CoreEvent[] => [
  { type: 'gateEscalated', session: RUN, ord: 3, condition: 'same_seat_evaluator', denialSource: 'same_seat_evaluator', verdictSummary: reason },
  { type: 'awaitingHuman', session: RUN, ord: 3, gateKind: 'escalation', prompt: prompt(reason), ts: 1 },
] as unknown as CoreEvent[];
const gate = (reason: string): OpenGate => ({ runId: RUN, ord: 3, prompt: prompt(reason), lifecycle: 'open', receivedAt: Date.now(), gateKind: 'escalation' });

beforeEach(() => {
  setCachedRoster(ROSTER as never);
  useGateStore.setState({ gates: {} });
});
afterEach(() => { cleanup(); clearCachedRoster(); vi.restoreAllMocks(); });

describe('studio#1329: the engine ruled out every helper of the job', () => {
  it('reads the dead end and the outside helper the engine named', () => {
    expect(noDistinctReviewer(events(deadEnd('copilot')), 3, prompt(deadEnd('copilot')))).toEqual({ outside: 'copilot' });
    expect(noDistinctReviewer(events(deadEnd(null)), 3, prompt(deadEnd(null)))).toEqual({ outside: null });
    expect(noDistinctReviewer(events(REASSIGN), 3, prompt(REASSIGN))).toBeNull();
  });

  it('the headline never names a seat of the job; it names the outside helper the engine named', () => {
    const reason = deadEnd('copilot');
    const c = gateCause({ view: view(), gate: gate(reason), events: events(reason), model: { choices: [], overflow: [], recommended: null } as never, roster: ROSTER as never });
    expect(c.seatRefusal).toBe(true);
    expect(c.judges?.inJob).toBeUndefined();
    expect(c.judges?.outside?.key).toBe('copilot');
    expect(c.headline).toBe('GitHub Copilot CLI could review this, but isn’t one of this job’s helpers');
  });

  it('with no outside helper named, it says none of the job’s helpers can; never "Claude Code can review this instead"', () => {
    const reason = deadEnd(null);
    const c = gateCause({ view: view(), gate: gate(reason), events: events(reason), model: { choices: [], overflow: [], recommended: null } as never, roster: ROSTER as never });
    expect(c.judges?.inJob).toBeUndefined();
    expect(c.judges?.outside).toBeUndefined();
    expect(c.noneInJob).toBe(true);
    expect(c.headline).toBe('None of this job’s helpers can review this independently');
  });

  it('without the dead end, a seat of the job studio finds free is still offered (the reassign words)', () => {
    const c = gateCause({ view: view(), gate: gate(REASSIGN), events: events(REASSIGN), model: { choices: [], overflow: [], recommended: null } as never, roster: ROSTER as never });
    expect(c.noneInJob).toBe(false);
    expect(c.judges?.inJob?.cli).toBe('claude');
  });

  it('the card: the denial’s headline, Start again with the named helper, and no Approve and retry with a job seat', async () => {
    const reason = deadEnd('copilot');
    useRunEventStore.setState({ byRun: { [RUN]: events(reason) } });
    render(<GateRow view={view()} gate={gate(reason)} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('session-gate-question').textContent).toBe('GitHub Copilot CLI could review this, but isn’t one of this job’s helpers'));
    expect(screen.getByTestId('session-gate-lead-act').textContent).toBe('Start again with GitHub Copilot CLI…');
    expect(screen.queryAllByTestId('session-gate-choice').some((b) => /Approve and retry with/.test(b.textContent ?? ''))).toBe(false);
  });

  it('the card with no outside helper: no sign-in lead, and the explanation never says to sign one in or hand it over', async () => {
    const reason = deadEnd(null);
    useRunEventStore.setState({ byRun: { [RUN]: events(reason) } });
    render(<GateRow view={view()} gate={gate(reason)} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('session-gate-question').textContent).toBe('None of this job’s helpers can review this independently'));
    expect(screen.queryByTestId('session-gate-lead-act')).toBeNull();
    const why = screen.getByTestId('session-gate-creator-seat').textContent ?? '';
    expect(why).toContain('none of its helpers can give one');
    expect(why).not.toMatch(/second signed-in helper|sign a second helper in/);
    expect(screen.queryByTestId('session-gate-creator-seat-nocap')).toBeNull();
  });

  it('review r1: an earlier attempt’s dead end never rules out the job’s helpers for the current attempt', () => {
    // Attempt 1 ended in the dead end; the step was dispatched again and its gate now is the plain reassign denial.
    const log = [
      ...events(deadEnd('copilot')),
      { type: 'unitDispatched', session: RUN, ord: 3, attempt: 2 },
      { type: 'awaitingHuman', session: RUN, ord: 3, gateKind: 'escalation', prompt: prompt(REASSIGN), ts: 2 },
    ] as unknown as CoreEvent[];
    expect(noDistinctReviewer(log, 3, prompt(REASSIGN))).toBeNull();
    const c = gateCause({ view: view(), gate: gate(REASSIGN), events: log, model: { choices: [], overflow: [], recommended: null } as never, roster: ROSTER as never });
    expect(c.noneInJob).toBe(false);
  });

  it('review r1: the gate prompt (cut at 240 characters by the engine) is read only without an escalation of this attempt', () => {
    // The cut keeps the dead end and loses the outside helper's name: the card names none rather than guess.
    expect(noDistinctReviewer([], 3, prompt(deadEnd('copilot')))).toEqual({ outside: null });
  });

  it('review r1: the outside helper the engine named is offered only while the roster says it can work', () => {
    const reason = deadEnd('copilot');
    const inactive = ROSTER.map((r) => (r.key === 'copilot' ? { ...r, health: { status: 'inactive' } } : r));
    const c = gateCause({ view: view(), gate: gate(reason), events: events(reason), model: { choices: [], overflow: [], recommended: null } as never, roster: inactive as never });
    expect(c.judges?.outside).toBeUndefined();
    expect(c.headline).toBe('None of this job’s helpers can review this independently');
  });
});
