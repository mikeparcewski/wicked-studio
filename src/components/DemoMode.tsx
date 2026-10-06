import { useCallback, useEffect, useRef, useState } from 'react';
import {
  approveDemoGate,
  demoFileUrl,
  getDemo,
  isDemoRun,
  launchDemo,
  putDemoScript,
  rerecordNote,
  sendBackDemo,
  STAGE_LINE,
  stepOf,
  type DemoChapter,
  type DemoFinding,
  type DemoStage,
  type DemoStep,
  type DemoView,
} from '../api/demo.js';
import type { GateInfo, SessionView } from '../api/types.js';
import { api } from '../api/client.js';
import { modePath } from '../hooks/useRoute.js';
import { useDisplayText } from '../hooks/useHomePath.js';
import { gateOpenPath } from '../board/gateActions.js';
import { plainRunTitle } from '../board/deskWords.js';
import { Markdown } from './Markdown.js';
import { Modal } from './Modal.js';
import { OutboundDraft } from './OutboundDraft.js';
import { OUTBOUND_TITLE } from '../api/outbound.js';
import { UNFILED_MOUNT } from '../api/interactive.js';

// The Demo experience (wicked-studio#373). A demo of a real local app, made by a governed run of the
// `demo` preset — the wicked-garden demo skill's plan → record → review:
//
//   Start   who it is for, what to show, the app URL → POST /projects/:id/demo
//   Plan    the presenter script and chapter list at the PLAN GATE: approve, edit the script, or
//           send back with notes — nothing records before this is approved
//   Record  per-chapter progress, one segment per chapter
//   Review  the contact sheets and the reviewer's per-issue verdicts at the REVIEW GATE: accept, or
//           re-record one chapter
//   Watch   the chaptered MP4 with its markers, the script, and a Draft update to copy out
//
// Governance is shown where it is true: the recorder and the reviewer are different seats
// (evaluator ≠ creator), the recorder ran read-only against the app, the script labels synthetic
// data. Every number here is read from the run; nothing is inferred.

const POLL_MS = 2500;

/** The review gate's line when the engine failed the review: there is nothing to accept. */
const REVIEW_FAILED_LINE = 'The review failed the recording. Re-record what it found, or have it reviewed again.';
/** studio#521: a gate that is not one of the demo's own three is open — the stage line says so. */
const WAITING_LINE = 'The run is waiting on a decision before it goes on — the gate is below, with the way to the run.';
/** The demo's own gates, each with its card below; any OTHER open gate gets the waiting card. */
const OWN_GATE_STAGES = new Set<string>(['team_gate', 'plan_gate', 'review_gate']);
/** A governance denial's prompt (crew: "Unit N was DENIED by input governance — a tool call was
 *  refused…"): never one of the demo's own gates, whatever the stage reads. */
const DENIAL_PROMPT = /\b(DENIED|denied|refused)\b/;
/** A floor failure's prompt (crew: "Unit N failed its deterministic floor (…)"): an escalation too —
 *  and, at a rejected review, the failed review's OWN gate (the engine's NOT PASS), which the review
 *  card below answers. */
const FLOOR_PROMPT = /\bfailed its\b|\bescalat/;

/** The floor a failure names, from the engine's prompt: "Unit N failed its deterministic floor
 *  (<floor>): …" → `<floor>` (`demo_review`, `demo_record`, `walkthrough_failed`); '' when the
 *  prompt is not of that shape. The id is the only part read — the explanation after the colon may
 *  mention a review (or anything) without being the review's gate. */
function floorIdOf(prompt: string): string {
  return /failed its deterministic floor \(([^)]+)\)/.exec(prompt)?.[1] ?? '';
}

/** studio#521 (codex): which open gate gets the waiting card — one the stage does not account for,
 *  or an escalation that opened while the stage still reads as one of the demo's own gates (the
 *  stage is derived from the run's files and can lag the gate). The one gate left to its own card is
 *  the failed review's: at `review_gate` with the review rejected, a floor failure WHOSE FLOOR ID names
 *  the review is that verdict gate; a governance denial or another unit's floor failure there is
 *  still shown — neither is the review's own. */
export function waitingGateOf(gate: GateInfo | null, stage: string, reviewRejected: boolean): GateInfo | null {
  if (gate === null) return null;
  if (!OWN_GATE_STAGES.has(stage)) return gate;
  if (DENIAL_PROMPT.test(gate.prompt)) return gate;
  if (!FLOOR_PROMPT.test(gate.prompt)) return null;
  // The failed review's own verdict gate: the floor id names the review ("demo_review").
  const reviewsOwn = stage === 'review_gate' && reviewRejected && /review/i.test(floorIdOf(gate.prompt));
  return reviewsOwn ? null : gate;
}

