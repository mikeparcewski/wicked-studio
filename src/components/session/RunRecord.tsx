import { RunPoolNote } from '../RunPoolNote.js';
import { RunInventoryNote, inventoryProgress } from '../RunInventoryNote.js';
import { useEffect, useMemo } from 'react';
import type { CoreEvent, SessionView } from '../../api/types.js';
import { endedAtMs, finishedAtMs } from '../../board/needsYou.js';
import { useProvenanceStore } from '../../store/provenance.js';
import { useRunEventStore } from '../../store/events.js';
import { parseDenial, sandboxOwner, stepDenialAdvice, stepDenialHeadline, type StructuredDenial } from '../denialCopy.js';
import { getCachedRoster } from '../../store/rosterCache.js';
import { degradedCouncil } from '../RunDegradedNote.js';
import { unitStepName } from '../../board/chainModel.js';
import { TechDetails } from '../ui/TechDetails.js';
import { useDisplayText } from '../../hooks/useHomePath.js';
import { RunIntentAmendments } from '../RunIntentAmendments.js';
import { WatchRunLines } from '../WatchLines.js';
import { everythingPath } from '../../board/everythingModel.js';
import { engineFailureOf } from '../../board/engineFailure.js';
import { consentDeclineOf } from '../../board/installOutcome.js';
import { deliverySummary, handedOf } from '../../board/proposalCard.js';

const EMPTY: readonly CoreEvent[] = [];

/** The failure-context "All runs ›" (§7.4): See everything › Sessions with the story's own lens —
 *  Stopped for a cancelled run, Failed for a halted one (studio#478). */
function AllRunsLink({ navigate, filter }: { navigate: (path: string) => void; filter: 'failed' | 'cancelled' }): React.ReactElement {
  const href = everythingPath({ tab: 'sessions', filter });
  return (
    <a href={href} data-testid="failure-all-runs" onClick={(e) => { e.preventDefault(); navigate(href); }} className="wk-link">All runs</a>
  );
}

/**
 * studio#1364: the run ended at a Decline at a consent gate (the MCP install after its pull request was delivered), read
 * off the run's one ended audit read; null for any other run, or until that read answers. The page's other words for a
 * cancelled run (its header badge, "Why it stopped", Start over) give way to it: a declined install is not a stopped job.
 */
export function useConsentDecline(view: SessionView | undefined): { install: boolean; ord: number } | null {
  const runId = view?.session.id ?? null;
  const cancelled = view?.session.status === 'cancelled';
  useEffect(() => { if (cancelled && runId !== null) useProvenanceStore.getState().load(runId, true); }, [runId, cancelled]);
  const story = useProvenanceStore((s) => (runId !== null ? s.cancelStories[runId] ?? null : null));
  return view !== undefined && cancelled ? consentDeclineOf(view, story) : null;
}

/**
 * S16a-1c: why a finished run stopped, said in its thread — the run page's FailureBanner story,
 * words verbatim (tests/FailureBanner.test.tsx's pins carry over), one quiet line under the status
 * sentence instead of a banner. Off the ONE audit fetch per run (`useProvenanceStore.load`):
 *  - cancelled · rejected       — "You rejected it: “…”" (the note the operator rejected with);
 *  - cancelled · engine-timeout — the daemon's turn-ceiling mark: the ENGINE stopped it;
 *  - cancelled · unattributed   — "Run cancelled." (+ the last send-back, which is NOT a rejection);
 *  - failed                     — each refused step's plain headline, advice and rules; the engine's
 *                                 own detail behind Technical details (studio#682 row 5).
 * Nothing for a run that did not stop (studio#537's misattribution fix lives in the store and holds).
 */
