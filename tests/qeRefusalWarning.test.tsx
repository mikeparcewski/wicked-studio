/**
 * The warning a failure BECAUSE QE acceptance is required gets (operator ask, 2026-10-14): what failed
 * and why in plain words, then — only when this computer's service reports QE acceptance `required` —
 * that it can be turned off, with a link straight to the Settings switch (`/system#qe-acceptance`).
 * QE already off: what else to do. Matched on crew's structured `code: 'qe_acceptance_required'`;
 * an older crew's launch sentence only on both of its fixed parts.
 *
 * Surfaces: the composer and the New job wizard (launch 400), the deliver card and the gate row (gate
 * 409), the stranded card and the Delivery card (post-hoc 409), the deliver card before it is pressed
 * (a hand-over crew will refuse), the decision toast and the approvals bar; and Settings landing on
 * the switch.
 */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import type { CoreEvent, RunAcceptanceSummary, SessionView, SessionWithDelivery } from '../src/api/types.js';
import type { ChainModel } from '../src/board/chainModel.js';
import { QE_SETTING_PATH, qeDeliveryFix, qeRefusalOf, qeRefusalWords } from '../src/board/qeRefusal.js';
import { QE_REFUSED_TEXT, sendGateDecision, useGateActionStore } from '../src/board/gateActions.js';
import { flushDecisionsForTest, reportDecision, resetDecisionsForTest, setUndoWindowForTest } from '../src/board/undoQueue.js';
import { useBatchGateStore } from '../src/board/batchGates.js';
import { ReassignControl } from '../src/components/ReassignControl.js';
import { QeRefusalWarning } from '../src/components/QeRefusalWarning.js';
import { resetQeSettingForTests } from '../src/store/qeSetting.js';
import { usePostHocDeliverStore } from '../src/store/postHocDeliver.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeUnit, makeView } from './factories.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { ProposalCard } from '../src/components/session/ProposalCard.js';
import { StrandedCard } from '../src/components/session/StrandedCard.js';
import { RunDelivery } from '../src/components/RunDelivery.js';
import { ChatInput } from '../src/components/ChatInput.js';
import { LaunchWizard } from '../src/components/launch/LaunchWizard.js';
import { SystemSettings } from '../src/components/SystemSettings.js';
import { UndoToasts } from '../src/components/UndoToasts.js';
import { ApprovalGroupActions } from '../src/components/desk/ApprovalGroupActions.js';

vi.mock('../src/components/Terminal.js', () => ({ Terminal: () => <div data-testid="mock-terminal" /> }));

/** crew ≤ 0.12.0's launch sentence (routes.ts), verbatim. */
const LAUNCH_SENTENCE =
  'workflow bug requires QE acceptance (required_instruments: qe_acceptance), so it delivers only through the deliver gate, '
  + 'where the verdict is checked — deliverGate: "auto" cannot apply to it (unless the launch explicitly skips QE acceptance with a reason: skipQeAcceptance)';
const DELIVERY_SENTENCE =
  'run r-qe requires QE acceptance (qe_acceptance) and its delivery is refused: the QE ledger holds no PASS attributed to this run. '
  + 'Nothing was pushed and the deliver gate stays open — record a PASS attributed to this run in its QE ledger (garden qe accept), then approve again.';
const launchRefusal = (withCode = true): ApiError =>
  new ApiError(400, LAUNCH_SENTENCE, withCode ? { code: 'qe_acceptance_required', error: LAUNCH_SENTENCE } : { error: LAUNCH_SENTENCE });
const deliveryRefusal = (): ApiError =>
  new ApiError(409, DELIVERY_SENTENCE, {
    code: 'qe_acceptance_required', error: DELIVERY_SENTENCE,
    acceptance: { status: 'required', satisfied: false, reason: 'no PASS', verdictId: null, reviewer: null }, assurance: null,
  });

