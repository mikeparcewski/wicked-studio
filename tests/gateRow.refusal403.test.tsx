/**
 * studio#403 (studio half): the engine's retry gate after a refused hand-over is answerable in the
 * session thread, leads with the remote's reason, and says what Deliver again re-pushes.
 *
 * Before: `proposalKindOf` called the gate a failure (not a hand-over) while `classifyRowGate` called
 * it the deliver card, so neither ProposalCard nor GateRow rendered it.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { WorkUnit } from '../src/api/types.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { FLOOR_OVERRIDE_KEY, offersDeliverFloorOverride } from '../src/board/floorOverride.js';
import { OPERATOR_JUDGMENT_LABEL } from '../src/board/rejudge.js';
import { setUndoWindowForTest } from '../src/board/undoQueue.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { classifyRowGate } from '../src/board/questionRow.js';
import { proposalKindOf } from '../src/board/proposalCard.js';
import { plainGateQuestion } from '../src/board/deskWords.js';
import { deliverRefusalOf, diffstatOf } from '../src/components/gateMoveModel.js';
import { GateRow, refusalWords } from '../src/components/session/GateRow.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-403';
const NOW = 1_700_000_000_000;
const BRANCH = `wicked/${RUN}`;

const UNITS: WorkUnit[] = [
  makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 1, role: 'creator', status: 'done', stage: 'build' }),
  makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 2, description: 'deliver', stage: 'build', phase_ref: 'deliver', status: 'rejected' }),
];

/** The engine's retry gate (wicked-core: "The deliver phase refused: <detail>. Approve to re-run …"),
 *  quoting crew's deliver script: the identity line first, then the refusal sentence and its marker. */
const REMOTE_PROMPT =
  `The deliver phase refused: deliver: pushing as someone (GH_ACCOUNT not set — not pinned)\n` +
  `deliver: the remote refused the push of ${BRANCH} after commit: remote: error: GH013 push declined by pre-receive hook; ` +
  `the work is committed on ${BRANCH} and nothing was pushed — fix the remote condition, then approve to retry the deliver phase; deliver: PUSH-REJECTED. ` +
  'Approve to re-run the deliver phase now (the engine re-lifts and re-verifies first; no second deliver gate), reject to cancel the run and keep the worktree.';

const IDENTITY_PROMPT =
  "The deliver phase refused: deliver: identity mismatch — GH_ACCOUNT is release-bot but gh's active login is someone-else; nothing was staged, committed or pushed. " +
  'Approve to re-run the deliver phase now (the engine re-lifts and re-verifies first; no second deliver gate), reject to cancel the run and keep the worktree.';

function gate(prompt: string): OpenGate {
  return { runId: RUN, ord: 2, prompt, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };
}

