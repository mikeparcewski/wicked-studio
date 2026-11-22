/**
 * studio#1276: `failingSplit` skips a failed check whose base passed only on its own re-run (`baseCleared`), which is
 * right for the "only with this change" count (run 9397a34b: 42 "regressions" against a base that cleared on retry).
 * But that check's failing tests then sat in neither list, so the split showed fewer failures than the floor and said
 * nothing about why. They are now a third group, `unplaced`, said on the gate's face apart from both.
 *
 * Real shape: run 9397a34b's own `repoChecksEvaluated` frames (tests/fixtures/run-9397a34b-floors.json): attempt 1's
 * test check is the base-cleared one; attempt 0's test check (base_red_unseparated, base failures named) stands in as a
 * second failed check the engine did tell apart.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import { failedChecks, failingSplit, failureName } from '../src/board/failingChecks.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { floorOf } from '../src/components/gateVerdictModel.js';
import { allOnBaseWords, GateRow, unplacedWords } from '../src/components/session/GateRow.js';
import { namedSendBackNote } from '../src/board/gateRowModel.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { makeUnit, makeView } from './factories.js';

type Frame = Record<string, unknown> & { checks: Array<Record<string, unknown>> };
const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'run-9397a34b-floors.json'), 'utf8')) as { events: Frame[] };
const RUN = 'r-1276';
const cleared = fx.events.find((e) => e['ord'] === 2 && e['attempt'] === 1)!;
const told = fx.events.find((e) => e['ord'] === 2 && e['attempt'] === 0)!;
const testOf = (e: Frame): Record<string, unknown> => e.checks.find((c) => c['name'] === 'test')!;

/** Attempt 1's frame with a second failed check: attempt 0's test check, as `typecheck`. */
const mixed: Frame = { ...cleared, session: RUN, checks: [...cleared.checks, { ...testOf(told), name: 'typecheck' }] };
/** A check's failing tests as the split reads them: its own run's and its re-runs'. */
const headOf = (e: Frame, name: string): string[] => {
  const c = failedChecks(floorOf(e as unknown as CoreEvent)).find((x) => x.name === name)!;
  return [...(c.failureIds ?? []), ...(c.rerunFailureIds ?? [])].map(failureName);
};

describe('a check whose base cleared on its re-run (studio#1276)', () => {
  it('the real frame reads as one: attempt 1’s test check is base-cleared', () => {
    const f = floorOf(cleared as unknown as CoreEvent);
    expect(failedChecks(f).map((c) => [c.name, c.baseCleared])).toEqual([['test', true]]);
  });

  it('its failing tests are placed apart, never counted as the change’s and never dropped', () => {
    const split = failingSplit(floorOf(mixed as unknown as CoreEvent))!;
    expect(split).not.toBeNull();
    const clearedIds = new Set(headOf(mixed, 'test'));
    const toldIds = new Set(headOf(mixed, 'typecheck'));
    expect(split.unplaced?.length ?? 0).toBeGreaterThan(0);
    // Every failure of the floor is in exactly one group.
    const groups = [split.fresh, split.onBase, split.unplaced ?? []];
    for (const id of new Set([...clearedIds, ...toldIds])) expect(groups.filter((g) => g.includes(id))).toHaveLength(1);
    // A test only the base-cleared check names is never "only with this change".
    for (const id of clearedIds) if (!toldIds.has(id)) expect(split.fresh).not.toContain(id);
    // The unplaced group holds nothing the told check placed.
    for (const id of split.unplaced!) expect(split.fresh.includes(id) || split.onBase.includes(id)).toBe(false);
  });

  it('a floor with no base-cleared check carries no unplaced group', () => {
    const only = { ...told, session: RUN };
    expect(failingSplit(floorOf(only as unknown as CoreEvent))!.unplaced).toBeUndefined();
  });

  it('a floor whose every failed check is base-cleared is a split too: nothing fresh, nothing on the base, all unplaced (xreview r1)', () => {
    const split = failingSplit(floorOf({ ...cleared, session: RUN } as unknown as CoreEvent))!;
    expect(split).not.toBeNull();
    expect(split.fresh).toEqual([]);
    expect(split.onBase).toEqual([]);
    expect(new Set(split.unplaced)).toEqual(new Set(headOf(cleared, 'test')));
  });

  it('says them in plain words, of the check (the record says the check failed on the base, not each test)', () => {
    expect(unplacedWords(1, true)).toBe('One more can’t be told apart from this change: the check failed on the base too, then passed there when run again.');
    expect(unplacedWords(3, false)).toBe('3 failures can’t be told apart from this change: the check failed on the base too, then passed there when run again.');
  });

  it('beside them, the base’s failures are never "all", and the send-back note never calls the rest the base’s', () => {
    expect(allOnBaseWords(2)).toBe('All 2 failures also fail on the base, so they aren’t caused by this change.');
    expect(allOnBaseWords(2, true)).toBe('2 failures also fail on the base, so they aren’t caused by this change.');
    expect(allOnBaseWords(1, true)).toBe('One failure also fails on the base, so it isn’t caused by this change.');
    expect(namedSendBackNote(['a'])).toBe('Fix only the test this change broke (the others fail on the base too): a');
    expect(namedSendBackNote(['a', 'b'], true)).toBe('Fix only the tests this change broke (the others fail on the base too, or can’t be told apart from this change): a, b');
  });
});

