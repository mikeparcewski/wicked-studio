// wicked-core#431 / api-types 0.33.0 on the GATE CARD (studio #250/#252 follow-through):
//
//   1. the judge SEAT on the verdict header (`judgeCli`), and a same-seat warning when
//      `judgeDistinct` is false — evaluator ≠ creator is the doctrine, so "the judge fell back to
//      the single default runner" is said on the card, not buried; a frame without the fields
//      claims no seat (the recorded pre-0.33.0 corpus keeps its "no seat" line);
//   2. the RESTORED denial: "the evaluator's edit was discarded and the creator's verified tree
//      restored", the worktreeRestored record's discarded paths, the pinned ref with a copyable
//      `git show <ref>` hint (or the honest "not pinned"); a FAILED restore says so and keeps the
//      manual remedy; the recorded pre-0.33.0 fold renders neither;
//   3. Approve relabelled "Retry against the restored tree" on that gate ONLY — keyed on the
//      evidence frames, never on the prompt text, which changed with the engine ("confirm to retry
//      the phase" → "Approve to retry the phase against the restored tree") and still matches the
//      card's NOT PASS classification either way;
//   4. the deliver lift on a gate opened on the deliver unit (a LIFT-CONFLICT retry gate; the
//      addendum's refused-before-the-lift gate), and NOT on the pre-run deliver gate.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent } from '../src/api/types.js';
import { SteeringGate } from '../src/components/SteeringGate.js';
import { useAnnotationStore } from '../src/store/annotations.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import { G4_EVENTS, G4_GATE, G5_EVENTS, G5_GATE, G6_EVENTS, G6_GATE, GATE_RUN, GATE_UNITS, REPO_CHECKS_FAIL, TREE_BEFORE } from './fixtures/gateEvidence.js';
import {
  DELIVER_CONFLICT_TAIL,
  DELIVER_REVERIFY_FAILED_TAIL,
  DELIVER_WRONG_HEAD_TAIL,
  DETAIL_REVERIFY_FAILED,
  G4_SAME_SEAT_EVENTS,
  G5R_EVENTS,
  G5R_GATE,
  G5R_UNPINNED_EVENTS,
  G5_RESTORE_FAILED_EVENTS,
  LEGACY_PROMPT,
  REFUSAL_CONFLICT,
  REFUSAL_REVERIFY_FAILED,
  REFUSAL_WRONG_HEAD,
  RESTORE_FAILED_ERROR,
  RUN_BRANCH,
  SUGGESTION_REF,
  deliverRetryGate,
} from './fixtures/wire433.js';

function mount(events: readonly unknown[], gate: { ord: number; prompt: string }): { unmount: () => void } {
  useRunEventStore.setState({ byRun: { [GATE_RUN]: events as never } });
  return render(<SteeringGate runId={GATE_RUN} ord={gate.ord} prompt={gate.prompt} units={GATE_UNITS} />);
}

/** How many times `needle` occurs in the element's text — "the refusal reads once" is a count, not a presence. */
const mentions = (el: HTMLElement, needle: string): number => (el.textContent ?? '').split(needle).length - 1;

afterEach(() => cleanup());

describe('SteeringGate — the judge seat (F-3R2-007)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    useAnnotationStore.setState({ drafts: {} });
    useRunEventStore.setState({ byRun: {} });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  });

  it('a distinct judge seat is named on the header; no same-seat warning', () => {
    mount(G5R_EVENTS, G5R_GATE);
    const seat = screen.getByTestId('gate-verdict-judge-seat');
    expect(seat).toHaveTextContent('judge: codex');
    expect(seat).toHaveAttribute('data-judge-cli', 'codex');
    expect(seat).toHaveAttribute('data-judge-distinct', 'true');
    expect(screen.getByTestId('gate-verdict')).toHaveTextContent('Evaluator verdict — verify · DENIED · judge: codex');
    expect(screen.queryByTestId('gate-verdict-judge-same-seat')).toBeNull();
    // The judge's own verdict word is still stated beside its seat.
    expect(screen.getByTestId('gate-verdict-judge')).toHaveTextContent('judge: pass');
  });

  it('judgeDistinct:false flags "same seat as the creator" — evaluator ≠ creator not held on this verdict', () => {
    mount(G4_SAME_SEAT_EVENTS, G4_GATE);
    expect(screen.getByTestId('gate-verdict-judge-seat')).toHaveTextContent('judge: claude');
    expect(screen.getByTestId('gate-verdict-judge-seat')).toHaveAttribute('data-judge-distinct', 'false');
    const warn = screen.getByTestId('gate-verdict-judge-same-seat');
    expect(warn).toHaveTextContent('same seat as the creator');
    expect(warn).toHaveTextContent('evaluator ≠ creator is not held on this verdict');
  });

  it('a frame without the fields (the recorded pre-0.33.0 corpus) claims no seat', () => {
    mount(G4_EVENTS, G4_GATE);
    expect(screen.queryByTestId('gate-verdict-judge-seat')).toBeNull();
    expect(screen.queryByTestId('gate-verdict-judge-same-seat')).toBeNull();
    expect(screen.getByTestId('gate-verdict').textContent).not.toMatch(/judge: (codex|claude|pi)/);
  });
});

