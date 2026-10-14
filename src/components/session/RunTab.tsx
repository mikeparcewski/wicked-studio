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
import { CodebaseDownload } from './CodebaseDownload.js';

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

export function RunTab({ runs, sessionId, title }: {
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
      <RunTabDetails key={view.session.id} view={view} title={title} />
    </div>
  );
}

function RunTabDetails({ view, title }: { view: SessionView; title: string }): React.ReactElement {
  const id = view.session.id;
  const { chain } = useRunChain(view);
  const gate = useGateStore((s) => s.gates[id]);
  const acceptance = useRunAcceptance(view, chain, gate);
  const { events } = useRunEvents(id, view.session.status === 'executing');
  const roster = useRoster();
  const stopping = useSheets((s) => s.stopping[id] !== undefined);
  const [confirmStop, setConfirmStop] = useState(false);
  const current = currentStep(view, chain);
  const clis = assignedClis(view);
  const session = view.session;
  return (
    <>
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
        {chain.steps.length === 0 ? <p className="wk-run-tab-muted">No phases yet.</p> : (
          <ol className="wk-run-tab-list">
            {chain.steps.map((step) => (
              <li key={step.id} data-testid="run-tab-phase" data-state={step.state} data-current={step === current ? 'true' : 'false'} className="wk-run-tab-phase">
                {(step.state === 'done' || step.state === 'checked') && <span aria-label="Done">✓ </span>}
                {step.label}{step === current && <span className="wk-run-tab-pill">{view.session.status === 'awaiting_human' ? 'waiting on you' : 'now'}</span>}
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
        {typeof acceptance?.summary === 'string' && <p data-testid="run-tab-acceptance" className="wk-run-tab-line">{acceptance.summary}</p>}
        <p data-testid="run-tab-spend" className="wk-run-tab-line">{spendWords(view) ?? 'Not reported'}</p>
      </section>
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