const BTN =
  'rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed';
const PRIMARY: React.CSSProperties = { background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none' };
const QUIET: React.CSSProperties = {
  background: 'transparent', color: 'var(--ink-body)', border: '1px solid var(--surface-raised)',
};
const CARD: React.CSSProperties = {
  background: 'var(--surface-card)', border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-lg)',
};
const FIELD: React.CSSProperties = {
  background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-md)',
  color: 'var(--ink-high)', fontFamily: 'inherit', fontSize: '13px', padding: '7px 9px', width: '100%',
};
const LABEL = 'text-[10px] font-mono uppercase tracking-wide';

export interface DemoModeProps {
  projectId: string;
  /** The demo run open in the mode (`/p/:pid/video/:runId`), or null for the start page. */
  runId: string | null;
  runs: SessionView[];
  navigate: (to: string) => void;
}

export function DemoMode({ projectId, runId, runs, navigate }: DemoModeProps): React.ReactElement {
  return (
    <div data-testid="demo-mode" className="flex-1 overflow-y-auto" style={{ background: 'var(--surface-base)' }}>
      {runId === null ? (
        <DemoStart projectId={projectId} runs={runs} navigate={navigate} />
      ) : (
        <DemoRun runId={runId} projectId={projectId} navigate={navigate} />
      )}
    </div>
  );
}

// ── Start ──────────────────────────────────────────────────────────────────────────────────────

/**
 * studio#520: a demo run's row in plain words. The daemon composes the run's `problem` from the brief
 * — on crew 0.8.1 with the brief's absolute home path in it ("…follow the demo brief at
 * <home>/.wicked/demos/<id>/BRIEF.md. Demo root: …") — so the row reads by what the demo is of (the
 * first URL in the text) and falls back to the one title fold; the caller passes it through the
 * home-path formatter either way.
 */
