/**
 * rig 0.15.8 (2026-10-25): the gate and run cards said what was not so.
 *
 *  1. A floor the operator overrode read green "Accepted: the checks this run had to pass have passed" on the
 *     deliver card, and "Passed" in the side panel — over a test check that FAILED. It now says
 *     "Overridden by you: <check> failed on this change and its base", in the overridden style.
 *  2. Where the engine names the override as the way through (a red base it cannot separate from the change),
 *     the card suggested "Retry this step with a note" / "Fix with a note". It now suggests the override.
 *  3. The failing tests were only under Technical details. The face now names up to five, "+N more".
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { flushDecisionsForTest, resetDecisionsForTest } from '../src/board/undoQueue.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent, RunAcceptanceSummary, SessionView, WorkUnit } from '../src/api/types.js';
import { deliveryReceiptOf, receiptOf } from '../src/board/assuranceModel.js';
import type { ChainModel } from '../src/board/chainModel.js';
import { deliverAcceptance } from '../src/board/checkState.js';
import { failingLine, failingOnFace, failureName, overriddenFloorsOf, overriddenLine } from '../src/board/failingChecks.js';
import { FLOOR_OVERRIDE_CONSEQUENCE, FLOOR_OVERRIDE_KEY, engineNamesFloorOverride, floorOverrideOf } from '../src/board/floorOverride.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { finalWords } from '../src/board/runConversation.js';
import { floorOf } from '../src/components/gateVerdictModel.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { ProposalCard } from '../src/components/session/ProposalCard.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { makeUnit, makeView } from './factories.js';
import { DELIVER_REVERIFY_FAILED_TAIL, REFUSAL_REVERIFY_FAILED } from './fixtures/wire433.js';
import { GATE_RUN } from './fixtures/gateEvidence.js';

const RUN = 'r-rig0158';
const NOW = 1_700_000_000_000;
const ACCEPTED = 'Accepted: the checks this run had to pass have passed.';
const SATISFIED: RunAcceptanceSummary = { required: true, satisfied: true, walkthrough: null, line: ACCEPTED };

/** The 8 failing ids the rig's verify floor printed (pytest's `FAILED <id> - <message>` lines). */
const IDS = [
  'FAILED tests/core/test_inventory_report_codebook.py::test_its_frontmatter_parses_strictly - ModuleNotFoundError',
  'FAILED tests/mem/test_decision_report_codebook.py::test_its_frontmatter_parses_strictly',
  'FAILED tests/test_codex_plugin_manifest.py::test_non_string_name_or_description_fails[name-[invalid, list]]',
  'FAILED tests/test_codex_plugin_manifest.py::test_non_string_name_or_description_fails[name-42]',
  'FAILED tests/test_codex_plugin_manifest.py::test_non_string_name_or_description_fails[description-[invalid, list]]',
  'FAILED tests/test_codex_plugin_manifest.py::test_non_string_name_or_description_fails[description-42]',
  'FAILED tests/test_validate_core_closure.py::test_dangling3',
  'FAILED tests/test_launcher.py::test_twins_are_present',
];

const testCheck = (over: Record<string, unknown> = {}) => ({
  name: 'test', argv: ['node', 'scripts/ci/run_pytest.js'], source: '.wicked/checks.json test', exitCode: 1, timedOut: false,
  spawnError: null, durationMs: 311_000, stdoutTail: '8 failed, 2338 passed', stderrTail: '', classification: 'base_red_unseparated',
  preExisting: [], regressions: [], failureIds: IDS,
  base: { head: '7bc892d1', cached: true, error: null, run: { name: 'test', exitCode: 1, timedOut: false, spawnError: null } },
  ...over,
});
const floorEvent = (ord: number, attempt: number, check = testCheck()) => ({
  type: 'repoChecksEvaluated', session: RUN, ord, attempt, passed: false, criterion: 'the repository\'s own checks pass', skipped: [],
  checks: [{ name: 'install', argv: ['npm', 'ci'], source: 'package-lock.json', exitCode: 0, timedOut: false, spawnError: null, durationMs: 1400, stdoutTail: '', stderrTail: '', classification: null, preExisting: [], regressions: [], failureIds: [], base: null }, check],
});

