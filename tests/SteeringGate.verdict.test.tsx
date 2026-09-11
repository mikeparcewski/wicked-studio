// wicked-studio#250 / F-3R2-006 — the gate card states the evaluator verdict it is asking about.
//
// Recorded from the Phase 3 re-run (tests/fixtures/gateEvidence.ts): at G4 the card said only
// "Approve unit 4 before it runs: verify — …" while the fix phase's PASS (criterion, floor, judge)
// sat in the log; at G5 it said "Unit 4 verdict is NOT PASS — confirm to retry…" while the reason
// (evaluator≠creator, the changed path, the restore command) was only in the thread; at G6 the
// deliver gate never showed that the repo's own checks had run and passed. These pin the card:
//
//   1. G4 — `gate-verdict[data-verdict=pass]` names the fix phase, its criterion, the judge's
//      reasoning and the floor line; no denial, no judge-seat claim.
//   2. G5 — `data-verdict=fail` + `data-denial-source=worktree_guard`: the layer, the engine's
//      reason verbatim with the restore command as <code>, and the changed path + seat + trees.
//   3. G6 — the repo-checks floor: one row per check (name · exit · duration · manifest source).
//   4. a failed floor (synthetic frame in the wire's declared shape): the failing check is marked,
//      the skipped one named.
//   5. no evaluation yet / no hydrated log ⇒ NO block — never a verdict made up from the prompt.
//   6. ungated ⇒ labelled as a default-allow, not a pass.
//   7. the existing card contract is untouched: `steering-prompt` still carries the headline and
//      the `verdict-detail` selector (the run page's card) is not claimed by the gate card.

import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { SteeringGate } from '../src/components/SteeringGate.js';
import { useAnnotationStore } from '../src/store/annotations.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import {
  G4_EVENTS,
  G4_GATE,
  G5_EVENTS,
  G5_GATE,
  G6_EVENTS,
  G6_GATE,
  GATE_RUN,
  GATE_UNITS,
  REPO_CHECKS_FAIL,
  TREE_BEFORE,
} from './fixtures/gateEvidence.js';

