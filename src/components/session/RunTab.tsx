import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SessionView } from '../../api/types.js';
import type { Navigate } from '../../hooks/useRoute.js';
import type { ChainModel, ChainStep } from '../../board/chainModel.js';
import { jobTitle } from '../../board/deskWords.js';
import { moneyWords } from '../../board/deskPulse.js';
import { workflowLabel } from '../../board/workflowNames.js';
import { chatStatusWord } from '../../board/statusWords.js';
import { seatLabel } from '../../board/seatNames.js';
import { ORPHANED_LINE, orphanedOf } from '../../board/sessionModel.js';
import { finishedDeliveryArm } from '../../board/proposalCard.js';
import { useRoster } from '../../hooks/useRoster.js';
import { builderResponder, isHelperSeat, isReviewUnit } from '../../board/responder.js';
import { executingOrd } from '../../api/run-state.js';
import { useRunAcceptance } from '../../hooks/useRunAcceptance.js';
import { useRunEvents } from '../../hooks/useRunEvents.js';
import { overriddenFloorsOf, overriddenLine } from '../../board/failingChecks.js';
import { useGateStore } from '../../store/gates.js';
import { openSheet, stopRun, useSheets } from '../../store/sheets.js';
import { useRunChain } from './ChainLine.js';
import { RunAssuranceLabel } from './AssuranceReceipt.js';
import { CodebaseDownload, DeliverCredentialsNotice } from './CodebaseDownload.js';
import { AssuranceReceipt, DeliveryAssuranceLines } from './AssuranceReceipt.js';
import { RunRecordLines, RunStory } from './RunRecord.js';
import { RecoveryRow } from './RunConversation.js';
import { SheetRunActions } from './RunActions.js';
import { IDLE_GATE_ACTION, useGateActionStore } from '../../board/gateActions.js';
import { deliverySummary, outcomeLine, statusSentence } from '../../board/proposalCard.js';
import { useSilentStep } from '../../hooks/useSilentStep.js';
import { silentWords } from '../../board/silentStep.js';
import { deliveryAssuranceOf, deliveryReceiptOf } from '../../board/assuranceModel.js';
import { deliveryOf } from '../delivery.js';
import { useRunCoverage } from '../../hooks/useRunCoverage.js';
import { endedAtMs, finishedAtMs } from '../../board/needsYou.js';
import { ago } from '../AgeStamp.js';
import { TechDetails } from '../ui/index.js';
import { useHostPanel } from '../../editors/hostApi.js';
import { useNarrow } from '../editorHost/HostPanel.js';
import { isDeliverGate } from '../gateMoveModel.js';
import { runSections } from '../RightPanel.js';
import { useIsSystemWorkflow } from '../../store/workflowCache.js';
import { FileViewer } from '../FileViewer.js';
import { ActivityTail, EvidenceTab, GoalBrief, HelpersList, RunSection, SignIns, StepsList } from '../sheets/ObjectSheet.js';
import { PANEL_SECTIONS, panelStateKind, quietSections, sectionOpen, type PanelSectionId } from '../../board/runPanelModel.js';
import { useRunPanel } from '../../store/runPanel.js';
import { TeamRosterLines } from './TeamRosterLines.js';

function isTerminal(view: SessionView): boolean {
  return ['completed', 'cancelled', 'failed'].includes(view.session.status);
}

function primaryRun(runs: SessionView[]): SessionView | undefined {
  return [...runs].reverse().find((view) => !isTerminal(view)) ?? runs[runs.length - 1];
}

/** The step the run is on: the running one, else (a live run waiting or between steps) the first step
 *  not yet finished — a step waiting on you at its gate is not "done", and the next one is not "now". */
function currentStep(view: SessionView, chain: ChainModel): ChainStep | undefined {
  if (isTerminal(view)) return undefined;
  return chain.steps.find((step) => step.state === 'running')
    ?? chain.steps.find((step) => !['done', 'checked', 'replaced', 'struck'].includes(step.state));
}