/** The engine's prompt at a base-red floor: the override clause right before its closer. */
const SUMMARY = 'repo checks floor failed: test: exit 1 (313.0s) [base_red_unseparated: base red, cannot separate: exclusion disabled (WICKED_FLOOR_EXCLUDE)] — the run base 7bc892d156 fails this check too, and its failures cannot be told apart from the head\'s: escalated with both logs — the operator\'s floor override is the path through';
const PROMPT =
  `Unit 2 failed its deterministic floor (repo_checks): ${SUMMARY} — confirm to retry the phase, judge it yourself with a written `
  + 'rationale when the evidence shows the failures are not the work\'s (action `operator_judgment`: it overrides the failed floor, '
  + 'labelled "floor overridden by operator" on the run and the delivery; every other layer still denies and QE acceptance is still '
  + 'required), or reject to cancel the run';

describe('3. the failing tests, on the face', () => {
  it('names the tests without the runner\'s status word or message', () => {
    expect(failureName(IDS[0]!)).toBe('tests/core/test_inventory_report_codebook.py::test_its_frontmatter_parses_strictly');
    expect(failureName('FAIL src/a.test.ts > adds')).toBe('src/a.test.ts > adds');
    // a " - " inside another runner's test name is part of the name (pr-xreview #899)
    expect(failureName('FAIL src/gate.test.ts > GateRow - red base > names tests')).toBe('src/gate.test.ts > GateRow - red base > names tests');
  });
  it('names up to five, then "+N more"; a check whose runner named none is named itself', () => {
    const f = failingOnFace(floorOf(floorEvent(2, 0) as unknown as CoreEvent))!;
    expect(f.names).toHaveLength(5);
    expect(f.more).toBe(3);
    expect(failingLine(f)).toBe(`Failing: ${IDS.slice(0, 5).map(failureName).join(', ')} +3 more`);
    const bare = failingOnFace(floorOf(floorEvent(2, 0, testCheck({ failureIds: [] })) as unknown as CoreEvent))!;
    expect(failingLine(bare)).toBe('Failing: the test check');
    expect(failingOnFace(floorOf({ ...floorEvent(2, 0), passed: true, checks: [] } as unknown as CoreEvent))).toBeNull();
  });
});

