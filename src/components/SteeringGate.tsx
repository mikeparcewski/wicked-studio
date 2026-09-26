import { commitGateDecision } from '../board/gateActions.js';
import { keepEntryState } from '../hooks/useHistoryState.js';
import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { api, type GateDecision, type RunDiff } from '../api/client.js';
import type { CoreEvent, CoverageReport, WorkUnit, WorkflowDef } from '../api/types.js';
import { useGlobalShortcuts, type ShortcutEntry } from '../hooks/useGlobalShortcuts.js';
import { useSteerPrefixes } from '../hooks/useSteerPrefixes.js';
import { useAnnotationStore } from '../store/annotations.js';
import { useRunEventStore } from '../store/events.js';
import { durableGuidance, useGuidanceStore } from '../store/guidance.js';
import { useGateStore } from '../store/gates.js';
import { useSteeringStore, type SteeringAction } from '../store/steering.js';
import { DeliverLift } from './DeliverLift.js';
import { deliverLift, textCarriesFailure } from './deliverLiftModel.js';
import { GATE_HASH } from './GateChip.js';
import { GateVerdict } from './GateVerdict.js';
import { failedSeatOf, gateVerdictFor, isEscalationGate, isFailureEscalation, isSeatFailure, isRestoredRetry, phaseLabel } from './gateVerdictModel.js';
import { IntakePlan, isIntakeGate } from './IntakePlan.js';
import { ReassignControl } from './ReassignControl.js';

interface Props {
  runId: string;
  ord?: number;
  prompt?: string;
  /** The run DTO's durable guidance note (CREW-UX-7, crew#312 — slice BE):
   *  pre-populates the steer textarea FIRST; the session draft layers on top. */
  guidance?: string | undefined;
  /** When present, fetches coverage stats for inline display at the gate card. */
  repoRef?: string;
  /** The run's units (snapshot) — names the phase the evaluator verdict on the card is about
   *  (wicked-studio#250, F-3R2-006). Absent ⇒ the verdict says `unit N`. */
  units?: readonly WorkUnit[];
  /** The run's seat pool (`session.clis`) — the seats a failure-escalation gate may reassign the
   *  unit to (F-7R2-007). Absent ⇒ the card offers no reassign. */
  clis?: readonly string[];
  /** The workflow def the run was planned from, when the host knows it (`GET /workflows`) — the
   *  intake plan (F-7R2-008) reads executor / skill / role vocabulary off it. */
  workflow?: WorkflowDef | null;
  /** The run's deliver posture (`session.auto_deliver`, F-E2E-030) for the intake plan's deliver
   *  row; `null`/absent = the engine predates the deliver gate. */
  autoDeliver?: boolean | null;
  onResolved?: () => void;
}

const EMPTY_EVENTS: CoreEvent[] = [];
const EMPTY_UNITS: WorkUnit[] = [];

/** Strip the bracketed architectural footnote from a workflow gate prompt. */
function cleanPrompt(raw: string): { headline: string; footnote: string | null } {
  const bracketIdx = raw.indexOf('[');
  if (bracketIdx === -1) return { headline: raw.trim(), footnote: null };
  const closeIdx = raw.lastIndexOf(']');
  return {
    headline: raw.slice(0, bracketIdx).trim(),
    footnote: raw.slice(bracketIdx, closeIdx !== -1 ? closeIdx + 1 : undefined).trim(),
  };
}

/** Parse a unified diff into file/addition/deletion counts for a diffstat line. */
function parseDiffstat(diff: string): { files: number; additions: number; deletions: number } {
  let files = 0, additions = 0, deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) files++;
    else if (line.startsWith('+') && !line.startsWith('+++ ')) additions++;
    else if (line.startsWith('-') && !line.startsWith('--- ')) deletions++;
  }
  return { files, additions, deletions };
}

