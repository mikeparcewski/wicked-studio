import { useEffect, useId, useRef, useState } from 'react';
import { CircleCheck, CircleX, FileText, Flag, GitCommitHorizontal, MessageCircle, Pencil, ShieldCheck, Terminal, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { ApiError } from '../../api/errors.js';
import { powerApi, rigorRank, type HandoffStep, type PauseDecision, type PowerState, type Rigor, type RigorChange, type RigorPlan } from '../../api/power.js';
import type { SessionView } from '../../api/types.js';
import { queueDecision, reportDecision } from '../../board/undoQueue.js';
import { clockTime } from '../../board/handover.js';
import {
  PAUSE_CHOICES, RAISE_WORDS, changeReason, pauseReasonWords, changedBy, handoffRow, handoffWords, higherRigors, listWords, pauseOrder, powerSwitch, rigorAt, rigorChip, settleHandoff,
  type ActivityRow, type PauseChoice, type PowerItem,
} from '../../board/powerMode.js';
import { seatResponder } from '../../board/responder.js';
import { rememberPower } from '../../hooks/usePower.js';
import { useRoster } from '../../hooks/useRoster.js';
import { openLaunchWizard } from '../../store/launchWizard.js';
import { Markdown } from '../Markdown.js';
import { TurnWho } from './TurnWho.js';

/**
 * POWER MODE on the run page (program DES-POWER-MODE; mockup design/mockups/power-mode.html): the header's switch and
 * rigor chip, and the thread's intake card, orchestrator turns, activity rows, checkpoint and rigor markers, hand-off
 * card and the "this grew" dock. Every part draws only when the daemon runs power mode (`usePower` is null otherwise).
 */

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function errorWords(e: unknown): string {
  if (e instanceof ApiError && e.body !== null && typeof e.body === 'object') {
    const reason = (e.body as { reason?: unknown }).reason;
    if (typeof reason === 'string' && reason.trim() !== '') return reason;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Close a popover on Escape and on a click outside it. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    const onDown = (e: MouseEvent): void => { if (ref.current !== null && !ref.current.contains(e.target as Node)) close(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open, close, ref]);
}

// ── the header ───────────────────────────────────────────────────────────────────────────────────────

/** The switch beside the run's name, then the rigor chip (the state badge sits between them in the header). */
export function PowerSwitchButton({ view, power }: { view: SessionView; power: PowerState }): React.ReactElement {
  const id = view.session.id;
  const sw = powerSwitch(power, view.session.status);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLSpanElement | null>(null);
  useDismiss(confirm, () => setConfirm(false), wrap);
  const next = !sw.checked;
  const flip = (): void => {
    setBusy(true);
    setError(null);
    powerApi.toggle(id, next).then(
      (v) => { rememberPower(id, v); setConfirm(false); },
      (e: unknown) => setError(errorWords(e)),
    ).finally(() => setBusy(false));
  };
  return (
    <span ref={wrap} className="pm-rigor-wrap">
      <button
        type="button" role="switch" data-testid="power-switch" aria-checked={sw.checked ? 'true' : 'false'}
        aria-disabled={sw.disabled !== null ? 'true' : undefined} data-disabled={sw.disabled !== null ? 'true' : 'false'}
        title={sw.disabled ?? sw.title} aria-label={`Power mode ${sw.checked ? 'on' : 'off'}`}
        onClick={() => { if (sw.disabled === null && !busy) { setError(null); setConfirm((c) => !c); } }}
        className="pm-power"
      >
        <span className="pm-power-track" aria-hidden /><Zap aria-hidden />Power
      </button>
      {confirm && (
        <span role="dialog" aria-label={next ? 'Turn power mode on' : 'Turn power mode off'} data-testid="power-switch-confirm" className="pm-rigor-pop">
          <p className="wk-session-text">{next ? sw.title : 'Turn power mode off? The rest of the work goes phased, with a gate after each phase. It adds rigor; what the orchestrator did so far is kept.'}</p>
          <span className="wk-prop-btns" style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button type="button" data-testid="power-switch-yes" disabled={busy} onClick={flip} className="wk-btn wk-btn--primary wk-btn--sm" autoFocus>
              {busy ? (next ? 'Turning on…' : 'Turning off…') : next ? 'Turn on' : 'Turn off'}
            </button>
            <button type="button" data-testid="power-switch-keep" onClick={() => setConfirm(false)} className="wk-btn wk-btn--quiet wk-btn--sm">{next ? 'Keep it off' : 'Keep it on'}</button>
          </span>
          {error !== null && <span role="alert" data-testid="power-switch-error" className="pm-rigor-note" style={{ display: 'block' }}>Not switched: {error}</span>}
        </span>
      )}
    </span>
  );
}

/** One rigor-history line: "14:19 checkpoint 2, sign-in touched, score 34 → 58". */
export function rigorHistoryWords(c: RigorChange): string {
  const when = clockTime(c.at);
  const what = c.trigger === 'intake' ? 'intake'
    : changedBy(c) === 'you' ? 'raised by you'
      : c.trigger === 'plugin' ? `raised by ${c.by.replace(/^plugin:/, '').replace(/@.*$/, '')}`
        : c.trigger === 'doc_edit' ? 'a working-document edit'
          : c.trigger === 'toggle' ? 'power switch'
            : c.checkpoint !== null ? `checkpoint ${c.checkpoint}` : c.trigger === 'pre_handoff' ? 'before hand-off' : c.trigger;
  const reason = changeReason(c);
  const why = reason !== null && c.trigger !== 'intake' ? `, ${reason}` : '';
  const score = c.trigger === 'intake' ? `, score ${c.actual}` : c.planned !== c.actual ? `, score ${c.planned} → ${c.actual}` : '';
  return `${when} ${what}${why}${score}`;
}

/** The rigor history: the intake row, then every change that moved it. */
export function RigorHistory({ power }: { power: PowerState }): React.ReactElement {
  const rows = power.history.filter((c) => c.to !== null && (c.direction !== 'same' || c.trigger === 'intake'));
  const intake = rows.some((c) => c.trigger === 'intake');
  return (
    <div data-testid="rigor-history">
      {!intake && power.plan !== null && (
        <div className="pm-rigor" data-testid="rigor-history-row" data-trigger="intake">
          <span className={`pm-chip pm-chip--${power.plan.rigor}`}>{power.plan.rigor}</span>
          <span>{clockTime(power.plan.at)} intake, score {power.plan.score}</span>
        </div>
      )}
      {rows.map((c) => (
        <div key={c.seq} className="pm-rigor" data-testid="rigor-history-row" data-trigger={c.trigger} data-direction={c.direction}>
          {c.trigger !== 'intake' && <span className="pm-rigor-arrow" aria-hidden>{c.direction === 'up' ? '↑' : c.direction === 'down' ? '↓' : '·'}</span>}
          <span className={`pm-chip pm-chip--${c.to}`}>{c.to}</span>
          <span>{rigorHistoryWords(c)}</span>
        </div>
      ))}
    </div>
  );
}

/** The header's rigor chip ("Rigor high ↑"); it opens the rigor history, and a raise. */
export function RigorChipButton({ view, power }: { view: SessionView; power: PowerState }): React.ReactElement | null {
  const chip = rigorChip(power, clockTime);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement | null>(null);
  const popId = useId();
  useDismiss(open, () => setOpen(false), wrap);
  if (chip === null) return null;
  const live = !TERMINAL.has(view.session.status);
  return (
    <span ref={wrap} className="pm-rigor-wrap">
      <button type="button" data-testid="rigor-chip" data-rigor={chip.rigor} data-raised={chip.raised ? 'true' : 'false'} title={chip.title}
        aria-expanded={open} aria-controls={popId} onClick={() => setOpen((o) => !o)} className={`pm-chip pm-chip--${chip.rigor}`}>
        Rigor {chip.rigor}{chip.raised && <b aria-label="raised"> ↑</b>}
      </button>
      {open && (
        <div id={popId} role="dialog" aria-label="Rigor history" className="pm-rigor-pop pm-rigor-pop--end">
          <h2>Rigor history</h2>
          <RigorHistory power={power} />
          <p className="pm-rigor-note">Hand-off: {handoffWords(chip.rigor, power.plan)}.</p>
          {live && <RaiseRigor runId={view.session.id} rigor={chip.rigor} />}
        </div>
      )}
    </span>
  );
}

// ── raising rigor ────────────────────────────────────────────────────────────────────────────────────

/** "Raise rigor ▾": the rigors above the current one; a raise becomes a floor. Nothing here can lower it. */
function RaiseRigor({ runId, rigor, inCard = false }: { runId: string; rigor: Rigor; inCard?: boolean }): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; to: Rigor } | { kind: 'error'; why: string }>({ kind: 'idle' });
  const above = higherRigors(rigor);
  // A raise that just reached the top still says it landed; with nothing above and nothing to say, the card has no menu.
  if (above.length === 0 && state.kind !== 'done') return inCard ? null : <p className="pm-rigor-note">Rigor is at its highest.</p>;
  const raise = (to: Rigor): void => {
    setState({ kind: 'busy' });
    powerApi.raise(runId, to, 'Raised by you from the job page').then(
      (v) => { rememberPower(runId, v); setState({ kind: 'done', to }); setOpen(false); },
      (e: unknown) => setState({ kind: 'error', why: errorWords(e) }),
    );
  };
  return (
    <>
      {above.length > 0 && <span className={inCard ? 'pm-intake-acts' : ''} style={inCard ? { gridColumn: 2 } : { display: 'block', marginTop: 8 }}>
        <button type="button" data-testid="rigor-raise" aria-expanded={open} disabled={state.kind === 'busy'} onClick={() => setOpen((o) => !o)} className="wk-chat-chip">
          {state.kind === 'busy' ? 'Raising…' : 'Raise rigor'} <span aria-hidden>▾</span>
        </button>
      </span>}
      {open && above.length > 0 && (
        <div role="menu" aria-label="Raise rigor to" data-testid="rigor-raise-menu" className="pm-intake-menu">
          {above.map((r) => (
            <button key={r} type="button" role="menuitem" data-testid="rigor-raise-to" data-rigor={r} onClick={() => raise(r)}>
              {r[0]!.toUpperCase() + r.slice(1)} <small>{RAISE_WORDS[r]}</small>
            </button>
          ))}
        </div>
      )}
      {state.kind === 'done' && <p role="status" data-testid="rigor-raise-done" className="pm-intake-status">Raised to {state.to}. It holds from now on: rigor never goes below it.</p>}
      {state.kind === 'error' && <p role="alert" data-testid="rigor-raise-error" className="pm-intake-status">Not raised: {state.why}</p>}
    </>
  );
}