export function RunStory({ view, navigate, events = EMPTY }: {
  view: SessionView;
  navigate?: (path: string) => void;
  /** The run's trail: a failure no step was refused for says the engine's own reason (run clarity). */
  events?: readonly CoreEvent[];
}): React.ReactElement | null {
  const runId = view.session.id;
  const status = view.session.status;
  const stopped = status === 'cancelled' || status === 'failed';
  useEffect(() => { if (stopped) useProvenanceStore.getState().load(runId, true); }, [runId, stopped]);
  const rejectNote = useProvenanceStore((s) => s.rejectNotes[runId] ?? null);
  // The engine headline quotes the engine's first line: paths read `~`, technical details or not
  // (the same rule as Technical details below it — codex r3).
  const show = useDisplayText();
  const story = useProvenanceStore((s) => s.cancelStories[runId] ?? null);
  if (!stopped) return null;

  if (status === 'cancelled') {
    const stop = story?.stop ?? null;
    const shownStop = stop !== null && (stop.byPerson || stop.reason !== null) ? stop : null;
    // studio#1364: a Decline at a consent gate (the MCP install, after the pull request was delivered) is said as what
    // it was, with the delivery that stays; a rejection on record (words or not) is the reason, never an older send-back.
    const declined = consentDeclineOf(view, story);
    const rejected = rejectNote !== null || (story?.rejected ?? null) !== null;
    const engineStopped = shownStop === null && !rejected && story?.engineTimedOut === true;
    const sendBack = shownStop === null && !rejected ? story?.sendBackNote ?? null : null;
    if (declined !== null && shownStop === null) {
      const handed = handedOf(view);
      const pr = deliverySummary(view);
      return (
        <div data-testid="failure-banner" data-kind="cancelled" data-cause="declined" className="wk-session-run-story">
          <p data-testid="failure-declined" className="wk-session-run-story-line">
            {declined.install ? 'You declined the install, so nothing was installed.' : 'You declined this step, so it didn’t run.'}
            {handed?.href != null && <> <a href={handed.href} target="_blank" rel="noreferrer" className="wk-link">{pr ?? 'The pull request'}</a> was delivered and stays as it is.</>}
            {handed?.href == null && handed?.branch != null && <> The branch <code>{handed.branch}</code> was pushed and stays as it is.</>}
          </p>
        </div>
      );
    }
    return (
      <div data-testid="failure-banner" data-kind="cancelled" data-cause={shownStop !== null ? 'stopped' : rejected ? 'rejected' : engineStopped ? 'engine-timeout' : 'unattributed'} className="wk-session-run-story">
        {/* The status sentence already says "Cancelled"; the story says only WHY, when it is known. */}
        {engineStopped && <p className="wk-session-run-story-line">It was stopped automatically: a step ran past its time limit.</p>}
        {shownStop !== null && (
          <p className="wk-session-run-story-note">{shownStop.byPerson ? 'You stopped it' : 'It was stopped'}{shownStop.reason !== null ? <>: “{show(shownStop.reason)}”</> : '; no reason was given.'}</p>
        )}
        {shownStop === null && rejectNote !== null && (
          <p data-testid="failure-reject-note" className="wk-session-run-story-note">You rejected it: “{show(rejectNote)}”</p>
        )}
        {shownStop === null && rejectNote === null && rejected && (
          <p data-testid="failure-reject-note" className="wk-session-run-story-note">You rejected it; no reason was given.</p>
        )}
        {sendBack !== null && (
          <p data-testid="failure-send-back-note" className="wk-session-run-story-note">Your last send-back to the creator (acted on — not a rejection): “{show(sendBack)}”</p>
        )}
        {/* The door to the other stopped runs rides with a story; alone it is a stray link. */}
        {navigate !== undefined && (shownStop !== null || engineStopped || rejected || sendBack !== null) && <AllRunsLink navigate={navigate} filter="cancelled" />}
      </div>
    );
  }

  const denied = view.units.filter((u) => u.denial_reason || u.status === 'rejected');
  // Run clarity: no step was refused, so the run stopped as a whole (no helper could take it, the
  // engine errored): the trail's own reason, in one plain line — never "Failed" with no why.
  const engine = denied.length === 0 ? engineFailureOf(events) : null;
  // studio#682 row 5: the status sentence already says it stopped; the story names the STEP and what
  // to do in plain words. The engine's own prose (env vars, fence internals, paths) is Technical
  // details only, sanitized (paths read `~`).
  return (
    <div data-testid="failure-banner" data-kind="failed" className="wk-session-run-story wk-session-run-story--failed">
      {denied.map((u) => {
        const facts = parseDenial(u.denial_reason, (u as unknown as { denial?: StructuredDenial }).denial ?? null);
        return (
          <div key={u.id} data-testid="failure-plain" className="wk-session-run-story-note">
            <p className="wk-session-run-story-line">{stepDenialHeadline(facts, unitStepName(u), sandboxOwner(u.assigned_cli, getCachedRoster()))}</p>
            <p>
              {stepDenialAdvice(facts)}
              {navigate !== undefined && facts.ruleIds.map((id) => (
                <a key={id} href={`/steering/policies?rule=${id}`} data-testid="failure-rule-link" className="wk-link wk-session-story-link"
                  onClick={(e) => { e.preventDefault(); navigate(`/steering/policies?rule=${id}`); }}>
                  Review {id}
                </a>
              ))}
            </p>
            <TechDetails data-testid="failure-engine-detail" text={facts.raw} />
          </div>
        );
      })}
      {engine !== null && (
        <div data-testid="failure-engine" className="wk-session-run-story-note">
          <p className="wk-session-run-story-line">{show(engine.headline)}</p>
          <TechDetails data-testid="failure-engine-reason" text={engine.raw} />
        </div>
      )}
      {navigate !== undefined && <AllRunsLink navigate={navigate} filter="failed" />}
    </div>
  );
}