describe('studio#403 — reading the refused hand-over', () => {
  it('the remote refusal: branch and the hook message; the identity line is not the reason', () => {
    expect(deliverRefusalOf(REMOTE_PROMPT)).toEqual({ remote: true, branch: BRANCH, reason: 'remote: error: GH013 push declined by pre-receive hook' });
    const nonFf = 'The deliver phase refused: deliver: the remote refused the push of wicked/x because its branch moved (non-fast-forward); the work is committed on wicked/x and nothing was pushed. Approve to re-run the deliver phase now';
    expect(deliverRefusalOf(nonFf)).toEqual({ remote: true, branch: 'wicked/x', reason: 'its branch moved (non-fast-forward)' });
  });

  it('another refusal: the script\'s own words, never its identity line', () => {
    const r = deliverRefusalOf(IDENTITY_PROMPT)!;
    expect(r.remote).toBe(false);
    expect(r.reason).toMatch(/^identity mismatch/);
    expect(deliverRefusalOf('Approve delivery before unit 2 runs.')).toBeNull();
  });

  it('the gate is a row (Deliver again / Stop, nothing preselected), not the deliver card', () => {
    const g = gate(REMOTE_PROMPT);
    expect(proposalKindOf(RUN, g, UNITS)).toBeNull();
    expect(classifyRowGate({ runId: RUN, gate: g, units: UNITS, events: [] }).kind).not.toBe('checking');
    expect(classifyRowGate({ runId: RUN, gate: g, units: UNITS, events: [] })).not.toEqual({ kind: 'card', reason: 'deliver' });
    const m = sessionGateChoices({ runId: RUN, gate: g, units: UNITS, events: [], pool: [], roster: null })!;
    expect(m).not.toBeNull();
    expect(m.choices.map((c) => [c.label, c.decision])).toEqual([['Deliver again', { approve: true }], ['Stop', { approve: false }]]);
    expect(m.recommended).toBeNull();
    expect(m.refusal?.branch).toBe(BRANCH);
    // A fresh deliver gate is still the hand-over card.
    const fresh: OpenGate = { runId: RUN, ord: 2, prompt: 'Approve delivery before unit 2 runs.', lifecycle: 'open', receivedAt: NOW, gateKind: 'deliver' };
    expect(classifyRowGate({ runId: RUN, gate: fresh, units: UNITS, events: [] })).toEqual({ kind: 'card', reason: 'deliver' });
  });

  // studio#814 (E2E run 9ec286dc): a refused hand-over, reloaded. An older crew's `GET /runs/:id/gate`
  // carries no kind, so the gate on the deliver unit read as a fresh deliver card; and the reason
  // was the script's FIRST line (an advisory), not the line it failed on.
  const NOTHING_PROMPT =
    'The deliver phase refused: deliver: the push identity mikeparcewski applies to github.com origins only; this origin is not one, so gh and git use their own credentials\n' +
    'deliver: nothing to deliver — the run produced no committed change (wicked/x is not ahead of origin/main); nothing was pushed\n' +
    'deliver: OUTCOME 5f2a failed. ' +
    'Approve to re-run the deliver phase now (the engine re-lifts and re-verifies first; no second deliver gate), reject to cancel the run and keep the worktree.';
  it('a reloaded refused hand-over (no gate kind) is the failure row, never the "Ready to hand it over" card', () => {
    const reloaded: OpenGate = { runId: RUN, ord: 2, prompt: NOTHING_PROMPT, lifecycle: 'open', receivedAt: NOW };
    expect(proposalKindOf(RUN, reloaded, UNITS)).toBeNull();
    expect(classifyRowGate({ runId: RUN, gate: reloaded, units: UNITS, events: [] })).not.toEqual({ kind: 'card', reason: 'deliver' });
    expect(plainGateQuestion(NOTHING_PROMPT, undefined)).toBe('The hand-over failed — deliver again or stop?');
  });
  it('the reason is the line the script failed on, not its first line', () => {
    const r = deliverRefusalOf(NOTHING_PROMPT)!;
    expect(r.remote).toBe(false);
    expect(r.reason).toBe('nothing to deliver — the run produced no committed change (wicked/x is not ahead of origin/main); nothing was pushed');
  });

  it('the words: the reason leads, the consent line names branch, repo and diffstat', () => {
    expect(plainGateQuestion(REMOTE_PROMPT, 'escalation')).toBe('The remote refused the push — deliver again or stop?');
    expect(plainGateQuestion(IDENTITY_PROMPT, 'escalation')).toBe('The hand-over failed — deliver again or stop?');
    const w = refusalWords(deliverRefusalOf(REMOTE_PROMPT)!, { branch: null, repo: 'acme/shop', diffstat: '2 files changed, +5, −1' });
    expect(w.lead).toBe(`The remote refused the push: remote: error: GH013 push declined by pre-receive hook. Nothing was pushed; the work is committed on ${BRANCH}.`);
    expect(w.consent).toBe(`Deliver again re-pushes ${BRANCH} to acme/shop: 2 files changed, +5, −1.`);
    expect(diffstatOf('diff --git a/x b/x\n--- a/x\n+++ b/x\n+a\n-b\n')).toBe('1 file changed, +1, −1');
    expect(diffstatOf('')).toBeNull();
  });
});