// ── the thread ───────────────────────────────────────────────────────────────────────────────────────

/** The intake QE plan, informational: it never waits on you. */
export function IntakeCard({ runId, plan, rigor, at, live }: { runId: string; plan: RigorPlan; rigor: Rigor; at: number | null; live: boolean }): React.ReactElement {
  return (
    <div role="note" aria-label="QE plan" data-testid="power-intake" data-rigor={plan.rigor} className="pm-intake">
      <span className="pm-intake-icon" aria-hidden><ShieldCheck /></span>
      <p className="pm-intake-eyebrow">QE plan · set at intake{at !== null ? ` · ${clockTime(at)}` : ''}</p>
      <p className="pm-intake-line" data-testid="power-intake-line"><b>Rigor {plan.rigor}</b> — {handoffWords(plan.rigor, plan)}</p>
      <div className="pm-intake-acts">
        {live && <RaiseRigor runId={runId} rigor={rigor} inCard />}
        <details data-testid="power-intake-more">
          <summary>More about this</summary>
          <p>Change score {plan.score} from the code graph (the {plan.band} band){plan.highRisk ? ', marked high risk' : ''}.{plan.reasons.length > 0 ? ` ${plan.reasons.join('; ')}.` : ''}</p>
          {plan.estimateMinutes !== null && <p>Estimate: about {plan.estimateMinutes} min of build.</p>}
          {plan.mandatoryPhases.length > 0 && <p>Stays phased: {listWords(plan.mandatoryPhases.map((m) => `${m.phase} (${m.why})`))}.</p>}
          {plan.risks.length > 0 && <><p>Risks:</p><ul>{plan.risks.map((r) => <li key={r}>{r}</li>)}</ul></>}
          {plan.scenarios.length > 0 && <><p>Planned tests:</p><ul>{plan.scenarios.map((s) => <li key={s}>{s}</li>)}</ul></>}
          {plan.floors.length > 0 && <p>Never below: {listWords(plan.floors.map((f) => `${f.rigor} (${f.why})`))}.</p>}
          <p>Checkpoints re-score the diff as the work goes and can only raise rigor on their own. Nothing waits on this card.</p>
        </details>
      </div>
    </div>
  );
}

