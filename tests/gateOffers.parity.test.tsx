/**
 * studio#1102: for each gate kind the engine raises, the card's actions equal the gate's actions.
 *
 * The right-hand side of every comparison is the gate's list as the ENGINE wrote it, recorded per case from its
 * own words (`choices` on the wire, `GateInfo.skipQe`, the options clause of a refusal prompt) — never from the
 * code under test. The left-hand side is what the card submits: the wire token of each decision it draws,
 * inline and in its overflow, through `GateRow`'s model and through `ProposalCard`'s rendered ways.
 * Client-side moves that answer nothing (Run QE again, Not now, Edit, Drop, Start again) are not answers.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import type { ChainModel } from '../src/board/chainModel.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { gateFromInfo, useGateStore, type OpenGate } from '../src/store/gates.js';
import { offerActions, refusalOffers } from '../src/board/gateOffers.js';
import { offersDeliverFloorOverride } from '../src/board/floorOverride.js';
import { deliverRefusalOf } from '../src/components/gateMoveModel.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { ProposalCard } from '../src/components/session/ProposalCard.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { flushDecisionsForTest, resetDecisionsForTest, setUndoWindowForTest } from '../src/board/undoQueue.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-1102';
const NOW = 1_700_000_000_000;
const sorted = (xs: string[]): string[] => [...new Set(xs)].sort();

const UNITS: WorkUnit[] = [
  makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 1, role: 'creator', status: 'done', stage: 'build', assigned_cli: 'claude' }),
  makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 2, role: 'evaluator', status: 'pending', stage: 'review', assigned_cli: 'codex' }),
  makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 3, stage: 'build', phase_ref: 'deliver', role: 'neutral', status: 'pending' }),
];

/** The wire token a decision sends: its `action`, else approve / reject. */
const tokenOf = (d: unknown): string => {
  const x = d as { approve?: boolean; action?: string };
  return x.action ?? (x.approve === true ? 'approve' : 'reject');
};

// The engine's refusal options (wicked-core `deliver_refusal_prompt`), written out here, not imported.
const OPTIONS = 'Approve to re-run the deliver phase now (the engine re-lifts and re-verifies first; no second deliver gate), ';
const JUDGMENT = 'judge it yourself with a written rationale when the evidence shows the failures are not the work\'s (action `operator_judgment`: it overrides the failed floor, labelled "floor overridden by operator" on the run and the delivery; every other layer still denies and QE acceptance is still required), ';
const CLOSE = 'or reject to cancel the run and keep the worktree.';

const gateOf = (over: Partial<OpenGate> & { prompt: string }): OpenGate => ({ runId: RUN, ord: 2, lifecycle: 'open', receivedAt: NOW, ...over });
const rowActions = (gate: OpenGate): string[] | null => {
  const m = sessionGateChoices({ runId: RUN, gate, units: UNITS, events: [], pool: [], roster: null });
  return m === null ? null : sorted([...m.choices, ...m.overflow].filter((c) => c.decision !== null).map((c) => tokenOf(c.decision)));
};