describe('SteeringGate — the restored-tree denial (F-3R2-010)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    useAnnotationStore.setState({ drafts: {} });
    useRunEventStore.setState({ byRun: {} });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  });

  it('restored:true — the discard/restore sentence, the discarded path, the pinned ref and a copyable git show hint; the denial prose still verbatim', async () => {
    mount(G5R_EVENTS, G5R_GATE);
    expect(screen.getByTestId('steering-prompt')).toHaveTextContent("its edit was discarded and the creator's verified tree restored");

    const card = screen.getByTestId('gate-verdict');
    expect(card).toHaveAttribute('data-verdict', 'fail');
    expect(card).toHaveAttribute('data-denial-source', 'worktree_guard');

    const restored = screen.getByTestId('gate-verdict-restored');
    expect(restored).toHaveTextContent("the evaluator's edit was discarded and the creator's verified tree restored");
    expect(restored).toHaveTextContent('discarded: M src/App.tsx');
    expect(restored).toHaveTextContent(`(tree ${TREE_BEFORE.slice(0, 10)})`);
    expect(restored).toHaveAttribute('data-suggestion-ref', SUGGESTION_REF);
    expect(restored).toHaveTextContent(`the edit is kept at ${SUGGESTION_REF}`);
    const hint = screen.getByTestId('gate-verdict-suggestion-hint');
    expect(hint.tagName).toBe('CODE');
    expect(hint).toHaveTextContent(`git show ${SUGGESTION_REF}`);
    expect(hint.style.userSelect).toBe('all');
    // F-255-06: the hint is also a REAL button — focusable, with an accessible name — that puts the
    // command on the clipboard and says so.
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const copy = within(restored).getByRole('button', { name: `copy git show ${SUGGESTION_REF}` });
    expect(copy.tagName).toBe('BUTTON');
    expect(copy).toHaveAttribute('data-command', `git show ${SUGGESTION_REF}`);
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith(`git show ${SUGGESTION_REF}`);
    expect(await screen.findByText('copied')).toBe(copy);
    expect(restored).not.toHaveTextContent('HEAD reset'); // head: null — the branch had not moved

    // The engine's own prose still renders verbatim — it now SAYS the edit was discarded, and no
    // longer carries a read-tree command to run by hand.
    const denial = screen.getByTestId('gate-verdict-denial');
    expect(denial).toHaveTextContent("The evaluator's edit was DISCARDED: the engine restored the creator's tree");
    expect(within(denial).queryByText((_, el) => el?.tagName === 'CODE' && (el.textContent ?? '').startsWith('git read-tree'))).toBeNull();
    expect(screen.queryByTestId('gate-verdict-restore-failed')).toBeNull();
    // The mutation line keeps its own facts.
    expect(screen.getByTestId('gate-verdict-mutation')).toHaveTextContent('worktree changed by pi during verify: M src/App.tsx');
  });

  it('a failed pin says the edit was not pinned — no git show hint invented', () => {
    mount(G5R_UNPINNED_EVENTS, G5R_GATE);
    const restored = screen.getByTestId('gate-verdict-restored');
    expect(restored).toHaveTextContent('the discarded edit was not pinned (no suggestion ref)');
    expect(restored).not.toHaveAttribute('data-suggestion-ref');
    expect(screen.queryByTestId('gate-verdict-suggestion-hint')).toBeNull();
    expect(within(restored).queryByRole('button', { name: /^copy / })).toBeNull();
  });

  it('restored:false — the restore failed, the error is named, the manual remedy (the read-tree command) stands as code', () => {
    mount(G5_RESTORE_FAILED_EVENTS, { ord: 4, prompt: LEGACY_PROMPT });
    expect(screen.queryByTestId('gate-verdict-restored')).toBeNull();
    const failed = screen.getByTestId('gate-verdict-restore-failed');
    expect(failed).toHaveTextContent("the creator's tree was NOT restored");
    expect(failed).toHaveTextContent(RESTORE_FAILED_ERROR);
    expect(failed).toHaveTextContent('the manual remedy in the denial stands');
    const denial = screen.getByTestId('gate-verdict-denial');
    const codes = within(denial).getAllByText((_, el) => el?.tagName === 'CODE' && (el.textContent ?? '').startsWith('git read-tree'));
    expect(codes).toHaveLength(1);
    expect(codes[0]).toHaveTextContent(`git read-tree --reset -u ${TREE_BEFORE}`);
  });

  it('the recorded pre-0.33.0 fold (no restored field) renders neither block — nothing is fabricated for an older daemon', () => {
    mount(G5_EVENTS, G5_GATE);
    expect(screen.getByTestId('gate-verdict-mutation')).toBeInTheDocument();
    expect(screen.queryByTestId('gate-verdict-restored')).toBeNull();
    expect(screen.queryByTestId('gate-verdict-restore-failed')).toBeNull();
  });
});

