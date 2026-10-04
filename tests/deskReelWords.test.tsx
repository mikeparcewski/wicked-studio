// The desk-skin words the wave-4 reel takes found (studio#441, #443, #444): the gate toast, the
// undo notice and the hand-over card say the work and the target in plain words — never a run
// UUID, an engine ordinal, the raw prompt or an absolute local path.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { gateLabel, rememberWorkTitles } from '../src/board/gateActions.js';
import { plainDeliverSentence } from '../src/board/deskWords.js';
import { deliverLine } from '../src/board/proposalCard.js';
import { undoHeadline } from '../src/board/undoQueue.js';
import { GateNotifications, resetToastLedger } from '../src/components/GateNotifications.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { useMembershipStore } from '../src/store/membership.js';
import { DEFAULT_APPEARANCE, useAppearanceStore } from '../src/theming/appearance.js';
import { makeUnit, makeView } from './factories.js';

const UUID = '75c25923-7f98-43ef-85fa-454bedbeecb2';
const PROBLEM = 'Add a short "Rules for booking" section to PROPOSAL.md: how long one booking can last.';
const PLAN_PROMPT = 'Approve plan rev 2 before unit 2 runs (manual mode; band 0-19; manual mode): pa-scope → clarify → design → build → adversarial-review → test → review';
const LOCAL_CARD = `Pushes branch wicked/${UUID} to origin (/var/repos/origins/checkout-demo.git) — a local path, so no pull request can be opened against it: unless another remote in this checkout is a GitHub repository gh resolves, the pushed branch IS the delivery.`;
const ENGINE = /\b(?:rev|unit|band|mode|gh resolves|IS the delivery)\b|#\d|→|\/var\/|75c25923|wicked\//;

function gate(over: Partial<OpenGate> = {}): OpenGate {
  return { runId: UUID, ord: 2, prompt: PLAN_PROMPT, lifecycle: 'open', receivedAt: Date.now(), gateKind: 'plan_approval', ...over };
}

beforeEach(() => {
  resetToastLedger();
  useGateStore.setState({ gates: {} });
  useMembershipStore.setState({ projectIdByRun: {}, projectNameByRun: { [UUID]: 'Library booking' } });
  rememberWorkTitles([]);
});
afterEach(() => {
  cleanup();
  useAppearanceStore.setState({ appearance: DEFAULT_APPEARANCE, loaded: false });
});

describe('studio#443: the undo notice names the work, never a run UUID', () => {
  it('a plan gate reads "the plan for <the work>"', () => {
    useGateStore.setState({ gates: { [UUID]: gate() } });
    rememberWorkTitles([makeView({ id: UUID, status: 'awaiting_human', problem: PROBLEM }, [])]);
    const label = gateLabel(UUID);
    expect(label).toBe('the plan for “Add a short "Rules for booking" section to PROPOSAL.md”');
    const head = undoHeadline({ id: 1, verb: 'approve', runIds: [UUID], preview: '', label, amend: null, queuedAt: 0, dueAt: 8_000 }, 0);
    expect(head).toBe('Approving the plan for “Add a short "Rules for booking" section to PROPOSAL.md” in 8 s');
    expect(head).not.toContain(UUID);
  });
  it('a deliver gate reads "the hand-over of <the work>"; a gate with no plain noun the work alone', () => {
    rememberWorkTitles([makeView({ id: UUID, status: 'awaiting_human', problem: PROBLEM }, [])]);
    useGateStore.setState({ gates: { [UUID]: gate({ gateKind: 'deliver', prompt: 'Approve delivery before unit 8 runs. ' + LOCAL_CARD }) } });
    expect(gateLabel(UUID)).toBe('the hand-over of “Add a short "Rules for booking" section to PROPOSAL.md”');
    useGateStore.setState({ gates: { [UUID]: gate({ gateKind: 'def', prompt: 'Retry unit 5 with a longer budget?' }) } });
    expect(gateLabel(UUID)).toBe('“Add a short "Rules for booking" section to PROPOSAL.md”');
  });
});