describe('GateRow: the row\'s actions equal the gate\'s list', () => {
  const cases: { kind: string; gate: OpenGate; engine: string[] }[] = [
    { kind: 'team_dispute', gate: gateOf({ gateKind: 'team_dispute', choices: ['approve', 'request_changes', 'reject'], prompt: 'Team dispute on unit 2: unresolved HIGH finding(s). Approve to continue, request changes to rework, or reject to cancel.' }), engine: ['approve', 'request_changes', 'reject'] },
    { kind: 'team_dispute (no send back)', gate: gateOf({ ord: 1, gateKind: 'team_dispute', choices: ['approve', 'reject'], prompt: 'Team dispute on unit 1' }), engine: ['approve', 'reject'] },
    { kind: 'review_adjudication', gate: gateOf({ gateKind: 'review_adjudication', choices: ['approve', 'request_changes', 'reject'], prompt: 'The reviewers disagree. Approve, request changes or reject.' }), engine: ['approve', 'request_changes', 'reject'] },
    { kind: 'consent', gate: gateOf({ ord: 9, gateKind: 'consent', prompt: 'Install the MCP server before unit 9 runs? Approve to give consent, reject to decline.' }), engine: ['approve', 'reject'] },
    { kind: 'repeat', gate: gateOf({ ord: 11, gateKind: 'repeat', choices: ['consent:continue', 'consent:lower', 'reject'], prompt: 'Mapping … budget reached' }), engine: ['consent:continue', 'consent:lower', 'reject'] },
    { kind: 'free text', gate: gateOf({ choices: null, prompt: 'Which branch should this target?' }), engine: ['approve'] },
    { kind: 'deliver refusal, no lift', gate: gateOf({ ord: 3, gateKind: 'escalation', prompt: 'The deliver phase refused: deliver: the remote refused the push. ' + OPTIONS + CLOSE }), engine: ['approve', 'reject'] },
    { kind: 'deliver refusal, after a lift', gate: gateOf({ ord: 3, gateKind: 'escalation', prompt: 'The deliver phase refused: deliver: the lift changed the tree, and the repository\'s own checks FAILED on it: test: exit 1. ' + OPTIONS + JUDGMENT + CLOSE }), engine: ['approve', 'operator_judgment', 'reject'] },
    { kind: 'deliver refusal, after a lift, retry reworded', gate: gateOf({ ord: 3, gateKind: 'escalation', prompt: 'The deliver phase refused: deliver: the lift changed the tree, and the repository\'s own checks FAILED on it: test: exit 1. Approve to re-run the deliver phase now (the engine re-checks the lifted tree), ' + JUDGMENT + CLOSE }), engine: ['approve', 'operator_judgment', 'reject'] },
    { kind: 'deliver refusal, QE-refused hand-over with skipQe', gate: gateOf({ ord: 3, gateKind: 'escalation', skipQe: { action: 'skip_qe', reasonRequired: true, actor: 'human_operator', label: 'QE acceptance skipped by operator', qeAcceptance: {} } as never, prompt: 'The deliver phase refused: deliver: QE acceptance did not pass. ' + OPTIONS + CLOSE }), engine: ['approve', 'skip_qe', 'reject'] },
    { kind: 'a clause quoted inside the refusal is no offer', gate: gateOf({ ord: 3, gateKind: 'escalation', prompt: 'The deliver phase refused: deliver: ' + OPTIONS + JUDGMENT + CLOSE + ' ' + OPTIONS + CLOSE }), engine: ['approve', 'reject'] },
  ];
  for (const c of cases) {
    it(c.kind, () => {
      // free text sends the operator's words (approve + a note); every other kind sends the listed tokens.
      expect(rowActions(c.gate)).toEqual(sorted(c.engine));
    });
  }

  it('live and reload read one list: a gate read keeps skipQe, a live frame has none', () => {
    const skipQe = { action: 'skip_qe', reasonRequired: true, actor: 'human_operator', label: 'QE acceptance skipped by operator', qeAcceptance: {} };
    const read = gateFromInfo({ runId: RUN, ord: 3, prompt: 'p', lifecycle: 'open', receivedAt: '2026-11-11T00:00:00Z', gateKind: 'deliver', skipQe } as never);
    expect(read.skipQe).toEqual(skipQe);
    expect(gateFromInfo({ runId: RUN, ord: 3, prompt: 'p', lifecycle: 'open', receivedAt: '2026-11-11T00:00:00Z' } as never).skipQe).toBeUndefined();
  });
});

describe('refused hand-over options after an earlier override (core#1114)', () => {
  const SAME_TREE = 'Approve to re-run the checks on this same tree (`f890f717e0`) now (the engine re-lifts and re-verifies first; no second deliver gate), ';
  const variants = [OPTIONS, SAME_TREE];

  it('keeps approve, operator judgment and reject when the lift changed the previously overridden tree', () => {
    const prompt = 'The deliver phase refused: deliver: test: exit 1. The tree changed since the floor was overridden (was `8c9499abff`, now `f890f717e0`); that earlier override covered `8c9499abff` only. ' + SAME_TREE + JUDGMENT + CLOSE;
    expect(offerActions(refusalOffers({ prompt }))).toEqual(['approve', 'operator_judgment', 'reject']);
    expect(offersDeliverFloorOverride(prompt)).toBe(true);
    expect(rowActions(gateOf({ ord: 3, gateKind: 'escalation', prompt }))).toEqual(sorted(['approve', 'operator_judgment', 'reject']));
  });

  for (const options of variants) {
    it(`ignores quoted action clauses before the last marker: ${options}`, () => {
      // The refusal detail may quote either variant, including its full options clause.
      for (const quoted of variants) {
        const prompt = 'The deliver phase refused: deliver: quoted: ' + quoted + JUDGMENT + CLOSE + ' ' + options + CLOSE;
        expect(offerActions(refusalOffers({ prompt }))).toEqual(['approve', 'reject']);
        expect(offersDeliverFloorOverride(prompt)).toBe(false);
        expect(rowActions(gateOf({ ord: 3, gateKind: 'escalation', prompt }))).toEqual(['approve', 'reject']);
      }
    });

    it(`keeps the refusal reason before the last options clause: ${options}`, () => {
      const prompt = 'The deliver phase refused: deliver: quoted: ' + OPTIONS + JUDGMENT + CLOSE + '\ndeliver: test: exit 1. ' + options + CLOSE;
      expect(deliverRefusalOf(prompt)?.reason).toBe('test: exit 1');
    });
  }
});