function health(qeAcceptance: 'off' | 'required' | undefined): void {
  vi.spyOn(client.api, 'getHealth').mockResolvedValue({
    status: 'ok', version: 'test', capabilities: { qeAcceptanceOverride: true, ...(qeAcceptance !== undefined ? { qeAcceptance } : {}) },
  } as never);
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetQeSettingForTests();
  resetDecisionsForTest();
  window.history.replaceState(null, '', '/');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('which failures are QE acceptance refusals', () => {
  it('a 409 with crew’s code is a refused delivery; a 400 with it is a refused launch', () => {
    expect(qeRefusalOf(deliveryRefusal())).toBe('delivery');
    expect(qeRefusalOf(launchRefusal())).toBe('launch');
  });
  it('an older crew’s launch sentence (no code) matches only on both of its fixed parts', () => {
    expect(qeRefusalOf(launchRefusal(false))).toBe('launch');
    expect(qeRefusalOf(new ApiError(400, 'workflow bug requires QE acceptance (required_instruments: qe_acceptance), so it delivers only through the deliver gate'))).toBeNull();
    expect(qeRefusalOf(new ApiError(400, 'deliverGate: "auto" cannot apply'))).toBeNull();
  });
  it('anything else is not: another 409 code, a 409 without a code, a 400 naming deliver, a 400 with another code, a plain error', () => {
    expect(qeRefusalOf(new ApiError(409, 'gate moved', { code: 'gate_changed' }))).toBeNull();
    expect(qeRefusalOf(new ApiError(409, DELIVERY_SENTENCE))).toBeNull();
    expect(qeRefusalOf(new ApiError(400, 'unknown field deliver'))).toBeNull();
    expect(qeRefusalOf(new ApiError(400, LAUNCH_SENTENCE, { code: 'something_else' }))).toBeNull();
    expect(qeRefusalOf(new Error(LAUNCH_SENTENCE))).toBeNull();
    expect(qeRefusalOf(new ApiError(500, LAUNCH_SENTENCE, { code: 'qe_acceptance_required' }))).toBeNull();
  });
});

describe('the words', () => {
  it('required: says why and offers the setting; a refused delivery is told the switch is for jobs started after it', () => {
    const launch = qeRefusalWords('launch', 'required');
    expect(launch.title).toBe('Not started: this job needs QE acceptance');
    expect(launch.fix).toMatch(/turn off QE acceptance in Settings/);
    expect(launch.link).toBe(true);
    const delivery = qeRefusalWords('delivery', 'required');
    expect(delivery.title).toBe('Not delivered: QE acceptance hasn’t passed');
    expect(delivery.body).toMatch(/Nothing was pushed/);
    expect(delivery.fix).toMatch(/applies to jobs started after that, so start this job again/);
    expect(delivery.link).toBe(true);
  });
  it('off: no offer to turn off what is off — what else to do instead', () => {
    expect(qeRefusalWords('launch', 'off', { forced: true })).toMatchObject({ link: false, fix: expect.stringMatching(/You asked this job to require QE acceptance/) });
    expect(qeDeliveryFix('off')).toMatchObject({ link: false, fix: expect.stringMatching(/keeps the QE requirement it started with, so it still needs a pass/) });
  });
  it('a forced launch is never told to flip the setting, even when it is required', () => {
    expect(qeRefusalWords('launch', 'required', { forced: true }).link).toBe(false);
  });
  it('not reported (an older service, or a failed read): why only, no setting advice', () => {
    expect(qeRefusalWords('launch', null).link).toBe(false);
    expect(qeDeliveryFix(null)).toMatchObject({ link: false, fix: 'Record a QE pass for this job, then try again.' });
  });
});

describe('the warning card', () => {
  it('required: the link lands on the Settings switch, in place', async () => {
    health('required');
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(<QeRefusalWarning kind="delivery" refusalKey="k1" detail={DELIVERY_SENTENCE} navigate={navigate} testId="w" />);
    expect(screen.getByTestId('w')).toHaveTextContent('Not delivered: QE acceptance hasn’t passed');
    const link = await screen.findByTestId('w-link');
    expect(link).toHaveAttribute('href', QE_SETTING_PATH);
    expect(QE_SETTING_PATH).toBe('/system#qe-acceptance');
    await user.click(link);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/system#qe-acceptance');
    // crew's sentence stays readable behind Technical details, never as the card's prose.
    expect(screen.getByTestId('w-detail').textContent).toContain('garden qe accept');
    expect(screen.getByTestId('w').dataset.setting).toBe('required');
  });
  it('without a navigate it pushes the address itself (popstate), so any surface can carry it', async () => {
    health('required');
    const pop = vi.fn();
    window.addEventListener('popstate', pop);
    const user = userEvent.setup();
    render(<QeRefusalWarning kind="launch" refusalKey="k1" testId="w" />);
    await user.click(await screen.findByTestId('w-link'));
    expect(window.location.pathname + window.location.hash).toBe('/system#qe-acceptance');
    expect(pop).toHaveBeenCalled();
    window.removeEventListener('popstate', pop);
  });
  it('off: no link; says what else to do', async () => {
    health('off');
    render(<QeRefusalWarning kind="delivery" refusalKey="k1" testId="w" />);
    expect(await screen.findByTestId('w-fix')).toHaveTextContent(/keeps the QE requirement it started with/);
    expect(screen.queryByTestId('w-link')).toBeNull();
  });
  it('a service that does not report the setting: why, and no advice to turn anything off', async () => {
    health(undefined);
    render(<QeRefusalWarning kind="launch" refusalKey="k1" testId="w" />);
    expect(await screen.findByTestId('w-fix')).toHaveTextContent('Let the job ask you before it pushes.');
    expect(screen.queryByTestId('w-link')).toBeNull();
  });
  it('the setting is read afresh for each warning: flipped off since the last one, no link', async () => {
    health('required');
    const first = render(<QeRefusalWarning kind="delivery" refusalKey="k1" testId="w" />);
    await screen.findByTestId('w-link');
    first.unmount();
    health('off');
    render(<QeRefusalWarning kind="delivery" refusalKey="k1" testId="w" />);
    expect(await screen.findByTestId('w-fix')).toHaveTextContent(/keeps the QE requirement it started with/);
    expect(screen.queryByTestId('w-link')).toBeNull();
  });
});

describe('the setting is never stale', () => {
  it('a warning that stays mounted re-reads for a new refusal (its key), e.g. the Delivery card moving to another run', async () => {
    health('required');
    const view = render(<QeRefusalWarning kind="delivery" refusalKey="run-a" testId="w" />);
    await screen.findByTestId('w-link');
    health('off');
    view.rerender(<QeRefusalWarning kind="delivery" refusalKey="run-b" testId="w" />);
    await waitFor(() => expect(screen.getByTestId('w').dataset.setting).toBe('off'));
    expect(screen.queryByTestId('w-link')).toBeNull();
  });
  it('the window regaining focus re-reads (the switch flipped in another tab)', async () => {
    health('required');
    render(<QeRefusalWarning kind="delivery" refusalKey="run-a" testId="w" />);
    await screen.findByTestId('w-link');
    health('off');
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(screen.queryByTestId('w-link')).toBeNull());
    expect(screen.getByTestId('w-fix')).toHaveTextContent(/keeps the QE requirement it started with/);
  });
});

