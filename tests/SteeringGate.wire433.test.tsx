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

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { SteeringGate } from '../src/components/SteeringGate.js';
import { useAnnotationStore } from '../src/store/annotations.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import { G4_EVENTS, G4_GATE, G5_EVENTS, G5_GATE, G6_EVENTS, G6_GATE, GATE_RUN, GATE_UNITS, TREE_BEFORE } from './fixtures/gateEvidence.js';
import {
  DELIVER_CONFLICT_TAIL,
  DELIVER_RETRY_GATE,
  DELIVER_WRONG_HEAD_TAIL,
  G4_SAME_SEAT_EVENTS,
  G5R_EVENTS,
  G5R_GATE,
  G5R_UNPINNED_EVENTS,
  G5_RESTORE_FAILED_EVENTS,
  LEGACY_PROMPT,
  RESTORE_FAILED_ERROR,
  RUN_BRANCH,
  SUGGESTION_REF,
} from './fixtures/wire433.js';

function mount(events: readonly unknown[], gate: { ord: number; prompt: string }): { unmount: () => void } {
  useRunEventStore.setState({ byRun: { [GATE_RUN]: events as never } });
  return render(<SteeringGate runId={GATE_RUN} ord={gate.ord} prompt={gate.prompt} units={GATE_UNITS} />);
}

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

  it('restored:true — the discard/restore sentence, the discarded path, the pinned ref and a copyable git show hint; the denial prose still verbatim', () => {
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

  it('a LIFT-CONFLICT retry gate renders the lift block: outcome, files, the remedy, the engine\'s refusal verbatim', () => {
    mount([...G6_EVENTS, ...DELIVER_CONFLICT_TAIL], DELIVER_RETRY_GATE);
    // The deciding evaluation is still the ord-4 PASS — the deliver unit never reached a verdict.
    expect(screen.getByTestId('gate-verdict')).toHaveAttribute('data-verdict', 'pass');
    const lift = screen.getByTestId('deliver-lift');
    expect(lift).toHaveAttribute('data-outcome', 'conflict');
    expect(lift).toHaveTextContent('Deliver lift — LIFT-CONFLICT');
    expect(screen.getByTestId('deliver-lift-conflicts')).toHaveTextContent('testid-inventory.json');
    expect(screen.getByTestId('deliver-lift-summary')).toHaveTextContent('nothing was rebased and nothing was pushed');
    expect(screen.getByTestId('deliver-lift-remedy')).toHaveTextContent('rebase onto origin/main, resolve testid-inventory.json');
    expect(screen.getByTestId('deliver-lift-failure')).toHaveTextContent('deliver: LIFT-CONFLICT — lifting the run\'s work onto origin/main');
    expect(screen.getByTestId('steering-approve')).toHaveTextContent('Approve'); // not a restored-tree gate
  });

  it('the addendum: refused for a wrong HEAD ref with NO lift frame — the deliver: text renders on its own', () => {
    mount([...G6_EVENTS, ...DELIVER_WRONG_HEAD_TAIL], DELIVER_RETRY_GATE);
    const lift = screen.getByTestId('deliver-lift');
    expect(lift).toHaveAttribute('data-outcome', 'refused');
    expect(lift).toHaveTextContent('Deliver lift — refused before the lift');
    expect(screen.queryByTestId('deliver-lift-summary')).toBeNull();
    expect(screen.queryByTestId('deliver-lift-remedy')).toBeNull();
    const failure = screen.getByTestId('deliver-lift-failure');
    expect(failure).toHaveTextContent("deliver: the worktree's HEAD is attached to refs/heads/main, not the run branch");
    // Quoted refs render as code, so the remedy's branch name is copyable.
    const codes = within(failure).getAllByText((_, el) => el?.tagName === 'CODE' && (el.textContent ?? '') === RUN_BRANCH);
    expect(codes.length).toBeGreaterThanOrEqual(1);
  });

  it('the pre-run deliver gate (no deliver-ord frames yet) and a non-deliver gate render no lift block', () => {
    const m = mount(G6_EVENTS, G6_GATE);
    expect(screen.queryByTestId('deliver-lift')).toBeNull();
    m.unmount();
    mount([...G6_EVENTS, ...DELIVER_CONFLICT_TAIL], G5R_GATE); // a gate on ord 4 sees no ord-5 lift
    expect(screen.queryByTestId('deliver-lift')).toBeNull();
  });
});