describe('ProposalCard: the card\'s answers equal the gate\'s list', () => {
  const CHAIN: ChainModel = { source: 'units', steps: [], proposed: false, transportLine: null, done: 0, total: 0, checked: null };
  const CLIENT_MOVES = new Set(['qe-again', 'relaunch', 'not-now', 'edit', 'drop']);
  const SKIP: OpenGate['skipQe'] = { action: 'skip_qe', reasonRequired: true, actor: 'human_operator', label: 'QE acceptance skipped by operator', qeAcceptance: {} } as never;
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateActionStore.setState({ byGate: {} });
    useRunEventStore.setState({ byRun: { [RUN]: [] } });
    vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] });
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
    vi.spyOn(client.api, 'getGate').mockRejectedValue(new Error('no read'));
  });
  afterEach(() => cleanup());

  const answers = (gate: OpenGate, refused: boolean | null, units = UNITS): string[] => {
    useGateStore.setState({ gates: { [RUN]: gate } });
    const view = makeView({ id: RUN, status: 'awaiting_human' } as never, units);
    Object.assign(view.session as object, { assurance: { mode: 'full', required: ['qe_acceptance'], qe: { status: 'required', basis: 'diff', score: 100, threshold: 20, reason: 'required', reasons: [], ord: 2, tree: 'abc' } } });
    const acceptance = refused ? { required: true, satisfied: false, walkthrough: null, line: 'QE acceptance did not pass' } : { required: true, satisfied: true, walkthrough: null, line: 'QE acceptance passed' };
    render(<ProposalCard view={view} chain={CHAIN} acceptance={refused === null ? null : acceptance as never} />);
    const group = screen.getByTestId('session-proposal-choices');
    return sorted([...group.querySelectorAll<HTMLElement>('[data-option]')].map((el) => el.dataset['option']!).filter((id) => !CLIENT_MOVES.has(id)).map((id) => (id === 'go' ? 'approve' : id === 'end' ? 'reject' : id === 'skip-qe' ? 'skip_qe' : id)));
  };

  it('plan_approval', () => {
    expect(answers(gateOf({ ord: 1, gateKind: 'plan_approval', prompt: 'Approve plan rev 1: build, review.' }), false)).toEqual(['approve', 'reject']);
  });
  it('deliver', () => {
    expect(answers(gateOf({ ord: 3, gateKind: 'deliver', prompt: 'Approve delivery before unit 3 runs.' }), false)).toEqual(['approve', 'reject']);
  });
  it('deliver, QE refused, crew\'s gate read carries skipQe', () => {
    const noRerun = UNITS.map((u) => ({ ...u, status: 'pending' as const }));
    expect(answers(gateOf({ ord: 3, gateKind: 'deliver', skipQe: SKIP!, prompt: 'Approve delivery before unit 3 runs.' }), true, noRerun)).toEqual(['approve', 'reject', 'skip_qe']);
    expect(screen.getByTestId('session-proposal-skip-qe')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('session-proposal-go')).toBeDisabled();
    expect(screen.getByTestId('session-proposal-primary')).toHaveTextContent('Skip QE with a reason…');
  });
  it('skip QE says its consequence once, including while its reason box is open', () => {
    answers(gateOf({ ord: 3, gateKind: 'deliver', skipQe: SKIP!, prompt: 'Approve delivery before unit 3 runs.' }), true);
    const line = screen.getByTestId('session-proposal-consequence');
    const selectedText = line.textContent;
    const selectedOption = line.getAttribute('data-option');
    fireEvent.mouseEnter(screen.getByTestId('session-proposal-not-now'));
    expect(line.textContent).toBe(selectedText);
    expect(line.getAttribute('data-option')).toBe(selectedOption);
    expect(screen.getByTestId('session-proposal-consequence-preview')).toHaveAttribute('data-option', 'not-now');
    expect(screen.getByTestId('session-proposal-consequence-preview')).toHaveTextContent(/^Preview: /);
    fireEvent.mouseLeave(screen.getByTestId('session-proposal-not-now'));
    expect(screen.getByTestId('session-proposal-consequence-preview')).toBeEmptyDOMElement();
    fireEvent.click(screen.getByTestId('session-proposal-skip-qe'));
    expect(line).toHaveTextContent('If you choose this: Delivers without a QE pass.');
    expect(line).toContainElement(screen.getByTestId('session-proposal-skip-qe-consequence'));
    expect(screen.getAllByText(/Delivers without a QE pass\./)).toHaveLength(1);
    expect(screen.queryByText('Preview:')).toBeNull();
  });
  it('deliver, QE refused, but the gate lists no skip: none is drawn', () => {
    expect(answers(gateOf({ ord: 3, gateKind: 'deliver', prompt: 'Approve delivery before unit 3 runs.' }), true)).toEqual(['approve', 'reject']);
  });
  for (const summary of [null, false] as const) {
    it(`deliver reads crew's skipQe offer and ${summary === null ? 'defers to it while acceptance is pending or failed' : 'keeps Deliver available when acceptance passed'}`, async () => {
      vi.mocked(client.api.getGate).mockResolvedValue({ runId: RUN, ord: 3, prompt: 'Deliver?', lifecycle: 'open', receivedAt: '', skipQe: SKIP } as never);
      answers(gateOf({ ord: 3, gateKind: 'deliver', prompt: 'Deliver?' }), summary);
      await act(async () => { await Promise.resolve(); });
      expect(screen.queryByTestId('session-proposal-skip-qe') !== null).toBe(summary === null);
      const deliver = document.querySelector<HTMLElement>('[data-option="go"]')!;
      expect(within(deliver).queryByTestId('ask-recommended') !== null).toBe(summary !== null);
      expect(deliver.getAttribute('aria-disabled') === 'true').toBe(summary === null);
      expect(client.api.getGate).toHaveBeenCalledWith(RUN);
    });
  }

  it('deliver without acceptance or a skipQe offer keeps Deliver recommended', async () => {
    vi.mocked(client.api.getGate).mockResolvedValue({ runId: RUN, ord: 3, prompt: 'Deliver?', lifecycle: 'open', receivedAt: '' } as never);
    answers(gateOf({ ord: 3, gateKind: 'deliver', prompt: 'Deliver?' }), null);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('session-proposal-skip-qe')).toBeNull();
    const deliver = document.querySelector<HTMLElement>('[data-option="go"]')!;
    expect(within(deliver).getByTestId('ask-recommended')).toBeTruthy();
    expect(deliver.getAttribute('aria-disabled')).not.toBe('true');
    expect(client.api.getGate).toHaveBeenCalledWith(RUN);
  });

  it('deliver uses a skipQe offer already on the gate without acceptance or another read', async () => {
    answers(gateOf({ ord: 3, gateKind: 'deliver', prompt: 'Deliver?', skipQe: SKIP! }), null);
    expect(await screen.findByTestId('session-proposal-skip-qe')).toBeTruthy();
    const deliver = document.querySelector<HTMLElement>('[data-option="go"]')!;
    expect(within(deliver).queryByTestId('ask-recommended')).toBeNull();
    expect(deliver.getAttribute('aria-disabled')).toBe('true');
    expect(client.api.getGate).not.toHaveBeenCalled();
  });

  it('deliver, QE refused, opened live: the skip is read from the gate', async () => {
    (client.api.getGate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ runId: RUN, ord: 3, prompt: 'p', lifecycle: 'open', receivedAt: '', skipQe: SKIP });
    answers(gateOf({ ord: 3, gateKind: 'deliver', prompt: 'Approve delivery before unit 3 runs.' }), true, UNITS.map((u) => ({ ...u, status: 'pending' as const })));
    expect(await screen.findByTestId('session-proposal-skip-qe')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('session-proposal-primary')).toBeEnabled();
    expect(screen.getByTestId('session-proposal-primary')).toHaveTextContent('Skip QE with a reason…');
  });
});

