import { useState } from 'react';
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
import { isReviewUnit } from '../../board/responder.js';
import { useRunAcceptance } from '../../hooks/useRunAcceptance.js';
import { useRunEvents } from '../../hooks/useRunEvents.js';
import { useGateStore } from '../../store/gates.js';
import { openSheet, stopRun, useSheets } from '../../store/sheets.js';
import { useRunChain } from './ChainLine.js';
import { RunAssuranceLabel } from './AssuranceReceipt.js';
import { CodebaseDownload, DeliverCredentialsNotice } from './CodebaseDownload.js';
import { AssuranceReceipt, DeliveryAssuranceLines } from './AssuranceReceipt.js';
import { RunRecordLines, RunStory } from './RunRecord.js';
import { RecoveryRow } from './RunConversation.js';
import { IDLE_GATE_ACTION, useGateActionStore } from '../../board/gateActions.js';
import { outcomeLine, statusSentence } from '../../board/proposalCard.js';
import { deliveryAssuranceOf, deliveryReceiptOf } from '../../board/assuranceModel.js';
import { deliveryOf } from '../delivery.js';
import { useRunCoverage } from '../../hooks/useRunCoverage.js';
import { endedAtMs, finishedAtMs } from '../../board/needsYou.js';
import { ago } from '../AgeStamp.js';
import { TechDetails } from '../ui/index.js';
import { useHostPanel } from '../../editors/hostApi.js';
import { useNarrow } from '../editorHost/HostPanel.js';

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

export function RunTab({ runs, sessionId, title, navigate }: {
  runs: SessionView[];
  sessionId: string;
  title: string;
  navigate?: Navigate;
}): React.ReactElement {
  const [picked, setPicked] = useState<{ sessionId: string; id: string } | null>(null);
  const view = (picked?.sessionId === sessionId ? runs.find((run) => run.session.id === picked.id) : undefined)
    ?? primaryRun(runs);
  if (view === undefined) return <p data-testid="run-tab-empty" className="wk-run-tab-muted">No run in this session yet.</p>;
  return (
    <div data-testid="run-tab" data-run-id={view.session.id} className="wk-run-tab">
      {runs.length > 1 && (
        <select data-testid="run-tab-run-pick" aria-label="Which run" className="wk-run-tab-pick" value={view.session.id}
          onChange={(e) => setPicked({ sessionId, id: e.target.value })}>
          {runs.map((run) => <option key={run.session.id} value={run.session.id}>{jobTitle(run.session)}</option>)}
        </select>
      )}
      {/* A confirmation belongs to one run; changing the pick starts a fresh confirmation. */}
      <RunTabDetails key={view.session.id} view={view} title={title} {...(navigate !== undefined ? { navigate } : {})} />
    </div>
  );
}