const ACT_ICON: Record<ActivityRow['kind'], typeof Pencil> = {
  edit: Pencil, test: CircleCheck, commit: GitCommitHorizontal, read: FileText,
};

function ActivityRows({ rows }: { rows: readonly ActivityRow[] }): React.ReactElement {
  return (
    <div className="pm-acts" data-testid="power-acts" aria-label="What the orchestrator did">
      {rows.map((r, i) => {
        const Icon = r.tone === 'fail' ? CircleX : ACT_ICON[r.kind];
        return (
          <div key={i} data-testid="power-act" data-kind={r.kind} className={`pm-act${r.tone !== 'plain' ? ` pm-act--${r.tone}` : ''}`}>
            <Icon aria-hidden />
            <span className="pm-act-words">
              {r.lead}
              {r.sha !== null && <> <span className="pm-sha">{r.sha}</span></>}
              {r.code !== null && <> <code>{r.code}</code></>}
              {r.added !== null && <> <span className="pm-add">+{r.added}</span></>}
              {r.removed !== null && <> <span className="pm-del">−{r.removed}</span></>}
              {r.tail !== null && <>{r.kind === 'read' ? ' ' : ' · '}{r.tail}</>}
            </span>
            {r.at !== null && <span className="pm-act-meta">{clockTime(r.at)}</span>}
          </div>
        );
      })}
    </div>
  );
}