// ── escalation kinds, recorded from the engine's own prompts and frames ────────────────────────────────────────────
// Send back (`request_changes`) is an answer of an escalation gate wherever a creator sits at or before it (wicked-core
// refuses it otherwise, studio#627), so it is part of the engine's list there though its prompt need not name it.
const FLOOR_SUMMARY = 'repo checks floor failed: test: exit 1 (313.0s) [base_red_unseparated: base red, cannot separate: exclusion disabled (WICKED_FLOOR_EXCLUDE)] — the run base 7bc892d156 fails this check too, and its failures cannot be told apart from the head\'s: escalated with both logs — the operator\'s floor override is the path through';
const FLOOR_PROMPT = `Unit 2 failed its deterministic floor (repo_checks): ${FLOOR_SUMMARY} — confirm to retry the phase, ${JUDGMENT.trim()} or reject to cancel the run`;
const floorEvents = (): CoreEvent[] => [
  { type: 'unitDispatched', session: RUN, ord: 2, attempt: 3 },
  { type: 'repoChecksEvaluated', session: RUN, ord: 2, attempt: 3, passed: false, checks: [{ name: 'test', command: 'npm test', exitCode: 1, durationMs: 1000, classification: 'base_red_unseparated', regressions: [], failureIds: [] }], skipped: [] },
  { type: 'gateEvaluated', session: RUN, ord: 2, combined: false, denial: { source: 'repo_checks', reason: FLOOR_SUMMARY, claimId: null, ruleIds: [], deniedTool: null, phase: 'fix' }, denialReason: FLOOR_SUMMARY, hasDeterministicFloor: true, deterministicPass: false, agentVerdict: 'pass', judgeCli: 'codex', judgeDistinct: true, evaluatorPolicies: [] },
  { type: 'gateEscalated', session: RUN, ord: 2, attempt: 3, condition: 'floor_failed', denialSource: 'repo_checks', verdictSummary: FLOOR_SUMMARY },
] as unknown as CoreEvent[];