describe('studio#403 — the row renders it', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    useGateActionStore.setState({ byGate: {} });
    useRunEventStore.setState({ byRun: { [RUN]: [] } });
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n+a\n+b\n-c\n' } as never);
  });
  afterEach(() => cleanup());

  it('question, reason, consent line with the diffstat, and the two choices', async () => {
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human', run_branch: BRANCH } as never, UNITS)} gate={gate(REMOTE_PROMPT)} />);
    expect(screen.getByTestId('session-gate-question').textContent).toBe('The remote refused the push — deliver again or stop?');
    expect(screen.getByTestId('session-gate-refusal').textContent).toMatch(/^The remote refused the push: remote: error: GH013/);
    await waitFor(() => expect(screen.getByTestId('session-gate-deliver-consent').textContent).toMatch(/: 1 file changed, \+2, −1\.$/));
    expect(screen.getByTestId('session-gate-deliver-consent').textContent).toMatch(new RegExp(`^Deliver again re-pushes ${BRANCH}`));
    expect(screen.getAllByTestId('session-gate-choice').map((b) => b.textContent)).toEqual(['Deliver again', 'Stop']);
  });
});

// wicked-core (deliver honors an override): the deliver phase's own re-verify failed on the tree it would
// ship (a lift onto a red tip). The engine offers the operator's judgment over exactly that result; the
// refused hand-over row shows it beside Deliver again / Stop and sends the arm with the rationale.
const OFFER =
  'judge it yourself with a written rationale when the evidence shows the failures are not the work\'s (action '
  + '`operator_judgment`: it overrides the failed floor, labelled "floor overridden by operator" on the run and the delivery; '
  + 'every other layer still denies and QE acceptance is still required),';
const REVERIFY_PROMPT =
  'The deliver phase refused: deliver: the lift changed the tree, and the repository\'s own checks FAILED on it: test: exit 1. '
  + `Approve to re-run the deliver phase now (the engine re-lifts and re-verifies first; no second deliver gate), ${OFFER} `
  + 'or reject to cancel the run and keep the worktree.';