const UNITS: WorkUnit[] = [
  makeUnit({ id: `${RUN}:triage`, session_id: RUN, ord: 1, role: 'neutral', status: 'done', stage: 'recon', assigned_cli: 'codex' }),
  makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 2, role: 'creator', status: 'rejected', stage: 'build', assigned_cli: 'claude' }),
];
const GATE_EVENTS = [
  { type: 'unitDispatched', session: RUN, ord: 2, attempt: 3 },
  floorEvent(2, 3),
  { type: 'gateEvaluated', session: RUN, ord: 2, combined: false, denial: { source: 'repo_checks', reason: SUMMARY, claimId: null, ruleIds: [], deniedTool: null, phase: 'fix' }, denialReason: SUMMARY, hasDeterministicFloor: true, deterministicPass: false, agentVerdict: 'pass', judgeCli: 'codex', judgeDistinct: true, evaluatorPolicies: [] },
  { type: 'gateEscalated', session: RUN, ord: 2, attempt: 3, condition: 'floor_failed', denialSource: 'repo_checks', verdictSummary: SUMMARY },
  { type: 'awaitingHuman', session: RUN, ord: 2, prompt: PROMPT, gateKind: 'escalation' },
] as unknown as CoreEvent[];
const gate = (prompt = PROMPT): OpenGate => ({ runId: RUN, ord: 2, prompt, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' });
const model = (events = GATE_EVENTS, prompt = PROMPT) =>
  sessionGateChoices({ runId: RUN, gate: gate(prompt), units: UNITS, events, pool: ['codex', 'claude'], roster: null, rerun: null, fullVerdict: null, rejudge: null })!;

describe('2. the suggested action is the one the engine names', () => {
  it('a red base the engine cannot separate: the override is suggested, with its consequence', () => {
    const m = model();
    expect(m.choices[m.recommended!]!.key).toBe(FLOOR_OVERRIDE_KEY);
    expect(m.consequence).toBe(FLOOR_OVERRIDE_CONSEQUENCE);
    expect(m.choices.map((c) => c.label)).toContain('Retry this step with a note');
  });
  it('the engine\'s own words name it even when the floor record is not in hand — unless they name a regression too', () => {
    expect(engineNamesFloorOverride({ floor: null, denial: { reason: SUMMARY } })).toBe(true);
    expect(engineNamesFloorOverride({ floor: null, denial: { reason: `lint: exit 1 [regression] — ${SUMMARY}` } })).toBe(false);
    expect(engineNamesFloorOverride({ floor: { checks: [{ classification: 'regression', regressions: ['x'], exitCode: 1 }] }, denial: { reason: 'test: exit 1' } })).toBe(false);
  });
  it('a floor that also holds a regression is never suggested away (pr-xreview #899)', () => {
    const mixed = GATE_EVENTS.map((e) => {
      const r = e as unknown as Record<string, unknown>;
      if (r['type'] !== 'repoChecksEvaluated') return e;
      const f = floorEvent(2, 3) as unknown as { checks: unknown[] };
      return { ...f, checks: [...f.checks, { ...testCheck({ name: 'lint', classification: 'regression', regressions: ['src/a.ts: no-explicit-any'], failureIds: [] }) }] } as unknown as CoreEvent;
    });
    const m = model(mixed);
    expect(m.choices.some((c) => c.key === FLOOR_OVERRIDE_KEY)).toBe(true);
    expect(m.recommended === null ? null : m.choices[m.recommended]!.key).not.toBe(FLOOR_OVERRIDE_KEY);
    expect(m.consequence).not.toBe(FLOOR_OVERRIDE_CONSEQUENCE);
  });
  it('a regression is not suggested away: the override is offered, never suggested', () => {
    const plain = 'repo checks floor failed: test: exit 1 [regression]';
    const prompt = PROMPT.replace(SUMMARY, plain);
    const events = GATE_EVENTS.map((e) => {
      const r = e as unknown as Record<string, unknown>;
      if (r['type'] === 'repoChecksEvaluated') return floorEvent(2, 3, testCheck({ classification: 'regression', regressions: ['x'] })) as unknown as CoreEvent;
      if (r['type'] === 'gateEvaluated') return { ...r, denial: { source: 'repo_checks', reason: plain }, denialReason: plain } as unknown as CoreEvent;
      if (r['type'] === 'gateEscalated') return { ...r, verdictSummary: plain } as unknown as CoreEvent;
      if (r['type'] === 'awaitingHuman') return { ...r, prompt } as unknown as CoreEvent;
      return e;
    });
    const m = model(events, prompt);
    expect(m.choices.some((c) => c.key === FLOOR_OVERRIDE_KEY)).toBe(true);
    expect(m.recommended === null ? null : m.choices[m.recommended]!.key).not.toBe(FLOOR_OVERRIDE_KEY);
  });
  it('the model names the gate\'s failing tests', () => {
    expect(model().failingTests).toEqual({ names: IDS.slice(0, 5).map(failureName), more: 3 });
  });
  it('a refused hand-over names what its own re-verify failed (no gate verdict there; pr-xreview #899)', () => {
    const units: WorkUnit[] = [
      makeUnit({ id: `${GATE_RUN}:build`, session_id: GATE_RUN, ord: 4, role: 'creator', status: 'done', stage: 'build' }),
      makeUnit({ id: `${GATE_RUN}:deliver`, session_id: GATE_RUN, ord: 5, description: 'deliver', stage: 'build', phase_ref: 'deliver', status: 'rejected' }),
    ];
    const g: OpenGate = { runId: GATE_RUN, ord: 5, prompt: `The deliver phase refused: ${REFUSAL_REVERIFY_FAILED}. Approve to re-run the deliver phase now (the engine re-lifts and re-verifies first; no second deliver gate), reject to cancel the run and keep the worktree.`, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };
    const m = sessionGateChoices({ runId: GATE_RUN, gate: g, units, events: DELIVER_REVERIFY_FAILED_TAIL, pool: [], roster: null })!;
    expect(m.refusal).toBeDefined();
    expect(m.failingTests).toEqual({ names: ['the lint check'], more: 0 });
  });
});

describe('2 + 3 on the rendered row', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: { [RUN]: gate() } });
    useGateActionStore.setState({ byGate: {} });
    useRunEventStore.setState({ byRun: { [RUN]: GATE_EVENTS } });
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '' } as never);
    vi.spyOn(client.api, 'getGate').mockResolvedValue({ runId: RUN, ord: 2, prompt: PROMPT, lifecycle: 'open', receivedAt: '' } as never);
  });
  afterEach(() => cleanup());

  it('the face names the failing tests and marks the override suggested', async () => {
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human', clis: ['codex', 'claude'] } as never, UNITS)} gate={gate()} navigate={vi.fn()} />);
    const failing = await screen.findByTestId('session-gate-failing');
    expect(failing.textContent).toBe(`Failing: ${IDS.slice(0, 5).map(failureName).join(', ')} +3 more`);
    const suggested = screen.getAllByTestId('session-gate-choice').find((b) => b.dataset['recommended'] === 'true')!;
    expect(suggested.dataset['choiceKey']).toBe(FLOOR_OVERRIDE_KEY);
    expect(screen.getByTestId('session-gate-consequence').textContent).toBe(FLOOR_OVERRIDE_CONSEQUENCE);
  });
});