// ── (1) launch refused ────────────────────────────────────────────────────────────────────────────
describe('the composer: a launch refused because QE acceptance is required', () => {
  const BUG = { id: 'bug', phases: [{ id: 'fix', kind: 'build', executes_code: true, role: 'creator' }], required_instruments: ['distinct_evaluator', 'judge', 'qe_acceptance'] };
  beforeEach(async () => {
    const { setRetryPrefill, takeRetryPrefill } = await import('../src/store/retryPrefill.js');
    takeRetryPrefill();
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: ['claude', 'codex'].map((k) => ({ key: k, display_name: k, binary: k, enabled_for_council: true })) } as never);
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [{ id: 'repo-1', name: 'app', root_path: '/srv/app' }] } as never);
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [BUG] } as never);
    vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
    vi.spyOn(client.api, 'getDeliverTarget').mockResolvedValue(null as never);
    localStorage.clear();
    setRetryPrefill({
      retryOf: 'r-qe', problem: 'fix the signup crash', clis: ['claude', 'codex'], workflowId: 'bug', repoRef: 'repo-1',
      entityMode: 'shared', humanConfirm: { before: 1 }, projectId: null,
    });
  });
  async function send(): Promise<void> {
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
  }

  it('required: the warning says why and links to the switch; the bare error line is not shown; nothing is retried', async () => {
    health('required');
    vi.spyOn(client.api, 'launchRun').mockRejectedValue(launchRefusal());
    const navigate = vi.fn();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} navigate={navigate} />);
    await send();
    const card = await screen.findByTestId('launch-qe-refused');
    expect(card).toHaveTextContent('Not started: this job needs QE acceptance');
    expect(screen.queryByTestId('launch-error')).toBeNull();
    const link = await screen.findByTestId('launch-qe-refused-link');
    await userEvent.setup().click(link);
    expect(navigate).toHaveBeenCalledWith('/system#qe-acceptance');
    // The refusal also says "deliver": it is never retried without the key (one POST, not two).
    expect(client.api.launchRun).toHaveBeenCalledTimes(1);
  });

  it('an older crew’s sentence-only refusal gets the same warning', async () => {
    health('required');
    vi.spyOn(client.api, 'launchRun').mockRejectedValue(launchRefusal(false));
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await send();
    expect(await screen.findByTestId('launch-qe-refused')).toBeInTheDocument();
    expect(client.api.launchRun).toHaveBeenCalledTimes(1);
  });

  it('any other refusal keeps the plain error line', async () => {
    health('required');
    vi.spyOn(client.api, 'launchRun').mockRejectedValue(new ApiError(400, 'problem is required'));
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await send();
    expect(await screen.findByTestId('launch-error')).toBeInTheDocument();
    expect(screen.queryByTestId('launch-qe-refused')).toBeNull();
  });
});