/**
 * The council-degraded disclosure on the session card (UI-CONTRACT §3; audit row 61): one plain
 * sentence, with the routing detail ("council degraded: 2 of 5 seats benched …") behind Technical
 * details. A review that stayed on the creator's own seat says THAT in the plain line — the
 * independence disclosure is never hidden, only its wording is.
 */
export function RunCheckersNote({ events }: { events: readonly CoreEvent[] }): React.ReactElement | null {
  const d = degradedCouncil(events);
  if (d === null) return null;
  // The independence disclosure keeps its meaning in plain words (narrator.narrateDistributionWarning).
  const line = /^evaluator ≠ creator not held/.test(d.reason)
    ? 'The helper that did the work also reviewed it: no other helper was available.'
    : /^evaluator ≠ creator held by seat instance only/.test(d.reason)
      ? 'The review ran on a separate copy of the same helper that did the work.'
      : /^evaluator ≠ creator/.test(d.reason)
        ? 'This review may not be independent of the work.'
        : 'Fewer helpers than planned reviewed this run.';
  return (
    <div data-testid="run-degraded" data-units={d.units} {...(d.ord !== null ? { 'data-ord': d.ord } : {})} className="wk-session-checkers">
      <p className="wk-session-grey">{line}</p>
      <TechDetails data-testid="run-degraded-detail" text={`${d.reason}${d.units > 1 ? ` · ${d.units} steps routed this way` : ''}`} />
    </div>
  );
}

/** wicked-crew#1566: the run may have started behind the remote (the daemon could not fetch origin): one quiet warning line. */
export function RunBaseNote({ runId }: { runId: string }): React.ReactElement | null {
  const showText = useDisplayText();
  useEffect(() => { useProvenanceStore.getState().load(runId); }, [runId]);
  const note = useProvenanceStore((s) => s.baseNotices[runId] ?? null);
  if (note === null) return null;
  return <p data-testid="run-base-unfetched" role="note" className="wk-session-base-note">{showText(note)}</p>;
}

/**
 * S16a-1c: the run's record lines under its status sentence — the cancel / stop story, the amended
 * acceptance list, the short-council note, and the Watchtower's lines (what was not checked; "You
 * jumped in from the Watchtower" with Back when the address carries `?jump=`). Each renders nothing
 * when there is nothing to say.
 */
export function RunRecordLines({ view, jumped, navigate, withStory = true }: {
  view: SessionView;
  jumped: boolean;
  navigate?: (path: string) => void;
  /** Run clarity: false when the host draws the stop story itself (above its recovery buttons). */
  withStory?: boolean;
}): React.ReactElement {
  const runId = view.session.id;
  const events = useRunEventStore((s) => s.byRun[runId]) ?? EMPTY;
  const isTerminal = ['completed', 'cancelled', 'failed'].includes(view.session.status);
  const endedMs = useMemo(() => (isTerminal ? (endedAtMs(view) ?? finishedAtMs(view)) : null), [isTerminal, view]);
  return (
    <>
      {withStory && <RunStory view={view} events={events} {...(navigate === undefined ? {} : { navigate })} />}
      <RunIntentAmendments session={view.session} />
      <RunCheckersNote events={events} />
      <RunPoolNote events={events} units={view.units} />
      <RunInventoryNote runId={view.session.id} progress={inventoryProgress(view.session.status, view.units)} />
      <WatchRunLines runId={runId} jumped={jumped} onBack={() => window.history.back()} isTerminal={isTerminal} endedMs={endedMs} />
    </>
  );
}