function assignedClis(view: SessionView): string[] {
  return [...new Set(view.units.map((unit) => unit.assigned_cli)
    .filter((cli): cli is string => typeof cli === 'string' && cli.trim() !== ''))];
}

function agentsWord(n: number): string {
  return n === 1 ? '1 agent' : `${n} agents`;
}

function spendWords(view: SessionView): string | null {
  const cost = (view.session as unknown as Record<string, unknown>).cost_usd;
  return typeof cost === 'number' && Number.isFinite(cost) ? moneyWords(cost) : null;
}

function startedMs(view: SessionView): number | null {
  const c = (view.session as unknown as { created_at?: unknown }).created_at;
  return typeof c === 'number' && Number.isFinite(c) ? c * 1000 : null;
}

/** The question a run is waiting on, as the thread draws it (the plan, a step's question, the hand-over). */
const ASKING = '[data-testid="chat-plan"][data-open="true"], [data-testid="chat-gate"], [data-testid="chat-final"][data-kind="deliver"], [data-testid="decision-marker"]';

/**
 * THE RUN PANEL (src/board/runPanelModel.ts): the run page's one right panel — what the Details panel's Run tab and
 * the ⋯ session sheet showed, in six folding sections. `allRuns` is the whole index (a run's retries can sit in
 * another session: What and where names them).
 */
export function RunTab({ runs, allRuns = runs, sessionId, title, navigate }: {
  runs: SessionView[];
  allRuns?: readonly SessionView[];
  sessionId: string;
  title: string;
  navigate?: Navigate;
}): React.ReactElement {
  const picked = useRunPanel((s) => (s.picked?.sessionId === sessionId ? s.picked.runId : null));
  const view = (picked !== null ? runs.find((run) => run.session.id === picked) : undefined) ?? primaryRun(runs);
  if (view === undefined) return <p data-testid="run-tab-empty" className="wk-run-tab-muted">No run in this session yet.</p>;
  return (
    <div data-testid="run-tab" data-run-id={view.session.id} className="wk-run-tab">
      {runs.length > 1 && (
        <select data-testid="run-tab-run-pick" aria-label="Which run" className="wk-run-tab-pick" value={view.session.id}
          onChange={(e) => useRunPanel.getState().pick(sessionId, e.target.value)}>
          {runs.map((run) => <option key={run.session.id} value={run.session.id}>{jobTitle(run.session)}</option>)}
        </select>
      )}
      {/* A confirmation belongs to one run; changing the pick starts a fresh confirmation. */}
      <RunTabDetails key={view.session.id} view={view} allRuns={allRuns} sessionId={sessionId} title={title} {...(navigate !== undefined ? { navigate } : {})} />
    </div>
  );
}

const NO_NAVIGATE: Navigate = () => {};