describe('the New job wizard: a launch refused because QE acceptance is required', () => {
  const BUG = { id: 'bug', phases: [{ id: 'fix', kind: 'build', executes_code: true, role: 'creator' }], required_instruments: ['distinct_evaluator', 'judge', 'qe_acceptance'] };
  beforeEach(async () => {
    const { resetLaunchWizard } = await import('../src/store/launchWizard.js');
    const { clearCachedWorkflows, setCachedWorkflows } = await import('../src/store/workflowCache.js');
    resetLaunchWizard();
    clearCachedWorkflows();
    setCachedWorkflows([BUG] as never);
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: ['claude', 'codex'].map((k) => ({ key: k, display_name: k, binary: k, enabled_for_council: true, auth: 'signed_in' })) } as never);
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [{ id: 'repo-1', name: 'app', root_path: '/srv/app' }] } as never);
    vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  });

  async function launchToRefusal(): Promise<ReturnType<typeof userEvent.setup>> {
    const { openLaunchWizard } = await import('../src/store/launchWizard.js');
    const user = userEvent.setup();
    render(<LaunchWizard navigate={navigateSpy} />);
    act(() => openLaunchWizard({ workflowId: 'bug', intent: 'fix the signup crash', contextRepo: 'repo-1' }));
    for (;;) {
      if (screen.queryByTestId('launch-wizard-launch') !== null) break;
      await waitFor(() => expect(screen.getByTestId('launch-wizard-next')).toBeEnabled());
      await user.click(screen.getByTestId('launch-wizard-next'));
    }
    await waitFor(() => expect(screen.getByTestId('launch-wizard-launch')).toBeEnabled());
    await user.click(screen.getByTestId('launch-wizard-launch'));
    return user;
  }
  const navigateSpy = vi.fn();

  it('required: the warning replaces the generic error; the link closes the wizard (keeping the draft) and lands on the switch', async () => {
    health('required');
    navigateSpy.mockReset();
    vi.spyOn(client.api, 'launchRun').mockRejectedValue(launchRefusal());
    const user = await launchToRefusal();
    expect(await screen.findByTestId('launch-wizard-qe-refused')).toHaveTextContent('Not started: this job needs QE acceptance');
    expect(screen.queryByTestId('launch-wizard-error')).toBeNull();
    await user.click(await screen.findByTestId('launch-wizard-qe-refused-link'));
    const { useLaunchWizard } = await import('../src/store/launchWizard.js');
    expect(useLaunchWizard.getState().open).toBe(false);
    expect(useLaunchWizard.getState().draft).not.toBeNull();
    expect(navigateSpy).toHaveBeenCalledExactlyOnceWith('/system#qe-acceptance');
  });

  it('any other refusal keeps the generic error', async () => {
    health('required');
    vi.spyOn(client.api, 'launchRun').mockRejectedValue(new ApiError(400, 'problem is required'));
    await launchToRefusal();
    expect(await screen.findByTestId('launch-wizard-error')).toBeInTheDocument();
    expect(screen.queryByTestId('launch-wizard-qe-refused')).toBeNull();
  });
});

// ── (2) delivery refused at the gate, and post-hoc ───────────────────────────────────────────────
describe('the one gate send: a 409 qe_acceptance_required is recorded as a QE refusal', () => {
  it('plain words in `error`, crew’s sentence as the detail, the flag set; a new attempt clears it', async () => {
    vi.spyOn(client.api, 'confirmGate').mockRejectedValueOnce(deliveryRefusal());
    const why = await sendGateDecision('r-qe', { approve: true });
    expect(why).toBe(QE_REFUSED_TEXT);
    const st = useGateActionStore.getState().byGate['r-qe']!;
    expect(st.qeRefusal).toBe(true);
    expect(st.errorDetail).toBe(DELIVERY_SENTENCE);
    vi.mocked(client.api.confirmGate).mockRejectedValueOnce(new ApiError(400, 'bad ord'));
    await sendGateDecision('r-qe', { approve: true });
    const after = useGateActionStore.getState().byGate['r-qe']!;
    expect(after.qeRefusal).toBeUndefined();
    expect(after.error).toBe('the daemon refused this — bad ord');
  });
});