describe('studio#444: the hand-over says the target in one plain sentence', () => {
  it.each([
    [LOCAL_CARD, 'checkout-demo', 'Pushes your changes as a new branch to checkout-demo’s origin on this machine. There is no pull request: the branch is the delivery.'],
    [`Pushes branch wicked/${UUID} to acme/shop on GitHub and opens a pull request there; merge stays human.`, 'shop', 'Pushes your changes as a new branch to acme/shop on GitHub and opens a pull request there. Merging stays yours.'],
    [`Pushes branch wicked/${UUID} to origin and opens a pull request; merge stays human.`, null, 'Pushes your changes as a new branch to the repository’s origin and opens a pull request. Merging stays yours.'],
    [`Pushes branch wicked/${UUID} to origin (git.example.com) and opens a pull request only if gh resolves git.example.com as a GitHub host it is logged in to; otherwise no pull request is opened and the pushed branch IS the delivery. Merge stays human.`, 'shop', 'Pushes your changes as a new branch to shop’s origin on git.example.com. A pull request opens only if that is a GitHub host you’re signed in to; otherwise the branch is the delivery.'],
    [`Pushes wicked/${UUID} onto pull request #42 (branch fix/cart); no new PR.`, 'shop', 'Adds your changes to pull request #42.'],
    ['Pushes the run branch to origin — but this repository has no `origin` remote, so the push will fail and nothing will be delivered. Add the remote first.', 'shop', 'shop has no origin to push to, so nothing would be delivered. Add the remote first.'],
  ])('%s', (card, repo, plain) => {
    expect(plainDeliverSentence(card, repo)).toBe(plain);
  });
  it('the hand-over card line (and so its "Are you sure?" and the undo preview) carries no path, run id or engine words', () => {
    const units = [makeUnit({ id: `${UUID}:deliver`, session_id: UUID, ord: 8, status: 'pending', description: `deliver — ${PROBLEM} ||| ${LOCAL_CARD} Push identity: none configured.` })];
    const view = makeView({ id: UUID, status: 'awaiting_human', problem: PROBLEM, repo_ref: 'checkout-demo' } as never, units);
    const line = deliverLine(view, gate({ ord: 8, gateKind: 'deliver' }));
    expect(line).toBe('Pushes your changes as a new branch to checkout-demo’s origin on this machine. There is no pull request: the branch is the delivery.');
    expect(line).not.toMatch(ENGINE);
  });
});

describe('studio#441: desk-skin gate toasts speak the Desk’s words', () => {
  it('the plain question and the work, no run hash, ordinal, raw prompt or mono, and the toast marks are not violet', () => {
    useAppearanceStore.setState({ appearance: { ...DEFAULT_APPEARANCE, skin: 'desk' }, loaded: true });
    useGateStore.setState({ gates: { [UUID]: gate() } });
    const runs = [makeView({ id: UUID, status: 'awaiting_human', problem: PROBLEM }, [])];
    render(<GateNotifications onSelect={() => {}} runs={runs} />);
    const toast = screen.getByTestId('gate-notification');
    const text = toast.textContent ?? '';
    expect(text).toContain('Approve the plan (7 steps)');
    expect(text).toContain('Add a short "Rules for booking" section to PROPOSAL.md');
    expect(text).not.toMatch(/Run awaiting human|before unit|75c25923|band|manual mode|pa-scope/);
    expect(toast.innerHTML).not.toMatch(/font-mono|status-gate|monospace/);
  });
  it('the overflow line does not send the reader to a runs bar the desk skin has no', () => {
    useAppearanceStore.setState({ appearance: { ...DEFAULT_APPEARANCE, skin: 'desk' }, loaded: true });
    const gates = Object.fromEntries(['a', 'b', 'c', 'd'].map((id) => [id, gate({ runId: id })]));
    useGateStore.setState({ gates });
    render(<GateNotifications onSelect={() => {}} />);
    expect(screen.getByTestId('gate-toast-overflow').textContent).toBe('+1 more waiting on the Desk');
  });
  it('the studio skin keeps its toast as it was', () => {
    useAppearanceStore.setState({ appearance: { ...DEFAULT_APPEARANCE, skin: 'studio' }, loaded: true });
    useGateStore.setState({ gates: { [UUID]: gate() } });
    render(<GateNotifications onSelect={() => {}} />);
    expect(screen.getByTestId('gate-notification').textContent).toContain('Run awaiting human');
  });
});

describe('studio#441: a deliver gate’s question in the Desk’s words', () => {
  it('"Approve delivery before unit 8 runs. <card>" asks for the hand-over, never "Waiting on your answer"', async () => {
    const { plainGateQuestion } = await import('../src/board/deskWords.js');
    expect(plainGateQuestion(`Approve delivery before unit 8 runs. ${LOCAL_CARD}`, undefined)).toBe('Approve the hand-over');
    expect(plainGateQuestion('anything', 'deliver')).toBe('Approve the hand-over');
  });
});

describe('codex on studio#443', () => {
  it('another gate names its question with the work ("the review for “…”")', () => {
    rememberWorkTitles([makeView({ id: UUID, status: 'awaiting_human', problem: PROBLEM }, [])]);
    useGateStore.setState({ gates: { [UUID]: gate({ gateKind: 'def', prompt: 'Approve the output of unit 5 (adversarial-review — Add it)' }) } });
    expect(gateLabel(UUID)).toBe('the review for “Add a short "Rules for booking" section to PROPOSAL.md”');
  });
  it('before the run list has the run, the label is the project or "this run" — never the id', () => {
    expect(gateLabel(UUID)).toBe('a run in Library booking');
    useMembershipStore.setState({ projectNameByRun: {} });
    expect(gateLabel(UUID)).toBe('this run');
  });
});