function RunTabDetails({ view, allRuns, sessionId, title, navigate }: { view: SessionView; allRuns: readonly SessionView[]; sessionId: string; title: string; navigate?: Navigate }): React.ReactElement {
  const id = view.session.id;
  const { chain } = useRunChain(view);
  const gate = useGateStore((s) => s.gates[id]);
  const acceptance = useRunAcceptance(view, chain, gate, true);
  // The whole log (not only while executing): a finished run's delivery receipt reads it too.
  const { events } = useRunEvents(id);
  const action = useGateActionStore((s) => s.byGate[id] ?? IDLE_GATE_ACTION);
  // (J4 0.16.6) The step silent past crew's quiet mark: the Now section says so, as the header does.
  const silent = useSilentStep(view);
  const coverage = useRunCoverage(view);
  const delivery = deliveryOf(view);
  const recorded = deliveryAssuranceOf(view);
  const runReceipt = deliveryReceiptOf(view, events ?? null, recorded);
  const receipt = view.session.status === 'completed' ? runReceipt : null;
  // rig 0.15.8: a failed floor the operator overrode is said as that — the deliver card's words — never "Passed".
  const overridden = overriddenFloorsOf(runReceipt, events ?? null, view);
  const started = startedMs(view);
  const ended = isTerminal(view) ? (endedAtMs(view) ?? finishedAtMs(view)) : null;
  const doneSteps = chain.steps.filter((s) => s.state === 'done' || s.state === 'checked').length;
  const summary = acceptance?.summary as unknown;
  const acceptanceLine = typeof summary === 'string' ? summary
    : summary !== null && typeof summary === 'object' && typeof (summary as { line?: unknown }).line === 'string' ? (summary as { line: string }).line : null;
  const acceptancePassed = summary !== null && typeof summary === 'object' && typeof (summary as { satisfied?: unknown }).satisfied === 'boolean'
    ? (summary as { satisfied: boolean }).satisfied : null;
  // The thread draws the run's story, recovery buttons and record lines too: the panel draws its copies only while it
  // is open, so a closed panel never doubles them (one live instance of each on the page you are reading).
  const narrow = useNarrow();
  const panelShown = useHostPanel((st) => (narrow ? st.overlay : !st.folded));
  const prNumber = delivery.url === null ? null : (/\/pull\/(\d+)/.exec(delivery.url)?.[1] ?? null);
  const roster = useRoster();
  const stopping = useSheets((s) => s.stopping[id] !== undefined);
  const [confirmStop, setConfirmStop] = useState(false);
  const [glanceStop, setGlanceStop] = useState(false);
  const current = currentStep(view, chain);
  const clis = assignedClis(view);
  const session = view.session;
  const spend = spendWords(view);
  const isSystem = useIsSystemWorkflow();
  const extra = runSections(view, isSystem);
  const planItem = extra.some((s) => s.id === 'plan');
  const deliveryItem = extra.some((s) => s.id === 'delivery');
  const go = navigate ?? NO_NAVIGATE;

  // Which sections are open: the run's state picks the default, the operator's choice (per state) wins.
  const kind = panelStateKind(view, gate === undefined ? undefined : { gateKind: isDeliverGate(id, view.units, gate.ord) ? 'deliver' : gate.gateKind, prompt: gate.prompt });
  const quiet = quietSections(view);
  const remembered = useRunPanel((s) => s.remembered);
  const focus = useRunPanel((s) => s.focus);
  const open = (s: PanelSectionId): boolean => sectionOpen(s, kind, remembered, quiet, focus?.section ?? null);
  const fold = { kind, open, quiet };
  const delivered = (delivery.state !== 'none' && delivery.state !== 'in-flight') || receipt !== null;

  const goToQuestion = (): void => {
    const block = [...document.querySelectorAll<HTMLElement>('[data-testid="session-run"]')].find((b) => b.dataset['runId'] === id);
    const asking = block?.querySelector<HTMLElement>(ASKING) ?? block;
    if (asking === undefined) return;
    // The question is docked above the composer: its marker in the thread focuses the dock.
    if (asking.dataset['testid'] === 'decision-marker') { if (narrow) useHostPanel.getState().setOverlay(false); asking.click(); return; }
    if (narrow) useHostPanel.getState().setOverlay(false);
    asking.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  };

  // (mockup ui-v2-gate) The panel's glance: progress, changes, helpers, three ways in, and Stop job — the folding
  // sections below keep everything else.
  const total = chain.steps.length;
  const stepAt = current !== undefined ? chain.steps.indexOf(current) + 1 : doneSteps;
  const builder = builderResponder(view, gate?.ord ?? null, roster);
  const runningOrd = executingOrd(view.session, view.units);
  const helpers = clis.filter(isHelperSeat).map((cli) => {
    const seat = roster?.find((entry) => entry.key === cli);
    const name = seat === undefined ? cli : seatLabel(seat);
    const running = runningOrd !== null && view.units.some((u) => u.ord === runningOrd && u.assigned_cli === cli);
    const reviews = view.units.some((unit) => unit.assigned_cli === cli && isReviewUnit(unit));
    return `${name} ${running ? (reviews ? 'reviewing' : 'building') : builder?.cli === cli ? 'built it' : reviews ? 'reviews' : 'builds'}`;
  });
  const changesWord = deliverySummary(view) ?? (delivered ? 'Nothing pushed' : 'Nothing delivered yet');
  const glance = (
    <div data-testid="run-tab-glance" className="wk-run-glance">
      <div className="wk-run-glance-item">
        <span className="wk-run-glance-label">Progress</span>
        <span data-testid="run-tab-glance-progress" className="wk-run-glance-value">{total === 0 ? 'No steps yet' : `Step ${Math.max(1, stepAt)} of ${total}${current !== undefined ? ` · ${current.label}` : ''}`}</span>
        {total > 0 && <span aria-hidden className="wk-run-glance-bar" data-tone={session.status === 'awaiting_human' ? 'waiting' : isTerminal(view) ? 'done' : 'run'}><span style={{ width: `${Math.round((doneSteps / total) * 100)}%` }} /></span>}
      </div>
      <div className="wk-run-glance-item">
        <span className="wk-run-glance-label">Changes</span>
        <span data-testid="run-tab-glance-changes" className="wk-run-glance-value">{changesWord}</span>
      </div>
      {helpers.length > 0 && (
        <div className="wk-run-glance-item">
          <span className="wk-run-glance-label">Helpers</span>
          <span data-testid="run-tab-glance-helpers" className="wk-run-glance-value">{helpers.join(' · ')}</span>
        </div>
      )}
      <nav aria-label="About this job" className="wk-run-glance-links">
        <button type="button" data-testid="run-tab-glance-asked" className="wk-run-glance-link" onClick={() => useRunPanel.getState().focusOn('now', 'goal')}>What you asked for</button>
        <button type="button" data-testid="run-tab-glance-plan" className="wk-run-glance-link" onClick={() => useRunPanel.getState().focusOn('plan', 'steps')}>Plan and steps</button>
        <button type="button" data-testid="run-tab-glance-evidence" className="wk-run-glance-link" onClick={() => useRunPanel.getState().focusOn('checks', 'evidence')}>Evidence and record</button>
      </nav>
      {!isTerminal(view) && !glanceStop && (
        <button type="button" data-testid="run-tab-glance-stop" className="wk-run-tab-button wk-stop-btn wk-run-glance-stop" disabled={stopping} onClick={() => setGlanceStop(true)}>{stopping ? 'Stopping…' : 'Stop job'}</button>
      )}
      {!isTerminal(view) && glanceStop && (
        <div data-testid="run-tab-glance-stop-confirm-row" className="wk-run-tab-confirm">
          <span>Stop this job? What it did so far is kept.</span>
          <button type="button" data-testid="run-tab-glance-stop-confirm" className="wk-run-tab-button wk-stop-btn wk-stop-btn--confirm" disabled={stopping} onClick={() => { stopRun([id], `“${title}”`); setGlanceStop(false); }}>Stop this job</button>
          <button type="button" className="wk-run-tab-button" onClick={() => setGlanceStop(false)}>Keep going</button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {glance}
      <Section id="now" {...fold} summary={silent !== null ? silentWords(silent) : chatStatusWord([view]).word}>
        <div data-testid="run-tab-now" className="wk-run-tab-block">
          <p data-testid="run-tab-status" role="status" className="wk-run-tab-line">{statusSentence(view, chain, gate, action, silent?.minutes ?? null)}</p>
          {(started !== null || ended !== null) && (
            <p data-testid="run-tab-times" className="wk-run-tab-muted">
              {started !== null && `Started ${ago(started)} ago`}{started !== null && ended !== null && ' · '}{ended !== null && `ended ${ago(ended)} ago`}
            </p>
          )}
          {gate !== undefined && session.status === 'awaiting_human' && (
            <button type="button" data-testid="run-tab-goto-question" className="wk-run-tab-button wk-run-tab-button--lead" onClick={goToQuestion}>Go to the question</button>
          )}
        </div>
        <div data-testid="run-tab-workflow" className="wk-run-tab-block">
          <p className="wk-run-tab-line">{workflowLabel(session.workflow_id)}{' '}
            <span className="wk-run-tab-pill">{chatStatusWord([view]).word}</span>
          </p>
          {typeof session.repo_ref === 'string' && session.repo_ref.trim() !== '' && (
            <p data-testid="run-tab-repo" className="wk-run-tab-line"><code>{session.repo_ref}</code></p>
          )}
        </div>
        {panelShown && open('now') && (session.status === 'failed' || session.status === 'cancelled') && (
          <div data-testid="run-tab-story" className="wk-run-tab-block">
            <h4 className="wk-run-tab-heading">Why it stopped</h4>
            <RunStory view={view} events={events ?? []} {...(navigate !== undefined ? { navigate } : {})} />
            <RecoveryRow view={view} {...(navigate !== undefined ? { navigate } : {})} />
          </div>
        )}
        {orphanedOf(session.status, events ?? undefined) !== null && <p data-testid="run-tab-orphaned" role="status" className="wk-run-tab-warning">{ORPHANED_LINE}</p>}
        {finishedDeliveryArm(view, gate) === 'stranded' && (
          <p data-testid="run-tab-stranded" role="status" className="wk-run-tab-warning">Nobody has taken this work yet: its delivery card is in the thread.</p>
        )}
        <div data-testid="run-tab-actions" className="wk-run-tab-actions">
          {!isTerminal(view) && (
            <button type="button" data-testid="run-tab-stop" className="wk-run-tab-button wk-stop-btn" disabled={stopping} onClick={() => setConfirmStop(true)}>{stopping ? 'Stopping…' : 'Stop'}</button>
          )}
          {panelShown && <SheetRunActions view={view} />}
        </div>
        {!isTerminal(view) && confirmStop && (
          <div data-testid="run-tab-stop-confirm-row" className="wk-run-tab-confirm">
            <span>Stop this run?</span>
            <button type="button" data-testid="run-tab-stop-confirm" className="wk-run-tab-button wk-stop-btn wk-stop-btn--confirm" disabled={stopping} onClick={() => { stopRun([id], `“${title}”`); setConfirmStop(false); }}>Stop this run</button>
            <button type="button" data-testid="run-tab-stop-keep" className="wk-run-tab-button" onClick={() => setConfirmStop(false)}>Keep going</button>
          </div>
        )}
        <Item section="now" id="goal">{() => <div data-testid="sheet-goal" className="wk-sheet-section"><GoalBrief problem={session.problem} /></div>}</Item>
      </Section>

      <Section id="plan" {...fold} summary={chain.steps.length === 0 ? 'No steps yet' : `${doneSteps} of ${chain.steps.length} done${current !== undefined ? ` · ${current.label}` : ''}`}>
        <div data-testid="run-tab-phases" className="wk-run-tab-block">
          {chain.transportLine !== null && <p data-testid="run-tab-transport" className="wk-run-tab-warning">{chain.transportLine}</p>}
          {chain.steps.length === 0 ? <p className="wk-run-tab-muted">No phases yet.</p> : (
            <ol className="wk-run-tab-list">
              {chain.steps.map((step) => (
                <li key={step.id} data-testid="run-tab-phase" data-state={step.state} data-current={step === current ? 'true' : 'false'} className="wk-run-tab-phase">
                  {(step.state === 'done' || step.state === 'checked') && <span aria-label="Done">✓ </span>}
                  {step.label}{step.state === 'checked' && <span className="wk-run-tab-pill">checked</span>}{step.state === 'failed' && <span className="wk-run-tab-pill">failed</span>}{step === current && <span className="wk-run-tab-pill">{view.session.status === 'awaiting_human' ? 'waiting on you' : 'now'}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
        {planItem && <Item section="plan" id="plan">{() => <RunSection id="plan" view={view} runs={allRuns} navigate={go} />}</Item>}
        <Item section="plan" id="steps">{() => <StepsList view={view} />}</Item>
      </Section>

      <Section id="changes" {...fold} summary={deliverySummary(view) ?? (delivered ? 'Nothing pushed' : quiet.has('changes') ? 'Nothing changed yet' : 'Nothing delivered yet')}>
        {/* A run still going has nothing delivered to say ("in-flight" is only "it has a deliver step"). */}
        {delivered && (
          <div data-testid="run-tab-delivery" className="wk-run-tab-block">
            <p data-testid="run-tab-delivery-outcome" className="wk-run-tab-line">{view.session.status === 'completed' ? outcomeLine(view) : 'Not delivered'}</p>
            {delivery.url !== null && <p className="wk-run-tab-line"><a data-testid="run-tab-pr" href={delivery.url} target="_blank" rel="noreferrer">Pull request{prNumber !== null ? ` #${prNumber}` : ''} ↗</a></p>}
            {delivery.pushed !== undefined && <p data-testid="run-tab-branch" className="wk-run-tab-line">Branch <code>{delivery.pushed.branch}</code></p>}
            {delivery.reason !== null && delivery.state !== 'delivered' && <p data-testid="run-tab-delivery-reason" className="wk-run-tab-muted">{delivery.reason}</p>}
            {receipt !== null && <AssuranceReceipt receipt={receipt} passed={recorded !== null && !recorded.verified ? null : true} testId="run-tab-assurance" />}
            <DeliveryAssuranceLines recorded={recorded} testIdPrefix="run-tab" />
            {panelShown && <DeliverCredentialsNotice view={view} />}
          </div>
        )}
        <div data-testid="run-tab-download" className="wk-run-tab-download"><CodebaseDownload view={view} /></div>
        <Item section="changes" id="changes">{(close) => <ChangesItem runId={id} close={close} />}</Item>
        {deliveryItem && <Item section="changes" id="delivery">{() => <RunSection id="delivery" view={view} runs={allRuns} navigate={go} />}</Item>}
        <Item section="changes" id="files">{() => <RunSection id="files" view={view} runs={allRuns} navigate={go} />}</Item>
      </Section>

      <Section id="checks" {...fold} summary={quiet.has('checks') ? 'Nothing checked yet' : acceptancePassed === false ? 'Not passed' : overridden !== null ? 'Overridden by you' : acceptancePassed === true ? 'Passed' : ''}>
        <div data-testid="run-tab-checks" className="wk-run-tab-block">
          <RunAssuranceLabel view={view} />
          {/* crew's acceptance line (WT-W3 `summary.line`; a bare string from an older read). An acceptance not passed leads;
              a passed one under an override is QE acceptance's word only, so it goes behind Technical details. */}
          {acceptanceLine !== null && (overridden === null || acceptancePassed === false) && <p data-testid="run-tab-acceptance" className="wk-run-tab-line">{acceptanceLine}</p>}
          {overridden !== null && <p data-testid="run-tab-overridden" className="wk-run-tab-line wk-prop-accept--overridden">{overriddenLine(overridden)}</p>}
          {acceptanceLine !== null && overridden !== null && acceptancePassed !== false && <TechDetails data-testid="run-tab-acceptance-detail" summary="What QE acceptance recorded" text={acceptanceLine} />}
          {coverage !== null && <p data-testid="run-tab-coverage" className="wk-run-tab-line">{coverage.line}</p>}
          {coverage !== null && coverage.reasons.length > 0 && <TechDetails data-testid="run-tab-coverage-why" text={coverage.reasons} />}
          {acceptanceLine === null && coverage === null && overridden === null && <p className="wk-run-tab-muted">{quiet.has('checks') ? 'Nothing has been checked yet.' : 'No acceptance check recorded.'}</p>}
        </div>
        <Item section="checks" id="evidence">{() => <EvidenceTab runId={id} />}</Item>
        <Item section="checks" id="governance">{() => <RunSection id="governance" view={view} runs={allRuns} navigate={go} />}</Item>
        <Item section="checks" id="steering">{() => <RunSection id="steering" view={view} runs={allRuns} navigate={go} />}</Item>
      </Section>

      <Section id="agents" {...fold} summary={`${agentsWord(clis.length)}${spend !== null ? ` · ${spend}` : ''}`}>
        <div data-testid="run-tab-agents" className="wk-run-tab-block">
          <TeamRosterLines runId={id} roster={roster} />
          {clis.length === 0 ? <p className="wk-run-tab-muted">No agent has been assigned yet.</p> : (
            <ul className="wk-run-tab-list">
              {clis.map((cli) => {
                const seat = roster?.find((entry) => entry.key === cli);
                const reviews = view.units.some((unit) => unit.assigned_cli === cli && isReviewUnit(unit));
                return (
                  <li key={cli} data-testid="run-tab-agent" data-cli={cli} className="wk-run-tab-agent">
                    <button type="button" className="wk-run-tab-name" onClick={() => openSheet({ kind: 'helper', runId: id, cli })}>
                      {seat === undefined ? cli : seatLabel(seat)}
                    </button>{' '}<span className="wk-run-tab-muted">{reviews ? 'reviews' : 'builds'}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p data-testid="run-tab-spend" className="wk-run-tab-line">Spend: {spend ?? 'Not reported'}</p>
        </div>
        <Item section="agents" id="helpers">{() => <HelpersList runs={[view]} sessionId={sessionId} roster={roster} onSignIn={() => useRunPanel.getState().focusOn('agents', 'signins')} />}</Item>
        <Item section="agents" id="signins">{() => <SignIns roster={roster} navigate={go} />}</Item>
        <Item section="agents" id="burn">{() => <RunSection id="burn" view={view} runs={allRuns} navigate={go} />}</Item>
      </Section>

      <Section id="record" {...fold} summary="">
        {panelShown && open('record') && (
          <div data-testid="run-tab-record" className="wk-run-tab-block">
            <RunRecordLines view={view} jumped={false} withStory={false} {...(navigate !== undefined ? { navigate } : {})} />
          </div>
        )}
        <Item section="record" id="activity">{() => <ActivityTail view={view} />}</Item>
        <Item section="record" id="decisions">{() => <RunSection id="decisions" view={view} runs={allRuns} navigate={go} />}</Item>
        <Item section="record" id="assumptions">{() => <RunSection id="assumptions" view={view} runs={allRuns} navigate={go} />}</Item>
        <Item section="record" id="data">{() => <RunSection id="data" view={view} runs={allRuns} navigate={go} />}</Item>
        <Item section="record" id="whatwhere">{() => <RunSection id="whatwhere" view={view} runs={allRuns} navigate={go} />}</Item>
        <details data-testid="run-tab-tech" className="wk-run-tab-tech">
          <summary>Tech details</summary>
          <p className="wk-run-tab-line">Run: <code>{id}</code></p>
          {typeof session.base_commit === 'string' && <p className="wk-run-tab-line">Base commit: <code>{session.base_commit}</code></p>}
          <p className="wk-run-tab-line">Agents: <code>{session.clis.join(', ')}</code></p>
        </details>
      </Section>
    </>
  );
}

/**
 * One folding section: its header is a button (aria-expanded) naming the section and a one-line summary. The body's
 * light content stays mounted while closed (hidden); the heavier items inside mount on first open ({@link Item}).
 */
function Section({ id, kind, open, quiet, summary, children }: {
  id: PanelSectionId;
  kind: ReturnType<typeof panelStateKind>;
  open: (s: PanelSectionId) => boolean;
  quiet: ReadonlySet<PanelSectionId>;
  summary: string;
  children: React.ReactNode;
}): React.ReactElement {
  const label = PANEL_SECTIONS.find((s) => s.id === id)!.label;
  const isOpen = open(id);
  const body = `run-panel-${id}`;
  const ref = useRef<HTMLElement | null>(null);
  // A link that sent the operator here (⌘K, a sign-in line, `#governance`) brings the section into view.
  const focus = useRunPanel((s) => s.focus);
  useEffect(() => {
    if (focus === null || focus.section !== id || focus.item !== null) return;
    ref.current?.scrollIntoView?.({ block: 'start' });
  }, [focus, id]);
  return (
    <section ref={ref} data-testid="run-panel-section" data-section={id} data-open={isOpen ? 'true' : 'false'} data-quiet={quiet.has(id) ? 'true' : 'false'} className="wk-rp-section">
      <h3 className="wk-rp-heading">
        <button type="button" data-testid="run-panel-toggle" data-section={id} aria-expanded={isOpen} aria-controls={body}
          onClick={() => useRunPanel.getState().setOpen(kind, id, !isOpen)} className="wk-rp-toggle">
          <span aria-hidden className="wk-rp-chevron" />
          <span className="wk-rp-label">{label}</span>
          {summary !== '' && <span data-testid="run-panel-summary" className="wk-rp-summary">{summary}</span>}
        </button>
      </h3>
      <div id={body} role="region" aria-label={label} hidden={!isOpen} className="wk-rp-body">{children}</div>
    </section>
  );
}

/**
 * One of the old sheet's tabs inside a section: a smaller fold, mounted on first open (its reads — the diff, the run
 * model, the events — start only then). A link naming it (`openSheet(…, tab)`) opens it and brings it into view.
 */
function Item({ section, id, children }: { section: PanelSectionId; id: string; children: (close: () => void) => React.ReactNode }): React.ReactElement {
  const label = PANEL_SECTIONS.find((s) => s.id === section)!.items.find((i) => i.id === id)!.label;
  const focus = useRunPanel((s) => s.focus);
  const sent = focus !== null && focus.section === section && focus.item === id;
  const [open, setOpen] = useState(sent);
  const [mounted, setMounted] = useState(sent);
  const ref = useRef<HTMLDivElement | null>(null);
  const uid = useId();
  useEffect(() => {
    if (!sent) return;
    setOpen(true);
    setMounted(true);
    ref.current?.scrollIntoView?.({ block: 'start' });
  }, [sent, focus?.seq]);
  const toggle = (): void => { setOpen((o) => !o); setMounted(true); };
  const body = useMemo(() => `${uid}-body`, [uid]);
  return (
    <div ref={ref} data-testid="run-panel-item" data-item={id} data-open={open ? 'true' : 'false'} className="wk-rp-item">
      <button type="button" data-testid="run-panel-item-toggle" data-item={id} aria-expanded={open} aria-controls={body} onClick={toggle} className="wk-rp-item-toggle">
        <span aria-hidden className="wk-rp-chevron" />{label}
      </button>
      <div id={body} hidden={!open} className="wk-rp-item-body">{mounted && children(() => setOpen(false))}</div>
    </div>
  );
}

/** The run's changes: the diff reads only on a click, in the viewer's own overlay (code needs more than 400 px). */
function ChangesItem({ runId, close }: { runId: string; close: () => void }): React.ReactElement {
  const [viewing, setViewing] = useState(false);
  return (
    <div data-testid="sheet-session-changes" className="wk-sheet-section">
      <p className="wk-sheet-line">What this run changed, against where it started.</p>
      <button type="button" data-testid="run-tab-changes-open" onClick={() => setViewing(true)} className="wk-run-tab-button">Show the changes</button>
      {viewing && <FileViewer runId={runId} defaultTab="diff" base="merge-base" onClose={() => setViewing(false)} onUnsupported={() => { setViewing(false); close(); }} />}
    </div>
  );
}

/** The panel's one-line ribbon (below 1200 px, or folded). HostPanel draws the button around it, so this is text. */
export function RunRibbon({ runs }: { runs: SessionView[] }): React.ReactElement {
  const view = primaryRun(runs);
  if (view === undefined) return <span data-testid="run-ribbon-line" className="wk-run-tab-ribbon">No run in this session yet.</span>;
  return <RunRibbonLine view={view} />;
}

function RunRibbonLine({ view }: { view: SessionView }): React.ReactElement {
  const { chain } = useRunChain(view);
  const spend = spendWords(view);
  return (
    <span data-testid="run-ribbon-line" className="wk-run-tab-ribbon">
      {workflowLabel(view.session.workflow_id)} · {currentStep(view, chain)?.label ?? chatStatusWord([view]).word} · {agentsWord(assignedClis(view).length)}{spend !== null && ` · ${spend}`}
    </span>
  );
}