describe('the deliver card', () => {
  const R = 'r-qe';
  const NOW = Date.now();
  const CHAIN: ChainModel = { source: 'units', steps: [], proposed: false, transportLine: null, done: 0, total: 0, checked: null };
  const gate = { runId: R, ord: 2, prompt: 'deliver: push the run branch and open a PR on origin — confirm to deliver, reject to keep it local', lifecycle: 'open' as const, receivedAt: NOW, gateKind: 'deliver' };
  const QE = { type: 'qeAcceptanceDecided', session: R, qe: { status: 'required', basis: 'diff', score: 55, threshold: 20, reason: 'the diff scored 55', reasons: [] } };
  const view = (): SessionView => makeView({ id: R, status: 'awaiting_human' }, [
    makeUnit({ id: `${R}:build`, session_id: R, ord: 1, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'claude' }),
    makeUnit({ id: `${R}:deliver`, session_id: R, ord: 2, stage: 'build', phase_ref: 'deliver', role: 'neutral', status: 'pending' }),
  ]);
  beforeEach(() => {
    useGateActionStore.setState({ byGate: {} });
    useGateStore.setState({ gates: { [R]: gate } });
    useRunEventStore.setState({ byRun: { [R]: [QE] as unknown as CoreEvent[] } });
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      const body = path.endsWith('/events') ? { events: [QE] } : {};
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    }));
  });

  it('(3) parked on the QE check: Deliver waits, and the card offers the setting (required)', async () => {
    health('required');
    const summary: RunAcceptanceSummary = { required: true, satisfied: false, walkthrough: null, line: 'Not accepted yet: no QE ledger (missing ⇒ deny)' } as never;
    render(<ProposalCard view={view()} chain={CHAIN} acceptance={summary} />);
    expect((screen.getByTestId('session-proposal-go') as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByTestId('session-proposal-qe-fix-link')).toHaveAttribute('href', '/system#qe-acceptance');
    expect(screen.getByTestId('session-proposal-qe-fix-fix')).toHaveTextContent(/start this job again to deliver it without the check/);
  });

  it('(3) parked with QE already off: no link, what else to do', async () => {
    health('off');
    const summary: RunAcceptanceSummary = { required: true, satisfied: false, walkthrough: null, line: 'Not accepted yet: no QE ledger (missing ⇒ deny)' } as never;
    render(<ProposalCard view={view()} chain={CHAIN} acceptance={summary} />);
    expect(await screen.findByTestId('session-proposal-qe-fix-fix')).toHaveTextContent(/keeps the QE requirement it started with/);
    expect(screen.queryByTestId('session-proposal-qe-fix-link')).toBeNull();
  });

  it('(2) crew refused the hand-over: the card shows the QE warning instead of a bare "Didn’t work"', async () => {
    health('required');
    useGateActionStore.setState({ byGate: { [R]: { queued: false, busy: false, answered: null, error: QE_REFUSED_TEXT, qeRefusal: true, errorDetail: DELIVERY_SENTENCE, receipt: null } } });
    render(<ProposalCard view={view()} chain={CHAIN} acceptance={null} />);
    expect(await screen.findByTestId('session-proposal-qe-refused')).toHaveTextContent('Not delivered: QE acceptance hasn’t passed');
    expect(screen.queryByTestId('session-proposal-reason')).toBeNull();
    expect(await screen.findByTestId('session-proposal-qe-refused-link')).toHaveAttribute('href', '/system#qe-acceptance');
  });

  it('any other refusal keeps "Didn’t work" and crew’s words', async () => {
    health('required');
    useGateActionStore.setState({ byGate: { [R]: { queued: false, busy: false, answered: null, error: 'the daemon refused this — deliveries are frozen', receipt: null } } });
    render(<ProposalCard view={view()} chain={CHAIN} acceptance={null} />);
    expect(screen.getByTestId('session-proposal-reason')).toHaveTextContent('deliveries are frozen');
    expect(screen.queryByTestId('session-proposal-qe-refused')).toBeNull();
  });
});

describe('the gate row (an escalation on the deliver unit whose retry crew refused)', () => {
  const RUN = 'r-esc';
  const UNITS = [
    makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 1, stage: 'build', role: 'creator', status: 'done' }),
    makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 2, stage: 'build', phase_ref: 'deliver', role: 'neutral', status: 'rejected' }),
  ];
  const EVENTS = [{ type: 'awaitingHuman', session: RUN, ord: 2, ts: 1, gateKind: 'escalation', prompt: 'deliver failed: push refused (403)' }] as unknown as CoreEvent[];
  const gate = { runId: RUN, ord: 2, prompt: 'deliver failed: push refused (403)', lifecycle: 'open' as const, receivedAt: 1 };
  beforeEach(() => {
    useGateStore.setState({ gates: {} });
    useRunEventStore.setState({ byRun: { [RUN]: EVENTS } });
    vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: EVENTS } as never);
  });
  it('shows the QE warning in place of the bare error line, with the link', async () => {
    health('required');
    useGateActionStore.setState({ byGate: { [RUN]: { queued: false, busy: false, answered: null, error: QE_REFUSED_TEXT, qeRefusal: true, errorDetail: DELIVERY_SENTENCE, receipt: null } } });
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS)} gate={gate} />);
    expect(await screen.findByTestId('session-gate-qe-refused')).toHaveTextContent('Not delivered: QE acceptance hasn’t passed');
    expect(screen.queryByTestId('session-gate-error')).toBeNull();
    expect(await screen.findByTestId('session-gate-qe-refused-link')).toHaveAttribute('href', '/system#qe-acceptance');
  });
  it('another refusal keeps the error line', async () => {
    useGateActionStore.setState({ byGate: { [RUN]: { queued: false, busy: false, answered: null, error: 'the daemon refused this — bad ord', receipt: null } } });
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS)} gate={gate} />);
    expect(await screen.findByTestId('session-gate-error')).toHaveTextContent('bad ord');
    expect(screen.queryByTestId('session-gate-qe-refused')).toBeNull();
  });
});

