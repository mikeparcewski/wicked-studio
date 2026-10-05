import { useEffect, useMemo, useState } from 'react';
import { api, downloadRunEvidence } from '../../api/client.js';
import { executingOrd } from '../../api/run-state.js';
import type { RosterSeat, SessionView } from '../../api/types.js';
import { getDiagnostics, type Diagnostics } from '../../api/diagnostics.js';
import { objectAttr, OBJECT_ACTIONS, primaryAction, RUN_SECTION_TABS, SHEET_TABS, type ObjectRef } from '../../board/objectActions.js';
import { parseSessionId, runChatIdOf } from '../../board/sessionModel.js';
import { unitStepName } from '../../board/chainModel.js';
import { UnitConsidered } from '../decisions/ConsideredLine.js';
import { useRunModel } from '../../hooks/useRunModel.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useRoster } from '../../hooks/useRoster.js';
import { useRunRawEvents } from '../../hooks/useRunRawEvents.js';
import { useCapabilities } from '../../store/capabilities.js';
import { useProvenanceStore } from '../../store/provenance.js';
import { closeSheet, setSheetTab, useSheets } from '../../store/sheets.js';
import { useIsSystemWorkflow } from '../../store/workflowCache.js';
import { DeliveryFreezeSwitch } from '../DeliveryFreezeSwitch.js';
import { FileViewer } from '../FileViewer.js';
import { seatStandingWord } from '../HealthRailSection.js';
import { SignInPanel } from '../SignInPanel.js';
import { signInLapsed } from '../../board/deskModel.js';
import { LiveNarration } from '../LiveNarration.js';
import { RunSectionBody, runSections, type AccordionId } from '../RightPanel.js';
import { humanTitle } from '../runIdentity.js';
import { Sheet } from './Sheet.js';
import { useDisplayText } from '../../hooks/useHomePath.js';

