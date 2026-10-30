import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CircleCheck, CircleX, GitCommitHorizontal, Loader, Pencil, Search, Sparkles, Terminal, Users } from 'lucide-react';
import { activityRows, activitySummary, currentTurn, narration, turnEndedAt, visibleRows, workingWords, type ActivityKind, type LiveRow, type TurnRef } from '../../board/liveActivity.js';
import { seatLabel } from '../../board/seatNames.js';
import { useRoster } from '../../hooks/useRoster.js';
import { useRunEventStore } from '../../store/events.js';
import { outputKey, useRuntimeStore } from '../../store/runtime.js';

/**
 * What a working step is doing right now, live (operator 2026-10-30, "like Claude Code or Codex show"): the newest
 * few tool calls and edits, each with how long ago, and the step's newest line of its own words — refreshed every few
 * seconds while it runs. A finished step or turn says the same in one line ({@link ActivitySummaryLine}).
 */

const SHOWN = 5;
const ICON: Record<ActivityKind, typeof Pencil> = {
  read: BookOpen, search: Search, run: Terminal, test: CircleCheck, edit: Pencil, write: Pencil, commit: GitCommitHorizontal,
  skill: Sparkles, task: Users, other: Terminal, working: Loader,
};

function ago(at: number | null, now: number): string | null {
  if (at === null) return null;
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
}

export function LiveActivity({ runId, ord }: { runId: string; ord: number }): React.ReactElement | null {
  const events = useRunEventStore((s) => s.byRun[runId]);
  const output = useRuntimeStore((s) => s.outputs[outputKey(runId, ord)]);
  const roster = useRoster();
  const [now, setNow] = useState(() => Date.now());
  // Every few seconds: the ages move, and a row that just finished reads as finished.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 3000); return () => clearInterval(t); }, []);
  // A power build's orchestrator: the turn running now; any other step: its newest attempt. A turn that ended says
  // itself in one line on its message, so the live list folds away once its last calls have been in view a minute.
  const turn = useMemo(() => currentTurn(events, ord), [events, ord]);
  const endedAt = turn !== null ? turnEndedAt(events, ord, turn) : null;
  const all = useMemo(() => activityRows(events, ord, turn), [events, ord, turn]);
  const rows = visibleRows(all, endedAt, now);
  const said = useMemo(() => (endedAt !== null ? null : narration(output)), [output, endedAt]);
  if (rows.length === 0 && said === null) return null;
  const shown = rows.slice(-SHOWN);
  // A quiet seat's row counts its silence up live, by the seat's roster name ("Codex · working · last output 40 s ago").
  const textOf = (r: LiveRow): string => {
    if (r.working === undefined || r.working.quietSince === null) return r.text;
    const seat = (roster ?? []).find((s) => s.key === r.working!.seat);
    return workingWords(seatLabel(seat ?? { key: r.working.seat }), r.working.quietSince, now);
  };
  const earlier = rows.length - shown.length;
  return (
    <div data-testid="live-activity" data-ord={ord} data-count={rows.length} className="wk-live" aria-live="polite" aria-label="What it is doing now">
      {earlier > 0 && <p data-testid="live-activity-earlier" className="wk-live-earlier">{earlier} earlier</p>}
      <ul className="wk-live-list">
        {shown.map((r) => {
          const Icon = r.running ? Loader : r.ok === false ? CircleX : ICON[r.kind];
          return (
            <li key={r.key} data-testid="live-activity-row" data-kind={r.kind} data-running={r.running ? 'true' : 'false'} className={`wk-live-row${r.running ? ' wk-live-row--running' : ''}${r.ok === false ? ' wk-live-row--fail' : ''}`}>
              <Icon size={13} aria-hidden className="wk-live-icon" />
              <span className="wk-live-text">{textOf(r)}</span>
              {r.kind !== 'working' && ago(r.at, now) !== null && <span className="wk-live-ago">{ago(r.at, now)}</span>}
            </li>
          );
        })}
      </ul>
      {said !== null && <p data-testid="live-activity-said" className="wk-live-said">“{said}”</p>}
    </div>
  );
}

/** A finished step's or turn's activity, in one line: "Read 4 files · ran 7 commands · edited 3 files · 2 commits". */
export function ActivitySummaryLine({ runId, ord, turn = null }: { runId: string; ord: number; turn?: number | TurnRef | null }): React.ReactElement | null {
  const events = useRunEventStore((s) => s.byRun[runId]);
  const line = useMemo(() => activitySummary(events, ord, turn), [events, ord, turn]);
  return line === null ? null : <p data-testid="activity-summary" className="wk-live-summary">{line}</p>;
}