describe('post-hoc delivery refused (POST /runs/:id/deliver 409)', () => {
  function strandedView(id = 'r-str'): SessionView {
    const v = makeView(
      { id, workflow_id: 'feature', status: 'completed', workdir: '/w/trees/r-str', repo_ref: 'studio-api', problem: 'Fix the double charge' },
      [makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' }),
        makeUnit({ id: `${id}:deliver`, session_id: id, ord: 1, status: 'rejected', phase_ref: 'deliver' })],
    );
    (v.session as SessionWithDelivery).delivery = 'stranded';
    return v;
  }
  beforeEach(() => {
    usePostHocDeliverStore.setState({ byRun: {} });
    useRunEventStore.setState({ byRun: { 'r-str': [] } });
    window.localStorage.clear();
  });

  it('the store records it as a QE refusal: plain words, crew’s sentence kept', async () => {
    vi.spyOn(client.api, 'deliverRun').mockRejectedValue(deliveryRefusal());
    usePostHocDeliverStore.getState().deliver('r-str');
    await waitFor(() => expect(usePostHocDeliverStore.getState().byRun['r-str']?.phase).toBe('error'));
    expect(usePostHocDeliverStore.getState().byRun['r-str']).toEqual({ phase: 'error', error: QE_REFUSED_TEXT, qe: true, detail: DELIVERY_SENTENCE });
  });

  it('the stranded card in the thread shows the warning with the link', async () => {
    health('required');
    vi.spyOn(client.api, 'deliverRun').mockRejectedValue(deliveryRefusal());
    render(<StrandedCard view={strandedView()} />);
    await userEvent.setup().click(screen.getByTestId('session-stranded-deliver'));
    expect(await screen.findByTestId('session-stranded-qe-refused')).toHaveTextContent('Not delivered: QE acceptance hasn’t passed');
    expect(screen.queryByTestId('session-stranded-error')).toBeNull();
    expect(await screen.findByTestId('session-stranded-qe-refused-link')).toHaveAttribute('href', '/system#qe-acceptance');
  });

  it('the Delivery card shows the warning with the link', async () => {
    health('required');
    vi.spyOn(client.api, 'deliverRun').mockRejectedValue(deliveryRefusal());
    const navigate = vi.fn();
    render(<RunDelivery view={strandedView()} navigate={navigate} />);
    await userEvent.setup().click(screen.getByTestId('run-deliver-button'));
    expect(await screen.findByTestId('run-deliver-qe-refused')).toBeInTheDocument();
    expect(screen.queryByTestId('run-deliver-error')).toBeNull();
    await userEvent.setup().click(await screen.findByTestId('run-deliver-qe-refused-link'));
    expect(navigate).toHaveBeenCalledWith('/system#qe-acceptance');
  });

  it('a non-QE refusal keeps the stranded headline and crew’s words', async () => {
    vi.spyOn(client.api, 'deliverRun').mockRejectedValue(new ApiError(409, 'rebase hit a conflict; nothing was pushed'));
    render(<StrandedCard view={strandedView()} />);
    await userEvent.setup().click(screen.getByTestId('session-stranded-deliver'));
    expect(await screen.findByTestId('session-stranded-error')).toHaveTextContent('rebase hit a conflict');
    expect(screen.queryByTestId('session-stranded-qe-refused')).toBeNull();
  });
});