describe('SteeringGate — the evaluator verdict on the card (F-3R2-006)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    useAnnotationStore.setState({ drafts: {} });
    useRunEventStore.setState({ byRun: {} });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  });

  it('G4 (before unit #4): renders the fix phase PASS — criterion, judge reasoning, floor line; no denial', () => {
    useRunEventStore.setState({ byRun: { [GATE_RUN]: G4_EVENTS } });
    render(<SteeringGate runId={GATE_RUN} ord={G4_GATE.ord} prompt={G4_GATE.prompt} units={GATE_UNITS} />);

    // The headline contract is untouched.
    expect(screen.getByTestId('steering-prompt')).toHaveTextContent('Approve unit 4 before it runs: verify');

    const card = screen.getByTestId('gate-verdict');
    expect(card).toHaveAttribute('data-verdict', 'pass');
    expect(card).toHaveAttribute('data-phase-ord', '3');
    expect(card).not.toHaveAttribute('data-denial-source');
    expect(card).toHaveTextContent('Evaluator verdict — fix · PASS');
    expect(screen.getByTestId('gate-verdict-criterion')).toHaveTextContent(
      'criterion: the run left a change in its worktree (done is re-derived from the diff, never asserted)',
    );
    expect(screen.getByTestId('gate-verdict-judge')).toHaveTextContent('judge: pass');
    expect(screen.getByTestId('gate-verdict-judge')).toHaveTextContent('multiple modified files and one new untracked test file');
    expect(screen.getByTestId('gate-verdict-layers')).toHaveTextContent('deterministic floor: pass');
    expect(screen.queryByTestId('gate-verdict-denial')).toBeNull();
    expect(screen.queryByTestId('gate-verdict-mutation')).toBeNull();
    expect(screen.queryByTestId('gate-verdict-floor')).toBeNull(); // no repoChecksEvaluated at G4
    // The judge SEAT is not on this wire — the card must not claim one.
    expect(card.textContent).not.toMatch(/judge seat|seat:/i);
    // The run page's card keeps its selector.
    expect(screen.queryByTestId('verdict-detail')).toBeNull();
  });

  it('G5 (escalated on unit #4): renders the worktree-guard denial — layer, verbatim reason with the restore command as code, changed path + seat', () => {
    useRunEventStore.setState({ byRun: { [GATE_RUN]: G5_EVENTS } });
    render(<SteeringGate runId={GATE_RUN} ord={G5_GATE.ord} prompt={G5_GATE.prompt} units={GATE_UNITS} />);

    expect(screen.getByTestId('steering-prompt')).toHaveTextContent('Unit 4 verdict is NOT PASS');

    const card = screen.getByTestId('gate-verdict');
    expect(card).toHaveAttribute('data-verdict', 'fail');
    expect(card).toHaveAttribute('data-phase-ord', '4');
    expect(card).toHaveAttribute('data-denial-source', 'worktree_guard');
    expect(card).toHaveTextContent('Evaluator verdict — verify · DENIED');

    const denial = screen.getByTestId('gate-verdict-denial');
    expect(denial).toHaveTextContent('denied by worktree guard (evaluator ≠ creator):');
    expect(denial).toHaveTextContent('evaluator≠creator: phase verify declares executes_code: false but changed the worktree it was reviewing');
    expect(denial).toHaveTextContent("Restore the creator's tree in the worktree with");
    // The remedy command is copyable code, byte for byte.
    const codes = within(denial).getAllByText((_, el) => el?.tagName === 'CODE' && (el.textContent ?? '').startsWith('git read-tree'));
    expect(codes).toHaveLength(1);
    expect(codes[0]).toHaveTextContent(`git read-tree --reset -u ${TREE_BEFORE}`);
    // …and so is the def change the engine names as the other way out.
    expect(denial).toHaveTextContent('a phase that must change code declares executes_code: true in the workflow def');

    const mutation = screen.getByTestId('gate-verdict-mutation');
    expect(mutation).toHaveTextContent('worktree changed by pi during verify: M src/App.tsx');
    expect(mutation).toHaveTextContent(`(tree ${TREE_BEFORE.slice(0, 10)} →`);
    expect(mutation).not.toHaveTextContent('run branch moved');

    // The judge's own PASS is still stated — the denial is the guard's, and both are true.
    expect(screen.getByTestId('gate-verdict-judge')).toHaveTextContent('judge: pass');
  });

  it('G6 (before unit #5 deliver): renders the repo-checks floor per check — name, exit code, duration, manifest source', () => {
    useRunEventStore.setState({ byRun: { [GATE_RUN]: G6_EVENTS } });
    render(<SteeringGate runId={GATE_RUN} ord={G6_GATE.ord} prompt={G6_GATE.prompt} units={GATE_UNITS} />);

    const card = screen.getByTestId('gate-verdict');
    expect(card).toHaveAttribute('data-verdict', 'pass');
    expect(card).toHaveTextContent('Evaluator verdict — verify · PASS');

    const floor = screen.getByTestId('gate-verdict-floor');
    expect(floor).toHaveAttribute('data-floor', 'pass');
    expect(floor).toHaveTextContent('repository checks — pass');
    expect(floor).toHaveTextContent("the repository's own checks pass in the run's worktree");

    const rows = screen.getAllByTestId('gate-verdict-check');
    expect(rows.map((r) => r.getAttribute('data-check'))).toEqual(['typecheck', 'lint', 'test']);
    expect(rows.every((r) => r.getAttribute('data-ok') === 'true')).toBe(true);
    expect(rows[0]).toHaveTextContent('typecheck · exit 0 · 6.9s · package.json scripts.typecheck');
    expect(rows[1]).toHaveTextContent('lint · exit 0 · 6.1s · package.json scripts.lint');
    expect(rows[2]).toHaveTextContent('test · exit 0 · 1m 19s · package.json scripts.test');
    expect(screen.queryByTestId('gate-verdict-skipped')).toBeNull();
    // The retry's PASS does not inherit attempt 0's mutation record.
    expect(screen.queryByTestId('gate-verdict-mutation')).toBeNull();
    expect(screen.queryByTestId('gate-verdict-denial')).toBeNull();
  });

  it('a FAILED floor (wire-declared shape): the failing check is marked, the skipped check is named, the verdict is DENIED', () => {
    const denied = {
      ...G6_EVENTS[G6_EVENTS.length - 4]!, // the ord-4 attempt-1 gateEvaluated
      seq: 403,
      combined: false,
      deterministicPass: false,
      denialReason: 'repository checks failed in the worktree: lint exited 1',
      denial: {
        source: 'repo_checks',
        reason: 'repository checks failed in the worktree: lint exited 1',
        claimId: null,
        ruleIds: [],
        deniedTool: null,
        phase: 'unit-4',
      },
    };
    const events = [...G5_EVENTS, REPO_CHECKS_FAIL, denied, { type: 'gateDecided', session: GATE_RUN, ord: 4, allow: false }];
    useRunEventStore.setState({ byRun: { [GATE_RUN]: events } });
    render(<SteeringGate runId={GATE_RUN} ord={4} prompt="Unit 4 verdict is NOT PASS — confirm to retry the phase, or reject to cancel the run" units={GATE_UNITS} />);

    const card = screen.getByTestId('gate-verdict');
    expect(card).toHaveAttribute('data-verdict', 'fail');
    expect(card).toHaveAttribute('data-denial-source', 'repo_checks');
    expect(screen.getByTestId('gate-verdict-denial')).toHaveTextContent('denied by repository checks: repository checks failed in the worktree: lint exited 1');

    const floor = screen.getByTestId('gate-verdict-floor');
    expect(floor).toHaveAttribute('data-floor', 'fail');
    const rows = screen.getAllByTestId('gate-verdict-check');
    expect(rows.map((r) => [r.getAttribute('data-check'), r.getAttribute('data-ok')])).toEqual([
      ['typecheck', 'true'],
      ['lint', 'false'],
    ]);
    expect(rows[1]).toHaveTextContent('lint · exit 1 · 5.4s');
    expect(screen.getByTestId('gate-verdict-skipped')).toHaveTextContent('skipped (an earlier check failed): test');
    expect(screen.getByTestId('gate-verdict-layers')).toHaveTextContent('deterministic floor: fail');
  });

  it('the very first gate (no evaluation yet) and an un-hydrated log render NO verdict block', () => {
    useRunEventStore.setState({ byRun: { [GATE_RUN]: G4_EVENTS.slice(0, 1) } });
    const { unmount } = render(<SteeringGate runId={GATE_RUN} ord={1} prompt="Approve unit 1 before it runs: triage" units={GATE_UNITS} />);
    expect(screen.queryByTestId('gate-verdict')).toBeNull();
    expect(screen.getByTestId('steering-prompt')).toHaveTextContent('Approve unit 1 before it runs: triage');
    unmount();

    // Nothing hydrated for this run at all (a gate reached from the chat surface, say).
    render(<SteeringGate runId="run-elsewhere" ord={2} prompt="?" />);
    expect(screen.queryByTestId('gate-verdict')).toBeNull();
  });

  it('an UNGATED previous phase is labelled a default-allow — never dressed as a pass', () => {
    // The gate before unit #2: the ord-1 triage evaluation had no floor, no judge, no policy.
    useRunEventStore.setState({ byRun: { [GATE_RUN]: G4_EVENTS.slice(0, 4) } });
    render(<SteeringGate runId={GATE_RUN} ord={2} prompt="Approve unit 2 before it runs: reproduce" units={GATE_UNITS} />);

    const card = screen.getByTestId('gate-verdict');
    expect(card).toHaveAttribute('data-verdict', 'ungated');
    expect(card).toHaveTextContent('Evaluator verdict — triage · UNGATED');
    expect(screen.getByTestId('gate-verdict-ungated')).toHaveTextContent('nothing gated this phase — it was approved by default, not verified');
    expect(screen.getByTestId('gate-verdict-layers')).toHaveTextContent('no deterministic floor · evaluator: default-allow (no policy applied)');
    expect(screen.queryByTestId('gate-verdict-criterion')).toBeNull();
  });

  it('without `units` the phase is named by ord — the block still renders', () => {
    useRunEventStore.setState({ byRun: { [GATE_RUN]: G4_EVENTS } });
    render(<SteeringGate runId={GATE_RUN} ord={G4_GATE.ord} prompt={G4_GATE.prompt} />);
    expect(screen.getByTestId('gate-verdict')).toHaveTextContent('Evaluator verdict — unit 3 · PASS');
  });
});