export function demoListTitle(problem: string): string {
  const url = /https?:\/\/[^\s"'`<>)\]]+/.exec(problem);
  // A URL at the end of a sentence carries the sentence's punctuation; the demo is not of that.
  if (url !== null) return `Demo of ${url[0].replace(/[.,;:!?]+$/, '')}`;
  return plainRunTitle(problem);
}

function DemoStart({ projectId, runs, navigate }: Omit<DemoModeProps, 'runId'>): React.ReactElement {
  const showText = useDisplayText();
  const [url, setUrl] = useState('');
  const [audience, setAudience] = useState('');
  const [show, setShow] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = /^https?:\/\/\S+$/i.test(url.trim()) && audience.trim() !== '' && show.trim() !== '';
  // Unfiled (the `default` mount) holds the demo runs filed to no project.
  const demos = runs.filter((r) => {
    const pid = (r.session as { project_id?: string | null }).project_id ?? null;
    return isDemoRun(r) && (projectId === UNFILED_MOUNT ? pid === null || pid === UNFILED_MOUNT : pid === projectId);
  });

  async function start(): Promise<void> {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { runId } = await launchDemo(projectId, { url: url.trim(), audience: audience.trim(), show: show.trim() });
      navigate(modePath(projectId, 'video', runId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full flex-col gap-5 px-6 py-6" style={{ maxWidth: '1100px' }}>
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--ink-high)', margin: 0 }}>Make a demo</h1>
        <p className="text-sm" style={{ color: 'var(--ink-muted)', margin: 0 }}>
          The team plans the story and rehearses it on your app, you approve the script, it records each chapter,
          and a different seat reviews the recording before you watch it.
        </p>
      </header>
      <section data-testid="demo-start" className="grid gap-4 p-5" style={{ ...CARD, gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <label className={`${LABEL} flex flex-col gap-1`} style={{ color: 'var(--ink-dim)', gridColumn: '1 / -1' }}>
          App URL
          <input
            data-testid="demo-url"
            style={FIELD}
            placeholder="http://127.0.0.1:5173/"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className={`${LABEL} flex flex-col gap-1`} style={{ color: 'var(--ink-dim)' }}>
          Who it is for
          <textarea
            data-testid="demo-audience"
            style={{ ...FIELD, minHeight: '84px', resize: 'vertical' }}
            placeholder="New team leads who have never seen the app"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
          />
        </label>
        <label className={`${LABEL} flex flex-col gap-1`} style={{ color: 'var(--ink-dim)' }}>
          What to show
          <textarea
            data-testid="demo-show"
            style={{ ...FIELD, minHeight: '84px', resize: 'vertical' }}
            placeholder="How a request goes from intake to done, and where people approve"
            value={show}
            onChange={(e) => setShow(e.target.value)}
          />
        </label>
        <div className="flex items-center gap-3" style={{ gridColumn: '1 / -1' }}>
          <button type="button" data-testid="demo-launch" className={BTN} style={PRIMARY} disabled={!ready || busy} onClick={() => void start()}>
            {busy ? 'Starting…' : 'Plan the demo'}
          </button>
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            Nothing records until you approve the plan. The recorder only reads your app: it never submits, approves or deletes.
          </span>
        </div>
        {error !== null && (
          <p role="alert" data-testid="demo-error" className="text-xs font-mono" style={{ color: 'var(--status-fail)', margin: 0, gridColumn: '1 / -1' }}>
            {error} — nothing was started.
          </p>
        )}
      </section>
      <section data-testid="demo-list" className="flex flex-col gap-2">
        <h2 className={LABEL} style={{ color: 'var(--ink-dim)', margin: 0 }}>This project’s demos</h2>
        {demos.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--ink-muted)', margin: 0 }}>No demos yet.</p>
        )}
        {demos.map((r) => (
          <button
            key={r.session.id}
            type="button"
            data-testid="demo-list-row"
            data-run={r.session.id}
            onClick={() => navigate(modePath(projectId, 'video', r.session.id))}
            className="flex items-center justify-between gap-3 px-4 py-3 text-left"
            style={CARD}
          >
            {/* studio#520: by what the demo is of — never the composed problem (it carries the brief's home path). */}
            <span className="truncate text-sm" style={{ color: 'var(--ink-high)' }} title={showText(demoListTitle(r.session.problem))}>{showText(demoListTitle(r.session.problem))}</span>
            <span className="shrink-0 text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>{r.session.status.replace('_', ' ')}</span>
          </button>
        ))}
      </section>
    </div>
  );
}

// ── One demo run ───────────────────────────────────────────────────────────────────────────────

function DemoRun({ runId, projectId, navigate }: { runId: string; projectId: string; navigate: (to: string) => void }): React.ReactElement {
  const [view, setView] = useState<DemoView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [answered, setAnswered] = useState<string | null>(null);
  // studio#521: the run's open gate, read beside the demo view — `GET /runs/:id/gate` is 404 when
  // none is open. A gate the demo's stage does not account for (an escalation on a denied tool call,
  // a deliver gate) is shown, not hidden behind "the team is scoping".
  // The gate and the view are read by the same refresh (codex rounds 1–8): each carries the
  // refresh's sequence, and each lands only in order — an answer older than the one already on screen
  // is dropped (a slow earlier gate read must not resurrect a gate a later read saw answered; an older
  // demo read must not step the view back), while an answer that is merely slow still lands (a daemon
  // slower than the poll interval must still load the page, and a gate endpoint consistently slower
  // than the demo one must still show its gate). What invalidates a gate on screen is the run MOVING
  // ON: a view whose stage changed drops the gate until a gate read at least that fresh lands, so an
  // answered gate never shows as pending beside a view that already moved past it; with the stage
  // unchanged, the gate read on screen is still consistent with the view and stays.
  const [gateRead, setGateRead] = useState<{ seq: number; gate: GateInfo | null }>({ seq: 0, gate: null });
  const refreshSeq = useRef(0);
  const landedGateSeq = useRef(0);
  const landedViewSeq = useRef(0);
  const lastStage = useRef<DemoStage | null>(null);
  // Gate reads started at or before this sequence were started before the run was seen to move on:
  // barred from landing (the first read started afterwards answers).
  const gateBarSeq = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++refreshSeq.current;
    const landGate = (gate: GateInfo | null): void => {
      if (seq < landedGateSeq.current || seq <= gateBarSeq.current) return;
      landedGateSeq.current = seq;
      setGateRead({ seq, gate });
    };
    // Beside the demo read, never awaited by it: a gate answer must not hold the page's `busy`.
    void api.getGate(runId).then((g) => landGate(g), () => landGate(null));
    try {
      const v = await getDemo(runId);
      if (seq < landedViewSeq.current) return; // an older read landing after a newer one: nothing to say
      landedViewSeq.current = seq;
      if (lastStage.current !== null && v.stage !== lastStage.current) {
        // The run moved on: every gate read started so far — later refreshes' reads still in flight
        // included — was started before this was known and may name an answered gate. Drop what is
        // shown and bar all of them from landing; the first read started after this answers.
        gateBarSeq.current = refreshSeq.current;
        landedGateSeq.current = Math.max(landedGateSeq.current, refreshSeq.current);
        setGateRead({ seq: refreshSeq.current, gate: null });
      }
      lastStage.current = v.stage;
      setView(v);
      setLoadError(null);
    } catch (e) {
      if (seq < landedViewSeq.current) return;
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [runId]);

  useEffect(() => {
    setView(null);
    setAnswered(null);
    void refresh();
  }, [refresh]);
  const terminal = view !== null && (view.stage === 'done' || view.stage === 'failed');
  useEffect(() => {
    if (terminal) return;
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh, terminal]);
  // A gate answer is reflected once the run moves: clear the "sent" line when the stage changes.
  const stage = view?.stage;
  useEffect(() => { setAnswered(null); }, [stage]);

  async function act(label: string, fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      const outcome = await fn();
      // A gate decision can end without being sent: undone in its window, or cancelled because the
      // gate moved first. Only a sent one is "sent".
      if (outcome === 'undone') setActionError('Undone');
      else if (outcome === 'cancelled' || outcome === 'dropped') setActionError('Not sent');
      else setAnswered(label);
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (view === null) {
    return (
      <div className="px-6 py-6 text-sm" style={{ color: loadError !== null ? 'var(--status-fail)' : 'var(--ink-muted)' }} data-testid="demo-loading">
        {loadError !== null ? `Could not read demo ${runId}: ${loadError}` : `Reading demo ${runId}…`}
      </div>
    );
  }

  const step = stepOf(view.stage);
  const waitingGate = waitingGateOf(gateRead.gate, view.stage, view.review.rejected);
  return (
    <div data-testid="demo-run" data-stage={view.stage} data-waiting={waitingGate !== null ? 'gate' : undefined} className="mx-auto flex w-full flex-col gap-4 px-6 py-5" style={{ maxWidth: '1180px' }}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <button type="button" className="self-start text-xs" style={{ color: 'var(--ink-muted)' }} onClick={() => navigate(modePath(projectId, 'video'))}>
            ← All demos
          </button>
          <h1 className="truncate text-lg font-semibold" style={{ color: 'var(--ink-high)', margin: 0 }}>
            Demo of {view.url ?? 'the app'}
          </h1>
          {view.audience !== null && (
            <p className="text-sm" style={{ color: 'var(--ink-muted)', margin: 0 }}>For: {view.audience}</p>
          )}
        </div>
        <Stepper step={step} failed={view.stage === 'failed'} />
      </header>
      <p data-testid="demo-stage-line" className="text-sm" style={{ color: 'var(--ink-body)', margin: 0 }}>
        {waitingGate !== null ? WAITING_LINE : view.stage === 'review_gate' && view.review.rejected ? REVIEW_FAILED_LINE : STAGE_LINE[view.stage]}
      </p>
      {answered !== null && (
        <p data-testid="demo-answered" className="text-xs font-mono" style={{ color: 'var(--status-done)', margin: 0 }}>
          {answered} — sent. The run picks it up at its next step.
        </p>
      )}
      {actionError !== null && (
        <p role="alert" data-testid="demo-error" className="text-xs font-mono" style={{ color: 'var(--status-fail)', margin: 0 }}>
          {actionError} — the gate is unchanged.
        </p>
      )}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px', alignItems: 'start' }}>
        <main className="flex min-w-0 flex-col gap-4">
          {waitingGate !== null && (
            <WaitingGate gate={waitingGate} projectId={projectId} runId={view.runId} navigate={navigate} />
          )}
          {view.stage === 'team_gate' && (
            <TeamGate view={view} busy={busy} act={act} projectId={projectId} navigate={navigate} />
          )}
          {view.stage === 'plan_gate' && (
            <PlanGate view={view} busy={busy} act={act} />
          )}
          {view.stage === 'review_gate' && (
            <ReviewGate view={view} busy={busy} act={act} />
          )}
          {view.video !== null && <Watch view={view} />}
          {view.sheets.length > 0 && <Review view={view} />}
          <Plan view={view} open={step === 'plan'} />
        </main>
        <aside className="flex flex-col gap-4">
          <Chapters view={view} busy={busy} act={act} />
          <Governance view={view} />
        </aside>
      </div>
    </div>
  );
}

const STEPS: Array<{ step: DemoStep; label: string }> = [
  { step: 'plan', label: 'Plan' },
  { step: 'record', label: 'Record' },
  { step: 'review', label: 'Review' },
  { step: 'watch', label: 'Watch' },
];

function Stepper({ step, failed }: { step: DemoStep; failed: boolean }): React.ReactElement {
  const at = STEPS.findIndex((s) => s.step === step);
  return (
    <ol data-testid="demo-stepper" data-step={step} className="flex items-center gap-1.5" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {STEPS.map((s, i) => {
        const state = i < at ? 'done' : i === at ? (failed ? 'failed' : 'current') : 'next';
        const bg = state === 'current' ? 'var(--accent)' : state === 'done' ? 'var(--surface-raised)' : 'transparent';
        const ink = state === 'current' ? 'var(--accent-fg)' : state === 'failed' ? 'var(--status-fail)' : state === 'done' ? 'var(--ink-body)' : 'var(--ink-dim)';
        return (
          <li
            key={s.step}
            data-testid="demo-step"
            data-state={state}
            className="rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: bg, color: ink, border: '1px solid var(--surface-raised)' }}
          >
            {i + 1}. {s.label}
          </li>
        );
      })}
    </ol>
  );
}

type Act = (label: string, fn: () => Promise<unknown>) => Promise<void>;

function GateCard({ testId, title, children }: { testId: string; title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section data-testid={testId} className="flex flex-col gap-3 p-4" style={{ ...CARD, borderColor: 'var(--status-gate)' }}>
      <h2 className="text-sm font-semibold" style={{ color: 'var(--status-gate)', margin: 0 }}>{title}</h2>
      {children}
    </section>
  );
}

function SendBack({ busy, act, runId, placeholder }: { busy: boolean; act: Act; runId: string; placeholder: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  if (!open) {
    return (
      <button type="button" data-testid="demo-send-back" className={BTN} style={QUIET} disabled={busy} onClick={() => setOpen(true)}>
        Send back with notes
      </button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2">
      <textarea
        data-testid="demo-send-back-note"
        aria-label="What should change"
        style={{ ...FIELD, minHeight: '64px', resize: 'vertical' }}
        placeholder={placeholder}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="demo-send-back-submit"
          className={BTN}
          style={PRIMARY}
          disabled={busy || note.trim() === ''}
          onClick={() => void act('Sent back with your notes', () => sendBackDemo(runId, note.trim()))}
        >
          Send back
        </button>
        <button type="button" className={BTN} style={QUIET} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

/** studio#521: a gate the demo's stage does not account for — the run is `awaiting_human` on it. The
 *  prompt's head says what; the run's page (the gate in view) is where it is answered. */
function WaitingGate({ gate, projectId, runId, navigate }: { gate: GateInfo; projectId: string; runId: string; navigate: (to: string) => void }): React.ReactElement {
  const showText = useDisplayText();
  const head = gate.prompt.trim().split(/\n/)[0] ?? '';
  return (
    <GateCard testId="demo-waiting-gate" title={`Waiting on you: step ${gate.ord} needs a decision before the demo goes on`}>
      <p data-testid="demo-waiting-gate-prompt" className="text-sm" style={{ color: 'var(--ink-body)', margin: 0, overflowWrap: 'anywhere' }}>
        {showText(head.length > 280 ? `${head.slice(0, 280).trimEnd()}…` : head)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-testid="demo-open-run-gate" className={BTN} style={PRIMARY} onClick={() => navigate(gateOpenPath(projectId, runId))}>
          Open the run →
        </button>
        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>Approve, send back or stop it there; the demo picks up from the answer.</span>
      </div>
    </GateCard>
  );
}

/** The team plan's own approval gate (`plan_approval`), before `plan` runs. Its full plan is on the run page. */
function TeamGate({ view, busy, act, projectId, navigate }: {
  view: DemoView; busy: boolean; act: Act; projectId: string; navigate: (to: string) => void;
}): React.ReactElement {
  return (
    <GateCard testId="demo-team-gate" title="Team plan: approve the steps before planning starts">
      <p className="text-xs" style={{ color: 'var(--ink-muted)', margin: 0 }}>
        The run will plan the demo (you approve the script next), record each chapter, and have a different seat review it.
      </p>
      <div className="flex flex-wrap items-start gap-2">
        <button
          type="button"
          data-testid="demo-approve-team"
          className={BTN}
          style={PRIMARY}
          disabled={busy}
          onClick={() => void act('Team plan approved', () => approveDemoGate(view.runId))}
        >
          Approve and plan
        </button>
        <button type="button" data-testid="demo-open-run" className={BTN} style={QUIET} onClick={() => navigate(gateOpenPath(projectId, view.runId))}>
          Review the plan on the run page
        </button>
      </div>
    </GateCard>
  );
}

function PlanGate({ view, busy, act }: { view: DemoView; busy: boolean; act: Act }): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(view.script ?? '');
  return (
    <GateCard testId="demo-plan-gate" title="Plan gate: approve the script before anything records">
      <p className="text-xs" style={{ color: 'var(--ink-muted)', margin: 0 }}>
        {view.chapters.length} {view.chapters.length === 1 ? 'chapter' : 'chapters'} planned. Approve to start recording,
        edit the presenter script, or send the plan back with what should change.
      </p>
      {editing && (
        <div className="flex flex-col gap-2">
          <textarea
            data-testid="demo-script-editor"
            aria-label="Presenter script"
            style={{ ...FIELD, minHeight: '220px', fontFamily: 'var(--font-mono)', fontSize: '12px', resize: 'vertical' }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="demo-save-script"
              className={BTN}
              style={PRIMARY}
              disabled={busy || draft.trim() === ''}
              onClick={() => void act('Script saved', async () => { await putDemoScript(view.runId, draft); setEditing(false); })}
            >
              Save script
            </button>
            <button type="button" className={BTN} style={QUIET} onClick={() => { setEditing(false); setDraft(view.script ?? ''); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-start gap-2">
        <button
          type="button"
          data-testid="demo-approve-plan"
          className={BTN}
          style={PRIMARY}
          disabled={busy || editing}
          onClick={() => void act('Plan approved', () => approveDemoGate(view.runId))}
        >
          Approve plan and record
        </button>
        {!editing && view.script !== null && (
          <button type="button" data-testid="demo-edit-script" className={BTN} style={QUIET} disabled={busy} onClick={() => { setDraft(view.script ?? ''); setEditing(true); }}>
            Edit script
          </button>
        )}
        <SendBack busy={busy} act={act} runId={view.runId} placeholder="e.g. Open on the dashboard, and drop the settings chapter" />
      </div>
    </GateCard>
  );
}

const VERDICT_LABEL: Record<DemoFinding['verdict'], string> = {
  're-encode': 'Re-encode',
  're-record': 'Re-record one chapter',
  'fix-app': 'Fix the app',
};

function ReviewGate({ view, busy, act }: { view: DemoView; busy: boolean; act: Act }): React.ReactElement {
  const verdict = view.review.verdict;
  const reviewer = view.seats.reviewer ?? 'another seat';
  const n = view.review.findings.length;
  const issues = `${n} ${n === 1 ? 'issue' : 'issues'}`;
  // A review the engine judged NOT PASS cannot be accepted (evaluator ≠ creator: the creator's side
  // never overrules its evaluator). Its gate re-runs the reviewer, or sends the note back to record.
  const failed = view.review.rejected;
  return (
    <GateCard testId="demo-review-gate" title={failed ? 'Review gate: the review failed the recording' : 'Review gate: accept the recording, or act on a verdict'}>
      <p data-testid="demo-review-verdict" data-verdict={verdict ?? 'none'} data-rejected={String(failed)} className="text-xs" style={{ color: 'var(--ink-muted)', margin: 0 }}>
        {failed
          ? `The reviewer (${reviewer}) failed the recording${n > 0 ? ` with ${issues}` : ''}. A failed review cannot be accepted: re-record a chapter from the list, send it back with notes, or have it reviewed again.`
          : verdict === 'accept'
            ? `The reviewer (${reviewer}) accepts the recording.`
            : verdict === 'changes'
              ? `The reviewer (${reviewer}) found ${issues}. Re-record a chapter from the list, or accept it as it is.`
              : 'The reviewer gave no verdict block; read its notes below before you decide.'}
      </p>
      <div className="flex flex-wrap items-start gap-2">
        {failed ? (
          <button
            type="button"
            data-testid="demo-review-again"
            className={BTN}
            style={QUIET}
            disabled={busy}
            onClick={() => void act('Review requested again', () => approveDemoGate(view.runId))}
          >
            Review it again
          </button>
        ) : (
          <button
            type="button"
            data-testid="demo-accept"
            className={BTN}
            style={PRIMARY}
            disabled={busy}
            onClick={() => void act('Recording accepted', () => approveDemoGate(view.runId))}
          >
            Accept the recording
          </button>
        )}
        <SendBack busy={busy} act={act} runId={view.runId} placeholder="e.g. Re-encode with a longer hold on the closing card" />
      </div>
    </GateCard>
  );
}

function Plan({ view, open }: { view: DemoView; open: boolean }): React.ReactElement {
  return (
    <details data-testid="demo-plan" open={open} className="p-4" style={CARD}>
      <summary className="cursor-pointer text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>Presenter script</summary>
      {view.script === null ? (
        <p className="mt-2 text-sm" style={{ color: 'var(--ink-muted)' }}>The planner has not written the script yet.</p>
      ) : (
        <div data-testid="demo-script" className="mt-3 text-sm" style={{ color: 'var(--ink-body)' }}>
          <Markdown>{view.script}</Markdown>
        </div>
      )}
    </details>
  );
}

function Review({ view }: { view: DemoView }): React.ReactElement {
  return (
    <section data-testid="demo-review" className="flex flex-col gap-3 p-4" style={CARD}>
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)', margin: 0 }}>Contact sheets</h2>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        {view.sheets.map((s) => (
          <a key={s.name} href={demoFileUrl(view.runId, s.path)} target="_blank" rel="noreferrer" data-testid="demo-sheet" data-name={s.name} className="flex flex-col gap-1">
            <img src={demoFileUrl(view.runId, s.path)} alt={`Contact sheet: ${s.name}`} className="w-full rounded" style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-base)' }} />
            <span className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>{s.name}</span>
          </a>
        ))}
      </div>
      {view.review.findings.length > 0 && (
        <table data-testid="demo-findings" className="w-full text-xs" style={{ borderCollapse: 'collapse', color: 'var(--ink-body)' }}>
          <thead>
            <tr style={{ color: 'var(--ink-dim)', textAlign: 'left' }}>
              <th className="py-1 pr-3 font-mono font-normal">At</th>
              <th className="py-1 pr-3 font-mono font-normal">Chapter</th>
              <th className="py-1 pr-3 font-mono font-normal">What is wrong</th>
              <th className="py-1 font-mono font-normal">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {view.review.findings.map((f, i) => (
              <tr key={`${f.at}-${i}`} data-testid="demo-finding" data-verdict={f.verdict} style={{ borderTop: '1px solid var(--surface-raised)' }}>
                <td className="py-1.5 pr-3 font-mono">{f.at}</td>
                <td className="py-1.5 pr-3 font-mono">{f.chapter}</td>
                <td className="py-1.5 pr-3">{f.issue}</td>
                <td className="py-1.5">{VERDICT_LABEL[f.verdict]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {view.review.text !== null && view.review.findings.length === 0 && view.review.verdict !== 'accept' && (
        <details>
          <summary className="cursor-pointer text-xs" style={{ color: 'var(--ink-muted)' }}>The reviewer’s notes</summary>
          <pre className="mt-2 whitespace-pre-wrap text-xs" style={{ color: 'var(--ink-body)' }}>{view.review.text}</pre>
        </details>
      )}
    </section>
  );
}

function Watch({ view }: { view: DemoView }): React.ReactElement {
  const video = useRef<HTMLVideoElement>(null);
  const [drafting, setDrafting] = useState(false);
  const src = view.video === null ? '' : demoFileUrl(view.runId, view.video.path);
  return (
    <section data-testid="demo-watch" className="flex flex-col gap-3 p-4" style={CARD}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)', margin: 0 }}>
          {view.stage === 'done' ? 'Watch the demo' : 'The recording under review'}
        </h2>
        <div className="flex gap-2">
          <a href={src} download className={BTN} style={QUIET} data-testid="demo-download">Download MP4</a>
          {view.stage === 'done' && (
            <button type="button" data-testid="demo-draft-update" className={BTN} style={QUIET} onClick={() => setDrafting(true)}>
              Draft update
            </button>
          )}
        </div>
      </div>
      <video ref={video} data-testid="demo-video" src={src} controls preload="metadata" className="w-full rounded" style={{ background: 'var(--surface-base)', maxHeight: '420px' }} />
      {view.markers.length > 0 && (
        <ol data-testid="demo-markers" className="flex flex-wrap gap-1.5" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {view.markers.map((m) => (
            <li key={`${m.sec}-${m.title}`}>
              <button
                type="button"
                data-testid="demo-marker"
                data-sec={String(m.sec)}
                className="rounded-full px-2.5 py-1 text-xs"
                style={QUIET}
                onClick={() => {
                  if (video.current !== null) {
                    video.current.currentTime = m.sec;
                    void video.current.play().catch(() => undefined);
                  }
                }}
              >
                <span className="font-mono" style={{ color: 'var(--ink-dim)' }}>{m.at}</span> {m.title}
              </button>
            </li>
          ))}
        </ol>
      )}
      {drafting && (
        <Modal title={OUTBOUND_TITLE.status} onClose={() => setDrafting(false)}>
          <OutboundDraft kind="status" runId={view.runId} />
        </Modal>
      )}
    </section>
  );
}

function chapterState(view: DemoView, c: DemoChapter, i: number): 'recorded' | 'recording' | 'waiting' {
  if (c.recorded) return 'recorded';
  if (view.stage !== 'recording') return 'waiting';
  const first = view.chapters.findIndex((x) => !x.recorded);
  return first === i ? 'recording' : 'waiting';
}

function Chapters({ view, busy, act }: { view: DemoView; busy: boolean; act: Act }): React.ReactElement {
  const recorded = view.chapters.filter((c) => c.recorded).length;
  const gate = view.stage === 'review_gate';
  return (
    <section data-testid="demo-chapters" className="flex flex-col gap-2 p-4" style={CARD}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)', margin: 0 }}>Chapters</h2>
        {view.chapters.length > 0 && (
          <span data-testid="demo-record-progress" className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
            {recorded}/{view.chapters.length} recorded
          </span>
        )}
      </div>
      {view.chapters.length === 0 && (
        <p className="text-xs" style={{ color: 'var(--ink-muted)', margin: 0 }}>The chapter list appears when the plan is written.</p>
      )}
      <ol className="flex flex-col gap-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {view.chapters.map((c, i) => {
          const st = chapterState(view, c, i);
          const finding = view.review.findings.find((f) => f.chapter === c.key && f.verdict === 're-record');
          return (
            <li key={c.key} data-testid="demo-chapter" data-key={c.key} data-state={st} className="flex flex-col gap-1 rounded-md p-2" style={{ border: '1px solid var(--surface-raised)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold" style={{ color: 'var(--ink-high)' }}>
                  <span className="font-mono" style={{ color: 'var(--ink-dim)' }}>{String(i + 1).padStart(2, '0')}</span> {c.title}
                </span>
                <span
                  className="shrink-0 text-[10px] font-mono"
                  style={{ color: st === 'recorded' ? 'var(--status-done)' : st === 'recording' ? 'var(--status-gate)' : 'var(--ink-dim)' }}
                >
                  {st === 'recorded' ? 'recorded' : st === 'recording' ? 'recording…' : 'waiting'}
                </span>
              </div>
              {c.blurb !== '' && <p className="text-[11px]" style={{ color: 'var(--ink-muted)', margin: 0 }}>{c.blurb}</p>}
              {finding !== undefined && (
                <p className="text-[11px]" style={{ color: 'var(--status-gate)', margin: 0 }}>Review: {finding.issue}</p>
              )}
              {gate && (
                <button
                  type="button"
                  data-testid="demo-rerecord"
                  data-key={c.key}
                  className="self-start rounded px-2 py-0.5 text-[11px] disabled:opacity-40"
                  style={QUIET}
                  disabled={busy}
                  onClick={() => void act(`Re-record of ${c.key} requested`, () => sendBackDemo(view.runId, rerecordNote(c, finding)))}
                >
                  Re-record this chapter
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Governance({ view }: { view: DemoView }): React.ReactElement {
  const { recorder, reviewer } = view.seats;
  const apart = recorder !== null && reviewer !== null ? recorder !== reviewer : null;
  const ro = view.recording.readOnly;
  const row = (testId: string, ok: boolean | null, text: string): React.ReactElement => (
    <li data-testid={testId} data-ok={ok === null ? 'pending' : String(ok)} className="flex items-start gap-2 text-xs" style={{ color: 'var(--ink-body)' }}>
      <span aria-hidden className="font-mono" style={{ color: ok === null ? 'var(--ink-dim)' : ok ? 'var(--status-done)' : 'var(--status-fail)' }}>
        {ok === null ? '○' : ok ? '✓' : '✕'}
      </span>
      <span>{text}</span>
    </li>
  );
  return (
    <section data-testid="demo-governance" className="flex flex-col gap-2 p-4" style={CARD}>
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)', margin: 0 }}>Governance</h2>
      <ul className="flex flex-col gap-1.5" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {row(
          'demo-gov-seats',
          apart,
          apart === null
            ? 'Evaluator ≠ creator: the reviewer is seated after the recording.'
            : apart
              ? `Evaluator ≠ creator: recorded by ${recorder}, reviewed by ${reviewer}.`
              : `The same seat (${recorder}) recorded and reviewed.`,
        )}
        {row(
          'demo-gov-readonly',
          ro,
          ro === null ? 'Read-only recording: shown once the video is stitched.' : ro ? 'Recorded read-only: the recorder sent no writes to the app.' : 'Not recorded read-only: writes were allowed for a disposable target.',
        )}
        {row(
          'demo-gov-synthetic',
          view.script === null ? null : view.syntheticLabelled,
          view.script === null ? 'Synthetic data: checked when the script is written.' : view.syntheticLabelled ? 'The script labels its synthetic data.' : 'The script does not say which data is synthetic.',
        )}
      </ul>
    </section>
  );
}