/** The rig's run at its deliver gate: the fix floor (unit 2, attempt 3) failed on a red base and the operator overrode it. */
const OVERRIDE = {
  at: 1, by: 'local (human)', note: 'every head failure is a base failure', reason: SUMMARY,
  floorOverride: { attempt: 3, label: 'floor overridden by operator', layer: 'repo_checks', ord: 2, resultId: `${RUN}:unit-2:attempt-3:repo_checks`, tree: 'abc' },
};
const DELIVER_UNITS: WorkUnit[] = [
  makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 2, role: 'creator', status: 'done', stage: 'build', assigned_cli: 'claude' }),
  makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 3, stage: 'build', phase_ref: 'deliver', role: 'neutral', status: 'pending' }),
];
function deliverView(status = 'awaiting_human', over: Record<string, unknown> = {}): SessionView {
  const v = makeView({ id: RUN, status } as never, DELIVER_UNITS);
  Object.assign(v.session as object, { assurance: { mode: 'full', required: ['judge', 'qe_acceptance'], floorOverrides: [OVERRIDE] }, ...over });
  return v;
}
const DELIVER_EVENTS = [
  { type: 'unitDispatched', session: RUN, ord: 2, attempt: 3 },
  floorEvent(2, 3),
  { type: 'gateEvaluated', session: RUN, ord: 2, combined: false, denial: { source: 'repo_checks', reason: SUMMARY }, hasDeterministicFloor: true, deterministicPass: false, agentVerdict: 'pass', judgeCli: 'codex', judgeDistinct: true, evaluatorPolicies: [],
    assurance: { mode: 'full', required: ['judge', 'qe_acceptance'], ran: ['repo_checks', 'judge'], skipped: [], creator: 'claude', evaluator: null, judge: 'codex', tree: 'abc', attempt: 3 } },
] as unknown as CoreEvent[];