const DENIED_PROMPT = 'Unit 2 was DENIED by input governance: a write outside the unit\'s root. Approve to re-run the phase from the start, or reject to cancel the run';
const QE_PROMPT = 'Unit 6 verdict is NOT PASS — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run';
const JUDGE_PROMPT = 'Unit 2 could not be judged — no eligible judge seat remained. The work was not rejected. Approve to judge it yourself (it counts, labelled "judged by operator"), re-run the judge on the same work once a judge seat can rule (action `rejudge`; the step does not run again), request changes to send it back for rework, or reject to cancel the run';
const REJUDGE = { available: true, eligible: ['pi'], missing: [] };
const QE_UNITS: WorkUnit[] = [
  makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 4, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'pi' }),
  { ...makeUnit({ id: `${RUN}:test`, session_id: RUN, ord: 6, stage: 'test', role: 'evaluator', status: 'rejected', assigned_cli: 'claude' }), qe_review: { outcome: 'invalid', reason: 'x', attempts: [] } } as WorkUnit,
];
const qeEvents = (): CoreEvent[] => [
  { type: 'unitDispatched', session: RUN, ord: 6, attempt: 0 },
  { type: 'gateEvaluated', session: RUN, ord: 6, criterion: 'x', hasDeterministicFloor: true, deterministicPass: true, agentVerdict: 'pass', evaluatorPass: true, evaluatorPolicies: [], evaluatorVerdict: 'PASS', denialReason: "QE acceptance: the reviewer's verdict could not be bound: the reviewer recorded no verdict on QE run 56b40976",
    denial: { source: 'qe_review', reason: "QE acceptance: the reviewer's verdict could not be bound: the reviewer recorded no verdict on QE run 56b40976", claimId: null, ruleIds: [], deniedTool: null, phase: 'unit-6' }, combined: false, judgeCli: 'pi', judgeDistinct: true },
  { type: 'gateEscalated', session: RUN, ord: 6, attempt: 0, condition: 'verdict_not_pass', defGate: true, denialSource: 'qe_review', outputCaptured: true, restored: false, discarded: [], suggestionRef: null, verdictSummary: "QE acceptance: the reviewer's verdict could not be bound" },
] as unknown as CoreEvent[];

interface EscCase { kind: string; gate: OpenGate; units: WorkUnit[]; events: CoreEvent[]; rejudge?: unknown; engine: string[] }
const ESC: EscCase[] = [
  { kind: 'floor failure, override offered', gate: gateOf({ gateKind: 'escalation', prompt: FLOOR_PROMPT }), units: UNITS, events: floorEvents(), engine: ['approve', 'request_changes', 'operator_judgment', 'reject'] },
  { kind: 'floor failure, no override in its list', gate: gateOf({ gateKind: 'escalation', prompt: FLOOR_PROMPT.replace(JUDGMENT.trim() + ' ', '') }), units: UNITS, events: floorEvents(), engine: ['approve', 'request_changes', 'reject'] },
  { kind: 'denied unit', gate: gateOf({ gateKind: 'escalation', prompt: DENIED_PROMPT }), units: UNITS, events: [{ type: 'gateEvaluated', session: RUN, ord: 2, denial: { source: 'input_governance', reason: 'x', claimId: null, ruleIds: [], deniedTool: null, phase: null }, combined: false, evaluatorPolicies: [] } as unknown as CoreEvent], engine: ['approve', 'reject'] },
  // studio#761 (ruled): nothing was judged, so Send back is withheld even though the prompt names it.
  { kind: 'QE escalation, no verdict', gate: gateOf({ ord: 6, gateKind: 'escalation', prompt: QE_PROMPT }), units: QE_UNITS, events: qeEvents(), engine: ['approve', 'reject'] },
  { kind: 'judge unavailable, a judge can rule now', gate: gateOf({ gateKind: 'escalation', prompt: JUDGE_PROMPT }), units: UNITS, events: [], rejudge: REJUDGE, engine: ['approve', 'rejudge', 'request_changes', 'reject'] },
  { kind: 'judge unavailable, none can', gate: gateOf({ gateKind: 'escalation', prompt: JUDGE_PROMPT }), units: UNITS, events: [], engine: ['approve', 'request_changes', 'reject'] },
  { kind: 'plain workflow gate (def)', gate: gateOf({ gateKind: 'def', prompt: 'Approve the design before unit 2 runs.' }), units: UNITS, events: [], engine: ['approve', 'request_changes', 'reject'] },
];

const rowModelOf = (c: EscCase) => sessionGateChoices({ runId: RUN, gate: c.gate, units: c.units, events: c.events, pool: ['claude', 'codex', 'pi'], roster: null, rerun: null, fullVerdict: null, rejudge: (c.rejudge ?? null) as never })!;

describe('GateRow, escalation kinds: the row\'s actions equal the gate\'s list', () => {
  for (const c of ESC) {
    it(c.kind, () => {
      const m = rowModelOf(c);
      expect(sorted([...m.choices, ...m.overflow].filter((x) => x.decision !== null).map((x) => tokenOf(x.decision)))).toEqual(sorted(c.engine));
    });
  }
});