describe('SteeringGate — Approve means "retry against the restored tree" exactly when the engine restored it', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    useAnnotationStore.setState({ drafts: {} });
    useRunEventStore.setState({ byRun: {} });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  });

  it('relabels Approve / Approve + steer on the restored-tree denial gate and marks the card', () => {
    mount(G5R_EVENTS, G5R_GATE);
    expect(screen.getByTestId('steering-gate')).toHaveAttribute('data-retry-restored', 'true');
    expect(screen.getByTestId('steering-approve')).toHaveTextContent('Retry against the restored tree');
    expect(screen.getByTestId('steering-approve-steer')).toHaveTextContent('Retry + steer');
    expect(screen.getByTestId('steering-reject')).toHaveTextContent('Reject');
    expect(screen.getByTestId('steering-gate')).toHaveTextContent('a retry · r reject');
  });

  it('the relabel keys on the frames, not the prompt: the same frames with the OLD prompt still relabel', () => {
    mount(G5R_EVENTS, { ord: 4, prompt: LEGACY_PROMPT });
    expect(screen.getByTestId('steering-approve')).toHaveTextContent('Retry against the restored tree');
  });

  it('stays "Approve" when the restore failed, on the recorded pre-0.33.0 fold, and on a pre-run gate whose deciding verdict passed', () => {
    let m = mount(G5_RESTORE_FAILED_EVENTS, { ord: 4, prompt: LEGACY_PROMPT });
    expect(screen.getByTestId('steering-approve')).toHaveTextContent('Approve');
    expect(screen.getByTestId('steering-gate')).not.toHaveAttribute('data-retry-restored');
    m.unmount();

    m = mount(G5_EVENTS, G5_GATE);
    expect(screen.getByTestId('steering-approve')).toHaveTextContent('Approve');
    expect(screen.getByTestId('steering-approve')).not.toHaveTextContent('Retry');
    m.unmount();

    // The gate BEFORE unit #5 after the restored-and-retried verify PASSED: its deciding verdict is
    // the ord-4 PASS (no mutation on that fold), so the button is the ordinary Approve.
    mount([...G5R_EVENTS, ...G6_EVENTS.slice(G5_EVENTS.length)], G6_GATE);
    expect(screen.getByTestId('gate-verdict')).toHaveAttribute('data-verdict', 'pass');
    expect(screen.getByTestId('steering-approve')).toHaveTextContent('Approve');
    expect(screen.queryByTestId('gate-verdict-restored')).toBeNull();
  });

  it('the NOT PASS classification holds for both prompt spellings (the old string match re-checked)', () => {
    // Neither prompt has coverage data behind it here, so the only observable is that the card
    // renders the headline whole — the isCoverageFail branch is exercised without asserting a
    // fetch. Both spellings contain "NOT PASS".
    const m = mount(G5R_EVENTS, G5R_GATE);
    expect(screen.getByTestId('steering-prompt')).toHaveTextContent(/NOT PASS/);
    m.unmount();
    mount(G5_EVENTS, G5_GATE);
    expect(screen.getByTestId('steering-prompt')).toHaveTextContent(/NOT PASS/);
  });
});