describe('where a decision’s outcome is told', () => {
  it('the toast of a QE refusal offers the setting only when it is required; another failure’s toast offers nothing', async () => {
    health('required');
    render(<UndoToasts />);
    act(() => reportDecision('failed', `Not sent: this run — ${QE_REFUSED_TEXT}`, { qe: true }));
    act(() => reportDecision('failed', 'Not sent: this run — bad ord'));
    const results = screen.getAllByTestId('undo-result');
    expect(results).toHaveLength(2);
    await waitFor(() => expect(results[0]!.querySelector('[data-testid="undo-result-qe-link"]')).toHaveAttribute('href', '/system#qe-acceptance'));
    expect(results[0]!.textContent).toMatch(/can be turned off for jobs started later/);
    expect(results[1]!.querySelector('[data-testid="undo-result-qe"]')).toBeNull();
  });
  it('the toast when QE acceptance is already off: no link, the job keeps its requirement', async () => {
    health('off');
    render(<UndoToasts />);
    act(() => reportDecision('failed', `Not sent: this run — ${QE_REFUSED_TEXT}`, { qe: true }));
    const offer = await screen.findByTestId('undo-result-qe');
    expect(offer).toHaveTextContent('QE acceptance is off, but this job keeps the requirement it started with.');
    expect(screen.queryByTestId('undo-result-qe-link')).toBeNull();
  });
  it('the toast when the service does not report the setting: no offer at all', async () => {
    health(undefined);
    render(<UndoToasts />);
    act(() => reportDecision('failed', `Not sent: this run — ${QE_REFUSED_TEXT}`, { qe: true }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByTestId('undo-result-qe')).toBeNull();
  });

  it('the approvals bar: a member crew refused for QE acceptance gets the offer (required), another failure none', async () => {
    health('required');
    useGateActionStore.setState({ byGate: {
      'r-a': { queued: false, busy: false, answered: null, error: QE_REFUSED_TEXT, qeRefusal: true, errorDetail: DELIVERY_SENTENCE, receipt: null },
      'r-b': { queued: false, busy: false, answered: null, error: 'bad ord', receipt: null },
    } });
    useBatchGateStore.setState({ failures: [{ runId: 'r-a', error: QE_REFUSED_TEXT }, { runId: 'r-b', error: 'bad ord' }] } as never);
    render(<ApprovalGroupActions runIds={['r-a', 'r-b']} label="2 approvals" />);
    const rows = screen.getAllByTestId('need-group-failure');
    await waitFor(() => expect(rows[0]!.querySelector('[data-testid="need-group-failure-qe-link"]')).toHaveAttribute('href', '/system#qe-acceptance'));
    expect(rows[1]!.querySelector('[data-testid="need-group-failure-qe"]')).toBeNull();
  });
  it('the approvals bar when QE acceptance is already off: no link', async () => {
    health('off');
    useGateActionStore.setState({ byGate: { 'r-a': { queued: false, busy: false, answered: null, error: QE_REFUSED_TEXT, qeRefusal: true, receipt: null } } });
    useBatchGateStore.setState({ failures: [{ runId: 'r-a', error: QE_REFUSED_TEXT }] } as never);
    render(<ApprovalGroupActions runIds={['r-a']} label="1 approval" />);
    expect(await screen.findByTestId('need-group-failure-qe')).toHaveTextContent(/keeps the requirement it started with/);
    expect(screen.queryByTestId('need-group-failure-qe-link')).toBeNull();
  });
});

describe('codex r2: no stale advice while re-reading, and the toast link is not taken from under focus', () => {
  it('a focus re-read hides the old advice until the new answer lands', async () => {
    health('required');
    render(<QeRefusalWarning kind="delivery" refusalKey="run-a" testId="w" />);
    await screen.findByTestId('w-link');
    let answer: (v: unknown) => void = () => {};
    vi.mocked(client.api.getHealth).mockReturnValue(new Promise((r) => { answer = r; }) as never);
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(screen.queryByTestId('w-link')).toBeNull();
    expect(screen.queryByTestId('w-fix')).toBeNull();
    await act(async () => { answer({ status: 'ok', version: 't', capabilities: { qeAcceptance: 'off' } }); await Promise.resolve(); });
    expect(await screen.findByTestId('w-fix')).toHaveTextContent(/keeps the QE requirement it started with/);
  });
  it('a toast whose link has focus outlives its 8 s, and goes when focus leaves', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      health('required');
      render(<UndoToasts />);
      act(() => reportDecision('failed', `Not sent: this run — ${QE_REFUSED_TEXT}`, { qe: true }));
      const link = await screen.findByTestId('undo-result-qe-link');
      act(() => { link.focus(); });
      act(() => { vi.advanceTimersByTime(9_000); });
      expect(screen.getByTestId('undo-result-qe-link')).toBeInTheDocument();
      act(() => { (document.activeElement as HTMLElement).blur(); });
      expect(screen.queryByTestId('undo-result')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('codex r3: a window focus never takes a focused toast link away', () => {
  it('the toast reads the setting once: a window focus while its link has focus leaves link and focus in place; it goes once focus leaves after its time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      health('required');
      render(<UndoToasts />);
      act(() => reportDecision('failed', `Not sent: this run — ${QE_REFUSED_TEXT}`, { qe: true }));
      const link = await screen.findByTestId('undo-result-qe-link');
      act(() => { link.focus(); });
      const reads = vi.mocked(client.api.getHealth).mock.calls.length;
      vi.mocked(client.api.getHealth).mockReturnValue(new Promise(() => {}) as never);
      act(() => { window.dispatchEvent(new Event('focus')); });
      expect(vi.mocked(client.api.getHealth).mock.calls.length).toBe(reads);
      expect(document.activeElement).toBe(screen.getByTestId('undo-result-qe-link'));
      act(() => { vi.advanceTimersByTime(9_000); });
      expect(screen.getByTestId('undo-result-qe-link')).toBeInTheDocument();
      act(() => { (document.activeElement as HTMLElement).blur(); });
      expect(screen.queryByTestId('undo-result')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('codex r4: a card re-reading beside the toast does not change the toast', () => {
  it('a mounted warning whose focus re-read answers off leaves the focused toast link, which goes once focus leaves after its time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      health('required');
      render(<><UndoToasts /><QeRefusalWarning kind="delivery" refusalKey="run-a" testId="w" /></>);
      await screen.findByTestId('w-link');
      act(() => reportDecision('failed', `Not sent: this run — ${QE_REFUSED_TEXT}`, { qe: true }));
      const link = await screen.findByTestId('undo-result-qe-link');
      act(() => { link.focus(); });
      health('off');
      act(() => { window.dispatchEvent(new Event('focus')); });
      await waitFor(() => expect(screen.getByTestId('w').dataset.setting).toBe('off'));
      expect(document.activeElement).toBe(screen.getByTestId('undo-result-qe-link'));
      act(() => { vi.advanceTimersByTime(9_000); });
      act(() => { (document.activeElement as HTMLElement).blur(); });
      expect(screen.queryByTestId('undo-result')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the reassign control (approve and move the retry): crew refused the hand-over', () => {
  it('the one gate send recorded a QE refusal: the warning instead of the bare error line; Retry stays', async () => {
    health('required');
    setUndoWindowForTest(0);
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: ['claude', 'codex'].map((k) => ({ key: k, display_name: k, binary: k, enabled_for_council: true, auth: 'signed_in' })) } as never);
    vi.spyOn(client.api, 'reassignRun').mockRejectedValue(deliveryRefusal());
    render(<ReassignControl runId="r-mv" ord={2} pool={['claude', 'codex']} failedCli="claude" onDone={vi.fn()} />);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('steering-reassign')).toBeEnabled());
    await user.click(screen.getByTestId('steering-reassign'));
    await act(async () => { await flushDecisionsForTest(); });
    expect(await screen.findByTestId('steering-reassign-qe-refused')).toHaveTextContent('Not delivered: QE acceptance hasn’t passed');
    expect(screen.queryByTestId('steering-reassign-error')).toBeNull();
    expect(screen.getByTestId('steering-reassign-retry')).toBeInTheDocument();
    setUndoWindowForTest(null);
  });
});

describe('Settings lands on the switch', () => {
  it('/system#qe-acceptance: once the settings are read, the switch is scrolled to, focused and ringed until focus leaves', async () => {
    window.history.replaceState(null, '', '/system#qe-acceptance');
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
    vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150, qeAcceptance: 'required' } as never });
    const scrolled = vi.fn();
    render(<SystemSettings />);
    const target = screen.getByTestId('qe-acceptance-setting');
    target.scrollIntoView = scrolled;
    expect(target.id).toBe('qe-acceptance');
    await waitFor(() => expect(target.dataset.targeted).toBe('true'));
    expect(document.activeElement).toBe(screen.getByTestId('qe-acceptance-toggle'));
    expect(scrolled).toHaveBeenCalled();
    act(() => { (document.activeElement as HTMLElement).blur(); });
    expect(target.dataset.targeted).toBe('false');
  });

  it('already on Settings (the router’s navigate fires no event): the link still brings the switch into view', async () => {
    window.history.replaceState(null, '', '/system');
    health('required');
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
    vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150, qeAcceptance: 'required' } as never });
    const routerNavigate = (path: string): void => { history.pushState(null, '', path); };
    render(<><SystemSettings /><QeRefusalWarning kind="launch" refusalKey="k" navigate={routerNavigate} testId="w" /></>);
    await waitFor(() => expect(screen.getByTestId('qe-acceptance-toggle')).toBeEnabled());
    expect(screen.getByTestId('qe-acceptance-setting').dataset.targeted).toBe('false');
    await userEvent.setup().click(await screen.findByTestId('w-link'));
    await waitFor(() => expect(screen.getByTestId('qe-acceptance-setting').dataset.targeted).toBe('true'));
    expect(document.activeElement).toBe(screen.getByTestId('qe-acceptance-toggle'));
  });

  it('a service without the setting (the switch is disabled): the row takes focus and the ring', async () => {
    window.history.replaceState(null, '', '/system#qe-acceptance');
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
    vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } });
    render(<SystemSettings />);
    const target = screen.getByTestId('qe-acceptance-setting');
    await waitFor(() => expect(target.dataset.targeted).toBe('true'));
    expect(screen.getByTestId('qe-acceptance-toggle')).toBeDisabled();
    expect(document.activeElement).toBe(target);
  });

  it('without the anchor nothing is focused or ringed', async () => {
    window.history.replaceState(null, '', '/system');
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
    vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150, qeAcceptance: 'required' } as never });
    render(<SystemSettings />);
    await waitFor(() => expect(screen.getByTestId('qe-acceptance-toggle')).toBeEnabled());
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.getByTestId('qe-acceptance-setting').dataset.targeted).toBe('false');
    expect(document.activeElement).not.toBe(screen.getByTestId('qe-acceptance-toggle'));
  });
});