/** Format a diffstat into a compact summary string. */
function diffstatLabel(diff: string): string {
  const { files, additions, deletions } = parseDiffstat(diff);
  if (files === 0) return 'no changes';
  const parts = [`${files} file${files !== 1 ? 's' : ''} changed`];
  if (additions > 0) parts.push(`+${additions}`);
  if (deletions > 0) parts.push(`−${deletions}`);
  return parts.join(', ');
}

/** Format a coverage report into a compact summary for gate-card display. */
function coverageLabel(r: CoverageReport): string {
  const pct = r.behavior_bearing === 0 ? '—' : `${(r.coverage * 100).toFixed(1)}%`;
  const resolvedPct = r.behavior_bearing === 0 ? '' : ` · resolved ${(r.resolved_rate * 100).toFixed(0)}%`;
  return `Coverage: ${pct} · ${r.behavior_bearing.toLocaleString()} nodes · ${r.unaccounted} unaccounted${resolvedPct}`;
}

export function SteeringGate({ runId, ord, prompt, guidance, repoRef, units, clis, workflow, onResolved, autoDeliver }: Props): React.ReactElement {
  const clearGate = useGateStore((s) => s.clearGate);
  const recordSteering = useSteeringStore((s) => s.record);
  // F-7R2-008: the intake gate — the engine's pre-run gate on the run's FIRST unit — renders the
  // planned phases + seats above the prompt, so "approve" is an informed act over the plan.
  const intake = isIntakeGate(prompt, ord, units ?? EMPTY_UNITS);
  // The evaluator's record for THIS gate (wicked-studio#250, F-3R2-006): a pure view over the
  // run's event log — already hydrated by the run page and fed live by /ws — so the card states
  // what the operator is approving (the fix phase's verdict, criterion, the checks that ran) or
  // rejecting (which layer denied, the engine's remedy) instead of the bare prompt. Zero fetches;
  // an un-hydrated or evaluation-less log renders no block, never a verdict made up from the prompt.
  // BOUNDED on the gate's ord, always: with no numeric ord in hand there is nothing to bound the
  // lookup with, so no block — never an unbounded historical evaluation dressed as this gate's
  // (Copilot on #252). Every caller has one: the gate record's, or ApprovalDock's derivation from
  // the run's own cursor when the daemon-restart fallback lost the prompt.
  const events = useRunEventStore((s) => s.byRun[runId]) ?? EMPTY_EVENTS;
  // F-7R2-018: an ESCALATION gate about unit N shows only unit N's own evaluation — never the
  // previous phase's pass under a card about the unit that failed (`gateVerdictFor`).
  const verdict = useMemo(() => gateVerdictFor(events, ord, prompt), [events, ord, prompt]);
  // F-7R2-007: a failure-escalation gate offers to move the unit to another seat — plain Approve
  // re-dispatches the seat that just failed. Not on a deliver-lift escalation (a LIFT-CONFLICT or
  // a refused lift is the engine's story, told by the lift block below — another seat cannot fix
  // a rebase conflict), which is why the control is also gated on `lift === null` at the render.
  const escalation = isFailureEscalation(prompt, verdict);
  // All engine escalation gates that render the four-verb layout (#299 AC1): triage-escalated,
  // floor_failed (repo_checks), and verdict_not_pass (evaluator_verdict). Keyed on
  // `isEscalationGate`; `escalation` (isFailureEscalation) is kept ONLY for the seat-reassign
  // lever (F-7R2-007 / F-E2E-014) — that predicate must not widen.
  const escalationGate = isEscalationGate(prompt, verdict);
  // Tri-state (#274): a seat, `null` = the unit provably had none, `undefined` = this host cannot
  // tell (no `units` — the steering-author / testing-launch panels) and must not read it as seatless.
  const failedCli = failedSeatOf(units, ord);
  // A host without the run view (the steering-author and testing-launch panels hold only the run
  // id + the gate) reads the run ONCE for its seat pool when — and only when — the gate is a failure
  // escalation the lever applies to. Zero reads on every other gate; a failed read offers no lever.
  const [fetchedClis, setFetchedClis] = useState<readonly string[] | null>(null);
  const wantsPool = escalation && clis === undefined;
  useEffect(() => {
    if (!wantsPool) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => api.getRun(runId))
      .then(({ run }) => { if (!cancelled) setFetchedClis(Array.isArray(run.session.clis) ? run.session.clis : []); })
      .catch(() => { /* no pool known — the card keeps Approve / Reject / Cancel, nothing invented */ });
    return () => { cancelled = true; };
  }, [wantsPool, runId]);
  const pool = clis ?? fetchedClis;
  // The deliver lift's story for THIS ord (wicked-core#431 / F-3R2-013): a gate opened on a deliver
  // unit the engine refused (LIFT-CONFLICT, a failed re-verify, a HEAD off the run branch) renders
  // what the lift did and the engine's remedy on the card. A pre-run deliver gate has no deliver-ord
  // frames yet and renders nothing; so does every non-deliver gate.
  const lift = useMemo(() => (typeof ord === 'number' ? deliverLift(events, ord) : null), [events, ord]);
  // wicked-core#431 (F-3R2-010): when the deciding denial is THIS unit's WORKTREE-GUARD denial and the
  // engine restored the creator's tree, Approve no longer means "adopt the evaluator's edit and retry"
  // — it means a retry against the restored, verified tree, and the button says so. The engine's
  // `awaitingHuman.prompt` changed with it ("… its edit was discarded and the creator's verified tree
  // restored. Approve to retry the phase against the restored tree …"); the relabel keys on the
  // EVIDENCE frames, not on that prose, so a daemon that sends the frames with any prompt relabels and
  // one that predates them never does. ONE predicate for every gate card — the landing inbox's card
  // uses the same `isRestoredRetry` — mirroring the engine's own guard (`denial.source ==
  // "worktree_guard" && mutation.restored`), so no surface relabels where the engine kept the legacy prompt.
  const restoredRetry = isRestoredRetry(verdict, ord);
  // The engine's triage-escalate prompt already QUOTES the deliver refusal (`Unit N failed and triage
  // escalated: … Failure output: "<excerpt>". Approve to retry …`), so the lift block omits its copy
  // when the prompt carries it — the refusal reads ONCE on the card (F-255-02). A prompt that does
  // not (the daemon-restart fallback, an older engine's wording) leaves the block to say it.
  const liftOmitsFailure = lift !== null && lift.failure !== null && textCarriesFailure(prompt, lift.failure);
  // Slice BD (DES-UX-002 §4.3, EC51): gate arrival pre-populates the steer
  // textarea — the gate card MOUNTING is the arrival on this surface. Slice BE
  // added the durable layer (CREW-UX-7): pre-population order is the run DTO's
  // `guidance` note FIRST, the session-scoped draft ON TOP (the newer local
  // edit wins). Neither ⇒ blank, as today. The lazy initializer reads once;
  // `prepopulated` is a mount-stable fact.
  const [amend, setAmend] = useState(
    () =>
      useAnnotationStore.getState().drafts[runId]
      ?? durableGuidance(runId, guidance, useGuidanceStore.getState().saved)
      ?? '',
  );
  const [prepopulated] = useState(amend !== '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  const [runDiff, setRunDiff] = useState<RunDiff | null>(null);
  const message = useRef<HTMLParagraphElement>(null);
  const root = useRef<HTMLDivElement>(null);
  /** Synchronous double-fire guard for the keyboard path — `loading` is a
   *  render-cycle behind a fast second keydown. */
  const inflight = useRef(false);
  const steerRef = useRef<HTMLTextAreaElement>(null);

  // One writer for the steer text (slice BD): local state for the render, the
  // session draft store for continuity — an edit here IS the newest draft.
  const applyAmend = useCallback(
    (text: string) => {
      setAmend(text);
      useAnnotationStore.getState().setDraft(runId, text);
    },
    [runId],
  );
  // Alt+1/2/3 insert Focus:/Skip:/Context: at the cursor (§4.3, bindings per
  // the operator steer — see useSteerPrefixes; the insert arrives through the
  // textarea's own onChange → applyAmend).
  useSteerPrefixes(`gate-${runId}`, steerRef);

  // Arrived from a board gate chip (§1.4 complex gate): put the MESSAGE in view and
  // give it focus, so a keyboard lands on the question rather than wherever the
  // thread happened to leave it. One-shot — the hash is consumed on arrival, or the
  // next render (this thread re-renders on every frame) would yank focus back.
  useEffect(() => {
    if (window.location.hash !== GATE_HASH) return;
    const el = message.current;
    if (el === null) return;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
    // Keep the entry's own state (wave 1's in-app mark, any history-state view keys): only
    // the one-shot hash goes, so a later Back still lands on the page before this one.
    window.history.replaceState(keepEntryState(), '', `${window.location.pathname}${window.location.search}`);
  }, [runId]);

  useEffect(() => {
    if (!repoRef) return;
    // Fetch coverage stats for this repo — the evaluator unit writes these to
    // the estate store, so they reflect the numbers the gate was checking.
    api.getCoverageReportForRepo(repoRef).then(({ report }) => {
      if (report) setCoverage(report);
    }).catch(() => { /* best-effort: no stats is fine */ });
  }, [repoRef]);

  // Deliver gate diffstat (#300): when the gate is on the deliver unit (lift !== null), fetch the
  // run's merge-base diff so the operator sees what approve will push before committing.
  const hasLift = lift !== null;
  useEffect(() => {
    if (!hasLift) return;
    let cancelled = false;
    api.getRunDiff(runId, undefined, 'merge-base')
      .then((d) => { if (!cancelled) setRunDiff(d); })
      .catch(() => { /* diff unavailable — the card still renders without it */ });
    return () => { cancelled = true; };
  }, [runId, hasLift]);

  async function run(
    action: () => Promise<unknown>,
    intervention: { kind: SteeringAction; amend?: string },
  ): Promise<void> {
    if (inflight.current) return;
    inflight.current = true;
    setLoading(true);
    setError(null);
    try {
      // A gate decision rides the shared undo window (wave 2a): only a decision
      // that actually went out records steering, clears the draft, and resolves.
      const outcome = await action();
      if (outcome === 'undone' || outcome === 'dropped') return;
      recordSteering({
        runId,
        action: intervention.kind,
        ...(typeof ord === 'number' ? { ord } : {}),
        ...(intervention.amend !== undefined ? { amend: intervention.amend } : {}),
      });
      // The decision consumed the draft (slice BD): whatever guidance was
      // composed pre-gate has ridden (or been declined) — a stale copy must
      // not pre-fill the run's NEXT gate.
      useAnnotationStore.getState().clearDraft(runId);
      clearGate(runId);
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }

  const approve = (): Promise<void> =>
    run(() => commitGateDecision(runId, { approve: true }), { kind: 'approve' });

  // Escalation Retry: re-dispatches the failed unit. Optionally carries the amend note — the
  // deliver-unit prompt says "Approve to retry (optionally amend)" and other escalation shapes
  // also accept amend on a plain approve; the daemon records it durably in the gate audit trail.
  // Distinct from `approve()` so the non-escalation Approve path is not changed.
  const retry = (): Promise<void> => {
    const text = amend.trim();
    const decision: GateDecision = text === '' ? { approve: true } : { approve: true, amend: text };
    return run(() => commitGateDecision(runId, decision), { kind: 'approve', ...(text !== '' ? { amend: text } : {}) });
  };

  const approveWithSteer = (): Promise<void> => {
    const text = amend.trim();
    if (!text) return Promise.resolve();
    const decision: GateDecision = { approve: true, amend: text };
    return run(() => commitGateDecision(runId, decision), { kind: 'approve-with-steer', amend: text });
  };

  // The steer text rides REJECT too (DES-RUN-NARRATOR §7 — the reject-note gap):
  // `{approve:false, amend}` is the same wire GateRejectNote already speaks, and
  // the daemon's gate audit durably records the note on the decision. An empty
  // textarea still sends the bare reject.
  const reject = (): Promise<void> => {
    const text = amend.trim();
    const decision: GateDecision = text === '' ? { approve: false } : { approve: false, amend: text };
    return run(() => commitGateDecision(runId, decision), {
      kind: 'reject',
      ...(text !== '' ? { amend: text } : {}),
    });
  };

  const cancel = (): Promise<void> =>
    run(() => api.cancelRun(runId), { kind: 'cancel' });

  // Escalation gate only (#299): rewind to the most recent creator phase and re-dispatch it with
  // the operator's note as amended guidance. `action: 'request_changes'` (api-types 0.38.0) is
  // accepted by crew >= 0.7.36; an older daemon 400s — no capability flag guards it, so the button
  // appears only on escalation cards (where the daemon version that opened the gate is >= 0.7.36).
  const requestChanges = (): Promise<void> => {
    const text = amend.trim();
    if (!text) return Promise.resolve();
    const decision: GateDecision = { approve: false, action: 'request_changes', amend: text };
    return run(() => commitGateDecision(runId, decision), { kind: 'request-changes', amend: text });
  };

  // DES-UX-001 §7.7 (slice AC): the gate panel honors a / r — the same
  // POST /runs/:id/gate its buttons fire, through the ONE slice-G registry
  // (the shared typing guard keeps the steer textarea's letters as letters).
  // Guarded on the panel HOLDING focus: a is approve exactly where approve
  // matters most, and nowhere else on the page.
  const actions = useRef({ approve, reject });
  // On escalation gates the 'a' key fires Retry (optionally carries amend), not the plain approve.
  actions.current = { approve: escalationGate ? retry : approve, reject };
  const keyEntries = useMemo<ShortcutEntry[]>(() => {
    const focused = (): boolean =>
      !inflight.current &&
      root.current !== null &&
      root.current.contains(document.activeElement);
    return [
      {
        id: 'gate-panel-approve',
        chord: { key: 'a' },
        group: 'gates',
        description: 'Approve the focused gate',
        guard: focused,
        handler: (e) => {
          e.preventDefault();
          void actions.current.approve();
        },
      },
      {
        id: 'gate-panel-reject',
        chord: { key: 'r' },
        group: 'gates',
        description: 'Reject the focused gate',
        guard: focused,
        handler: (e) => {
          e.preventDefault();
          void actions.current.reject();
        },
      },
    ];
  }, []);
  useGlobalShortcuts(keyEntries);

  // An escalation prompt's cause lives after `(Failed): […]` — skip footnote extraction so the
  // full cause appears in the headline (F-E2E-014). Non-escalation prompts carry a genuine
  // architectural footnote that belongs collapsed.
  const rawPrompt = prompt ?? 'Prompt unavailable (daemon restarted) — you can still approve or reject.';
  const { headline, footnote } = escalationGate ? { headline: rawPrompt.trim(), footnote: null } : cleanPrompt(rawPrompt);

  // Both mutation-gate prompts the engine has shipped — the pre-0.33.0 retry-or-reject wording and
  // wicked-core#431's "… Approve to retry the phase against the restored tree …" — carry
  // "NOT PASS", so this match holds across the wording change (re-checked for api-types 0.33.0).
  const isCoverageFail = headline.toLowerCase().includes('not pass') || headline.toLowerCase().includes('coverage');

  return (
    <div
      ref={root}
      // Programmatically/click focusable, not a tab stop: clicking anywhere on
      // the card arms the a/r keys (§7.7) without adding a tab-order entry.
      tabIndex={-1}
      className="rounded-xl p-4"
      style={{
        background: 'var(--surface-rail)',
        border: '1px solid var(--status-gate-dim)',
        boxShadow: '0 0 0 1px var(--status-gate-dim)',
        outline: 'none',
      }}
      data-testid="steering-gate"
      data-run-id={runId}
      {...(restoredRetry ? { 'data-retry-restored': 'true' } : {})}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--status-gate)' }} />
        <p className="font-semibold text-sm font-mono" style={{ color: 'var(--status-gate)' }}>
          Awaiting human decision
        </p>
      </div>
      <p className="text-xs font-mono mb-3" style={{ color: 'var(--ink-dim)' }}>
        run {runId.slice(0, 8)}
        {typeof ord === 'number' ? ` · before unit #${ord}` : ''}
      </p>

      {/* Headline prompt — the actionable part only */}
      <p
        ref={message}
        // Focusable only programmatically: the deep-link target, never a tab stop.
        tabIndex={-1}
        className="text-xs mb-1 leading-relaxed font-mono"
        style={{ color: 'var(--ink-body)', outline: 'none', overflowWrap: 'anywhere' }}
        data-testid="steering-prompt"
      >
        {headline}
      </p>

      {/* The intake gate's PLAN (F-7R2-008): on the pre-run gate for the run's FIRST unit, every
          planned phase with its executor, skill and seat — what "approve" launches — instead of the
          brief echoed back. Read off the run's units snapshot (+ the def when the host knows it). */}
      {intake && (
        <IntakePlan runId={runId} units={units ?? EMPTY_UNITS} clis={pool ?? undefined} workflow={workflow ?? null} autoDeliver={autoDeliver ?? null} />
      )}

      {/* The evaluator verdict this gate is about (F-3R2-006): pass/deny, criterion, the judge's
          reasoning, the repo-checks floor per check, and on a denial the layer + the engine's
          remedy verbatim. Rendered BETWEEN the question and the answer controls, so the decision
          is informed on the card itself — not in an expandable thread line. */}
      {verdict !== null && (
        <GateVerdict view={verdict} phase={phaseLabel(runId, units ?? EMPTY_UNITS, verdict.ord)} />
      )}

      {/* The deliver lift + the engine's refusal for a gate on the deliver unit (wicked-core#431). */}
      {lift !== null && <DeliverLift view={lift} omitFailure={liftOmitsFailure} />}

      {/* Deliver gate diffstat (#300): the diff of what this approve will push (GET /runs/:id/diff?base=merge-base). */}
      {lift !== null && runDiff !== null && (
        <details className="mb-2">
          <summary
            className="text-xs font-mono cursor-pointer select-none"
            style={{ color: 'var(--ink-dim)' }}
            data-testid="deliver-gate-diffstat"
          >
            {diffstatLabel(runDiff.diff)}
            {runDiff.truncated ? ' (diff truncated at 1 MB)' : ''}
          </summary>
          <pre
            data-testid="deliver-gate-full-diff"
            className="text-[10px] font-mono overflow-auto max-h-64 mt-1 p-2 rounded"
            style={{ background: 'var(--surface-base)', color: 'var(--ink-body)', whiteSpace: 'pre' }}
          >
            {runDiff.diff || '(empty diff)'}
          </pre>
        </details>
      )}

      {/* Coverage stats — shown when evaluator gate fails and we have repo coverage data */}
      {isCoverageFail && coverage && (
        <p className="text-xs mb-2 font-mono" style={{ color: 'var(--ink-body)' }}>
          {coverageLabel(coverage)}
        </p>
      )}

      {/* Footnote disclosure — architectural explanation, collapsed by default */}
      {footnote && (
        <details className="mb-3">
          <summary
            className="text-[10px] font-mono cursor-pointer select-none"
            style={{ color: 'var(--ink-dim)' }}
          >
            why this gate fired
          </summary>
          <p className="text-[10px] font-mono mt-1 leading-relaxed" style={{ color: 'var(--ink-dim)' }}>
            {footnote}
          </p>
        </details>
      )}

      {/* Steer textarea — guide the re-run. Slice BD: pre-populated from the
          session draft when one existed at mount (`amend-prepopulated`, §4.5),
          auto-expanded to fit it (the "expands automatically" contract of
          §4.3 — no click needed to see the whole draft), and armed with the
          Alt+1/2/3 steer prefixes (useSteerPrefixes — bindings deviate from
          the doc per the operator steer recorded there). Edits sync BACK to
          the draft store so a remount before the decision keeps the newest
          text; the decision clears it (see run()). */}
      <textarea
        ref={steerRef}
        data-testid={prepopulated ? 'amend-prepopulated' : 'steering-amend'}
        data-run-id={runId}
        className="w-full rounded-lg p-2 text-xs mb-3 resize-none font-mono"
        style={{
          background: 'var(--surface-rail)',
          border: '1px solid var(--surface-raised)',
          color: 'var(--ink-high)',
          outline: 'none',
        }}
        rows={Math.min(8, Math.max(2, amend.split('\n').length))}
        placeholder={
          isCoverageFail && coverage && coverage.unaccounted > 0
            ? `${coverage.unaccounted} nodes unaccounted — add guidance for the evaluator, e.g. "focus on services/ directory"`
            : 'Optional note — rides "Approve + steer" as guidance, or "Reject" as the recorded reason'
        }
        value={amend}
        onChange={(e) => applyAmend(e.target.value)}
        disabled={loading}
      />

      {error && (
        <p className="text-xs mb-3 font-mono" style={{ color: 'var(--status-fail)' }} data-testid="steering-error">
          {error}
        </p>
      )}

      {/* F-7R2-007: on a SEAT failure escalation, the seat lever — approve the retry, then move
          the unit to a seat that is not the one that just failed (crew's reassign route). A
          seatless / tool-only escalation (failedCli === null) suppresses this lever entirely
          (F-E2E-014): signing a seat in cannot fix a failure no seat was involved in. The steer
          text rides the approve here too. */}
      {isSeatFailure(escalation, failedCli) && pool !== null && lift === null && (
        <ReassignControl
          runId={runId}
          ord={ord}
          pool={pool}
          failedCli={failedCli ?? null}
          amend={amend}
          onDone={() => {
            useAnnotationStore.getState().clearDraft(runId);
            clearGate(runId);
            onResolved?.();
          }}
        />
      )}

      {escalationGate && lift === null ? (
        /* Non-deliver escalation (#299): Retry / Request changes / Reject / Cancel run.
         * "Request changes" rewinds to the last creator phase — semantically correct when a
         * build/recon/verify unit failed. Deliver-unit escalations (lift !== null) suppress it
         * because rewinding the creator cannot fix a git-push or rebase-conflict failure. */
        <div className="grid grid-cols-2 gap-2">
          <button
            data-testid="steering-retry"
            onClick={() => void retry()}
            disabled={loading}
            className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
            style={{ background: 'var(--status-run)', color: 'var(--surface-base)' }}
            title="Re-dispatches the failed unit (carries your note as guidance if typed)"
          >
            Retry
          </button>
          <button
            data-testid="steering-request-changes"
            onClick={() => void requestChanges()}
            disabled={loading || !amend.trim()}
            className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            title="Rewinds to the last creator phase and re-dispatches with your note (note required)"
          >
            Request changes
          </button>
          <button
            data-testid="steering-reject"
            onClick={() => void reject()}
            disabled={loading}
            className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
            style={{ background: 'var(--status-fail-dim)', border: '1px solid var(--status-fail-dim)', color: 'var(--status-fail)' }}
          >
            Reject
          </button>
          <button
            data-testid="steering-cancel"
            onClick={() => void cancel()}
            disabled={loading}
            className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--ink-dim)', color: 'var(--ink-muted)' }}
          >
            Cancel run
          </button>
        </div>
      ) : escalationGate && lift !== null ? (
        /* Deliver-unit escalation (#299): Retry (optionally amend) / Reject / Cancel run.
         * No "Request changes" — rewinding to the creator cannot fix a git-push or rebase-conflict
         * failure; the daemon prompt says "Approve to retry (optionally amend), reject to fail the
         * run". Retry spans the full row so the note is visually paired with the primary action. */
        <div className="grid grid-cols-2 gap-2">
          <button
            data-testid="steering-retry"
            onClick={() => void retry()}
            disabled={loading}
            className="col-span-2 rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
            style={{ background: 'var(--status-run)', color: 'var(--surface-base)' }}
            title="Re-dispatches the deliver unit (carries your note as guidance if typed)"
          >
            Retry
          </button>
          <button
            data-testid="steering-reject"
            onClick={() => void reject()}
            disabled={loading}
            className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
            style={{ background: 'var(--status-fail-dim)', border: '1px solid var(--status-fail-dim)', color: 'var(--status-fail)' }}
          >
            Reject
          </button>
          <button
            data-testid="steering-cancel"
            onClick={() => void cancel()}
            disabled={loading}
            className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--ink-dim)', color: 'var(--ink-muted)' }}
          >
            Cancel run
          </button>
        </div>
      ) : (
        /* Standard layout: Approve / Approve+steer / Reject / Cancel run */
        <div className="grid grid-cols-2 gap-2">
          <button
            data-testid="steering-approve"
            onClick={() => void approve()}
            disabled={loading}
            className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
            style={{ background: 'var(--status-run)', color: 'var(--surface-base)' }}
            {...(restoredRetry ? { title: "the evaluator's edit was discarded; the phase re-runs against the creator's verified tree" } : {})}
          >
            {restoredRetry ? 'Retry against the restored tree' : 'Approve'}
          </button>
          <button
            data-testid="steering-approve-steer"
            onClick={() => void approveWithSteer()}
            disabled={loading || !amend.trim()}
            className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            {restoredRetry ? 'Retry + steer' : 'Approve + steer'}
          </button>
          <button
            data-testid="steering-reject"
            onClick={() => void reject()}
            disabled={loading}
            className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
            style={{ background: 'var(--status-fail-dim)', border: '1px solid var(--status-fail-dim)', color: 'var(--status-fail)' }}
          >
            Reject
          </button>
          <button
            data-testid="steering-cancel"
            onClick={() => void cancel()}
            disabled={loading}
            className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--ink-dim)', color: 'var(--ink-muted)' }}
          >
            Cancel run
          </button>
        </div>
      )}

      {/* Mode-selector note / action hint */}
      {escalationGate && lift === null ? (
        <p className="text-[10px] font-mono mt-2" style={{ color: 'var(--ink-dim)' }}>
          Retry re-runs the failed unit · Request changes rewinds to the last creator phase (note required) · Reject cancels the run · Cancel run stops the run without a gate decision
        </p>
      ) : escalationGate && lift !== null ? (
        <p className="text-[10px] font-mono mt-2" style={{ color: 'var(--ink-dim)' }}>
          Retry re-dispatches the deliver unit (optionally with a note) · Reject fails the run
        </p>
      ) : (
        <p className="text-[10px] font-mono mt-2" style={{ color: 'var(--ink-dim)' }}>
          Workflow-declared gate — run-level human_confirm setting does not apply here.
          {' '}· a {restoredRetry ? 'retry' : 'approve'} · r reject while this card holds focus
        </p>
      )}
    </div>
  );
}