describe('on the gate’s face', () => {
  const UNITS: WorkUnit[] = [makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 2, role: 'creator', status: 'rejected', stage: 'build', assigned_cli: 'claude' })];
  const PROMPT = 'Unit 2 failed its deterministic floor (repo_checks): test: exit 1 — confirm to retry the phase, or reject to cancel the run';
  const gate: OpenGate = { runId: RUN, ord: 2, prompt: PROMPT, lifecycle: 'open', receivedAt: 1_700_000_000_000, gateKind: 'escalation' };
  const eventsWith = (floor: Frame): CoreEvent[] => [
    { type: 'unitDispatched', session: RUN, ord: 2, attempt: 1 },
    floor,
    { type: 'gateEvaluated', session: RUN, ord: 2, combined: false, denial: { source: 'repo_checks', reason: 'test: exit 1', claimId: null, ruleIds: [], deniedTool: null, phase: 'fix' }, denialReason: 'test: exit 1', hasDeterministicFloor: true, deterministicPass: false, agentVerdict: 'pass', judgeCli: 'codex', judgeDistinct: true, evaluatorPolicies: [] },
    { type: 'gateEscalated', session: RUN, ord: 2, attempt: 1, condition: 'floor_failed', denialSource: 'repo_checks', verdictSummary: 'test: exit 1' },
    { type: 'awaitingHuman', session: RUN, ord: 2, prompt: PROMPT, gateKind: 'escalation' },
  ] as unknown as CoreEvent[];
  const events = eventsWith(mixed);
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: { [RUN]: gate } });
    useGateActionStore.setState({ byGate: {} });
    useRunEventStore.setState({ byRun: { [RUN]: events } });
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '' } as never);
    vi.spyOn(client.api, 'getGate').mockResolvedValue({ runId: RUN, ord: 2, prompt: PROMPT, lifecycle: 'open', receivedAt: '' } as never);
  });
  afterEach(() => cleanup());

  it('names how many could not be told apart, folded, and lists them on request', async () => {
    const split = failingSplit(floorOf(mixed as unknown as CoreEvent))!;
    const n = split.unplaced!.length;
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human', clis: ['claude'] } as never, UNITS)} gate={gate} navigate={vi.fn()} />);
    const block = await screen.findByTestId('session-gate-failing-unplaced');
    expect(block.dataset['count']).toBe(String(n));
    expect(screen.getByTestId('session-gate-failing-unplaced-words').textContent).toBe(unplacedWords(n, split.fresh.length + split.onBase.length > 0));
    expect(block.querySelector('ul')).toBeNull();
    fireEvent.click(screen.getByTestId('session-gate-failing-unplaced-toggle'));
    expect(block.querySelectorAll('li')).toHaveLength(n);
  });

  it('a floor of base-cleared checks only: no "every failure on the base" headline, no "all" words, the group said', async () => {
    const alone = { ...cleared, session: RUN } as Frame;
    useRunEventStore.setState({ byRun: { [RUN]: eventsWith(alone) } });
    const n = failingSplit(floorOf(alone as unknown as CoreEvent))!.unplaced!.length;
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human', clis: ['claude'] } as never, UNITS)} gate={gate} navigate={vi.fn()} />);
    expect((await screen.findByTestId('session-gate-question')).textContent).toBe('No failing test is known to be this change’s alone');
    expect(screen.getByTestId('session-gate-failing-unplaced-words').textContent).toBe(unplacedWords(n, false));
    expect(screen.queryByTestId('session-gate-failing-words')).toBeNull();
    expect(screen.getByTestId('session-gate-failing-split').textContent).not.toMatch(/fail on the base|fails on the base/u);
  });
});