function RunTabDetails({ view, title, navigate }: { view: SessionView; title: string; navigate?: Navigate }): React.ReactElement {
  const id = view.session.id;
  const { chain } = useRunChain(view);
  const gate = useGateStore((s) => s.gates[id]);
  const acceptance = useRunAcceptance(view, chain, gate, true);
  // The whole log (not only while executing): a finished run's delivery receipt reads it too.
  const { events } = useRunEvents(id);
  const action = useGateActionStore((s) => s.byGate[id] ?? IDLE_GATE_ACTION);
  // DES-CHAT-NATIVE-RUN: everything the run's old in-thread summary said lives here now, grouped.
  const coverage = useRunCoverage(view);
  const delivery = deliveryOf(view);
  const recorded = deliveryAssuranceOf(view);
  const receipt = view.session.status === 'completed' ? deliveryReceiptOf(view, events ?? null, recorded) : null;
  const started = startedMs(view);
  const ended = isTerminal(view) ? (endedAtMs(view) ?? finishedAtMs(view)) : null;
  const doneSteps = chain.steps.filter((s) => s.state === 'done' || s.state === 'checked').length;
  const summary = acceptance?.summary as unknown;
  const acceptanceLine = typeof summary === 'string' ? summary
    : summary !== null && typeof summary === 'object' && typeof (summary as { line?: unknown }).line === 'string' ? (summary as { line: string }).line : null;
  // The thread draws the run's story, recovery buttons and record lines too: the panel draws its copies only while it
  // is open, so a closed panel never doubles them (one live instance of each on the page you are reading).
  const narrow = useNarrow();
  const panelShown = useHostPanel((st) => (narrow ? st.overlay : !st.folded));
  const prNumber = delivery.url === null ? null : (/\/pull\/(\d+)/.exec(delivery.url)?.[1] ?? null);
  const roster = useRoster();
  const stopping = useSheets((s) => s.stopping[id] !== undefined);
  const [confirmStop, setConfirmStop] = useState(false);
  const current = currentStep(view, chain);
  const clis = assignedClis(view);
  const session = view.session;
  return (
    <>
      <section data-testid="run-tab-now" className="wk-run-tab-section">
        <h3 className="wk-run-tab-heading">Now</h3>
        <p data-testid="run-tab-status" role="status" className="wk-run-tab-line">{statusSentence(view, chain, gate, action)}</p>
        {(started !== null || ended !== null) && (
          <p data-testid="run-tab-times" className="wk-run-tab-muted">
            {started !== null && `Started ${ago(started)} ago`}{started !== null && ended !== null && ' · '}{ended !== null && `ended ${ago(ended)} ago`}
          </p>
        )}
      </section>
      <section data-testid="run-tab-workflow" className="wk-run-tab-section">
        <h3 className="wk-run-tab-heading">Workflow</h3>
        <p className="wk-run-tab-line">{workflowLabel(session.workflow_id)}{' '}
          <span className="wk-run-tab-pill">{chatStatusWord([view]).word}</span>
        </p>
        {typeof session.repo_ref === 'string' && session.repo_ref.trim() !== '' && (
          <p data-testid="run-tab-repo" className="wk-run-tab-line"><code>{session.repo_ref}</code></p>
        )}
      </section>
      <section data-testid="run-tab-phases" className="wk-run-tab-section">
        <h3 className="wk-run-tab-heading">Phases</h3>
        {chain.steps.length > 0 && <p data-testid="run-tab-phase-count" className="wk-run-tab-muted">{doneSteps} of {chain.steps.length} done</p>}
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
      </section>
      <section data-testid="run-tab-agents" className="wk-run-tab-section">
        <h3 className="wk-run-tab-heading">Agents</h3>
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
      </section>
      <section data-testid="run-tab-checks" className="wk-run-tab-section">
        <h3 className="wk-run-tab-heading">Checks and spend</h3>
        <RunAssuranceLabel view={view} />
        {/* crew's acceptance line (WT-W3 `summary.line`; a bare string from an older read). */}
        {acceptanceLine !== null && <p data-testid="run-tab-acceptance" className="wk-run-tab-line">{acceptanceLine}</p>}
        {coverage !== null && <p data-testid="run-tab-coverage" className="wk-run-tab-line">{coverage.line}</p>}
        {coverage !== null && coverage.reasons.length > 0 && <TechDetails data-testid="run-tab-coverage-why" text={coverage.reasons} />}
        <p data-testid="run-tab-spend" className="wk-run-tab-line">{spendWords(view) ?? 'Not reported'}</p>
      </section>
      {/* A run still going has nothing delivered to say ("in-flight" is only "it has a deliver step"). */}
      {((delivery.state !== 'none' && delivery.state !== 'in-flight') || receipt !== null) && (
        <section data-testid="run-tab-delivery" className="wk-run-tab-section">
          <h3 className="wk-run-tab-heading">Delivery</h3>
          <p data-testid="run-tab-delivery-outcome" className="wk-run-tab-line">{view.session.status === 'completed' ? outcomeLine(view) : 'Not delivered'}</p>
          {delivery.url !== null && <p className="wk-run-tab-line"><a data-testid="run-tab-pr" href={delivery.url} target="_blank" rel="noreferrer">Pull request{prNumber !== null ? ` #${prNumber}` : ''} ↗</a></p>}
          {delivery.pushed !== undefined && <p data-testid="run-tab-branch" className="wk-run-tab-line">Branch <code>{delivery.pushed.branch}</code></p>}
          {delivery.reason !== null && delivery.state !== 'delivered' && <p data-testid="run-tab-delivery-reason" className="wk-run-tab-muted">{delivery.reason}</p>}
          {receipt !== null && <AssuranceReceipt receipt={receipt} passed={recorded !== null && !recorded.verified ? null : true} testId="run-tab-assurance" />}
          <DeliveryAssuranceLines recorded={recorded} testIdPrefix="run-tab" />
          {panelShown && <DeliverCredentialsNotice view={view} />}
        </section>
      )}
      {panelShown && (session.status === 'failed' || session.status === 'cancelled') && (
        <section data-testid="run-tab-story" className="wk-run-tab-section">
          <h3 className="wk-run-tab-heading">Why it stopped</h3>
          <RunStory view={view} events={events ?? []} {...(navigate !== undefined ? { navigate } : {})} />
          <RecoveryRow view={view} {...(navigate !== undefined ? { navigate } : {})} />
        </section>
      )}
      {panelShown && (
        <section data-testid="run-tab-record" className="wk-run-tab-section">
          <h3 className="wk-run-tab-heading">Record</h3>
          <RunRecordLines view={view} jumped={false} withStory={false} {...(navigate !== undefined ? { navigate } : {})} />
        </section>
      )}
      {orphanedOf(session.status, events ?? undefined) !== null && <p data-testid="run-tab-orphaned" role="status" className="wk-run-tab-warning">{ORPHANED_LINE}</p>}
      {finishedDeliveryArm(view, gate) === 'stranded' && (
        <p data-testid="run-tab-stranded" role="status" className="wk-run-tab-warning">Nobody has taken this work yet: its delivery card is in the thread.</p>
      )}
      <section data-testid="run-tab-actions" className="wk-run-tab-section">
        <h3 className="wk-run-tab-heading">Actions</h3>
        <button type="button" data-testid="run-tab-look" className="wk-run-tab-button" onClick={() => openSheet({ kind: 'session', sessionId: `run:${id}` }, 'steps')}>Look underneath</button>
        <div data-testid="run-tab-download" className="wk-run-tab-download"><CodebaseDownload view={view} /></div>
        {!isTerminal(view) && (
          <>
            <button type="button" data-testid="run-tab-stop" className="wk-run-tab-button" disabled={stopping} onClick={() => setConfirmStop(true)}>{stopping ? 'Stopping…' : 'Stop'}</button>
            {confirmStop && (
              <div data-testid="run-tab-stop-confirm-row" className="wk-run-tab-confirm">
                <span>Stop this run?</span>
                <button type="button" data-testid="run-tab-stop-confirm" className="wk-run-tab-button" disabled={stopping} onClick={() => { stopRun([id], `“${title}”`); setConfirmStop(false); }}>Stop this run</button>
                <button type="button" data-testid="run-tab-stop-keep" className="wk-run-tab-button" onClick={() => setConfirmStop(false)}>Keep going</button>
              </div>
            )}
          </>
        )}
        <details data-testid="run-tab-tech" className="wk-run-tab-tech">
          <summary>Tech details</summary>
          <p className="wk-run-tab-line">Run: <code>{id}</code></p>
          {typeof session.base_commit === 'string' && <p className="wk-run-tab-line">Base commit: <code>{session.base_commit}</code></p>}
          <p className="wk-run-tab-line">Agents: <code>{session.clis.join(', ')}</code></p>
        </details>
      </section>
    </>
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
