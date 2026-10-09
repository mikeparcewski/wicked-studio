import { useEffect, useMemo } from 'react';
import type { CoreEvent, SessionView } from '../../api/types.js';
import { endedAtMs, finishedAtMs } from '../../board/needsYou.js';
import { useProvenanceStore } from '../../store/provenance.js';
import { useRunEventStore } from '../../store/events.js';
import { denialAdvice, denialHeadline, parseDenial, type StructuredDenial } from '../denialCopy.js';
import { RunDegradedNote } from '../RunDegradedNote.js';
import { RunIntentAmendments } from '../RunIntentAmendments.js';
import { WatchRunLines } from '../WatchLines.js';
import { everythingPath } from '../../board/everythingModel.js';

const EMPTY: readonly CoreEvent[] = [];

/** The failure-context "All runs ›" (§7.4): See everything › Sessions with the story's own lens —
 *  Stopped for a cancelled run, Failed for a halted one (studio#478). */
function AllRunsLink({ navigate, filter }: { navigate: (path: string) => void; filter: 'failed' | 'cancelled' }): React.ReactElement {
  const href = everythingPath({ tab: 'sessions', filter });
  return (
    <a href={href} data-testid="failure-all-runs" onClick={(e) => { e.preventDefault(); navigate(href); }} className="wk-since-toggle">All runs ›</a>
  );
}

/**
 * S16a-1c: why a finished run stopped, said in its thread — the run page's FailureBanner story,
 * words verbatim (tests/FailureBanner.test.tsx's pins carry over), one quiet line under the status
 * sentence instead of a banner. Off the ONE audit fetch per run (`useProvenanceStore.load`):
 *  - cancelled · rejected       — "You rejected it: “…”" (the note the operator rejected with);
 *  - cancelled · engine-timeout — the daemon's turn-ceiling mark: the ENGINE stopped it;
 *  - cancelled · unattributed   — "Run cancelled." (+ the last send-back, which is NOT a rejection);
 *  - failed                     — "Run halted." with each refused unit's headline, advice, rules and
 *                                 the engine's own detail.
 * Nothing for a run that did not stop (studio#537's misattribution fix lives in the store and holds).
 */
export function RunStory({ view, navigate }: { view: SessionView; navigate?: (path: string) => void }): React.ReactElement | null {
  const runId = view.session.id;
  const status = view.session.status;
  const stopped = status === 'cancelled' || status === 'failed';
  useEffect(() => { if (stopped) useProvenanceStore.getState().load(runId); }, [runId, stopped]);
  const rejectNote = useProvenanceStore((s) => s.rejectNotes[runId] ?? null);
  const story = useProvenanceStore((s) => s.cancelStories[runId] ?? null);
  if (!stopped) return null;

  if (status === 'cancelled') {
    const engineStopped = rejectNote === null && story?.engineTimedOut === true;
    const sendBack = rejectNote === null ? story?.sendBackNote ?? null : null;
    return (
      <div data-testid="failure-banner" data-kind="cancelled" data-cause={rejectNote !== null ? 'rejected' : engineStopped ? 'engine-timeout' : 'unattributed'} className="wk-session-run-story">
        <p className="wk-session-run-story-line">{engineStopped ? 'Run cancelled — the engine stopped it: a worker turn hit its time ceiling.' : 'Run cancelled.'}</p>
        {rejectNote !== null && (
          <p data-testid="failure-reject-note" className="wk-session-run-story-note">You rejected it: “{rejectNote}”</p>
        )}
        {sendBack !== null && (
          <p data-testid="failure-send-back-note" className="wk-session-run-story-note">Your last send-back to the creator (acted on — not a rejection): “{sendBack}”</p>
        )}
        {navigate !== undefined && <AllRunsLink navigate={navigate} filter="cancelled" />}
      </div>
    );
  }

  const denied = view.units.filter((u) => u.denial_reason || u.status === 'rejected');
  return (
    <div data-testid="failure-banner" data-kind="failed" className="wk-session-run-story wk-session-run-story--failed">
      <p className="wk-session-run-story-line">Run halted.</p>
      {denied.map((u) => {
        const facts = parseDenial(u.denial_reason, (u as unknown as { denial?: StructuredDenial }).denial ?? null);
        return (
          <div key={u.id} data-testid="failure-plain" className="wk-session-run-story-note">
            <p>{denialHeadline(facts, u.ord)}</p>
            <p>
              {denialAdvice(facts)}
              {navigate !== undefined && facts.ruleIds.map((id) => (
                <a key={id} href={`/steering/policies?rule=${id}`} data-testid="failure-rule-link" className="wk-since-toggle"
                  onClick={(e) => { e.preventDefault(); navigate(`/steering/policies?rule=${id}`); }}>
                  Review {id} ›
                </a>
              ))}
            </p>
            {facts.raw.length > 0 && <p data-testid="failure-engine-detail" className="wk-session-grey">engine detail: {facts.raw}</p>}
          </div>
        );
      })}
      {navigate !== undefined && <AllRunsLink navigate={navigate} filter="failed" />}
    </div>
  );
}

/**
 * S16a-1c: the run's record lines under its status sentence — the cancel / stop story, the amended
 * acceptance list, the short-council note, and the Watchtower's lines (what was not checked; "You
 * jumped in from the Watchtower" with Back when the address carries `?jump=`). Each renders nothing
 * when there is nothing to say.
 */
export function RunRecordLines({ view, jumped, navigate }: {
  view: SessionView;
  jumped: boolean;
  navigate?: (path: string) => void;
}): React.ReactElement {
  const runId = view.session.id;
  const events = useRunEventStore((s) => s.byRun[runId]) ?? EMPTY;
  const isTerminal = ['completed', 'cancelled', 'failed'].includes(view.session.status);
  const endedMs = useMemo(() => (isTerminal ? (endedAtMs(view) ?? finishedAtMs(view)) : null), [isTerminal, view]);
  return (
    <>
      <RunStory view={view} {...(navigate === undefined ? {} : { navigate })} />
      <RunIntentAmendments session={view.session} />
      <RunDegradedNote events={events} />
      <WatchRunLines runId={runId} jumped={jumped} onBack={() => window.history.back()} isTerminal={isTerminal} endedMs={endedMs} />
    </>
  );
}