/** A run can take a message only while a helper is working in it (crew's inject surface). */
const MESSAGEABLE = new Set(['executing', 'distributing', 'planning']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

const UNIT_WORD: Record<string, string> = {
  pending: 'not started', running: 'working', done: 'done', rejected: 'stopped', distributed: 'handed to a helper',
};

/** A step's plain name off its unit: the chain's word for its phase, else the stage. */
const stepName = unitStepName;

/** The runs a session holds, oldest first. */
function sessionRuns(sessionId: string, runs: readonly SessionView[], runChatId: boolean): SessionView[] {
  const ref = parseSessionId(sessionId);
  const mine = ref.kind === 'run' ? runs.filter((v) => v.session.id === ref.runId)
    : runChatId ? runs.filter((v) => runChatIdOf(v) === ref.chatId) : [];
  const at = (v: SessionView): number => Number((v.session as unknown as { created_at?: number }).created_at ?? 0);
  return [...mine].sort((a, b) => at(a) - at(b));
}

/** Every helper (CLI) a run's units were given to. */
function helpersOf(v: SessionView): string[] {
  return [...new Set(v.units.map((u) => u.assigned_cli).filter((c): c is string => typeof c === 'string' && c !== ''))];
}

/**
 * THE OPEN SHEET (S11), mounted once by App: whichever object `store/sheets` has open — a step, a
 * helper, a session or the Desk — with its tabs (DESIGN-simple §4) and its one primary action. The
 * rest of each object's actions are ⌘K for it (`sheets/objectCommands.ts`).
 */
export function ObjectSheet({ runs, navigate, needCount }: { runs: SessionView[]; navigate: Navigate; needCount: number }): React.ReactElement | null {
  const open = useSheets((s) => s.open);
  if (open === null) return null;
  const { ref, tab } = open;
  switch (ref.kind) {
    case 'step': return <StepSheet key={objectAttr(ref)} r={ref} tab={tab} runs={runs} navigate={navigate} />;
    case 'helper': return <HelperSheet key={objectAttr(ref)} r={ref} tab={tab} runs={runs} />;
    case 'session': return <SessionSheet key={objectAttr(ref)} r={ref} tab={tab} runs={runs} navigate={navigate} />;
    case 'desk': return <DeskSheet tab={tab} runs={runs} navigate={navigate} needCount={needCount} />;
  }
}

/** "Message it": a box that sends to the working helper (`POST /runs/:id/inject`). */
function MessageBox({ runId, target, can }: { runId: string; target: string; can: string | null }): React.ReactElement {
  const [text, setText] = useState('');
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const send = (): void => {
    const body = text.trim();
    if (body === '' || can !== null) return;
    setState({ kind: 'sending' });
    api.injectMessage(runId, body, target)
      .then(() => { setText(''); setState({ kind: 'sent' }); })
      .catch((e: unknown) => setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
  };
  return (
    <div data-testid="sheet-message" className="wk-sheet-message">
      <textarea
        data-testid="sheet-message-input"
        aria-label="Message it"
        rows={2}
        value={text}
        disabled={can !== null}
        placeholder={can ?? 'Say what to change or check — it reads it at its next step'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
        className="wk-desk-input"
      />
      <button type="button" data-testid="sheet-message-send" disabled={can !== null || text.trim() === '' || state.kind === 'sending'} onClick={send} className="wk-prop-btn wk-prop-btn--ghost">Send</button>
      {state.kind === 'sent' && <span data-testid="sheet-message-sent" role="status" className="wk-sheet-hint">Sent — it reads it at its next step.</span>}
      {state.kind === 'error' && <span data-testid="sheet-message-error" role="alert" className="wk-composer-note wk-composer-note--bad">Not sent: {state.message}</span>}
    </div>
  );
}

function UnitOutput({ runId, unit }: { runId: string; unit: SessionView['units'][number] }): React.ReactElement {
  const showText = useDisplayText();
  const [out, setOut] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const key = unit.id.startsWith(`${runId}:`) ? unit.id.slice(runId.length + 1) : `u${unit.ord}`;
    api.getUnitOutput(runId, key)
      .then(({ output, outputUnavailable }) => { if (!cancelled) setOut(output ?? outputUnavailable ?? 'Nothing was captured for this step.'); })
      .catch((e: unknown) => { if (!cancelled) setOut(`Could not read what it did (${e instanceof Error ? e.message : String(e)}).`); });
    return () => { cancelled = true; };
  }, [runId, unit.id, unit.ord]);
  return <pre data-testid="sheet-output" className="wk-sheet-pre">{showText(out ?? 'Reading…')}</pre>;
}

function StepSheet({ r, tab, runs, navigate }: { r: Extract<ObjectRef, { kind: 'step' }>; tab: string; runs: SessionView[]; navigate: Navigate }): React.ReactElement {
  const view = runs.find((v) => v.session.id === r.runId) ?? null;
  const unit = view?.units.find((u) => u.ord === r.ord) ?? null;
  const live = view !== null ? executingOrd(view.session, view.units) : null;
  const events = useRunRawEvents(r.runId);
  const name = unit !== null ? stepName(unit) : `Step ${r.ord + 1}`;
  const can = view === null ? 'This run is not on this daemon.'
    : !MESSAGEABLE.has(view.session.status) ? 'It is not working right now, so it cannot read a message.' : null;
  const [messaging, setMessaging] = useState(false);
  const p = primaryAction('step');
  return (
    <Sheet
      title={name}
      sub={view !== null ? humanTitle(view.session.problem || view.session.id) : null}
      objectAttr={objectAttr(r)}
      tabs={SHEET_TABS.step}
      tab={tab}
      onTab={setSheetTab}
      primary={{ label: p.label, onClick: () => setMessaging((m) => !m), disabled: can }}
      onClose={closeSheet}
    >
      {messaging && can === null && <MessageBox runId={r.runId} target={unit?.assigned_cli ?? 'all'} can={can} />}
      {tab === 'happening' && (
        <div data-testid="sheet-happening" className="wk-sheet-section">
          <p className="wk-sheet-line"><b>{name}</b> is {unit !== null ? (unit.ord === live ? 'working' : UNIT_WORD[unit.status] ?? unit.status) : 'not started'}{unit?.assigned_cli ? ` · ${unit.assigned_cli}` : ''}.</p>
          {unit !== null && unit.ord === live && <LiveNarration runId={r.runId} ord={unit.ord} phase={name} />}
          {unit === null && <p className="wk-session-grey">Nothing has run for this step yet.</p>}
          {/* DC-S8 (B10): the rules this step was given — considered · set aside · cited (unchecked). */}
          {unit !== null && unit.status !== 'pending' && <UnitConsidered runId={r.runId} ord={unit.ord} status={unit.status} navigate={navigate} />}
        </div>
      )}
      {tab === 'events' && (
        <div data-testid="sheet-events" className="wk-sheet-section">
          {events.state === 'loading' && <p className="wk-session-grey">Reading the events…</p>}
          {events.state === 'error' && <p role="alert" className="wk-composer-note wk-composer-note--bad">Could not read the events: {events.message}</p>}
          {events.state === 'ok' && (() => {
            const mine = events.events.filter((e) => (e as { ord?: unknown }).ord === r.ord);
            return mine.length === 0
              ? <p data-testid="sheet-events-empty" className="wk-session-grey">No events for this step yet.</p>
              : <pre className="wk-sheet-pre">{JSON.stringify(mine.slice(-50), null, 2)}</pre>;
          })()}
        </div>
      )}
      {tab === 'did' && (unit !== null ? <UnitOutput runId={r.runId} unit={unit} /> : <p className="wk-session-grey">Nothing has run for this step yet.</p>)}
      {tab === 'changes' && (
        <div data-testid="sheet-changes" className="wk-sheet-section wk-sheet-fill">
          <FileViewer runId={r.runId} defaultTab="diff" base="merge-base" onClose={() => setSheetTab('happening')} onUnsupported={() => setSheetTab('happening')} />
        </div>
      )}
      <p className="wk-sheet-hint">
        <a href={`/runs/${encodeURIComponent(r.runId)}`} data-testid="sheet-record" onClick={(e) => { e.preventDefault(); closeSheet(); navigate(`/runs/${encodeURIComponent(r.runId)}`); }}>Full record →</a>
      </p>
    </Sheet>
  );
}

function SeatFacts({ seat }: { seat: RosterSeat | undefined }): React.ReactElement {
  // Amendment 5, decision 5: a signed-out helper's sheet offers the one plain-words sign-in panel.
  const [signIn, setSignIn] = useState(false);
  if (seat === undefined) return <p className="wk-session-grey">This helper is not on the roster.</p>;
  const standing = seatStandingWord(seat);
  const health = (seat.health as { status?: string; message?: string } | undefined) ?? undefined;
  return (
    <div data-testid="sheet-seat" data-seat={seat.key} className="wk-sheet-section">
      <p className="wk-sheet-line"><b>{seat.display_name || seat.key}</b> — {standing.detail}</p>
      {health?.message !== undefined && health.message !== '' && <p className="wk-session-grey">{health.message}</p>}
      <p className="wk-session-grey">{seat.enabled_for_council ? 'Takes part in councils.' : 'Not in councils.'}</p>
      {signInLapsed(seat) && (
        <button type="button" data-testid="sheet-seat-signin" onClick={() => setSignIn(true)} className="wk-prop-btn wk-prop-btn--ghost">Sign in</button>
      )}
      {signIn && <SignInPanel seat={seat} onClose={() => setSignIn(false)} />}
    </div>
  );
}

function HelperSheet({ r, tab, runs }: { r: Extract<ObjectRef, { kind: 'helper' }>; tab: string; runs: SessionView[] }): React.ReactElement {
  const view = runs.find((v) => v.session.id === r.runId) ?? null;
  const roster = useRoster();
  const seat = roster?.find((s) => s.key === r.cli);
  const units = (view?.units ?? []).filter((u) => u.assigned_cli === r.cli).sort((a, b) => a.ord - b.ord);
  const live = view !== null ? executingOrd(view.session, view.units) : null;
  const liveUnit = units.find((u) => u.ord === live) ?? null;
  const [typing, setTyping] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const can = view === null || !MESSAGEABLE.has(view.session.status) ? 'It is not working right now, so it cannot read a message.' : null;
  return (
    <Sheet
      title={seat?.display_name || r.cli}
      sub={view !== null ? `on “${humanTitle(view.session.problem || view.session.id)}”` : null}
      objectAttr={objectAttr(r)}
      tabs={SHEET_TABS.helper}
      tab={tab}
      onTab={setSheetTab}
      primary={{ label: primaryAction('helper').label, onClick: () => setMessaging((m) => !m), disabled: can }}
      onClose={closeSheet}
    >
      {messaging && can === null && <MessageBox runId={r.runId} target={r.cli} can={can} />}
      {tab === 'terminal' && (
        <div data-testid="sheet-terminal" data-typing={typing ? 'on' : 'off'} className="wk-sheet-section">
          <p className="wk-sheet-hint">Read-only: typing into it is off unless you turn it on.</p>
          <button type="button" role="switch" aria-checked={typing} data-testid="sheet-terminal-typing" onClick={() => setTyping((t) => !t)} className="wk-prop-btn wk-prop-btn--ghost">
            {typing ? 'Typing is on — turn it off' : 'Let me type into it'}
          </button>
          {liveUnit !== null
            ? <LiveNarration runId={r.runId} ord={liveUnit.ord} phase={stepName(liveUnit)} />
            : units.length > 0
              ? <UnitOutput runId={r.runId} unit={units[units.length - 1]!} />
              : <p className="wk-session-grey">It has not worked on this run yet.</p>}
          {typing && <MessageBox runId={r.runId} target={r.cli} can={can} />}
        </div>
      )}
      {tab === 'did' && (
        <ul data-testid="sheet-did" className="wk-sheet-list">
          {units.length === 0 && <li className="wk-session-grey">Nothing on this run yet.</li>}
          {units.map((u) => (
            <li key={u.id} data-testid="sheet-did-row" className="wk-sheet-line">{stepName(u)} — {u.ord === live ? 'working' : UNIT_WORD[u.status] ?? u.status}</li>
          ))}
        </ul>
      )}
      {tab === 'signin' && (roster === null ? <p className="wk-session-grey">Reading the roster…</p> : <SeatFacts seat={seat} />)}
    </Sheet>
  );
}

function SessionSheet({ r, tab: asked, runs, navigate }: { r: Extract<ObjectRef, { kind: 'session' }>; tab: string; runs: SessionView[]; navigate: Navigate }): React.ReactElement {
  const runChatId = useCapabilities((s) => s.runChatId);
  const mine = useMemo(() => sessionRuns(r.sessionId, runs, runChatId), [r.sessionId, runs, runChatId]);
  const newest = mine[mine.length - 1] ?? null;
  const roster = useRoster();
  const isSystem = useIsSystemWorkflow();
  const sections = newest !== null ? runSections(newest, isSystem) : [];
  // The run's sections — and its steps, changes and evidence — only where the run has them (none
  // when no run of it is on this daemon).
  const runTab = new Set<string>(['steps', 'changes', 'evidence', ...RUN_SECTION_TABS.map((t) => t.id)]);
  const tabs = SHEET_TABS.session.filter((t) => !runTab.has(t.id) || (newest !== null && (!RUN_SECTION_TABS.some((r) => r.id === t.id) || sections.some((x) => x.id === t.id))));
  // A tab that went away under the open sheet (the run finished, Plan left) falls back to the first.
  const tab = tabs.some((t) => t.id === asked) ? asked : tabs[0]!.id;
  const title = newest !== null ? humanTitle(mine[0]!.session.problem || mine[0]!.session.id) : 'This session';
  const record = newest !== null ? `/runs/${encodeURIComponent(newest.session.id)}` : null;
  return (
    <Sheet
      title={title}
      sub={mine.length > 1 ? `${mine.length} runs` : null}
      objectAttr={objectAttr(r)}
      tabs={tabs}
      tab={tab}
      onTab={setSheetTab}
      primary={{ label: primaryAction('session').label, onClick: () => { if (record !== null) { closeSheet(); navigate(record); } }, disabled: record === null ? 'Nothing in this session is on this daemon.' : null }}
      onClose={closeSheet}
    >
      {tab === 'goal' && (
        <ul data-testid="sheet-goal" className="wk-sheet-list">
          {mine.length === 0 && <li className="wk-session-grey">Nothing in this session is on this daemon.</li>}
          {mine.map((v) => <li key={v.session.id} className="wk-sheet-line">{v.session.problem || v.session.id}</li>)}
        </ul>
      )}
      {tab === 'steps' && (newest !== null ? <StepsList view={newest} /> : <p className="wk-session-grey">Nothing in this session is on this daemon.</p>)}
      {tab === 'helpers' && <HelpersList runs={mine} />}
      {tab === 'changes' && newest !== null && (
        <div data-testid="sheet-session-changes" className="wk-sheet-section wk-sheet-fill">
          <FileViewer runId={newest.session.id} defaultTab="diff" base="merge-base" onClose={() => setSheetTab('steps')} onUnsupported={() => setSheetTab('steps')} />
        </div>
      )}
      {tab === 'evidence' && newest !== null && <EvidenceTab runId={newest.session.id} />}
      {tab === 'activity' && newest !== null && <ActivityTail runId={newest.session.id} />}
      {tab === 'signins' && <SignIns roster={roster} />}
      {newest !== null && sections.some((s) => s.id === tab) && <RunSection id={tab as AccordionId} view={newest} navigate={navigate} />}
    </Sheet>
  );
}

function RunSection({ id, view, navigate }: { id: AccordionId; view: SessionView; navigate: Navigate }): React.ReactElement {
  const model = useRunModel(view.session.id, view);
  const provenance = useProvenanceStore((s) => s.byRun[view.session.id] ?? null);
  useEffect(() => { useProvenanceStore.getState().load(view.session.id); }, [view.session.id]);
  return (
    <div data-testid="sheet-section" data-section={id}>
      <RunSectionBody id={id} view={view} model={model} provenance={provenance} retriedAs={[]} navigate={navigate} />
    </div>
  );
}

/**
 * S15d: the run's steps in order — the old run page's timeline in plain words. Each row names the
 * step, what state it is in and who has it; the row opens the step's own sheet on "What it did"
 * (its transcript; Changes and Live events are its other tabs). A stopped step says why.
 */
function StepsList({ view }: { view: SessionView }): React.ReactElement {
  const live = executingOrd(view.session, view.units);
  const units = [...view.units].sort((a, b) => a.ord - b.ord);
  return (
    <ul data-testid="sheet-steps" className="wk-sheet-list">
      {units.length === 0 && <li className="wk-session-grey">No step has been planned yet.</li>}
      {units.map((u) => {
        const word = u.ord === live ? 'working' : UNIT_WORD[u.status] ?? u.status;
        const ref: ObjectRef = { kind: 'step', runId: view.session.id, ord: u.ord };
        return (
          <li key={u.id} data-testid="sheet-step-row" data-ord={u.ord} data-status={u.status} className="wk-sheet-line" data-object={objectAttr(ref)}>
            <button type="button" data-testid="sheet-step-open" aria-label={`What ${stepName(u)} did`} onClick={() => useSheets.setState({ open: { ref, tab: 'did' } })} className="wk-since-toggle">
              {stepName(u)} — {word}{u.assigned_cli ? ` · ${u.assigned_cli}` : ''}
            </button>
            {u.denial_reason ? <span data-testid="sheet-step-why" className="wk-session-grey"> — {u.denial_reason}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** S15d: the run's evidence bundle (`GET /runs/:id/evidence`) — what the old run page offered as a download. */
function EvidenceTab({ runId }: { runId: string }): React.ReactElement {
  const [state, setState] = useState<'idle' | 'getting' | 'got' | 'failed'>('idle');
  const get = (): void => {
    setState('getting');
    downloadRunEvidence(runId).then(() => setState('got')).catch(() => setState('failed'));
  };
  return (
    <div data-testid="sheet-evidence" className="wk-sheet-section">
      <p className="wk-sheet-line">Everything the run recorded — its events, verdicts and files — as one file you can keep or hand to a reviewer.</p>
      <button type="button" data-testid="sheet-evidence-download" disabled={state === 'getting'} onClick={get} className="wk-prop-btn wk-prop-btn--ghost">{state === 'getting' ? 'Getting it…' : 'Download the evidence'}</button>
      {state === 'got' && <p role="status" className="wk-sheet-hint">Downloaded.</p>}
      {state === 'failed' && <p role="alert" className="wk-composer-note wk-composer-note--bad">Could not get the evidence from the daemon.</p>}
    </div>
  );
}

function HelpersList({ runs }: { runs: readonly SessionView[] }): React.ReactElement {
  const rows = runs.flatMap((v) => helpersOf(v).map((cli) => ({ v, cli })));
  return (
    <ul data-testid="sheet-helpers" className="wk-sheet-list">
      {rows.length === 0 && <li className="wk-session-grey">No helper has been given work here yet.</li>}
      {rows.map(({ v, cli }) => {
        const live = executingOrd(v.session, v.units);
        const working = v.units.some((u) => u.ord === live && u.assigned_cli === cli);
        const ref: ObjectRef = { kind: 'helper', runId: v.session.id, cli };
        return (
          <li key={`${v.session.id}:${cli}`} className="wk-sheet-line" data-object={objectAttr(ref)}>
            <button type="button" data-testid="sheet-helper-open" data-cli={cli} onClick={() => useSheets.setState({ open: { ref, tab: SHEET_TABS.helper[0]!.id } })} className="wk-since-toggle">{cli}</button>
            {' '}— {working ? 'working' : TERMINAL.has(v.session.status) ? 'finished' : 'waiting'} on “{humanTitle(v.session.problem || v.session.id)}”
          </li>
        );
      })}
    </ul>
  );
}

function ActivityTail({ runId }: { runId: string }): React.ReactElement {
  const ev = useRunRawEvents(runId);
  if (ev.state === 'loading') return <p className="wk-session-grey">Reading the activity…</p>;
  if (ev.state === 'error') return <p role="alert" className="wk-composer-note wk-composer-note--bad">Could not read the activity: {ev.message}</p>;
  const tail = ev.events.slice(-30).reverse();
  return (
    <ul data-testid="sheet-activity" className="wk-sheet-list">
      {tail.length === 0 && <li className="wk-session-grey">Nothing has happened yet.</li>}
      {tail.map((e, i) => <li key={i} className="wk-sheet-line">{String((e as { type?: unknown }).type ?? 'event')}</li>)}
    </ul>
  );
}

function SignIns({ roster }: { roster: RosterSeat[] | null }): React.ReactElement {
  // Amendment 5, decision 5: a signed-out seat's row offers the one plain-words sign-in panel.
  const [signIn, setSignIn] = useState<RosterSeat | null>(null);
  if (roster === null) return <p className="wk-session-grey">Reading the roster…</p>;
  return (
    <ul data-testid="sheet-signins" className="wk-sheet-list">
      {roster.length === 0 && <li className="wk-session-grey">No helper is set up on this daemon yet.</li>}
      {roster.map((s) => (
        <li key={s.key} data-testid="sheet-signin-row" data-seat={s.key} className="wk-sheet-line">
          <b>{s.display_name || s.key}</b> — {seatStandingWord(s).detail}
          {signInLapsed(s) && <> <button type="button" data-testid="sheet-signin-action" data-seat={s.key} onClick={() => setSignIn(s)} className="wk-since-toggle">Sign in</button></>}
        </li>
      ))}
      {signIn !== null && <SignInPanel seat={signIn} onClose={() => setSignIn(null)} />}
    </ul>
  );
}

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.round(n / 1e3)} kB`;
}

function DeskSheet({ tab, runs, navigate, needCount }: { tab: string; runs: SessionView[]; navigate: Navigate; needCount: number }): React.ReactElement {
  const roster = useRoster();
  const [diag, setDiag] = useState<{ d: Diagnostics } | { error: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    getDiagnostics()
      .then((d) => { if (!cancelled) setDiag({ d }); })
      .catch((e: unknown) => { if (!cancelled) setDiag({ error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, []);
  const live = runs.filter((v) => !TERMINAL.has(v.session.status));
  return (
    <Sheet
      title="The Desk"
      sub={needCount === 0 ? 'Nothing needs you.' : `${needCount} ${needCount === 1 ? 'thing needs' : 'things need'} you.`}
      objectAttr="desk"
      tabs={SHEET_TABS.desk}
      tab={tab}
      onTab={setSheetTab}
      primary={{ label: primaryAction('desk').label, onClick: () => { closeSheet(); navigate('/projects'); } }}
      onClose={closeSheet}
    >
      {tab === 'studio' && (
        <div data-testid="sheet-studio" className="wk-sheet-section">
          {diag === null && <p className="wk-session-grey">Asking the daemon…</p>}
          {diag !== null && 'error' in diag && <p role="alert" className="wk-composer-note wk-composer-note--bad">The daemon could not say ({diag.error}).</p>}
          {diag !== null && 'd' in diag && (
            <>
              <p className="wk-sheet-line">wicked-crew {diag.d.components.crew}{diag.d.components.studioBundle ? ` · studio ${diag.d.components.studioBundle}` : ''}{diag.d.components.coreTs ? ` · engine ${diag.d.components.coreTs}` : ''}</p>
              <p className="wk-session-grey">Up {Math.round(diag.d.daemon.uptimeMs / 60_000)} min · {diag.d.recentErrors.length === 0 ? 'no recent errors' : `${diag.d.recentErrors.length} recent errors`}</p>
            </>
          )}
        </div>
      )}
      {tab === 'computer' && (
        <ul data-testid="sheet-computer" className="wk-sheet-list">
          {diag !== null && 'd' in diag && diag.d.stores.map((s) => <li key={s.name} className="wk-sheet-line">{s.name} — {fmtBytes(s.bytes)}</li>)}
          {diag !== null && 'd' in diag && diag.d.stores.length === 0 && <li className="wk-session-grey">The daemon lists no stores.</li>}
          {diag !== null && 'error' in diag && <li role="alert" className="wk-composer-note wk-composer-note--bad">The daemon could not say ({diag.error}).</li>}
          {diag === null && <li className="wk-session-grey">Asking the daemon…</li>}
        </ul>
      )}
      {tab === 'signins' && <SignIns roster={roster} />}
      {tab === 'helpers' && <HelpersList runs={live} />}
      {tab === 'hold' && (
        <div data-testid="sheet-hold" className="wk-sheet-section">
          <p className="wk-sheet-hint">Holds every hand-over: nothing is pushed until you let it go. It asks you first.</p>
          <DeliveryFreezeSwitch placement="inline" />
        </div>
      )}
    </Sheet>
  );
}

export { OBJECT_ACTIONS };
