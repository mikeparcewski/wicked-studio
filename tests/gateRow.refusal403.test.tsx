/**
 * studio#403 (studio half): the engine's retry gate after a refused hand-over is answerable in the
 * session thread, leads with the remote's reason, and says what Deliver again re-pushes.
 *
 * Before: `proposalKindOf` called the gate a failure (not a hand-over) while `classifyRowGate` called
 * it the deliver card, so neither ProposalCard nor GateRow rendered it.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { WorkUnit } from '../src/api/types.js';
import { useGateActionStore } from '../src/board/gateActions.js';
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