describe('1. a floor the operator overrode is never "passed"', () => {
  it('reads the overridden floor\'s failed checks off its own record, and whether the base failed too', () => {
    const r = deliveryReceiptOf(deliverView(), DELIVER_EVENTS);
    const o = overriddenFloorsOf(r, DELIVER_EVENTS)!;
    expect(o).toEqual({ checks: ['test'], onBase: true });
    expect(overriddenLine(o)).toBe('Overridden by you: test failed on this change and its base.');
    // a regression the operator overrode is the change's own: no "and its base"
    const reg = [DELIVER_EVENTS[0]!, floorEvent(2, 3, testCheck({ classification: 'regression', regressions: ['x'], base: { run: { exitCode: 0 } } })) as unknown as CoreEvent];
    expect(overriddenLine(overriddenFloorsOf(r, reg)!)).toBe('Overridden by you: test failed on this change.');
    // no floor record in hand: the override is said, and nothing is claimed about the base
    expect(overriddenLine(overriddenFloorsOf(receiptOf({ mode: 'full', required: [], operatorJudges: [OVERRIDE] }), [])!)).toBe('Overridden by you: the repository checks failed on this change.');
  });
  it('the override\'s unit and attempt come off the wire, else its result id', () => {
    expect(floorOverrideOf({ resultId: 'r:unit-7:attempt-0:repo_checks' })).toMatchObject({ ord: 7, attempt: 0 });
    expect(floorOverrideOf({ resultId: 'x', ord: 5, attempt: 3 })).toMatchObject({ ord: 5, attempt: 3 });
    expect(floorOverrideOf({ resultId: '' })).toMatchObject({ ord: null, attempt: null });
  });
  it('the acceptance line says the override in the overridden tone; crew\'s line goes behind Technical details', () => {
    expect(deliverAcceptance(SATISFIED, null, true, { checks: ['test'], onBase: true })).toEqual({
      text: 'Overridden by you: test failed on this change and its base.', tone: 'overridden', detail: ACCEPTED,
    });
    // QE acceptance not passed yet still leads: crew refuses the delivery then
    expect(deliverAcceptance({ ...SATISFIED, satisfied: false, line: 'Not accepted yet' }, null, true, { checks: ['test'], onBase: true })?.blocksDeliver).toBe(true);
    // ... and so does any required acceptance not satisfied, required by the run or not (pr-xreview #899)
    expect(deliverAcceptance({ ...SATISFIED, satisfied: false, line: 'Not accepted yet: the walkthrough failed in chapter 4.' }, null, false, { checks: ['test'], onBase: true }))
      .toEqual({ text: 'Not accepted yet: the walkthrough failed in chapter 4.', tone: 'bad' });
    // no override: crew's line as before
    expect(deliverAcceptance(SATISFIED, null, true, null)).toEqual({ text: ACCEPTED, tone: 'ok' });
  });
  it('the final message says the override, never "The checks passed"', () => {
    const v = deliverView('completed', { delivery: 'delivered', deliverUrl: 'https://github.com/o/r/pull/7' });
    const w = finalWords(v, { done: 3, total: 3 }, { passed: true, tests: null, nothing: false, reviewers: ['Codex'], overridden: 'Overridden by you: test failed on this change and its base.' });
    expect(w.line).toBe('Overridden by you: test failed on this change and its base. Reviewed and approved by Codex. Pull request #7 is open.');
    expect(w.line).not.toContain('The checks passed');
    // an override never hides checks that did not pass
    const failed = finalWords(v, { done: 3, total: 3 }, { passed: false, tests: null, nothing: false, reviewers: [], overridden: 'Overridden by you: test failed on this change and its base.' });
    expect(failed.line).toBe('Overridden by you: test failed on this change and its base. The checks did not pass. Pull request #7 is open.');
  });
});