function Mark({ testId, tone, icon, head, tail, at, extra = {} }: {
  testId: string; tone: 'plain' | 'up' | 'down' | 'note' | 'paused'; icon: React.ReactNode; head: string; tail: string; at: number | null; extra?: Record<string, string>;
}): React.ReactElement {
  return (
    <div role="note" data-testid={testId} {...extra} className={`wk-dmark pm-mark${tone !== 'plain' ? ` pm-mark--${tone}` : ''}`}>
      {icon}
      <span className="wk-dmark-words"><b>{head}</b>{tail !== '' ? ` · ${tail}` : ''}</span>
      {at !== null && <span className="wk-dmark-go">{clockTime(at)}</span>}
    </div>
  );
}

/** The hand-off as it ran: one row per step (checks, the distinct reviewer, QE, compliance), each with its status. */
export function HandoffCard({ round, steps, rigor }: { round: number; steps: readonly HandoffStep[]; rigor: Rigor | null }): React.ReactElement {
  const roster = useRoster();
  const name = (cli: string): string => seatResponder(cli, roster).name;
  return (
    <div role="list" aria-label="Hand-off results" data-testid="power-handoff" data-round={round} className="pm-handoff">
      {steps.map((s) => {
        const w = handoffRow(s, rigor, name);
        return (
          <div key={s.step} role="listitem" data-testid="power-handoff-row" data-step={s.step} data-status={s.status} className="pm-hrow">
            <span aria-hidden className={`pm-hrow-dot${w.initial === null ? ' pm-hrow-dot--icon' : ''}`}>{w.initial ?? (s.step === 'checks' ? <Terminal /> : <ShieldCheck />)}</span>
            <p className="pm-hrow-who">{w.who} <span>· {w.role}</span></p>
            <span data-testid="power-handoff-result" className={`pm-res pm-res--${w.tone}`}>{w.result}</span>
            {w.what !== null && w.what !== '' && <p className="pm-hrow-what">{w.what}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** The power items of the run's thread. `part`: the intake card (it opens the run's turns) or everything after it. */
export function PowerThread({ view, power, items, part }: { view: SessionView; power: PowerState; items: readonly PowerItem[]; part: 'intake' | 'rest' }): React.ReactElement | null {
  const roster = useRoster();
  const id = view.session.id;
  const live = !TERMINAL.has(view.session.status);
  const shown = items.filter((i) => (part === 'intake' ? i.kind === 'intake' : i.kind !== 'intake'));
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map((it) => {
        switch (it.kind) {
          case 'intake':
            return <IntakeCard key={it.key} runId={id} plan={it.plan} rigor={power.rigor ?? it.plan.rigor} at={it.at} live={live} />;
          case 'turn':
            return (
              <div key={it.key} data-testid="power-turn" data-turn={it.turn} className="wk-chat-msg wk-chat-msg--assistant">
                <TurnWho who={seatResponder(it.cli, roster)} runId={id} suffix="orchestrator" at={it.at} className="wk-chat-who" />
                <div className="wk-chat-body"><div className="wk-chat-md"><Markdown>{it.summary}</Markdown></div></div>
              </div>
            );
          case 'acts':
            return <ActivityRows key={it.key} rows={it.rows} />;
          case 'checkpoint': {
            const [head, ...rest] = it.words.split(' · ');
            return (
              <Mark key={it.key} testId="power-checkpoint" tone={it.paused ? 'paused' : it.picked > 0 ? 'note' : 'plain'}
                icon={it.picked > 0 ? <MessageCircle size={15} aria-hidden className="wk-dmark-icon" /> : <Flag size={15} aria-hidden className="wk-dmark-icon" />}
                head={head ?? ''} tail={rest.join(' · ')} at={it.at} extra={{ 'data-checkpoint': String(it.checkpoint) }} />
            );
          }
          case 'rigor': {
            const [head, ...rest] = it.words.split(' · ');
            const up = it.change.direction === 'up';
            return (
              <Mark key={it.key} testId="power-rigor-mark" tone={up ? 'up' : 'down'}
                icon={up ? <TrendingUp size={15} aria-hidden className="wk-dmark-icon" /> : <TrendingDown size={15} aria-hidden className="wk-dmark-icon" />}
                head={head ?? ''} tail={rest.join(' · ')} at={it.at} extra={{ 'data-from': it.change.from ?? '', 'data-to': it.change.to ?? '' }} />
            );
          }
          case 'toggle':
            return <Mark key={it.key} testId="power-toggle-mark" tone="plain" icon={<Zap size={15} aria-hidden className="wk-dmark-icon" />} head={it.words.split(' · ')[0] ?? ''} tail={it.words.split(' · ').slice(1).join(' · ')} at={it.at} />;
          case 'handoff': {
            // Every row from the step's actual result: a step whose unit finished reads its outcome, and on an ended
            // run nothing reads Running. The rigor is the one that applied when hand-off's checks ran.
            const steps = settleHandoff(it.steps, (ord) => view.units.find((u) => u.ord === ord)?.status, !live);
            const checks = steps.find((st) => st.step === 'checks') ?? null;
            const applied = rigorAt(power, checks?.at ?? steps.find((st) => st.step !== 'rescore')?.at ?? it.at);
            return (
              <div key={it.key} data-testid="power-handoff-block" data-rigor={applied ?? ''} style={{ display: 'contents' }}>
                <p className="wk-chat-divider" data-testid="power-handoff-divider">Hand-off{it.round > 1 ? ` · round ${it.round}` : ''}{it.at !== null ? ` · ${clockTime(it.at)}` : ''}</p>
                <HandoffCard round={it.round} steps={steps} rigor={applied} />
              </div>
            );
          }
          default:
            return null;
        }
      })}
    </>
  );
}

// ── "this grew": the pause dock ──────────────────────────────────────────────────────────────────────

/**
 * The orchestrator paused at a checkpoint (`gate_kind: 'power_pause'`): split into lanes, switch to phased, continue at
 * high rigor, or stop. The engine's recommendation leads; the rest are under Other options.
 */
export function PowerPauseCard({ view, power }: { view: SessionView; power: PowerState }): React.ReactElement {
  const id = view.session.id;
  const pause = power.pause;
  const roster = useRoster();
  const who = power.orchestrator.cli !== null ? seatResponder(power.orchestrator.cli, roster).name : 'The orchestrator';
  const recommended: PauseChoice = pause?.recommended ?? 'continue_high';
  const order = pauseOrder(recommended);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<PauseChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reasons = pause?.reasons ?? [];
  const choose = (c: PauseChoice): void => {
    setMenu(false);
    setError(null);
    setBusy(c);
    // The answer is `POST /runs/:id/power/pause` (the pause is not an engine gate), sent after the same 10 s undo
    // window every decision has; Undo sends nothing.
    const send = (decision: PauseDecision, note?: string): void => {
      queueDecision({
        verb: decision === 'stop' ? 'stop' : 'approve',
        runIds: [id],
        preview: decision === 'stop' ? 'the job stops here' : decision === 'switch_phased' ? 'the rest goes phased' : decision === 'continue_high' ? 'it continues at high rigor' : 'it finishes the original change; the rest is split off',
        label: view.session.problem ?? null,
        closeNote: 'Close this tab before then and nothing is sent: the job stays paused.',
        commit: async () => {
          try {
            const v = await powerApi.pause(id, decision, note);
            rememberPower(id, v);
            reportDecision('sent', `${PAUSE_CHOICES[c].label}: sent.`);
          } catch (e) {
            setError(errorWords(e));
            reportDecision('failed', `Not sent: ${errorWords(e)}`);
          } finally { setBusy(null); }
        },
        onUndo: () => setBusy(null),
      });
    };
    if (c === 'split') {
      // This job narrows back to what was asked; the rest opens as a new job, prefilled, that starts only on Send.
      openLaunchWizard({ intent: `Split from “${view.session.problem ?? 'a power-mode job'}”: ${reasons.join('; ')}`, projectId: typeof view.session.project_id === 'string' ? view.session.project_id : null });
      send('continue', `Split into lanes: finish only the original change here (${reasons.join('; ')}). The rest is its own job now; do not do it in this run.`);
      return;
    }
    send(c);
  };
  const lead = order[0]!;
  return (
    <div data-testid="power-pause" data-recommended={recommended} className="wk-prop wk-prop--ask wk-prop--chat">
      <p className="wk-dock-eyebrow pm-pause-eyebrow" data-testid="power-pause-eyebrow">Paused · this grew{pause !== null ? ` · checkpoint ${pause.checkpoint}` : ''}</p>
      <h2 className="wk-prop-text wk-gate2-q" data-testid="power-pause-question">This change grew past its plan. How should it go on?</h2>
      <p className="wk-prop-why wk-gate2-p">{who} paused at the end of its turn. Recommended: {PAUSE_CHOICES[recommended].label.toLowerCase()}.</p>
      {reasons.length > 0 && <ul className="pm-pause-reasons" data-testid="power-pause-reasons">{reasons.map((r) => <li key={r}>{pauseReasonWords(r)}</li>)}</ul>}
      <div className="wk-prop-btns wk-gate2-choices">
        <button type="button" data-testid="power-pause-choice" data-choice={lead} disabled={busy !== null} onClick={() => choose(lead)} title={PAUSE_CHOICES[lead].sub}
          className={`wk-prop-btn wk-gate2-btn ${lead === 'stop' ? 'wk-gate2-btn--secondary' : 'wk-prop-btn--primary wk-gate2-btn--primary'}`}>
          {busy === lead ? 'Sending…' : PAUSE_CHOICES[lead].label}
        </button>
        <button type="button" aria-haspopup="menu" aria-expanded={menu} data-testid="power-pause-more" onClick={() => setMenu((m) => !m)} className="wk-prop-btn wk-gate2-btn wk-gate2-btn--secondary">
          Other options <span aria-hidden>▾</span>
        </button>
        {menu && (
          <div role="menu" aria-label="Other options" className="wk-gate2-menu">
            {order.slice(1).map((c) => (
              <button key={c} type="button" role="menuitem" data-testid="power-pause-choice" data-choice={c} data-sub={PAUSE_CHOICES[c].sub} disabled={busy !== null}
                onClick={() => choose(c)} className="wk-prop-btn wk-gate2-mi">{PAUSE_CHOICES[c].label}</button>
            ))}
          </div>
        )}
      </div>
      <p className="pm-pause-note">{PAUSE_CHOICES[lead].sub}.{rigorRank(power.rigor ?? 'standard') < rigorRank('high') && lead === 'continue_high' ? ' Rigor goes to high.' : ''}</p>
      {error !== null && <p role="alert" data-testid="power-pause-error" className="pm-pause-note">Not sent: {error}</p>}
    </div>
  );
}