describe('GateRow submits, for each action it draws, the decision the gate lists', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetDecisionsForTest();
    setUndoWindowForTest(0);
    useGateActionStore.setState({ byGate: {} });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ ok: true } as never);
    vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] });
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
  });
  afterEach(() => cleanup());

  it('judgment after a lift says approval re-runs deliver, once above the rationale', async () => {
    const gate = gateOf({ ord: 3, gateKind: 'escalation', prompt: "The deliver phase refused: deliver: the lift changed the tree, and the repository's own checks FAILED on it: test: exit 1. " + OPTIONS + JUDGMENT + CLOSE });
    useGateStore.setState({ gates: { [RUN]: gate } });
    useRunEventStore.setState({ byRun: { [RUN]: [] } });
    vi.spyOn(client.api, 'getGate').mockRejectedValue(new Error('no read'));
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS)} gate={gate} navigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole('radio', { name: /Approve as your own judgment/ }));
    const line = screen.getByTestId('session-gate-consequence');
    expect(line).toHaveTextContent('Approving re-runs the deliver phase with your judgment on the record.');
    expect(line).toContainElement(screen.getByTestId('session-gate-floor-override-consequence'));
    expect(screen.getAllByText(/Overrides the failed floor/)).toHaveLength(1);
    expect(screen.queryByText('Preview:')).toBeNull();
  });

  const submitted = async (c: EscCase, key: string): Promise<{ action?: string; approve?: boolean } | null> => {
    vi.mocked(client.api.confirmGate).mockClear();
    vi.spyOn(client.api, 'getGate').mockResolvedValue({ runId: RUN, ord: c.gate.ord, prompt: c.gate.prompt, lifecycle: 'open', receivedAt: '', ...(c.rejudge !== undefined ? { rejudge: c.rejudge } : {}) } as never);
    useGateStore.setState({ gates: { [RUN]: c.gate } });
    useRunEventStore.setState({ byRun: { [RUN]: c.events } });
    const view = makeView({ id: RUN, status: 'awaiting_human', clis: ['claude'] } as never, c.units);
    render(<GateRow view={view} gate={c.gate} navigate={vi.fn()} />);
    const opt = await waitFor(() => { const el = document.querySelector<HTMLElement>(`[data-choice-key="${key}"]`); if (el === null) throw new Error(`no ${key}`); return el; });
    fireEvent.click(opt);
    const note = screen.queryByTestId('session-gate-note') as HTMLTextAreaElement | null;
    if (note !== null) fireEvent.change(note, { target: { value: 'because the evidence says so' } });
    const send = (screen.queryByTestId('session-gate-send') ?? screen.getByTestId('session-gate-confirm')) as HTMLButtonElement;
    fireEvent.click(send);
    await act(async () => { await flushDecisionsForTest(); });
    const call = vi.mocked(client.api.confirmGate).mock.calls[0];
    cleanup();
    return call === undefined ? null : (call[1] as { action?: string; approve?: boolean });
  };

  for (const c of ESC) {
    it(c.kind, async () => {
      const m = rowModelOf(c);
      const sent: string[] = [];
      for (const ch of m.choices.filter((x) => x.decision !== null)) {
        const body = await submitted(c, ch.key);
        expect(body, `${c.kind}: ${ch.key} sent nothing`).not.toBeNull();
        expect(tokenOf(body), `${c.kind}: ${ch.key}`).toBe(tokenOf(ch.decision));
        sent.push(tokenOf(body));
      }
      // Every action the gate lists that the row draws inline is submitted as itself; none is outside the list.
      for (const t of sent) expect(c.engine).toContain(t);
    });
  }
});