describe('1 on the rendered deliver card', () => {
  const CHAIN: ChainModel = { source: 'units', steps: [], proposed: false, transportLine: null, done: 0, total: 0, checked: null };
  const deliverGate: OpenGate = { runId: RUN, ord: 3, prompt: 'deliver: push the run branch and open a PR on origin — confirm to deliver, reject to keep it local', lifecycle: 'open', receivedAt: NOW, gateKind: 'deliver' };
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: { [RUN]: deliverGate } });
    useGateActionStore.setState({ byGate: {} });
    useRunEventStore.setState({ byRun: { [RUN]: DELIVER_EVENTS } });
    vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: DELIVER_EVENTS });
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  });
  afterEach(() => cleanup());

  it('"Overridden by you: test failed on this change and its base", never green "passed"', () => {
    render(<ProposalCard view={deliverView()} chain={CHAIN} acceptance={SATISFIED} />);
    const line = screen.getByTestId('session-proposal-acceptance');
    expect(line.dataset['tone']).toBe('overridden');
    expect(line.className).toContain('wk-prop-accept--overridden');
    expect(line.textContent).toBe('Overridden by you: test failed on this change and its base.');
    expect(line.textContent).not.toMatch(/passed/i);
    expect(screen.getByTestId('session-proposal-acceptance-detail').textContent).toContain(ACCEPTED);
  });
});

describe('studio#923: a hand-over QE refused takes the skip in place', () => {
  const CHAIN: ChainModel = { source: 'units', steps: [], proposed: false, transportLine: null, done: 0, total: 0, checked: null };
  const deliverGate: OpenGate = { runId: RUN, ord: 3, prompt: 'Approve delivery before unit 3 runs.', lifecycle: 'open', receivedAt: NOW, gateKind: 'deliver' };
  const REFUSED: RunAcceptanceSummary = { required: true, satisfied: false, walkthrough: null, line: 'QE acceptance did not pass' };
  beforeEach(() => {
    vi.restoreAllMocks();
    resetDecisionsForTest();
    useGateStore.setState({ gates: { [RUN]: deliverGate } });
    useGateActionStore.setState({ byGate: {} });
    useRunEventStore.setState({ byRun: { [RUN]: [] } });
    vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] });
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  });
  afterEach(() => cleanup());

  it('Skip QE with a reason… opens a required reason here and answers the gate with skip_qe through the undo window', async () => {
    const confirm = vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ ok: true } as never);
    const view = makeView({ id: RUN, status: 'awaiting_human' } as never, DELIVER_UNITS);
    Object.assign(view.session as object, { assurance: { mode: 'full', required: ['qe_acceptance'], qe: { status: 'required', basis: 'diff', score: 100, threshold: 20, reason: 'required', reasons: [], ord: 2, tree: 'abc' } } });
    render(<ProposalCard view={view} chain={CHAIN} acceptance={REFUSED} />);
    expect(screen.getByTestId('session-proposal-text').textContent).toBe('QE hasn’t passed, so this can’t be delivered yet');
    // Starting the job over is still there, under Other options, named for what it does.
    fireEvent.click(screen.getByTestId('session-proposal-more'));
    expect(screen.getByTestId('session-proposal-relaunch-skip-qe').textContent).toBe('Start again with QE skipped…');
    fireEvent.click(screen.getByTestId('session-proposal-skip-qe'));
    const send = screen.getByTestId('session-proposal-skip-qe-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(screen.getByTestId('session-proposal-skip-qe-consequence').textContent).toMatch(/QE acceptance skipped by operator/);
    fireEvent.change(screen.getByTestId('session-proposal-skip-qe-reason'), { target: { value: 'The seats could not install deps; I ran the tests myself.' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await act(async () => { await flushDecisionsForTest(); });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![1]).toMatchObject({ approve: true, action: 'skip_qe', amend: 'The seats could not install deps; I ran the tests myself.', ord: 3 });
  });
});