describe('a refused hand-over whose re-verify failed — the operator\'s judgment', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setUndoWindowForTest(0);
    useGateStore.setState({ gates: { [RUN]: gate(REVERIFY_PROMPT) } });
    useGateActionStore.setState({ byGate: {} });
    useRunEventStore.setState({ byRun: { [RUN]: [] } });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' } as never);
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '' } as never);
    vi.spyOn(client.api, 'getGate').mockResolvedValue({ runId: RUN, ord: 2, prompt: REVERIFY_PROMPT, lifecycle: 'open', receivedAt: '' } as never);
  });
  afterEach(() => cleanup());

  it('is offered only where the engine wrote the clause in its own options', () => {
    expect(offersDeliverFloorOverride(REVERIFY_PROMPT)).toBe(true);
    expect(offersDeliverFloorOverride(REMOTE_PROMPT)).toBe(false);
    expect(offersDeliverFloorOverride(IDENTITY_PROMPT)).toBe(false);
    expect(offersDeliverFloorOverride(undefined)).toBe(false);
    // The clause quoted INSIDE the refusal, with the engine's own options offering nothing: no offer.
    const quoted =
      `The deliver phase refused: deliver: Approve to re-run the deliver phase now (the engine re-lifts and re-verifies first; no second deliver gate), ${OFFER} or reject to cancel the run. `
      + 'Approve to re-run the deliver phase now (the engine re-lifts and re-verifies first; no second deliver gate), reject to cancel the run and keep the worktree.';
    expect(offersDeliverFloorOverride(quoted)).toBe(false);
  });

  it('the row: Deliver again, Approve as your own judgment (note required), Stop', () => {
    const m = sessionGateChoices({ runId: RUN, gate: gate(REVERIFY_PROMPT), units: UNITS, events: [], pool: [], roster: null })!;
    expect(m.choices.map((c) => c.key)).toEqual(['retry', FLOOR_OVERRIDE_KEY, 'stop']);
    const own = m.choices[1]!;
    expect(own.label).toBe(OPERATOR_JUDGMENT_LABEL);
    expect(own.needsNote).toBe(true);
    expect(own.decision).toEqual({ approve: true, action: 'operator_judgment' });
    // Without the engine's offer the row is unchanged.
    const plain = sessionGateChoices({ runId: RUN, gate: gate(IDENTITY_PROMPT), units: UNITS, events: [], pool: [], roster: null })!;
    expect(plain.choices.map((c) => c.key)).toEqual(['retry', 'stop']);
  });

  it('sends the judgment with its rationale', async () => {
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human', clis: ['claude'] } as never, UNITS)} gate={gate(REVERIFY_PROMPT)} navigate={vi.fn()} />);
    fireEvent.click(await screen.findByText(OPERATOR_JUDGMENT_LABEL, { selector: `[data-choice-key="${FLOOR_OVERRIDE_KEY}"] b` }));
    const note = await screen.findByTestId('session-gate-note') as HTMLTextAreaElement;
    const send = screen.getByTestId('session-gate-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const why = 'the same 9 failures fail on the tip; none in files this run touched';
    fireEvent.change(note, { target: { value: why } });
    fireEvent.click(send);
    await waitFor(() => expect(client.api.confirmGate).toHaveBeenCalledTimes(1));
    const [runId, body] = vi.mocked(client.api.confirmGate).mock.calls[0]!;
    expect(runId).toBe(RUN);
    expect(body).toMatchObject({ approve: true, action: 'operator_judgment', amend: why });
  });
});

describe('studio#920 — the engine\'s [exit N] is not the reason; a preflight change names its files', () => {
  const PREFLIGHT = 'The deliver phase refused: deliver: pushing as mikeparcewski (GH_ACCOUNT)\n'
    + 'deliver: re-verifying the lifted tree … Nothing was staged, committed or pushed; deliver: PREFLIGHT CHANGED the verified tree: packages/crew/tests/generated/api-sample.generated.test.ts \n'
    + 'deliver: OUTCOME 9f2c failed\n\n[exit 1]. Approve to re-run the deliver phase now, or reject to cancel the run';
  it('drops a bare [exit N] line: the reason is the script\'s own last line', () => {
    const r = deliverRefusalOf('The deliver phase refused: deliver: gh is not signed in as the push identity\n\n[exit 1]. Approve to re-run the deliver phase now');
    expect(r?.reason).toBe('gh is not signed in as the push identity');
  });
  it('names the changed file, and keeps the whole list for More about this (never cut at 240)', () => {
    const r = deliverRefusalOf(PREFLIGHT)!;
    expect(r.reason).toBe('the deliver step\'s preflight changed packages/crew/tests/generated/api-sample.generated.test.ts after the checks; deliver again re-checks and delivers it');
    expect(r.changed).toEqual(['packages/crew/tests/generated/api-sample.generated.test.ts']);
    const many = deliverRefusalOf(PREFLIGHT.replace('api-sample.generated.test.ts', `api-sample.generated.test.ts ${Array.from({ length: 30 }, (_, i) => `packages/crew/src/generated/file-${i}.ts`).join(' ')}`))!;
    expect(many.reason).toMatch(/changed packages\/crew\/tests\/generated\/api-sample\.generated\.test\.ts and 30 more files after the checks/);
    expect(many.changed).toHaveLength(31);
    expect(many.changed!.at(-1)).toBe('packages/crew/src/generated/file-29.ts');
  });
});