describe('SteeringGate — the deliver lift on a gate opened on the deliver unit (F-3R2-013)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    useAnnotationStore.setState({ drafts: {} });
    useRunEventStore.setState({ byRun: {} });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  });

  it("a LIFT-CONFLICT retry gate renders the lift block — outcome, files, the remedy — and the refusal ONCE: the engine's escalate prompt already quotes it", () => {
    mount([...G6_EVENTS, ...DELIVER_CONFLICT_TAIL], deliverRetryGate(REFUSAL_CONFLICT));
    // The deciding evaluation is still the ord-4 PASS — the deliver unit never reached a verdict.
    expect(screen.getByTestId('gate-verdict')).toHaveAttribute('data-verdict', 'pass');
    // The engine's prompt, format string filled (actor.rs TriageDecision::Escalate): it QUOTES the failure.
    expect(screen.getByTestId('steering-prompt')).toHaveTextContent('Unit 5 failed and triage escalated');
    expect(screen.getByTestId('steering-prompt')).toHaveTextContent('Failure output: "deliver: LIFT-CONFLICT');
    const lift = screen.getByTestId('deliver-lift');
    expect(lift).toHaveAttribute('data-outcome', 'conflict');
    expect(lift).toHaveTextContent('Deliver lift — LIFT-CONFLICT');
    expect(screen.getByTestId('deliver-lift-conflicts')).toHaveTextContent('testid-inventory.json');
    expect(screen.getByTestId('deliver-lift-summary')).toHaveTextContent('nothing was rebased and nothing was pushed');
    expect(screen.getByTestId('deliver-lift-remedy')).toHaveTextContent('rebase onto origin/main, resolve testid-inventory.json');
    // Once on the whole card (F-255-02): the prompt carries it, so the lift block omits its copy.
    expect(screen.queryByTestId('deliver-lift-failure')).toBeNull();
    expect(mentions(screen.getByTestId('steering-gate'), "LIFT-CONFLICT — lifting the run's work")).toBe(1);
    expect(screen.getByTestId('steering-approve')).toHaveTextContent('Approve'); // not a restored-tree gate
  });

  it('the addendum: refused for a wrong HEAD ref with NO lift frame — the deliver: text once, from the prompt', () => {
    mount([...G6_EVENTS, ...DELIVER_WRONG_HEAD_TAIL], deliverRetryGate(REFUSAL_WRONG_HEAD));
    const lift = screen.getByTestId('deliver-lift');
    expect(lift).toHaveAttribute('data-outcome', 'refused');
    expect(lift).toHaveTextContent('Deliver lift — refused before the lift');
    expect(screen.queryByTestId('deliver-lift-summary')).toBeNull();
    expect(screen.queryByTestId('deliver-lift-remedy')).toBeNull();
    expect(screen.queryByTestId('deliver-lift-failure')).toBeNull();
    expect(mentions(screen.getByTestId('steering-gate'), "deliver: the worktree's HEAD is attached to")).toBe(1);
  });

  it('a prompt that does NOT carry the refusal (the daemon-restart fallback) leaves the lift block to say it — quoted refs as copyable code', () => {
    mount([...G6_EVENTS, ...DELIVER_WRONG_HEAD_TAIL], { ord: 5, prompt: 'Prompt unavailable (daemon restarted) — you can still approve or reject.' });
    const failure = screen.getByTestId('deliver-lift-failure');
    expect(failure).toHaveTextContent("deliver: the worktree's HEAD is attached to refs/heads/main, not the run branch");
    const codes = within(failure).getAllByText((_, el) => el?.tagName === 'CODE' && (el.textContent ?? '') === RUN_BRANCH);
    expect(codes.length).toBeGreaterThanOrEqual(1);
    expect(mentions(screen.getByTestId('steering-gate'), "deliver: the worktree's HEAD is attached to")).toBe(1);
  });

  it('a failed re-verify: the 532-char refusal reaches the wire ELIDED (150/250) yet the wider prompt excerpt still dedupes it; the red lint row exposes its stderr tail, collapsed', () => {
    mount([...G6_EVENTS, ...DELIVER_REVERIFY_FAILED_TAIL], deliverRetryGate(REFUSAL_REVERIFY_FAILED));
    expect(DETAIL_REVERIFY_FAILED).toMatch(/chars elided/);
    expect(screen.queryByTestId('deliver-lift-failure')).toBeNull();
    expect(mentions(screen.getByTestId('steering-gate'), 'deliver: the tree that would ship')).toBe(1);
    expect(screen.getByTestId('deliver-lift-floor')).toHaveAttribute('data-floor', 'fail');
    // F-255-03: only the red row carries a tail — a passing check's output is not evidence of anything.
    const tails = screen.getAllByTestId('deliver-lift-check-tail');
    expect(tails).toHaveLength(1);
    expect(tails[0]).toHaveAttribute('data-stream', 'stderr');
    expect(tails[0]!.tagName).toBe('DETAILS');
    expect((tails[0] as HTMLDetailsElement).open).toBe(false);
    expect(tails[0]).toHaveTextContent('@typescript-eslint/no-explicit-any');
    expect(within(tails[0]!).getByText(/stderr tail/)).toBeInTheDocument();
    const lint = screen.getAllByTestId('deliver-lift-check').find((r) => r.getAttribute('data-check') === 'lint')!;
    expect(within(lint).getByTestId('deliver-lift-check-tail')).toBe(tails[0]);
  });

  it('the pre-run deliver gate (no deliver-ord frames yet) and a non-deliver gate render no lift block', () => {
    const m = mount(G6_EVENTS, G6_GATE);
    expect(screen.queryByTestId('deliver-lift')).toBeNull();
    m.unmount();
    mount([...G6_EVENTS, ...DELIVER_CONFLICT_TAIL], G5R_GATE); // a gate on ord 4 sees no ord-5 lift
    expect(screen.queryByTestId('deliver-lift')).toBeNull();
  });
});