describe('ProposalCard submits, for each answer it draws, the decision the gate lists', () => {
  const CHAIN: ChainModel = { source: 'units', steps: [], proposed: false, transportLine: null, done: 0, total: 0, checked: null };
  const SKIP = { action: 'skip_qe', reasonRequired: true, actor: 'human_operator', label: 'QE acceptance skipped by operator', qeAcceptance: {} } as never;
  beforeEach(() => {
    vi.restoreAllMocks();
    resetDecisionsForTest();
    setUndoWindowForTest(0);
    useGateActionStore.setState({ byGate: {} });
    useRunEventStore.setState({ byRun: { [RUN]: [] } });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ ok: true } as never);
    vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] });
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
    vi.spyOn(client.api, 'getGate').mockRejectedValue(new Error('no read'));
  });
  afterEach(() => cleanup());

  const sendWay = async (gate: OpenGate, refused: boolean, way: string, steps: (() => void)[] = []): Promise<{ action?: string; approve?: boolean } | null> => {
    vi.mocked(client.api.confirmGate).mockClear();
    useGateStore.setState({ gates: { [RUN]: gate } });
    const view = makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS);
    Object.assign(view.session as object, { assurance: { mode: 'full', required: ['qe_acceptance'], qe: { status: 'required', basis: 'diff', score: 100, threshold: 20, reason: 'required', reasons: [], ord: 2, tree: 'abc' } } });
    const acceptance = refused ? { required: true, satisfied: false, walkthrough: null, line: 'QE acceptance did not pass' } : { required: false, satisfied: true, walkthrough: null, line: '' };
    render(<ProposalCard view={view} chain={CHAIN} acceptance={acceptance as never} />);
    fireEvent.click(document.querySelector<HTMLElement>(`[data-option="${way}"]`)!);
    const reason = screen.queryByTestId('session-proposal-skip-qe-reason') ?? screen.queryByTestId('session-proposal-reason-text');
    if (reason !== null) fireEvent.change(reason, { target: { value: 'because the evidence says so' } });
    fireEvent.click((screen.queryByTestId('session-proposal-skip-qe-send') ?? screen.queryByTestId('session-proposal-primary') ?? screen.getByTestId('session-proposal-go')) as HTMLElement);
    for (const step of steps) step();
    await act(async () => { await flushDecisionsForTest(); });
    const call = vi.mocked(client.api.confirmGate).mock.calls[0];
    cleanup();
    return call === undefined ? null : (call[1] as { action?: string; approve?: boolean });
  };

  it('plan_approval: approve and reject', async () => {
    const gate = gateOf({ ord: 1, gateKind: 'plan_approval', prompt: 'Approve plan rev 1: build, review.' });
    expect(tokenOf(await sendWay(gate, false, 'go'))).toBe('approve');
    expect(tokenOf(await sendWay(gate, false, 'end'))).toBe('reject');
  });
  it('deliver, QE refused with skipQe: skip_qe, with its reason', async () => {
    const gate = gateOf({ ord: 3, gateKind: 'deliver', skipQe: SKIP, prompt: 'Approve delivery before unit 3 runs.' });
    const body = await sendWay(gate, true, 'skip-qe');
    expect(tokenOf(body)).toBe('skip_qe');
    expect(body).toMatchObject({ amend: 'because the evidence says so' });
  });
  it('a delayed skipQe refusal replaces the Deliver primary with the recommended QE rerun', async () => {
    let resolveGate!: (info: Awaited<ReturnType<typeof client.api.getGate>>) => void;
    vi.mocked(client.api.getGate).mockReturnValue(new Promise((resolve) => { resolveGate = resolve; }));
    useGateStore.setState({ gates: { [RUN]: gateOf({ ord: 3, gateKind: 'deliver', prompt: 'Deliver?' }) } });
    const view = makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS);
    render(<ProposalCard view={view} chain={CHAIN} />);

    const initialPrimary = screen.getByTestId('session-proposal-go') as HTMLButtonElement;
    expect(initialPrimary.textContent).toBe('Deliver');
    expect(initialPrimary.disabled).toBe(false);
    expect(client.api.getGate).toHaveBeenCalledWith(RUN);

    await act(async () => {
      resolveGate({ runId: RUN, ord: 3, prompt: 'Deliver?', lifecycle: 'open', receivedAt: '', skipQe: SKIP } as never);
    });

    const primary = screen.getByTestId('session-proposal-primary') as HTMLButtonElement;
    expect(primary.textContent).toBe('Run QE again');
    expect(primary.disabled).toBe(false);
    fireEvent.click(primary);
    await act(async () => { await flushDecisionsForTest(); });
    expect(client.api.confirmGate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(client.api.confirmGate).mock.calls[0]?.[1]).toMatchObject({ approve: false, action: 'request_changes' });
  });
  it('a passing acceptance summary keeps Deliver available despite a cached skipQe offer', () => {
    useGateStore.setState({ gates: { [RUN]: gateOf({ ord: 3, gateKind: 'deliver', skipQe: SKIP, prompt: 'Approve delivery before unit 3 runs.' }) } });
    const view = makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS);
    const passed = { required: true, satisfied: true, walkthrough: null, line: 'QE acceptance passed' };
    render(<ProposalCard view={view} chain={CHAIN} acceptance={passed as never} />);
    expect(screen.queryByTestId('session-proposal-skip-qe')).toBeNull();
    const deliver = document.querySelector<HTMLElement>('[data-option="go"]')!;
    expect(within(deliver).getByTestId('ask-recommended')).toBeTruthy();
    expect(deliver.getAttribute('aria-disabled')).not.toBe('true');
  });
  it('the same gate with cached skipQe offers Deliver again when acceptance changes from refused to satisfied', () => {
    const gate = gateOf({ ord: 3, gateKind: 'deliver', skipQe: SKIP, prompt: 'Deliver?' });
    useGateStore.setState({ gates: { [RUN]: gate } });
    const view = makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS);
    const refused = { required: true, satisfied: false, walkthrough: null, line: 'QE acceptance did not pass' };
    const passed = { ...refused, satisfied: true, line: 'QE acceptance passed' };
    const { rerender } = render(<ProposalCard view={view} chain={CHAIN} acceptance={refused as never} />);
    expect(screen.getByTestId('session-proposal-skip-qe')).toBeTruthy();
    const refusedDeliver = document.querySelector<HTMLElement>('[data-option="go"]')!;
    expect(refusedDeliver.getAttribute('aria-disabled')).toBe('true');
    expect(within(refusedDeliver).queryByTestId('ask-recommended')).toBeNull();

    rerender(<ProposalCard view={view} chain={CHAIN} acceptance={passed as never} />);

    expect(useGateStore.getState().gates[RUN]).toBe(gate);
    expect(client.api.getGate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('session-proposal-skip-qe')).toBeNull();
    expect(document.querySelector('[data-option="skip-qe"]')).toBeNull();
    const deliver = document.querySelector<HTMLElement>('[data-option="go"]')!;
    expect(deliver.getAttribute('aria-disabled')).not.toBe('true');
    expect(within(deliver).getByTestId('ask-recommended')).toBeTruthy();
  });
  it('QE refused with no skipQe offer: the card neither draws Skip QE nor tells the operator to use it', () => {
    useGateStore.setState({ gates: { [RUN]: gateOf({ ord: 3, gateKind: 'deliver', prompt: 'Approve delivery before unit 3 runs.' }) } });
    const view = makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS);
    Object.assign(view.session as object, { assurance: { mode: 'full', required: ['qe_acceptance'], qe: { status: 'required', basis: 'diff', score: 100, threshold: 20, reason: 'required', reasons: [], ord: 2, tree: 'abc' } } });
    render(<ProposalCard view={view} chain={CHAIN} acceptance={{ required: true, satisfied: false, walkthrough: null, line: 'QE acceptance did not pass' } as never} />);
    expect(document.querySelector('[data-option="skip-qe"]')).toBeNull();
    expect(screen.getByTestId('session-proposal-why').textContent).not.toMatch(/skip QE here/i);
  });
  it('a complex gate read (`options: null`) still draws the plan card\'s approve and reject', async () => {
    const gate = gateOf({ ord: 1, gateKind: 'plan_approval', choices: null, prompt: 'Approve plan rev 1: build, review.' });
    expect(tokenOf(await sendWay(gate, false, 'go'))).toBe('approve');
    expect(tokenOf(await sendWay(gate, false, 'end'))).toBe('reject');
  });
  it('deliver, QE refused with skipQe: reject still stops the run', async () => {
    const gate = gateOf({ ord: 3, gateKind: 'deliver', skipQe: SKIP, prompt: 'Approve delivery before unit 3 runs.' });
    expect(tokenOf(await sendWay(gate, true, 'end'))).toBe('reject');
  });
});