describe('GateVerdict — the evidence behind a red repository check (F-255-03)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    useAnnotationStore.setState({ drafts: {} });
    useRunEventStore.setState({ byRun: {} });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  });

  it('a failed check exposes its recorded stderr tail as a collapsed block on the gate card; passing rows and empty streams show none', () => {
    // The recorded repo-checks denial fold (the same frames the inbox test uses): the floor failed on lint.
    const REPO_CHECKS_DENY: CoreEvent = {
      type: 'gateEvaluated', session: GATE_RUN, ord: 4, seq: 403, ts: 1789081879700,
      criterion: "the repository's own checks pass in the run's worktree",
      hasDeterministicFloor: true, deterministicPass: false, agentVerdict: 'pass', agentReasoning: null,
      evaluatorPass: true, evaluatorPolicies: [],
      denialReason: 'repository checks failed in the worktree: lint exited 1',
      denial: { source: 'repo_checks', reason: 'repository checks failed in the worktree: lint exited 1', claimId: null, ruleIds: [], deniedTool: null, phase: 'unit-4' },
      combined: false, judgeCli: null, judgeDistinct: null,
    };
    mount([...G5_EVENTS, REPO_CHECKS_FAIL, REPO_CHECKS_DENY], { ord: 4, prompt: G5_GATE.prompt });
    expect(screen.getByTestId('gate-verdict-floor')).toHaveAttribute('data-floor', 'fail');
    const tails = screen.getAllByTestId('gate-verdict-check-tail');
    expect(tails).toHaveLength(1);
    expect(tails[0]).toHaveAttribute('data-stream', 'stderr');
    expect(tails[0]!.tagName).toBe('DETAILS');
    expect((tails[0] as HTMLDetailsElement).open).toBe(false);
    expect(tails[0]).toHaveTextContent('@typescript-eslint/no-explicit-any');
    const red = screen.getAllByTestId('gate-verdict-check').find((r) => r.getAttribute('data-ok') === 'false')!;
    expect(within(red).getByTestId('gate-verdict-check-tail')).toBe(tails[0]);
    // The recorded pre-0.33.0 fold's floor (pass, every row green) shows no tail at all.
    cleanup();
    mount(G6_EVENTS, G6_GATE);
    expect(screen.queryByTestId('gate-verdict-check-tail')).toBeNull();
  });
});