describe('the resolver keeps every action the gate lists', () => {
  it('approve, request_changes, reject come back as exactly those three', async () => {
    const { gateOffers, offerActions } = await import('../src/board/gateOffers.js');
    expect(offerActions(gateOffers({ choices: ['approve', 'request_changes', 'reject'] }))).toEqual(['approve', 'request_changes', 'reject']);
    expect(offerActions(gateOffers({ choices: ['consent:continue', 'reject'] }))).toEqual(['consent:continue', 'reject']);
    expect(offerActions(gateOffers({}))).toEqual(['approve', 'reject']);
    expect(offerActions(gateOffers({ choices: null }))).toEqual(['answer']);
  });
  it('a reopened gate at the same ordinal reads its skipQe offer again', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useGateSkipQe } = await import('../src/hooks/useGateSkipQe.js');
    const first = { action: 'skip_qe', label: 'first gate' };
    const second = { action: 'skip_qe', label: 'second gate' };
    const get = vi.spyOn(client.api, 'getGate')
      .mockResolvedValueOnce({ runId: RUN, ord: 3, prompt: 'p', lifecycle: 'open', receivedAt: '2026-11-11T00:00:01Z', skipQe: first } as never)
      .mockResolvedValueOnce({ runId: RUN, ord: 3, prompt: 'p', lifecycle: 'open', receivedAt: '2026-11-11T00:00:02Z', skipQe: second } as never);
    const { result, rerender } = renderHook(({ at }) => useGateSkipQe(RUN, `3:${at}`, 3, true), { initialProps: { at: 1 } });
    await waitFor(() => expect(result.current).toEqual(first));
    rerender({ at: 2 });
    // The reopened gate never shows the previous instance's offer while its own read is in flight, then shows its own.
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual(second));
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('a read for another ordinal is no offer for this gate', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useGateSkipQe } = await import('../src/hooks/useGateSkipQe.js');
    const get = vi.spyOn(client.api, 'getGate').mockResolvedValue({ runId: RUN, ord: 5, prompt: 'p', lifecycle: 'open', receivedAt: '', skipQe: { action: 'skip_qe' } } as never);
    const { result } = renderHook(() => useGateSkipQe(RUN, '3:1', 3, true));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBeNull();
  });
});
